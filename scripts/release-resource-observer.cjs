'use strict';

// Diagnostic-only Linux sampler. Runs separately so synchronous compiler/setup
// work cannot block sampling. It never signals the workload or grants evidence.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function parseStat(text, pageBytes) {
  const close = text.lastIndexOf(')');
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const f = text.slice(close + 2).trim().split(/\s+/);
  if (close < 0 || f.length < 22 || !Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid proc stat');
  const row = { pid, parent: Number(f[1]), group: Number(f[2]), state: f[0],
    cpuTicks: Number(f[11]) + Number(f[12]), startTicks: f[19], rssKiB: Math.max(0, Number(f[21])) * pageBytes / 1024 };
  if (![row.parent, row.group, row.cpuTicks, row.rssKiB].every(Number.isFinite) || !/^\d+$/.test(row.startTicks)) throw new Error('Invalid proc counters');
  row.key = `${pid}:${row.startTicks}`;
  return row;
}

function ownedRows(rows, rootKey, known) {
  const selected = new Map(rows.filter(r => r.key === rootKey || known.has(r.key)).map(r => [r.pid, r]));
  let size;
  do {
    size = selected.size;
    for (const row of rows) if (selected.has(row.parent)) selected.set(row.pid, row);
  } while (selected.size !== size);
  for (const row of selected.values()) known.add(row.key);
  return [...selected.values()];
}

function namespacePid(procPid) {
  const status = fs.readFileSync(`/proc/${procPid}/status`, 'utf8');
  const pids = status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).map(Number);
  return pids?.at(-1) ?? Number(procPid);
}

function resolveProcPid(pid) {
  // Some containers expose the ancestor's proc mount. Match both namespace and
  // innermost PID, never mistake a host process with the same numeric PID for ours.
  const namespace = fs.readlinkSync('/proc/self/ns/pid');
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (namespacePid(entry) === pid && fs.readlinkSync(`/proc/${entry}/ns/pid`) === namespace) return Number(entry);
    } catch (_) { /* exited or not visible */ }
  }
  throw new Error('Controller process is not visible in this proc namespace');
}

function schedulingSnapshot(report, taskMap, scheduling, compilerSlots) {
  if (!report || !Array.isArray(report.selectedTasks) || !Array.isArray(report.results)) return null;
  const complete = new Set(report.results.map(r => r.name));
  const activeNames = report.currentTasks || [];
  const activeSet = new Set(activeNames);
  const hint = name => ({ name, ...scheduling(name, taskMap[name]) });
  if (![...report.selectedTasks, ...activeNames].every(name => taskMap[name])) return null;
  const active = activeNames.map(hint);
  const pending = report.selectedTasks.filter(name => !complete.has(name) && !activeSet.has(name)).map(hint);
  const priority = Math.max(-1, ...active.map(r => r.priority), ...pending.map(r => r.priority));
  const held = new Set(active.flatMap(r => r.resources));
  const compilerActive = active.filter(r => r.compiler).length;
  // Queued work with no other hint-level blocker. It may also lack a free worker;
  // this is a sampled admission condition, not exclusively compiler-caused delay.
  const compilerLimited = pending.filter(r => r.compiler && r.priority === priority && compilerActive >= compilerSlots
    && r.after.every(name => report.results.some(x => x.name === name && x.status === 'passed'))
    && !r.resources.some(x => held.has(x)) && !(r.exclusive && active.length) && !active.some(x => x.exclusive));
  return { runId: report.runId, status: report.status, completed: complete.size, selected: report.selectedTasks.length,
    active: active.map(r => ({ name: r.name, compiler: r.compiler, phase: report.currentTaskPhases?.[r.name] || null })),
    pending: pending.length, compilerActive, compilerLimited: compilerLimited.map(r => r.name) };
}

function runSampler({ pid, directory, root, intervalMs = 200 }) {
  const { tasks } = require('../wasm/test/suite/registry.cjs');
  const { scheduling } = require('./release-parallel.cjs');
  const started = performance.now();
  const pageBytes = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8', timeout: 1000 }));
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 }));
  if (!(pageBytes > 0 && ticksPerSecond > 0)) throw new Error('Invalid proc units');
  const procPid = resolveProcPid(pid);
  const rootKey = parseStat(fs.readFileSync(`/proc/${procPid}/stat`, 'utf8'), pageBytes).key;
  const known = new Set(), cpu = new Map();
  const output = fs.openSync(path.join(directory, 'process-samples.jsonl'), 'wx');
  let peakRSS = 0, peakProcesses = 0, samples = 0, readErrors = 0, maxGapMs = 0, lastAt = null;
  let last = null, stopped = false, timer, error = null;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  function sample() {
    const at = performance.now() - started, rows = [];
    if (lastAt !== null) maxGapMs = Math.max(maxGapMs, at - lastAt);
    lastAt = at;
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try { rows.push(parseStat(fs.readFileSync(`/proc/${entry}/stat`, 'utf8'), pageBytes)); }
      catch (e) { if (!['ENOENT', 'ESRCH'].includes(e.code)) readErrors++; }
    }
    const owned = ownedRows(rows, rootKey, known);
    for (const row of owned) {
      cpu.set(row.key, Math.max(cpu.get(row.key) || 0, row.cpuTicks));
      try { row.namespacePid = namespacePid(row.pid); } catch (_) { row.namespacePid = null; }
      // Read argv only to classify asc. Never retain argv, paths, or environment.
      try { row.asc = fs.readFileSync(`/proc/${row.pid}/cmdline`, 'utf8').split('\0')
        .some(arg => /[/\\]assemblyscript[/\\]bin[/\\]asc\.js$/.test(arg)); }
      catch (_) { row.asc = null; }
    }
    let stage = null, schedule = null;
    try {
      const owner = read(path.join(root, '.pulse-seal/active.json'));
      if (owner.pid === pid && path.dirname(owner.directory) === path.join(root, '.pulse-seal/attempts')) {
        const report = read(path.join(owner.directory, 'report.json'));
        stage = report.currentStep;
        const file = stage === 'release' ? report.recovery?.artifacts?.taskReport
          : stage === 'installed-features' ? report.recovery?.artifacts?.featureTasks : null;
        if (file && path.resolve(file).startsWith(owner.directory + path.sep)) schedule = schedulingSnapshot(read(file), tasks, scheduling,
          report.recovery.context.scheduling.compilerWorkers);
      }
    } catch (_) { /* Reports do not exist until their stage starts. */ }
    const rssKiB = owned.reduce((n, r) => n + r.rssKiB, 0);
    peakRSS = Math.max(peakRSS, rssKiB); peakProcesses = Math.max(peakProcesses, owned.length); samples++;
    last = { elapsedMs: Math.round(at), stage, schedule, rssKiB,
      sampledCpuMs: [...cpu.values()].reduce((a, b) => a + b, 0) * 1000 / ticksPerSecond,
      processes: owned.map(({ pid, namespacePid, parent, group, key, state, cpuTicks, rssKiB, asc }) => ({ pid, namespacePid, parent, group, key, state, cpuTicks, rssKiB, asc })) };
    fs.writeSync(output, JSON.stringify(last) + '\n');
  }
  function finish() {
    if (stopped) return;
    stopped = true; clearInterval(timer);
    try { sample(); } catch (e) { error ||= e.message; }
    fs.closeSync(output);
    const summary = { schemaVersion: 'pulse.seal-process-observation.v1', status: error ? 'failed' : 'observed',
      error, rootProcess: rootKey, controllerNamespacePid: pid, intervalMs, samples, maxGapMs: Math.round(maxGapMs), readErrors,
      sampledCpuMs: last?.sampledCpuMs ?? null, peakSimultaneousProcessRSSKiB: peakRSS, peakProcessCount: peakProcesses,
      remainingObservedProcesses: last?.processes || [], elapsedMs: Math.round(performance.now() - started),
      scope: 'Linux /proc snapshots of controller and observed descendants, including detached children and known surviving identities; sampler excluded',
      limits: 'Sampled lower bounds: short-lived processes, exit CPU tails and unseen reparenting can be missed. RSS sums include shared pages in each process; not unique physical or cgroup memory. Idle/wait states are sampled report observations, not compiler CPU or precise admission events.' };
    fs.writeFileSync(path.join(directory, 'process-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.send?.({ type: 'summary', summary });
    process.disconnect?.();
  }
  sample();
  timer = setInterval(() => { try { sample(); } catch (e) { error ||= e.message; finish(); } }, intervalMs);
  process.on('message', msg => { if (msg?.type === 'stop') finish(); });
  process.on('disconnect', finish);
  process.once('SIGTERM', finish);
}

function startObserver(pid, directory, root) {
  if (process.platform !== 'linux') return { stop: async () => ({ status: 'unavailable', reason: 'Linux /proc required' }) };
  const child = spawn(process.execPath, [__filename, String(pid), directory, root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let summary = null, failure = '', settled = false;
  let resolve;
  const done = new Promise(value => { resolve = value; });
  child.on('message', msg => { if (msg?.type === 'summary') summary = msg.summary; });
  child.stderr.on('data', chunk => { failure = (failure + chunk).slice(-4096); });
  child.once('error', e => { failure = e.message; });
  child.once('close', code => { settled = true; resolve(summary || { status: 'failed', error: failure || `Observer exited ${code}` }); });
  return { stop: async () => {
    if (!settled && child.connected) child.send({ type: 'stop' }, e => { if (e) failure = e.message; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    try { return await done; } finally { clearTimeout(timer); }
  } };
}

module.exports = { parseStat, ownedRows, schedulingSnapshot, startObserver };
if (require.main === module) {
  try { runSampler({ pid: Number(process.argv[2]), directory: process.argv[3], root: process.argv[4] }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
