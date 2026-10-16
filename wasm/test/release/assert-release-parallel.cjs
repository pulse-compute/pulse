'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runSelectedTasks, runTask } = require('../../scripts/run-wasm-tests.cjs');
const { workerCount, compilerCount, prepareWorkspaces, cleanupWorkspaces, readLayout, assertManagedWorker, cleanupWorker, verifyWorker, scheduling } = require('../../../scripts/release-parallel.cjs');
const recovery = require('../../../scripts/release-recovery.cjs');
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
    assert.equal(compilerCount(4, 2), 2);
    assert.throws(() => compilerCount(0, 2), /compiler-workers/);
    const registry = require('../suite/registry.cjs').tasks;
    for (const name of ['jwt-rs256', 'clean-machine-acceptance', 'schema-codecs', 'fastly-native-platform-capabilities',
      'cli-report-capture-proof', 'node-launcher', 'node01-installed', 'ast02d-installed', 'assets-native-embedded', 's3-body-installed']) {
      assert.equal(scheduling(name, registry[name]).compiler, true, `${name} must consume a compiler slot`);
    }
    assert.equal(scheduling('release-artifact-determinism', registry['release-artifact-determinism']).compiler, false);
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
    const sibling = layout.workspaces[1].directory;
    const temporary = path.join(sibling, 'packages/one/active-fixture.js');
    put(temporary, 'temporary');
    assert.throws(() => readLayout(candidateRoot, candidate, 2, 1536), /clean candidate/);
    copySharedPack({ repoRoot: worker.directory, outDir: copy }, { ...sharedPackEnv(pack), PULSEWASM_SEAL_WORKER_LAYOUT: layoutFile });
    const tracked = path.join(sibling, 'packages/one/source.js');
    put(tracked, 'changed source');
    assert.throws(() => copySharedPack({ repoRoot: worker.directory, outDir: copy },
      { ...sharedPackEnv(pack), PULSEWASM_SEAL_WORKER_LAYOUT: layoutFile }), /Worker candidate differs/);
    put(tracked, 'source');
    fs.rmSync(temporary);
    assert.deepEqual(readLayout(candidateRoot, candidate, 2, 1536), layout);
    assert.throws(() => assertManagedWorker(candidateRoot, candidateRoot, candidate, layoutFile), /Unowned/);
    assert.deepEqual(candidateIdentity(candidateRoot), candidate);
    // A retry rebuilds private inputs at the same bound paths.
    prepareWorkspaces(candidateRoot, candidate, 2, 1536);
    assert.equal(fs.readFileSync(path.join(worker.directory, 'node_modules/external/index.js'), 'utf8'), 'dependency');
    const binding = { root: candidateRoot, candidate, directory: worker.directory, layoutFile, inputs: recovery.inputIdentity(worker.directory) };
    put(path.join(worker.directory, 'generated/retained.lock'), 'task residue');
    put(path.join(sibling, 'active-sibling'), 'sibling output');
    assert.throws(() => verifyWorker(binding), /clean candidate/);
    const cleaned = cleanupWorker(binding);
    assert.deepEqual(cleaned, { status: 'passed', removed: ['generated/retained.lock'] });
    assert(fs.existsSync(path.join(sibling, 'active-sibling')), 'Never clean a sibling task');
    assert.deepEqual(candidateIdentity(worker.directory), candidate);
    fs.rmSync(path.join(sibling, 'active-sibling'));
    assert.throws(() => cleanupWorker({ ...binding, directory: candidateRoot }), /Unowned/);
    put(path.join(worker.directory, 'packages/one/source.js'), 'tracked mutation');
    put(path.join(worker.directory, 'retain-on-failure'), 'evidence');
    assert.throws(() => cleanupWorker(binding), /Worker candidate differs/);
    assert(fs.existsSync(path.join(worker.directory, 'retain-on-failure')));
    put(path.join(worker.directory, 'packages/one/source.js'), 'source');
    put(path.join(worker.directory, 'node_modules/external/index.js'), 'changed dependency');
    assert.throws(() => cleanupWorker(binding), /dependency\/build inputs changed/);
    put(path.join(worker.directory, 'node_modules/external/index.js'), 'dependency');
    cleanupWorker(binding);
    const outside = path.join(root, 'outside-evidence'); put(outside, 'preserve');
    fs.symlinkSync(outside, path.join(worker.directory, 'generated-link'));
    cleanupWorker(binding);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve');

    // Exercise the production worker/checkpoint integration with lightweight
    // subprocess fixtures, never real qualification claims or a sliced seal.
    const names = require('../../../scripts/release-feature-acceptance.cjs').REQUIRED_TASKS;
    const failureFlag = path.join(root, 'worker-late-failure');
    const context = { schemaVersion: recovery.SCHEMA, candidate: { ...candidate, repoRoot: candidateRoot },
      selections: { features: names }, scheduling: { ...layout,
        workspaces: layout.workspaces.map(item => ({ ...item, inputs: recovery.inputIdentity(item.directory) })) } };
    const fixtureTasks = Object.fromEntries(names.map((name, index) => [name, {
      command: process.execPath, args: ['-e', `
        const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
        if(cp.execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()) throw Error('Prior task leaked worker output');
        fs.writeFileSync('generated.lock','owned residue');
        if(${index === names.length - 1} && fs.existsSync(${JSON.stringify(failureFlag)})) process.exit(9);
        fs.mkdirSync(process.env.PULSE_RELEASE_FEATURE_REPORT_DIR,{recursive:true});
        fs.writeFileSync(path.join(process.env.PULSE_RELEASE_FEATURE_REPORT_DIR,${JSON.stringify(name + '.json')}),'fixture report');
      `], evidence: 'unit', description: 'worker cleanup recovery fixture', timeoutMs: 5000,
      scheduling: index === names.length - 1 ? { after: names.slice(0, -1) } : {}
    }]));
    async function managedAttempt(label, previous) {
      const directory = path.join(root, label), artifacts = recovery.artifactPaths(directory);
      const config = recovery.recoveryConfig({ directory, previousDirectory: previous?.directory,
        context, artifacts, sharedPack: { proofId: 'fixture-pack' } }, 'features', names);
      const state = { results: [], runDir: path.join(directory, 'runs'), sourceEnv: {} };
      fs.mkdirSync(path.join(state.runDir, 'tasks'), { recursive: true });
      await runSelectedTasks({ state, selection: { selected: names, requested: names }, recoveryConfig: config,
        taskMap: fixtureTasks, workspaces: layout.workspaces });
      return { state, directory };
    }
    put(failureFlag, 'fail');
    const leaked = await managedAttempt('managed-failed');
    assert.equal(leaked.state.results.filter(item => item.status === 'passed').length, names.length - 1);
    assert.equal(leaked.state.results.at(-1).status, 'failed');
    assert(leaked.state.results.every(item => item.cleanup.worker?.status === 'passed'));
    assert(leaked.state.results.every(item => item.cleanup.worker.removed.includes('wasm/generated.lock')));
    fs.rmSync(failureFlag);
    const recovered = await managedAttempt('managed-resumed', leaked);
    assert(recovered.state.results.every(item => item.status === 'passed'));
    assert.equal(recovered.state.results.filter(item => item.execution === 'reused').length, names.length - 1);
    assert.equal(recovered.state.results.at(-1).execution, 'executed');
    assert.deepEqual(candidateIdentity(worker.directory), candidate);

    // Reconcile residue still visible to the controller after a cleanup receipt.
    const temporaryRootRecord = path.join(root, 'cleanup-fixture-root');
    const falseReceipt = await runTask('worker-false-cleanup', { command: process.execPath,
      args: ['-e', `const fs=require('node:fs'); fs.writeFileSync('late-output','residue');
        fs.writeFileSync(${JSON.stringify(temporaryRootRecord)},process.env.PULSEWASM_TEST_TMP_ROOT);`],
      evidence: 'unit', description: 'cleanup receipt verification fixture', timeoutMs: 5000 },
    { cwd: path.join(worker.directory, 'wasm'), workerCleanup: binding,
      cleanupCommand: { command: process.execPath, args: ['-e',
        `const fs=require('node:fs'); fs.rmSync(fs.readFileSync(${JSON.stringify(temporaryRootRecord)},'utf8'),{recursive:true,force:true});
        process.stdout.write(JSON.stringify({worker:{status:'passed',removed:[]},failureArtifacts:[]}));`] } });
    assert.equal(falseReceipt.status, 'passed');
    assert.equal(falseReceipt.cleanup.worker.status, 'passed');
    assert.deepEqual(falseReceipt.cleanup.worker.removed, ['wasm/late-output']);
    verifyWorker(binding);

    // A failed cleanup is not recorded as a reusable task pass.
    const changed = await runTask('worker-input-mutation', { command: process.execPath,
      args: ['-e', "require('node:fs').writeFileSync('../packages/one/source.js','changed')"],
      evidence: 'unit', description: 'tracked mutation fixture', timeoutMs: 5000 },
    { cwd: path.join(worker.directory, 'wasm'), workerCleanup: binding });
    assert.equal(changed.status, 'failed'); assert.equal(changed.cleanup.status, 'failed');
    put(path.join(worker.directory, 'packages/one/source.js'), 'source');
    cleanupWorkspaces(candidateRoot, candidate.sourceTree, 2);
    assert(!fs.existsSync(worker.directory));
    assert.equal(git(['worktree', 'list', '--porcelain']).toString().match(/^worktree /gm).length, 1);
    assert.deepEqual(candidateIdentity(candidateRoot), candidate);
    // Interrupted removal can leave ordinary files after Git registration is gone.
    const parent = path.dirname(worker.directory);
    put(path.join(parent, 'owner.json'), JSON.stringify({ root: candidateRoot, tree: candidate.sourceTree }));
    put(path.join(worker.directory, 'orphan.lock'), 'orphan');
    prepareWorkspaces(candidateRoot, candidate, 2, 1536);
    assert.deepEqual(candidateIdentity(worker.directory), candidate);
    cleanupWorkspaces(candidateRoot, candidate.sourceTree, 2);
    put(path.join(parent, 'owner.json'), JSON.stringify({ root: candidateRoot, tree: candidate.sourceTree }));
    put(path.join(worker.directory, '.git'), `gitdir: ${path.join(candidateRoot, '.git')}\n`);
    assert.throws(() => cleanupWorkspaces(candidateRoot, candidate.sourceTree, 2), /live or foreign Git marker/);
    fs.rmSync(path.join(worker.directory, '.git'));
    cleanupWorkspaces(candidateRoot, candidate.sourceTree, 2);

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
        compilerWorkers: 1,
        taskRunOptions: { terminationGraceMs: 25, killGraceMs: 25 } });
      return { state, config };
    }
    // Use production names/hints with lightweight subprocesses: execution order
    // may change, but report order, coverage, recovery and slot limits must not.
    const hinted = name => task(name, { compiler: scheduling(name, registry[name]).compiler, ...registry[name].scheduling });
    const early = { 'jwt-rs256': hinted('jwt-rs256'), 'suite-shape': hinted('suite-shape'),
      'release-artifact-determinism': hinted('release-artifact-determinism'), 'boundaries': hinted('boundaries') };
    for (const parallel of [false, true]) {
      fs.writeFileSync(trace, '');
      const result = await attempt(`priority-${parallel}`, early, null, parallel);
      assert.deepEqual(result.state.results.map(item => item.name), Object.keys(early));
      assert(result.state.results.every(item => item.status === 'passed'));
      const rows = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
      const ended = Math.max(...rows.filter(row => ['suite-shape', 'boundaries'].includes(row.name) && row.event === 'end').map(row => row.at));
      assert(rows.filter(row => !['suite-shape', 'boundaries'].includes(row.name) && row.event === 'start').every(row => row.at >= ended));
      fs.writeFileSync(path.join(root, 'fail-suite-shape'), 'fail');
      fs.writeFileSync(trace, '');
      const failed = await attempt(`priority-failure-${parallel}`, early, null, parallel);
      assert(failed.state.results.some(item => item.status === 'failed'));
      assert(!fs.readFileSync(trace, 'utf8').includes('jwt-rs256'));
      assert(!fs.readFileSync(trace, 'utf8').includes('release-artifact-determinism'));
      fs.rmSync(path.join(root, 'fail-suite-shape'));
    }
    fs.writeFileSync(trace, '');
    const installed = await attempt('installed-priority', { 'jwt-installed-workflow': hinted('jwt-installed-workflow'),
      'str02b-installed': hinted('str02b-installed') });
    assert.deepEqual(installed.state.results.map(item => item.name), ['jwt-installed-workflow', 'str02b-installed']);
    const installedRows = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(installedRows[0].name, 'str02b-installed');
    assert.equal(installedRows[1].event, 'end');
    fs.writeFileSync(trace, '');
    const resources = { 'cli-report-capture-proof': hinted('cli-report-capture-proof'),
      'ast02d-installed': hinted('ast02d-installed'), 'release-artifact-determinism': hinted('release-artifact-determinism') };
    const resourceRun = await attempt('actual-resource-hints', resources);
    assert(resourceRun.state.results.every(item => item.status === 'passed'));
    const resourceRows = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    const eventAt = (name, event) => resourceRows.find(row => row.name === name && row.event === event).at;
    assert(eventAt('cli-report-capture-proof', 'end') <= eventAt('ast02d-installed', 'start'));
    assert(eventAt('release-artifact-determinism', 'start') < eventAt('cli-report-capture-proof', 'end'));
    assert(eventAt('cli-report-capture-proof', 'start') < eventAt('release-artifact-determinism', 'end'));
    fs.writeFileSync(trace, '');
    const tasks = { a: task('a', { compiler: true, resources: ['provider'] }), b: task('b', { compiler: true, resources: ['provider'] }),
      c: task('c'), d: task('d', { compiler: true, after: ['a'] }), benchmark: task('benchmark', { exclusive: true, cost: 100 }) };
    const parallel = await attempt('parallel', tasks);
    assert.deepEqual(parallel.state.results.map(item => [item.name, item.status]), Object.keys(tasks).map(name => [name, 'passed']));
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    const interval = name => events.filter(item => item.name === name);
    assert(interval('benchmark')[1].at <= Math.min(interval('a')[0].at, interval('c')[0].at), 'Benchmark must execute alone');
    assert(interval('a')[1].at <= interval('b')[0].at, 'Dependency and shared provider lock must serialize');
    assert(interval('a')[1].at <= interval('d')[0].at, 'Dependency must finish before its consumer');
    assert(interval('b')[1].at <= interval('d')[0].at, 'Compiler-heavy tasks must respect their separate slot limit');
    assert(interval('a')[0].at < interval('c')[1].at && interval('c')[0].at < interval('a')[1].at, 'Light work must overlap admitted compiler work');
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
