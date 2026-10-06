'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runSelectedTasks, runTask } = require('../../scripts/run-wasm-tests.cjs');
const { workerCount, prepareWorkspaces, cleanupWorkspaces, readLayout, assertManagedWorker } = require('../../../scripts/release-parallel.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { copySharedPack, recordPack, sharedPackEnv } = require('../../../scripts/release-shared-pack.cjs');

async function verifyParallel() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-parallel-check-'));
  const put = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  try {
    assert.equal(workerCount(8, 1536), 2);
    assert.equal(workerCount(4, 4096), 4);
    assert.throws(() => workerCount(9), /workers/);
    assert.throws(() => workerCount(2, 767), /memory-budget/);
    const candidateRoot = path.join(root, 'candidate');
    put(path.join(candidateRoot, '.gitignore'), 'node_modules/\ndist/\n.validation-tools/\n.pulse-seal/\n');
    put(path.join(candidateRoot, 'wasm/.keep'), '');
    put(path.join(candidateRoot, 'package.json'), '{"name":"fixture"}');
    put(path.join(candidateRoot, 'packages/one/package.json'), '{"name":"one"}');
    put(path.join(candidateRoot, 'packages/one/source.js'), 'source');
    put(path.join(candidateRoot, 'packages/one/dist/index.js'), 'build');
    put(path.join(candidateRoot, 'node_modules/external/index.js'), 'dependency');
    fs.symlinkSync(path.join(candidateRoot, 'packages/one'), path.join(candidateRoot, 'node_modules/one'), 'dir');
    const git = args => execFileSync('git', args, { cwd: candidateRoot, stdio: 'pipe' });
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'candidate']);
    const candidate = candidateIdentity(candidateRoot);
    const layout = prepareWorkspaces(candidateRoot, candidate, 2, 1536);
    assert.deepEqual(readLayout(candidateRoot, candidate, 2, 1536), layout);
    for (const worker of layout.workspaces) {
      assert.equal(fs.realpathSync(path.join(worker.directory, 'node_modules/one')), path.join(worker.directory, 'packages/one'));
      assert.equal(fs.readFileSync(path.join(worker.directory, 'packages/one/dist/index.js'), 'utf8'), 'build');
    }
    fs.writeFileSync(path.join(layout.workspaces[0].directory, 'node_modules/external/index.js'), 'worker mutation');
    assert.equal(fs.readFileSync(path.join(layout.workspaces[1].directory, 'node_modules/external/index.js'), 'utf8'), 'dependency');
    assert.equal(fs.readFileSync(path.join(candidateRoot, 'node_modules/external/index.js'), 'utf8'), 'dependency');
    const pack = path.join(candidateRoot, '.pulse-seal/pack');
    put(path.join(pack, 'pulse-release-manifest.json'), '{"packageCount":1}');
    recordPack({ repoRoot: candidateRoot, outDir: pack }, candidate);
    const layoutFile = path.join(path.dirname(layout.workspaces[0].directory), 'layout.json');
    const copy = path.join(root, 'consumer-pack');
    const worker = layout.workspaces[0];
    assert.throws(() => copySharedPack({ repoRoot: worker.directory, outDir: copy }, sharedPackEnv(pack)), /another checkout/);
    copySharedPack({ repoRoot: worker.directory, outDir: copy }, { ...sharedPackEnv(pack), PULSEWASM_SEAL_WORKER_LAYOUT: layoutFile });
    assert.throws(() => assertManagedWorker(candidateRoot, candidateRoot, candidate, layoutFile), /Unowned/);
    assert.deepEqual(candidateIdentity(candidateRoot), candidate);
    // A retry rebuilds private inputs at the same bound paths.
    prepareWorkspaces(candidateRoot, candidate, 2, 1536);
    assert.equal(fs.readFileSync(path.join(worker.directory, 'node_modules/external/index.js'), 'utf8'), 'dependency');
    cleanupWorkspaces(candidateRoot, candidate.sourceTree, 2);
    assert(!fs.existsSync(worker.directory));
    assert.equal(git(['worktree', 'list', '--porcelain']).toString().match(/^worktree /gm).length, 1);
    assert.deepEqual(candidateIdentity(candidateRoot), candidate);

    const workspaces = [1, 2].map(index => ({ id: `worker-${index}`, directory: path.join(root, `executor-${index}`) }));
    workspaces.forEach(item => fs.mkdirSync(path.join(item.directory, 'wasm'), { recursive: true }));
    const originalScript = path.resolve(__dirname, '../../.test-results', `parallel-execution-${process.pid}.cjs`);
    put(originalScript, "throw new Error('Executed primary checkout');");
    try {
      for (const workspace of workspaces) put(path.join(workspace.directory, path.relative(path.resolve(__dirname, '../../..'), originalScript)),
        "require('node:fs').writeFileSync('private-script-output', process.cwd());");
      const state = { results: [], sourceEnv: {} };
      await runSelectedTasks({ state, selection: { selected: ['absolute-script'] }, workspaces,
        taskMap: { 'absolute-script': { command: process.execPath, args: [originalScript], evidence: 'unit', description: 'absolute script', timeoutMs: 3000 } } });
      assert.equal(state.results[0].status, 'passed');
      assert.equal(state.results[0].commandSignature, require('node:crypto').createHash('sha256')
        .update(JSON.stringify({ command: process.execPath, args: [originalScript], timeoutMs: 3000, evidence: 'unit' })).digest('hex'),
      'Canonical signature must retain source definition');
    } finally { fs.rmSync(originalScript, { force: true }); }
    const trace = path.join(root, 'trace');
    const source = `const fs=require('node:fs');const [name,trace,fail,delay]=process.argv.slice(1);
      fs.appendFileSync(trace,JSON.stringify({name,event:'start',at:Date.now(),cwd:process.cwd()})+'\\n');
      fs.writeFileSync('shared-output',name);
      setTimeout(()=>{fs.appendFileSync(trace,JSON.stringify({name,event:'end',at:Date.now()})+'\\n');process.exitCode=fs.existsSync(fail)?9:0;},Number(delay));`;
    function task(name, scheduling = {}, delay = 160) {
      return { command: process.execPath, args: ['-e', source, name, trace, path.join(root, `fail-${name}`), String(delay)],
        evidence: 'unit', description: name, timeoutMs: 3000, scheduling };
    }
    async function attempt(label, taskMap, previous = null, parallel = true, signal) {
      const names = Object.keys(taskMap), directory = path.join(root, label), runDir = path.join(directory, 'runs');
      fs.mkdirSync(path.join(runDir, 'tasks'), { recursive: true });
      const state = { results: [], runDir, sourceEnv: {} };
      const config = { schemaVersion: 'pulse.seal-task-recovery.v1', context: { fixture: 'parallel', names },
        directory: path.join(directory, 'checkpoints'), previousDirectory: previous?.config.directory,
        selectedTasks: names, taskOptions: {}, dependencies: { 'shared-pack': 'same-pack' } };
      await runSelectedTasks({ state, selection: { requested: names, selected: names }, taskMap, recoveryConfig: config,
        workspaces: parallel ? workspaces : [workspaces[0]], signal,
        taskRunOptions: { terminationGraceMs: 25, killGraceMs: 25 } });
      return { state, config };
    }
    const tasks = { a: task('a', { resources: ['provider'] }), b: task('b', { resources: ['provider'] }),
      c: task('c'), d: task('d', { after: ['a'] }), benchmark: task('benchmark', { exclusive: true, cost: 100 }) };
    const parallel = await attempt('parallel', tasks);
    assert.deepEqual(parallel.state.results.map(item => [item.name, item.status]), Object.keys(tasks).map(name => [name, 'passed']));
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    const interval = name => events.filter(item => item.name === name);
    assert(interval('benchmark')[1].at <= Math.min(interval('a')[0].at, interval('c')[0].at), 'Benchmark must execute alone');
    assert(interval('a')[1].at <= interval('b')[0].at, 'Dependency and shared provider lock must serialize');
    assert(interval('a')[1].at <= interval('d')[0].at, 'Dependency must finish before its consumer');
    assert(interval('a')[0].cwd !== interval('c')[0].cwd, 'Overlapping tasks need isolated outputs');
    fs.writeFileSync(trace, '');
    const serial = await attempt('serial', tasks, null, false);
    assert.deepEqual(serial.state.results.map(item => [item.name, item.status]), parallel.state.results.map(item => [item.name, item.status]));
    fs.writeFileSync(trace, '');
    const late = { a: task('a'), b: task('b'), late: task('late', { after: ['a', 'b'] }) };
    fs.writeFileSync(path.join(root, 'fail-late'), 'fail');
    const failed = await attempt('failed', late);
    assert.deepEqual(failed.state.results.map(item => item.status), ['passed', 'passed', 'failed']);
    fs.rmSync(path.join(root, 'fail-late')); fs.writeFileSync(trace, '');
    const resumed = await attempt('resumed', late, failed);
    assert.deepEqual(resumed.state.results.map(item => item.execution), ['reused', 'reused', 'executed']);
    assert.deepEqual(resumed.state.results.slice(0, 2).map(item => item.checkpoint.proofId), failed.state.results.slice(0, 2).map(item => item.checkpoint.proofId));
    fs.writeFileSync(path.join(root, 'fail-a'), 'fail');
    const siblings = await attempt('sibling-failure', { a: task('a', {}, 120), b: task('b', {}, 2000), queued: task('queued') });
    assert.equal(siblings.state.error.code, 'PULSE_PARALLEL_TASK_FAILED');
    assert.deepEqual(siblings.state.results.map(item => item.status), ['failed', 'interrupted']);
    assert(siblings.state.results.every(item => item.cleanup.status === 'passed'));
    fs.rmSync(path.join(root, 'fail-a'));
    const controller = new AbortController();
    const waiting = { a: task('a', {}, 2000), b: task('b', {}, 2000) };
    const timer = setTimeout(() => controller.abort('SIGTERM'), 100);
    const interrupted = await attempt('interrupted', waiting, null, true, controller.signal);
    clearTimeout(timer);
    assert.equal(interrupted.state.results.length, 2);
    assert(interrupted.state.results.every(item => item.status === 'interrupted' && item.cleanup.status === 'passed'));
    assert.deepEqual(interrupted.state.currentTasks, []);
    const observer = await runTask('observer', task('observer', {}, 2000), {
      cwd: path.join(workspaces[0].directory, 'wasm'), terminationGraceMs: 25, killGraceMs: 25,
      onChild(child) { if (child) throw new Error('Cannot persist child tracking'); }
    });
    assert.equal(observer.status, 'interrupted');
    assert.equal(observer.interruptedBy, 'observer-failure');
    assert.equal(observer.cleanup.status, 'passed');
    assert.deepEqual(observer.remainingProcessTree, []);
    console.log('ok - isolated workers, serial equivalence, dependency/resource locks, exclusive benchmarks, cancellation and retained recovery');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
module.exports = { verifyParallel };
if (require.main === module) verifyParallel().catch(error => { console.error(error.stack); process.exitCode = 1; });
