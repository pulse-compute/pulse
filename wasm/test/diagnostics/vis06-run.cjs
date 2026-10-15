'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { sha256 } = require('./vis06-derivation.cjs');

function supervise({ input, mode, output, timeoutMs = 60000, rssMiB = 1536, heapMiB = 1024,
  worker = path.join(__dirname, 'vis06-worker.cjs') }) {
  for (const [name, value] of Object.entries({ timeoutMs, rssMiB, heapMiB })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  }
  if (process.platform !== 'linux') throw new Error('VIS06 RSS watchdog requires Linux /proc');
  if (!['limited', 'unrestricted', 'relations'].includes(mode)) throw new Error('Invalid diagnostic mode');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an attempted-run receipt');
  const receipt = { version: 'pulse.vis06-measurement.v1', status: 'running', mode,
    inputSha256: sha256(fs.readFileSync(input)), startedAt: new Date().toISOString(),
    watchdog: { timeoutMs, rssMiB, heapMiB, sampleIntervalMs: 20 },
    sampledPeakRssBytes: 0, progress: [], qualification: false };
  const write = () => { fs.writeFileSync(output + '.tmp', JSON.stringify(receipt, null, 2) + '\n'); fs.renameSync(output + '.tmp', output); };
  write();
  return new Promise(resolve => {
    const start = performance.now(); let failure = null, result = null, stderr = '', procPid = null;
    const parentProcPid = fs.readlinkSync('/proc/self');
    const child = fork(worker, [input, mode], { execArgv: [`--max-old-space-size=${heapMiB}`,
      '--require', path.join(__dirname, 'vis06-memory-probe.cjs')],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], detached: true });
    receipt.pid = child.pid;
    const kill = reason => {
      if (failure) return; failure = reason; receipt.failure = reason; write();
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    const interval = setInterval(() => {
      if (!procPid) { if (performance.now() - start > 1000) kill('watchdog-unavailable'); return; }
      try {
        const status = fs.readFileSync(`/proc/${procPid}/status`, 'utf8');
        if (/^State:\s+Z/m.test(status)) return;
        if (/^PPid:\s+(\d+)/m.exec(status)?.[1] !== parentProcPid) return kill('watchdog-identity-mismatch');
        const value = /^VmRSS:\s+(\d+)/m.exec(status)?.[1];
        if (!value) return kill('watchdog-unavailable');
        const rss = Number(value) * 1024;
        receipt.sampledPeakRssBytes = Math.max(receipt.sampledPeakRssBytes, rss);
        if (rss > rssMiB * 1024 * 1024) kill('rss-watchdog');
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) kill('watchdog-unavailable'); }
    }, 20);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('message', message => {
      if (message.watchdogIdentity) {
        if (message.watchdogIdentity.pid !== child.pid || !/^\d+$/.test(message.watchdogIdentity.procPid)) return kill('watchdog-identity-mismatch');
        procPid = message.watchdogIdentity.procPid;
        receipt.watchdog.procPid = procPid;
      } else if (message.result) result = message.result;
      else if (message.error) { receipt.error = message.error; failure ||= 'worker-exception'; }
      else {
        // Keep each completed stage, plus the latest consumer progress; do not
        // turn every consumer into an unbounded parent-side trace.
        if (message.counters) receipt.lastConsumer = message;
        else receipt.progress.push(message);
        write();
      }
    });
    child.on('error', error => { failure ||= 'spawn-error'; receipt.error = { message: error.message }; });
    const interrupted = () => kill('interrupted');
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearInterval(interval);
      process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
      receipt.elapsedMs = performance.now() - start; receipt.exitCode = code; receipt.signal = signal;
      receipt.stderr = stderr; receipt.completedAt = new Date().toISOString();
      if (!failure && /heap out of memory|allocation failed/i.test(stderr)) failure = 'heap-oom';
      if (!failure && code === 0 && result?.status === 'completed' && receipt.sampledPeakRssBytes === 0) failure = 'watchdog-unavailable';
      receipt.status = !failure && code === 0 && result?.status === 'completed' ? 'completed' : 'incomplete';
      receipt.failure = receipt.status === 'completed' ? null : failure || 'worker-exit-without-completion';
      receipt.result = result; write(); resolve(receipt);
    });
  });
}
module.exports = { supervise };
if (require.main === module) {
  const [input, mode, output, timeout = '60000', rss = '1536', heap = '1024'] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: vis06-run.cjs INPUT limited|unrestricted|relations OUTPUT [TIMEOUT_MS RSS_MIB HEAP_MIB]');
  supervise({ input: path.resolve(input), mode, output: path.resolve(output), timeoutMs: Number(timeout), rssMiB: Number(rss), heapMiB: Number(heap) })
    .then(r => { console.log(JSON.stringify({ status: r.status, failure: r.failure, output })); process.exitCode = r.status === 'completed' ? 0 : 1; });
}
