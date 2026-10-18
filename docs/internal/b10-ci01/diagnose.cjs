'use strict';

// Development comparison only. Run this identical driver against two clean
// checkouts; it neither qualifies a release nor creates reusable task proofs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('Usage: node diagnose.cjs <clean-checkout> <new-output-directory>');
const root = path.resolve(rootArg), out = path.resolve(outArg);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Diagnostic requires a clean candidate');
fs.mkdirSync(out); // Refuse to overwrite an earlier attempt.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runnerPath = path.join(root, 'wasm/scripts/run-wasm-tests.cjs');
const source = fs.readFileSync(runnerPath, 'utf8');
const functionSource = source.slice(source.indexOf('function finishLog(stream)'), source.indexOf('\nfunction cleanupTaskOutputs')).trim();
const finishLog = vm.runInNewContext(`(${functionSource})`, { Promise, setTimeout, clearTimeout, setImmediate, clearImmediate });
const { runSelectedTasks } = require(runnerPath);
const { startObserver } = require(path.join(root, 'scripts/release-resource-observer.cjs'));
const stall = ms => { const until = performance.now() + ms; while (performance.now() < until) {} };
const report = {
  schemaVersion: 'pulse.b10-ci01.log-close-diagnostic.v1',
  candidate: { revision: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), workingTree: 'clean' },
  node: process.version, nodeSha256: hash(fs.readFileSync(process.execPath)),
  lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
  runnerSha256: hash(source), functionSha256: hash(functionSource), driverSha256: hash(fs.readFileSync(__filename)),
  scope: 'Built-in-only fixtures; 2 diagnostic task directories, 1 compiler token, no compiler workload, checkpoint reuse or release qualification. Warm tools and filesystem; sequential control/changed runs.',
  primitive: [], concurrent: []
};

async function main() {
  fs.mkdirSync(path.join(out, 'observer'));
  const observer = startObserver(process.pid, path.join(out, 'observer'), root);
  try {
    for (const [index, blockMs] of [0, 1200, 1200, 1200].entries()) {
      const file = path.join(out, `primitive-${index}.log`), stream = fs.createWriteStream(file);
      const bytes = Buffer.from('complete fixture output\n');
      await new Promise((resolve, reject) => { stream.once('error', reject); stream.write(bytes, resolve); });
      const closed = new Promise(resolve => stream.once('close', resolve));
      const began = performance.now(), result = finishLog(stream);
      stall(blockMs);
      const error = await result;
      await closed;
      report.primitive.push({ blockMs, error: error || null, elapsedMs: Math.round(performance.now() - began),
        closed: stream.closed, writableFinished: stream.writableFinished,
        completeBytes: fs.readFileSync(file).equals(bytes), sha256: hash(fs.readFileSync(file)) });
    }
    for (const blockMs of [0, 1200]) {
      const directory = path.join(out, `concurrent-${blockMs}`), runDir = path.join(directory, 'run');
      fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
      const workspaces = [1, 2].map(i => ({ id: `worker-${i}`, directory: path.join(directory, `worker-${i}`) }));
      for (const workspace of workspaces) fs.mkdirSync(path.join(workspace.directory, 'wasm'), { recursive: true });
      const trace = path.join(directory, 'trace.jsonl');
      const taskMap = Object.fromEntries(['a', 'b'].map(name => [name, {
        command: process.execPath, args: ['-e', `const fs=require('node:fs');
          const record=event=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({name:${JSON.stringify(name)},event,at:Date.now()})+'\\n');
          record('start');process.stdout.write(${JSON.stringify(`${name}: complete task log\n`)});
          setTimeout(()=>record('end'),200);`],
        evidence: 'unit', description: 'bounded real task-log diagnostic', timeoutMs: 10000
      }]));
      const createWriteStream = fs.createWriteStream, streams = [];
      const state = { results: [], runDir, sourceEnv: {} }, began = performance.now();
      try {
        fs.createWriteStream = function(file, ...args) {
          const stream = createWriteStream.call(this, file, ...args);
          if (String(file).startsWith(path.join(runDir, 'tasks') + path.sep)) {
            streams.push(stream);
            const end = stream.end;
            stream.end = function(...endArgs) { const result = end.apply(this, endArgs); stall(blockMs); return result; };
          }
          return stream;
        };
        await runSelectedTasks({ state, selection: { requested: ['a', 'b'], selected: ['a', 'b'] }, taskMap,
          workspaces, compilerWorkers: 1, taskRunOptions: { terminationGraceMs: 25, killGraceMs: 25 } });
      } finally { fs.createWriteStream = createWriteStream; }
      const events = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
      report.concurrent.push({ blockMs, elapsedMs: Math.round(performance.now() - began),
        overlappingExecution: Math.max(...events.filter(r => r.event === 'start').map(r => r.at)) <
          Math.min(...events.filter(r => r.event === 'end').map(r => r.at)),
        activeTasksAfter: state.currentTasks, streamsClosed: streams.every(s => s.closed),
        results: state.results.map(result => ({ name: result.name, status: result.status, error: result.error,
          durationMs: result.durationMs, cleanup: result.cleanup, retainedTaskRoot: result.retainedTaskRoot,
          remainingProcessTree: result.remainingProcessTree,
          log: fs.readFileSync(path.join(runDir, 'tasks', `${result.name}.log`), 'utf8'),
          logSha256: hash(fs.readFileSync(path.join(runDir, 'tasks', `${result.name}.log`))) })) });
    }
  } finally { report.observer = await observer.stop(); }
  report.terminalWorkingTree = git('status', '--porcelain');
  report.status = 'completed'; // Diagnostic completion, not workload success.
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
