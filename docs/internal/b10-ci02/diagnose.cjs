'use strict';

// Development evidence only. Use this identical driver against both clean
// candidates. Feature names below exercise the production worker/recovery path
// with explicitly substituted development tasks, never installed acceptance.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function metrics() {
  const directory = process.env.PULSE_CI02_DIAGNOSTIC_METRICS;
  if (directory) process.once('exit', code => fs.writeFileSync(path.join(directory, `${process.pid}-${randomUUID()}.json`),
    JSON.stringify({ pid: process.pid, code, usage: process.resourceUsage() })));
}
if (require.main !== module) { metrics(); return; }
const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) throw Error('Usage: node diagnose.cjs <clean-checkout> <new-output-directory>');
const root = fs.realpathSync(rootArg), out = path.resolve(outArg);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw Error('Diagnostic requires a clean candidate');
fs.mkdirSync(out);
for (const name of ['phases', 'metrics']) fs.mkdirSync(path.join(out, name));
process.env.PULSEWASM_TEST_PHASE_DIR = path.join(out, 'phases');
process.env.PULSE_CI02_DIAGNOSTIC_METRICS = path.join(out, 'metrics');
const phaseFile = path.join(root, 'wasm/test/support/phase-observer.cjs');
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${phaseFile} --require=${__filename}`.trim();
metrics();
const phase = require(phaseFile);
const parallel = require(path.join(root, 'scripts/release-parallel.cjs'));
const recovery = require(path.join(root, 'scripts/release-recovery.cjs'));
const { candidateIdentity, REQUIRED_TASKS: names } = require(path.join(root, 'scripts/release-feature-acceptance.cjs'));
const { runTask, runSelectedTasks } = require(path.join(root, 'wasm/scripts/run-wasm-tests.cjs'));
const { startObserver } = require(path.join(root, 'scripts/release-resource-observer.cjs'));
const candidate = candidateIdentity(root);
const report = { status: 'running', candidate, controllerPid: process.pid, node: process.version,
  nodeSha256: hash(fs.readFileSync(process.execPath)), driverSha256: hash(fs.readFileSync(__filename)),
  lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
  offloaded: Boolean(parallel.verifyWorkerAsync), rows: [],
  scope: 'Warm local development comparison; identical full byte checks. Two isolated workers, one compiler slot. No installed acceptance or release qualification.' };
const round = value => Math.round(value * 1000) / 1000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function measure(label, operation) {
  const directory = path.join(out, label); fs.mkdirSync(directory);
  const observer = startObserver(process.pid, directory, root);
  const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
  let last = performance.now(), excess = 0, max = 0, ticks = 0;
  const timer = setInterval(() => { const now = performance.now(), late = Math.max(0, now - last - 10);
    excess += late; max = Math.max(max, late); ticks++; last = now; }, 10);
  await pause(30);
  const start = performance.now(), wallStart = Date.now(), utilization = performance.eventLoopUtilization();
  let value, observed;
  try { value = await phase.measure(`ci02.${label}`, operation); }
  finally {
    const elapsedMs = performance.now() - start;
    const elu = performance.eventLoopUtilization(utilization);
    await pause(30); clearInterval(timer); histogram.disable();
    observed = await observer.stop();
    report.rows.push({ label, wallStart, elapsedMs: round(elapsedMs), eventLoop: {
      ticks, maxTickLatenessMs: round(max), accumulatedTickLatenessMs: round(excess),
      histogramMaxMs: round(histogram.max / 1e6), histogramP99Ms: round(histogram.percentile(99) / 1e6),
      activeMs: round(elu.active), idleMs: round(elu.idle) }, observer: observed, value });
  }
  return value;
}
async function main() {
  let layout;
  try {
    report.inputs = recovery.inputIdentity(root);
    layout = parallel.prepareWorkspaces(root, candidate, 2, 6144, 1);
    const bindings = layout.workspaces.map(worker => ({ root, candidate, directory: worker.directory,
      layoutFile: path.join(path.dirname(worker.directory), 'layout.json'), inputs: recovery.inputIdentity(worker.directory) }));
    report.workerInputs = bindings.map(binding => binding.inputs);
    // The original B10-01 diagnostic, unchanged: all five scans synchronous.
    for (let index = 0; index < 3; index++) await measure(`original-empty-${index}`, async () => {
      const times = [];
      for (const [name, fn] of [['preTask', parallel.verifyWorker], ['firstCleanup', parallel.cleanupWorker], ['reconcile', parallel.cleanupWorker]]) {
        const start = performance.now(); fn(bindings[0]); times.push({ name, elapsedMs: round(performance.now() - start) });
      }
      return times;
    });
    // Actual current admission + runTask path: first cleanup stays in its child.
    for (let index = 0; index < 3; index++) await measure(`empty-task-${index}`, async () => {
      await (parallel.verifyWorkerAsync || parallel.verifyWorker)(bindings[0]);
      const result = await runTask('empty-worker', { command: process.execPath, args: ['-e', ''],
        evidence: 'unit', description: 'empty worker diagnostic', timeoutMs: 10000 },
      { workerCleanup: bindings[0], cwd: path.join(bindings[0].directory, 'wasm') });
      if (result.status !== 'passed') throw Error(JSON.stringify(result));
      return result;
    });
    const actual = ['canonical-api-lowering', 'javascript-effect-adapter', 'continuation-registry', 'api-surface'];
    report.taskMapping = Object.fromEntries(names.map((name, index) => [name, name === 'str02b-installed' ? 'api-surface' : actual[index % actual.length]]));
    const fixtureTasks = Object.fromEntries(names.map(name => [name, {
      command: process.execPath, args: ['-e', `const fs=require('node:fs'),path=require('node:path');
        const name=${JSON.stringify(report.taskMapping[name])}, task=require('./test/suite/registry.cjs').tasks[name];
        require('node:child_process').execFileSync(task.command,task.args,{stdio:'inherit',timeout:task.timeoutMs});
        fs.mkdirSync(process.env.PULSE_RELEASE_FEATURE_REPORT_DIR,{recursive:true});
        fs.writeFileSync(path.join(process.env.PULSE_RELEASE_FEATURE_REPORT_DIR,${JSON.stringify(name + '.json')}),
          JSON.stringify({diagnostic:true,actualTask:name}));`],
      evidence: 'unit', description: `CI02 diagnostic: ${report.taskMapping[name]}`, timeoutMs: 180000,
      scheduling: { compiler: report.taskMapping[name] === 'canonical-api-lowering' }
    }]));
    const context = { schemaVersion: recovery.SCHEMA, candidate: { ...candidate, repoRoot: root },
      selections: { features: names }, scheduling: { ...layout,
        workspaces: layout.workspaces.map((worker, index) => ({ ...worker, inputs: bindings[index].inputs })) } };
    for (let index = 0; index < 2; index++) await measure(`concurrent-${index}`, async () => {
      const directory = path.join(out, `workload-${index}`), artifacts = recovery.artifactPaths(directory);
      const config = recovery.recoveryConfig({ directory, context, artifacts, sharedPack: { proofId: 'diagnostic-only' } }, 'features', names);
      const state = { results: [], runDir: path.join(directory, 'runs'), sourceEnv: {} };
      fs.mkdirSync(path.join(state.runDir, 'tasks'), { recursive: true });
      const trace = [];
      await runSelectedTasks({ state, selection: { selected: names, requested: names }, recoveryConfig: config,
        taskMap: fixtureTasks, workspaces: layout.workspaces, compilerWorkers: 1,
        persist() { trace.push({ at: Date.now(), tasks: state.currentTasks, phases: { ...state.currentTaskPhases } }); } });
      const result = { results: state.results, error: state.error || null, trace,
        logs: state.results.map(item => { const file = path.resolve(root, 'wasm', item.logPath), bytes = fs.readFileSync(file);
          return { name: item.name, bytes: bytes.length, sha256: hash(bytes) }; }) };
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
      if (state.error || state.results.length !== names.length || state.results.some(item => item.status !== 'passed')) throw Error('Incomplete concurrent diagnostic');
      return result;
    });
    for (const binding of bindings) parallel.verifyWorker(binding);
    report.status = 'completed';
  } finally {
    if (layout) parallel.cleanupWorkspaces(root, candidate.sourceTree, 2);
    report.terminalCandidate = candidateIdentity(root);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
