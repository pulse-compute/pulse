'use strict';

// Deterministic control-plane qualification. Heavy product commands are fixtures;
// the controller, checkpoint admission, retention, restoration and receipt owners
// are real. Nothing here qualifies installed product behavior or a release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const contextOwner = require('../../../scripts/release-context-freshness.cjs');
const fixture = require('./context-freshness-fixture.cjs');
const checkpoints = require('../../../scripts/release-checkpoints.cjs');
const recovery = require('../../../scripts/release-recovery.cjs');
const acceptance = require('../../../scripts/release-feature-acceptance.cjs');
const { tasks, expandProfile } = require('../suite/registry.cjs');
const { checkpointDefinition, validateRecoveryConfig } = require('../../scripts/run-wasm-tests.cjs');
const { validateReport } = require('../../../scripts/maintainer-portable-validation.cjs');
const repo = path.resolve(__dirname, '../../..');
const hash = contextOwner.hash;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = recovery.atomicJson;
const passed = id => ({ id, status: 'passed', exitCode: 0, cleanup: { status: 'passed' } });

async function verifyContextSealRecovery({ out } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-seal-recovery-'));
  const source = require('../../../scripts/source-identity.cjs').resolveSourceIdentity(repo);
  const candidate = { sourceRevision: source.sourceRevision, sourceTree: 'b'.repeat(40), workingTree: '' };
  const checked = fixture.sourceChecks(candidate);
  const manifest = JSON.parse(checked.contextFreshness.manifestText);
  const candidateFiles = new Set([
    ...checked.contextFreshness.files.map(file => `wasm/packages/cli/examples/12-pulse-context-mcp/${file.path}`),
    ...manifest.outputs.map(file => `examples/12-pulse-context-mcp/${file.path}`),
    'examples/12-pulse-context-mcp/context-data/context-manifest.json',
    ...manifest.source.sources.map(file => file.path), ...manifest.producer.sources.map(file => file.path),
    manifest.producer.config.path, manifest.producer.allowlist.path, manifest.producer.lockfile.path
  ]);
  const before = new Map([...candidateFiles].map(file => {
    const absolute = path.join(repo, file); return [absolute, hash(fs.readFileSync(absolute))];
  }));
  const evidence = { schemaVersion: 'pulse.context-seal-recovery-test.v1', status: 'running',
    source, fixtureCandidate: candidate, productExecution: 'mocked; not release qualification', cases: [] };
  const record = (name, detail = {}) => evidence.cases.push({ name, status: 'passed', ...detail });
  const directories = [];
  const original = {};
  let currentMode = 'pass', currentMutation = null, calls = [], latestDirectory;
  const controllerModule = require.resolve('../../../scripts/validate-release.cjs');
  const supervisor = require('../../../scripts/release-process.cjs');
  const statusOwner = require('../../../scripts/release-seal-status.cjs');
  const fastlyModule = require.resolve('../../../packages/provider-fastly/src/testing/fastly-cli.js');
  const fastly = require(fastlyModule);
  const context = options => {
    const value = { schemaVersion: recovery.SCHEMA, candidate: { ...candidate, repoRoot: fs.realpathSync(repo) },
      lockfileSha256: hash(fs.readFileSync(path.join(repo, 'pnpm-lock.yaml'))),
      environmentSha256: 'a'.repeat(64), environmentKeys: {}, toolchain: { node: process.version },
      options: { requireFastly: options.requireFastly, install: options.install, workers: 1,
        memoryBudgetMiB: options.memoryBudgetMiB, compilerWorkers: options.compilerWorkers, dependencyBundleSha256: null },
      inputs: { dependenciesSha256: 'c'.repeat(64), buildSha256: 'd'.repeat(64), build: [] },
      selections: contextOwner.selections() };
    return value;
  };
  // The fixture runner consumes the controller's untouched canonical selection
  // and task definitions, recording/restoring every task through the real store.
  function taskLane(config) {
    const names = config.selectedTasks;
    validateRecoveryConfig(config, { requested: names, selected: names });
    const store = checkpoints.createCheckpointStore({ directory: config.directory,
      previousDirectory: config.previousDirectory, context: config.context });
    const results = [];
    for (const name of names) {
      const overrides = config.taskOptions[name] || {};
      const logPath = path.join(path.dirname(config.directory), `${config.kind}-${name}.log`);
      const spec = { id: `task:${name}`, definition: checkpointDefinition(name, tasks[name], overrides),
        dependencies: config.dependencies, artifacts: { ...overrides.artifacts, 'task-log': logPath } };
      let proof = store.tryReuse(spec), result;
      if (proof.reused) {
        result = { ...proof.result, execution: 'reused', durationMs: 0, reusedDurationMs: proof.result.durationMs,
          originalResult: proof.result, logPath };
      } else {
        for (const [key, file] of Object.entries(overrides.artifacts || {})) {
          if (key === 'candidates') write(path.join(file, 'fixture.json'), { status: 'fixture' });
          else write(file, { status: 'fixture', task: name });
        }
        fs.writeFileSync(logPath, `mock product execution: ${name}\n`);
        result = { name, status: 'passed', exitCode: 0, evidence: tasks[name].evidence, durationMs: 1,
          logPath, cleanup: { status: 'passed' }, retainedTaskRoot: null, remainingProcessTree: [] };
        if (currentMode === 'interrupt' && name === 'mcp-installed') {
          result = { ...result, status: 'interrupted', exitCode: 143, interruptedBy: 'SIGTERM' };
        }
        const reason = proof.reason;
        proof = store.record({ ...spec, result });
        result = { ...result, execution: 'executed', recoveryReason: reason };
      }
      results.push({ ...result, checkpoint: { proofId: proof.proofId, receiptPath: proof.receiptPath,
        receiptSha256: proof.receiptSha256, contextHash: checkpoints.fingerprint(config.context) } });
      if (result.status !== 'passed') break;
    }
    const report = { schemaVersion: 2, sourceRevision: candidate.sourceRevision, sourceIdentity: source,
      status: results.length === names.length && results.every(r => r.status === 'passed') ? 'passed' : 'interrupted',
      currentTask: null, startedAt: '2026-10-21T00:00:00.000Z', finishedAt: '2026-10-21T00:00:01.000Z', durationMs: 1000,
      requestedTasks: names, selectedTasks: names, completedTasks: results.length, results,
      recovery: { schemaVersion: 'pulse.seal-task-recovery.v1', directory: config.directory,
        previousDirectory: config.previousDirectory || null, contextHash: checkpoints.fingerprint(config.context),
        dependencies: config.dependencies, taskOptions: config.taskOptions,
        reusedTasks: results.filter(r => r.execution === 'reused').map(r => r.name),
        executedTasks: results.filter(r => r.execution === 'executed').map(r => r.name) } };
    write(config.kind === 'release' ? config.artifacts.taskReport : config.artifacts.featureTasks, report);
    return report;
  }
  async function attempt(name, previous, mode = 'pass', mutate = null) {
    currentMode = mode; currentMutation = mutate; calls = [];
    let error;
    try { await require(controllerModule).main(['--skip-install', ...(previous ? ['--resume', previous.runDirectory] : [])]); }
    catch (caught) { error = caught; }
    const report = read(path.join(latestDirectory, 'report.json'));
    assert(report.completedAt && report.currentStep === null, 'Every attempt must terminalize');
    assert.equal(report.cleanup.status, 'passed', JSON.stringify(report.error));
    assert.equal(calls.filter(call => call === 'source-checks').length, 1, 'Source checks must execute on every attempt');
    return { ...report, fixture: { name, error: error?.message, calls: [...calls] } };
  }
  try {
    // First exercise every vector-specific prerequisite through the canonical
    // checkpoint store; changed inputs cannot inherit a historical green proof.
    const base = path.join(scratch, 'matrix-base');
    const packed = fixture.pack(path.join(base, 'packages'), candidate);
    const deps = contextOwner.checkpointDependencies(packed.checked);
    const matrixContext = context({ requireFastly: false, install: false, memoryBudgetMiB: 4096, compilerWorkers: 2 });
    const spec = { id: 'shared-pack', definition: recovery.sharedPackDefinition(), dependencies: deps,
      artifacts: { pack: path.join(base, 'packages') } };
    const previous = checkpoints.createCheckpointStore({ directory: path.join(base, 'checkpoints'), context: matrixContext });
    const first = previous.record({ ...spec, result: passed('shared-pack') });
    const receiptBytes = fs.readFileSync(first.receiptPath);
    function rehashReceipt(mutate) {
      const envelope = JSON.parse(receiptBytes); mutate(envelope.receipt);
      envelope.sha256 = checkpoints.fingerprint(envelope.receipt); write(first.receiptPath, envelope);
    }
    const cases = [
      ['missing-checkpoint', () => fs.unlinkSync(first.receiptPath), /missing/],
      ['tampered-checkpoint', () => fs.appendFileSync(first.receiptPath, 'bad'), /JSON|Unexpected/],
      ['stale-candidate-tree', null, /context changed/, c => c.candidate.sourceTree = 'f'.repeat(40)],
      ['stale-candidate-hash', null, /context changed/, c => c.candidate.sourceRevision = 'f'.repeat(40)],
      ['foreign-checkout', null, /context changed/, c => c.candidate.repoRoot = scratch],
      ['changed-complete-selection', null, /context changed/, c => c.selections.features.pop()],
      ['changed-lockfile', null, /context changed/, c => c.lockfileSha256 = 'f'.repeat(64)],
      ['expired-checkpoint', () => rehashReceipt(r => { r.createdAt = '2000-01-01T00:00:00Z'; r.expiresAt = '2000-01-02T00:00:00Z'; }), /expired/],
      ['interrupted-checkpoint', () => rehashReceipt(r => { r.result.status = 'interrupted'; r.result.interruptedBy = 'SIGTERM'; }), /did not pass/],
      ['failed-checkpoint', () => rehashReceipt(r => { r.result.status = 'failed'; r.result.exitCode = 1; }), /did not pass/],
      ['missing-freshness-prerequisite', () => rehashReceipt(r => { r.dependencies = {}; }), /dependency proof changed/],
      ['tampered-freshness-prerequisite', () => rehashReceipt(r => { r.dependencies['context-freshness'] = 'f'.repeat(64); }), /dependency proof changed/]
    ];
    for (const [name, mutate, pattern, mutateContext] of cases) {
      fs.writeFileSync(first.receiptPath, receiptBytes); mutate?.();
      const retained = fs.existsSync(first.receiptPath) ? hash(fs.readFileSync(first.receiptPath)) : null;
      const changed = structuredClone(matrixContext); mutateContext?.(changed);
      const store = checkpoints.createCheckpointStore({ directory: path.join(scratch, name, 'checkpoints'),
        previousDirectory: path.dirname(first.receiptPath), context: changed });
      const next = { ...spec, artifacts: { pack: path.join(scratch, name, 'packages') } };
      const miss = store.tryReuse(next); assert.equal(miss.reused, false, name); assert.match(miss.reason, pattern);
      // Required re-execution receives a new prerequisite proof; no stale pass
      // is relabeled. Production commands stay mocked in this bounded fixture.
      fs.cpSync(spec.artifacts.pack, next.artifacts.pack, { recursive: true });
      const replacement = store.record({ ...next, result: passed('shared-pack') });
      assert.notEqual(replacement.proofId, first.proofId);
      if (retained) assert.equal(hash(fs.readFileSync(first.receiptPath)), retained, 'Rejection rewrote prior evidence');
      record(name, { reason: miss.reason, replacementProof: true });
    }
    fs.writeFileSync(first.receiptPath, receiptBytes);
    const unrelated = checkpoints.createCheckpointStore({ directory: path.join(scratch, 'no-pooling/checkpoints'),
      previousDirectory: path.join(scratch, 'selected-empty-attempt'), context: matrixContext }).tryReuse({ ...spec,
      artifacts: { pack: path.join(scratch, 'no-pooling/packages') } });
    assert.equal(unrelated.reused, false); assert.match(unrelated.reason, /missing/);
    assert(fs.existsSync(first.receiptPath), 'Historical pass must still exist for the no-pooling case');
    record('no-pooling-unselected-historical-pass', { reason: unrelated.reason });
    const capturedPackage = path.join(path.dirname(first.receiptPath), path.basename(first.receiptPath, '.json'), 'pack', packed.manifest.packages[0].tarball);
    const packageBytes = fs.readFileSync(capturedPackage);
    fs.appendFileSync(capturedPackage, 'changed');
    const changedPack = checkpoints.createCheckpointStore({ directory: path.join(scratch, 'changed-pack/checkpoints'),
      previousDirectory: path.dirname(first.receiptPath), context: matrixContext }).tryReuse({ ...spec, artifacts: { pack: path.join(scratch, 'changed-pack/packages') } });
    assert.equal(changedPack.reused, false); assert.match(changedPack.reason, /artifact changed/);
    record('changed-package-bytes', { reason: changedPack.reason }); fs.writeFileSync(capturedPackage, packageBytes);
    for (const key of ['producer', 'config', 'lockfile']) {
      const fresh = structuredClone(checked), manifest = JSON.parse(fresh.contextFreshness.manifestText);
      const item = key === 'producer' ? manifest.producer.sources[0] : manifest.producer[key];
      item.sha256 = 'f'.repeat(64);
      const bytes = JSON.stringify(manifest);
      fresh.contextFreshness.manifestText = bytes;
      fresh.contextFreshness.reconstruction.manifestSha256 = hash(bytes);
      Object.assign(fresh.contextFreshness.files.find(f => f.path === 'context-data/context-manifest.json'),
        { byteLength: Buffer.byteLength(bytes), sha256: hash(bytes) });
      const changed = contextOwner.checkpointDependencies(fresh);
      const miss = checkpoints.createCheckpointStore({ directory: path.join(scratch, `changed-${key}-proof/checkpoints`),
        previousDirectory: path.dirname(first.receiptPath), context: matrixContext }).tryReuse({ ...spec, dependencies: changed,
        artifacts: { pack: path.join(scratch, `changed-${key}-proof/packages`) } });
      assert.equal(miss.reused, false); assert.match(miss.reason, /dependency proof changed/);
      record(`changed-${key}-freshness-proof`, { reason: miss.reason });
    }

    Object.assign(original, { run: supervisor.runCommand, status: statusOwner.createSealStatus,
      acquire: recovery.acquireSealLock, context: recovery.createContext, candidate: acceptance.candidateIdentity,
      stdout: process.stdout.write });
    acceptance.candidateIdentity = () => ({ ...candidate });
    recovery.acquireSealLock = (_root, directory) => original.acquire(scratch, directory);
    recovery.createContext = (_root, _candidate, options) => context(options);
    statusOwner.createSealStatus = options => {
      const status = original.status({ ...options, resultsRoot: path.join(scratch, 'results') });
      directories.push(status.directory); latestDirectory = status.directory; return status;
    };
    require.cache[fastlyModule].exports = { ...fastly, inspectFastlyCli() { throw Object.assign(Error('No external provider in controller fixture'), { code: 'PULSE_FASTLY_CLI_UNAVAILABLE' }); } };
    supervisor.runCommand = async (command, args, options) => {
      if (args[0] === '-e') return original.run(command, args, options); // supervised cleanup stays real
      if (args.includes('scripts/release-source-checks.cjs')) {
        calls.push('source-checks'); const value = structuredClone(fixture.sourceChecks(candidate));
        value.durationMs = directories.length; // Fresh receipt bytes vary without invalidating identical context inputs.
        currentMutation?.(value);
        write(args[args.indexOf('--out') + 1], value);
      } else if (args.includes('scripts/release-shared-pack.cjs')) {
        calls.push('shared-pack'); const directory = args[args.indexOf('--out') + 1];
        const result = fixture.pack(directory, candidate);
        require('../../../scripts/release-shared-pack.cjs').recordPack({ repoRoot: repo, outDir: directory, manifest: result.manifest }, candidate);
      } else if (args.includes('--profile') || args.includes('scripts/release-feature-acceptance.cjs')) {
        const config = read(args[args.indexOf('--recovery-config') + 1]); calls.push(config.kind);
        const runner = taskLane(config);
        if (config.kind === 'features') {
          if (runner.status !== 'passed') return { status: 143, timedOut: false, interruptedBy: 'SIGTERM', signal: 'SIGTERM' };
          const manifest = read(path.join(options.env.PULSE_RELEASE_SHARED_PACK, 'pulse-release-manifest.json'));
          const features = { schemaVersion: acceptance.SCHEMA, ...candidate, status: 'passed',
            runnerReportSha256: hash(fs.readFileSync(config.artifacts.featureTasks)),
            gates: acceptance.REQUIRED_TASKS.map(task => ({ task, status: 'passed', reportSha256: 'e'.repeat(64), packages: manifest.packages })) };
          write(config.artifacts.featureReport, features);
        }
      } else if (args.includes('build')) {
        calls.push('build');
        if (currentMode === 'tamper-after-source') fs.appendFileSync(path.join(latestDirectory, 'source-checks.json'), ' ');
      }
      return { status: 0, signal: null, timedOut: false, interruptedBy: null };
    };
    process.stdout.write = () => true;
    delete require.cache[controllerModule];
    const initial = await attempt('interrupted', null, 'interrupt');
    assert.equal(initial.status, 'failed'); assert(initial.fixture.error);
    const retainedInitial = hash(fs.readFileSync(path.join(initial.runDirectory, 'report.json')));
    const resumed = await attempt('valid-resume', initial);
    assert.equal(resumed.status, 'passed', resumed.fixture.error);
    assert.notEqual(resumed.sourceChecks.sha256, initial.sourceChecks.sha256, 'Resume must validate its fresh receipt');
    assert.equal(resumed.recovery.sharedPack.execution, 'reused');
    const release = read(resumed.recovery.artifacts.taskReport), features = read(resumed.recovery.artifacts.featureTasks);
    validateReport(release, expandProfile('release'), candidate.sourceRevision);
    validateReport(features, acceptance.REQUIRED_TASKS, candidate.sourceRevision);
    assert.equal(release.recovery.reusedTasks.length, expandProfile('release').length);
    assert.equal(features.results.find(r => r.name === 'mcp-installed').execution, 'executed');
    assert.equal(features.results.find(r => r.name === 'str02b-installed').execution, 'reused');
    assert.equal(hash(fs.readFileSync(path.join(initial.runDirectory, 'report.json'))), retainedInitial);
    require('../../../scripts/release-evidence-bundle.cjs').validateRecoveryEvidence(resumed);
    record('controller-interruption-and-valid-resume', { releaseTasks: release.completedTasks,
      installedTasks: features.completedTasks, reusedInstalled: features.recovery.reusedTasks.length,
      executedInstalled: features.recovery.executedTasks, originalAttemptUnchanged: true });
    const retainedResume = hash(fs.readFileSync(path.join(resumed.runDirectory, 'report.json')));
    const packReceipt = resumed.recovery.sharedPack.receiptPath;
    const savedPackReceipt = fs.readFileSync(packReceipt);
    const retainedTarball = path.join(path.dirname(packReceipt), path.basename(packReceipt, '.json'), 'pack', '0.tgz');
    const savedTarball = fs.readFileSync(retainedTarball);
    for (const fault of ['changed-retained-package', 'expired-retained-package']) {
      if (fault === 'changed-retained-package') fs.appendFileSync(retainedTarball, 'corrupt');
      else {
        const envelope = JSON.parse(savedPackReceipt);
        envelope.receipt.createdAt = '2000-01-01T00:00:00Z'; envelope.receipt.expiresAt = '2000-01-02T00:00:00Z';
        envelope.sha256 = checkpoints.fingerprint(envelope.receipt); write(packReceipt, envelope);
      }
      const retried = await attempt(fault, resumed);
      assert.equal(retried.status, 'passed', retried.fixture.error);
      assert.equal(retried.recovery.sharedPack.execution, 'executed');
      assert.notEqual(retried.recovery.sharedPack.proofId, resumed.recovery.sharedPack.proofId);
      for (const key of ['taskReport', 'featureTasks']) {
        const lane = read(retried.recovery.artifacts[key]);
        assert.equal(lane.recovery.reusedTasks.length, 0, 'Replacement pack must invalidate all dependent tasks');
        assert.equal(lane.completedTasks, lane.selectedTasks.length);
      }
      assert.equal(hash(fs.readFileSync(path.join(resumed.runDirectory, 'report.json'))), retainedResume);
      record(fault, { packageExecution: 'executed', dependentTasksReexecuted: true });
      fs.writeFileSync(packReceipt, savedPackReceipt); fs.writeFileSync(retainedTarball, savedTarball);
    }
    const mcpReceipt = features.results.find(r => r.name === 'mcp-installed').checkpoint.receiptPath;
    const installedReceipt = path.join(path.dirname(mcpReceipt), path.basename(mcpReceipt, '.json'), 'installedReport');
    const savedInstalled = fs.readFileSync(installedReceipt);
    for (const fault of ['missing-installed-receipt', 'tampered-installed-receipt']) {
      if (fault === 'missing-installed-receipt') fs.unlinkSync(installedReceipt);
      else fs.appendFileSync(installedReceipt, 'corrupt');
      const retried = await attempt(fault, resumed);
      assert.equal(retried.status, 'passed', retried.fixture.error);
      assert.equal(retried.recovery.sharedPack.execution, 'reused');
      const lane = read(retried.recovery.artifacts.featureTasks);
      assert.deepEqual(lane.recovery.executedTasks, ['mcp-installed']);
      assert.equal(lane.completedTasks, acceptance.REQUIRED_TASKS.length);
      record(fault, { installedExecution: 'executed', unrelatedProofsReused: true });
      fs.writeFileSync(installedReceipt, savedInstalled);
    }
    for (const [name, mutate, pattern] of [
      ['missing-freshness', value => delete value.contextFreshness, /freshness receipt/],
      ['tampered-freshness', value => value.contextFreshness.manifestText += 'bad', /digest differs/],
      ['stale-freshness-tree', value => value.contextFreshness.candidate.sourceTree = 'f'.repeat(40), /candidate differs/],
      ['foreign-source-receipt', value => { value.candidate.sourceRevision = 'f'.repeat(40); value.contextFreshness.candidate.sourceRevision = 'f'.repeat(40); }, /another candidate/],
      ['stale-freshness-hash', value => value.contextFreshness.candidate.sourceRevision = 'f'.repeat(40), /candidate differs/],
      ['reduced-selection', value => value.contextFreshness.selections.features.pop(), /selection differs/]
    ]) {
      const rejected = await attempt(name, resumed, 'pass', mutate);
      assert.equal(rejected.status, 'failed'); assert.match(rejected.fixture.error, pattern);
      assert.deepEqual(rejected.fixture.calls, ['source-checks'], 'Invalid freshness crossed package/consumer admission');
      record(name, { failure: rejected.fixture.error, reused: 0 });
    }
    const tampered = await attempt('changed-after-source', resumed, 'tamper-after-source');
    assert.equal(tampered.status, 'failed'); assert.match(tampered.fixture.error, /before package checkpoint admission/);
    assert(!tampered.fixture.calls.includes('release') && !tampered.fixture.calls.includes('features'));
    record('changed-after-source', { reused: 0 });
    const final = await attempt('valid-complete-reuse', resumed);
    assert.equal(final.status, 'passed', final.fixture.error);
    assert.equal(final.recovery.sharedPack.execution, 'reused');
    for (const [key, expected] of [['taskReport', expandProfile('release')], ['featureTasks', acceptance.REQUIRED_TASKS]]) {
      const report = read(final.recovery.artifacts[key]); validateReport(report, expected, candidate.sourceRevision);
      assert.equal(report.recovery.reusedTasks.length, expected.length); assert.equal(report.recovery.executedTasks.length, 0);
    }
    require('../../../scripts/release-evidence-bundle.cjs').validateRecoveryEvidence(final);
    record('controller-complete-reuse', { releaseTasks: expandProfile('release').length, installedTasks: acceptance.REQUIRED_TASKS.length });
    evidence.attempts = [initial, resumed, tampered, final];
    for (const [file, digest] of before) assert.equal(hash(fs.readFileSync(file)), digest, 'Recovery changed candidate context bytes');
    evidence.candidateUnchanged = true; evidence.status = 'passed';
    if (out) write(path.resolve(out), evidence);
    return evidence;
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.stack || error.message;
    evidence.attempts = directories.filter(dir => fs.existsSync(path.join(dir, 'report.json'))).map(dir => read(path.join(dir, 'report.json')));
    if (out) write(path.resolve(out), evidence);
    throw error;
  } finally {
    if (original.run) {
      supervisor.runCommand = original.run; statusOwner.createSealStatus = original.status;
      recovery.acquireSealLock = original.acquire; recovery.createContext = original.context;
      acceptance.candidateIdentity = original.candidate; process.stdout.write = original.stdout;
      require.cache[fastlyModule].exports = fastly; delete require.cache[controllerModule];
    }
    for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
module.exports = { verifyContextSealRecovery };
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--out'), 'Usage: assert-context-seal-recovery.cjs [--out <evidence.json>]');
  verifyContextSealRecovery({ out: args[1] }).then(result => console.log(`ok - context seal recovery: ${result.cases.length} cases; complete same-candidate resume and fail-closed freshness`), error => { console.error(error); process.exitCode = 1; });
}
