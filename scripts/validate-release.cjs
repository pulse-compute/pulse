#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { runCommand } = require('./release-process.cjs');
const { createSealStatus } = require('./release-seal-status.cjs');
const { resolveSourceIdentity, sourceIdentityEnv } = require('./source-identity.cjs');

const repoRoot = path.resolve(__dirname, '..');
const resultsRoot = path.join(repoRoot, 'wasm', '.test-results');

function parseArgs(argv) {
  const options = { install: true, report: true, requireFastly: false, timeoutMs: 55 * 60 * 1000, workers: 1, memoryBudgetMiB: 4096, compilerWorkers: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--skip-install') options.install = false;
    else if (token === '--resume') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error('--resume requires an attempt directory');
      options.resume = path.resolve(value);
    }
    else if (token === '--prune-recovery') options.pruneRecovery = true;
    else if (token === '--no-report') options.report = false;
    else if (token === '--require-fastly') options.requireFastly = true;
    else if (token === '--workers' || token === '--memory-budget-mib' || token === '--compiler-workers') {
      const value = argv[++index];
      if (!/^[1-9]\d*$/.test(value || '')) throw new Error(`${token} requires a positive integer`);
      options[{ '--workers': 'workers', '--memory-budget-mib': 'memoryBudgetMiB', '--compiler-workers': 'compilerWorkers' }[token]] = Number(value);
    }
    else if (token === '--timeout-minutes') {
      const value = argv[++index];
      if (!/^[1-9]\d*$/.test(value || '') || Number(value) > 1440) {
        throw new Error('--timeout-minutes requires an integer from 1 to 1440');
      }
      options.timeoutMs = Number(value) * 60 * 1000;
    } else if (token === '--dependency-bundle') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--dependency-bundle requires a path');
      options.dependencyBundle = path.resolve(value);
      index += 1;
    } else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown release-seal option: ${token}`);
  }
  if (!options.install && options.dependencyBundle) throw new Error('--skip-install and --dependency-bundle cannot be combined');
  if (options.resume && !options.report) throw new Error('--resume requires reports');
  require('./release-parallel.cjs').workerCount(options.workers, options.memoryBudgetMiB);
  require('./release-parallel.cjs').compilerCount(options.compilerWorkers, options.workers);
  if (options.workers > 1 && !options.report) throw new Error('Parallel sealing requires durable reports');
  if (options.pruneRecovery && argv.length !== 1) throw new Error('--prune-recovery must be used alone');
  return Object.freeze(options);
}

function usage() {
  return [
    'Usage: node scripts/validate-release.cjs [options]',
    '',
    'Options:',
    '  --dependency-bundle <path>  restore the exact offline dependency bundle',
    '  --skip-install              keep the current dependency installation',
    '  --require-fastly            fail if the Fastly CLI or its local Compute lifecycle is unavailable',
    '  --resume <attempt-dir>      verify and reuse this same-candidate attempt\'s completed work',
    '  --workers <count>          isolated local test workers (1–8; default 1 is serial)',
    '  --compiler-workers <count> compiler-heavy task slots (1–8; default 2, capped by workers)',
    '  --memory-budget-mib <MiB> admission budget, 768 MiB per worker (default 4096)',
    '  --prune-recovery            remove terminal attempts older than seven days (never active work)',
    '  --timeout-minutes <minutes> overall work deadline (default 55); cleanup is separately bounded',
    '  --no-report                 do not write wasm/.test-results/release-seal.json',
    '  -h, --help                  show this help'
  ].join('\n');
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function packageManagerInvocation() {
  return require('./pnpm-toolchain.cjs').pnpmInvocation(repoRoot);
}

async function executeStep(steps, id, description, command, args, options = {}) {
  process.stdout.write(`\n[pulse:release] Step ${steps.length + 1} started: ${id} — ${description}\n`);
  const startedAt = new Date().toISOString();
  options.progress.persist({ currentStep: id, steps });
  const logPath = options.progress.directory ? path.join(options.progress.directory, `${id}.log`) : null;
  const log = logPath ? fs.openSync(logPath, 'w') : null;
  let result;
  try {
    result = await runCommand(command, args, {
      cwd: repoRoot, env: { ...process.env, ...(options.env || {}) },
      timeoutMs: options.timeoutMs || 20 * 60 * 1000, signal: options.signal,
      onChild: options.onChild,
      onOutput(name, chunk) {
        process[name].write(chunk);
        if (log !== null) fs.writeSync(log, chunk);
      }
    });
  } finally { if (log !== null) fs.closeSync(log); }
  const step = Object.freeze({
    id,
    description,
    command: commandText(command, args),
    status: !result.error && !result.timedOut && !result.interruptedBy && result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: result.timedOut,
    interruptedBy: result.interruptedBy,
    logPath,
    startedAt,
    completedAt: new Date().toISOString(),
    error: result.error ? result.error.message : result.timedOut ? 'Step deadline exceeded' : result.interruptedBy ? `Interrupted by ${result.interruptedBy}` : null
  });
  steps.push(step);
  options.progress.persist({ steps, currentStep: null });
  process.stdout.write(`[pulse:release] Step ${steps.length} ${step.status}: ${id} (${Date.parse(step.completedAt) - Date.parse(startedAt)}ms)\n`);
  if (step.status !== 'passed') {
    const error = new Error(`${description} failed (${step.command})`);
    error.code = 'PULSE_RELEASE_SEAL_STEP_FAILED';
    error.step = step;
    throw error;
  }
  return step;
}

function fastlyAvailability(env = process.env) {
  const fastly = require('../packages/provider-fastly/src/testing/fastly-cli.js');
  try {
    const cli = fastly.inspectFastlyCli({ env });
    return Object.freeze({
      status: 'available',
      fastlyCli: Object.freeze({ binary: cli.binary, version: cli.version || null }),
      localComputeEngine: Object.freeze({ owner: 'fastly-cli', selection: 'managed' })
    });
  } catch (error) {
    if (error && error.code === 'PULSE_FASTLY_CLI_UNAVAILABLE') {
      return Object.freeze({ status: 'unavailable', code: error.code, message: error.message });
    }
    throw error;
  }
}

function assertReleaseNode(version = process.versions.node) {
  const { PUBLICATION, versionSatisfiesCaretRange } = require('./package-support.cjs');
  if (!versionSatisfiesCaretRange(version, PUBLICATION.nodeReleaseRange)) {
    const error = new Error(`Release seal requires Node ${PUBLICATION.nodeReleaseRange}; running ${version}`);
    error.code = 'PULSE_RELEASE_NODE_RANGE_MISMATCH';
    throw error;
  }
  return Object.freeze({
    nodeVersion: version,
    acceptedRange: PUBLICATION.nodeReleaseRange,
    reproducibleToolchainVersion: PUBLICATION.nodeVersion
  });
}

function assertReleasePreflight(provenGates = []) {
  return require('./release-preflight.cjs').validatePreflight({ stage: 'release-seal', provenGates });
}

function createDeadline(controller, timeoutMs) {
  const deadlineAt = Date.now() + timeoutMs;
  const expire = () => {
    if (!controller.signal.aborted) controller.abort('deadline');
  };
  const timer = setTimeout(expire, timeoutMs);
  return {
    deadlineAt: new Date(deadlineAt).toISOString(),
    remaining() {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) expire();
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === 'deadline';
        throw Object.assign(new Error(timedOut ? 'Release seal deadline exceeded' : `Seal interrupted by ${controller.signal.reason}`),
          { code: timedOut ? 'PULSE_RELEASE_SEAL_DEADLINE' : 'PULSE_RELEASE_INTERRUPTED' });
      }
      return remaining;
    },
    close() { clearTimeout(timer); }
  };
}

function assertCandidateSource(identity) {
  // This module and its metadata dependencies use only Node built-ins. Do not
  // import shared packaging/documentation code before dependency restoration.
  const candidate = require('./release-feature-acceptance.cjs').candidateIdentity(repoRoot);
  if (candidate.sourceRevision !== identity.sourceRevision) {
    throw Object.assign(new Error('Release source identity differs from the clean candidate HEAD'),
      { code: 'PULSE_RELEASE_SOURCE_MISMATCH' });
  }
  return candidate;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.pruneRecovery) {
    const result = require('./release-recovery.cjs').pruneRecovery(repoRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const steps = [];
  const progress = createSealStatus({ resultsRoot, attemptsRoot: path.join(repoRoot, '.pulse-seal/attempts'), report: options.report, deferLatest: true, initial: {
    schemaVersion: 'pulse.release-seal.v1', sourceRevision: null, sourceIdentity: null, runtime: null,
    currentStep: 'bootstrap'
  } });
  const controller = new AbortController();
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
    if (!controller.signal.aborted) {
      controller.abort(signal);
      progress.persist({ interruption: signal });
    }
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const deadline = createDeadline(controller, options.timeoutMs);
  let sealLock = null;
  const runStep = (steps, id, description, command, args, stepOptions = {}) => {
    const timeoutMs = Math.min(stepOptions.timeoutMs || 20 * 60 * 1000, deadline.remaining());
    return executeStep(steps, id, description, command, args, { ...stepOptions, timeoutMs, progress, signal: controller.signal,
      onChild: child => sealLock?.child(child?.pid || null) });
  };
  let packageManagerCache = null;
  let packageManagerEnv;
  let sourceIdentity, revision, identityEnv, candidate;
  let externalFastly = Object.freeze({ status: 'not-inspected' });
  let featureAcceptance = null;
  let status = 'running';
  let failure = null;
  let cleanup = null;
  let recovery = null;
  let artifactFiles = null;
  const runPackageManagerStep = (id, description, args, timeoutMs) => {
    const invocation = packageManagerInvocation();
    return runStep(
      steps,
      id,
      description,
      invocation.command,
      [...invocation.prefix, ...args],
      { timeoutMs, env: packageManagerEnv }
    );
  };
  try {
    progress.persist({ deadlineAt: deadline.deadlineAt, currentStep: 'bootstrap' });
    const runtime = assertReleaseNode();
    progress.persist({ runtime, currentStep: 'source' });
    sourceIdentity = resolveSourceIdentity(repoRoot);
    revision = sourceIdentity.sourceRevision;
    identityEnv = sourceIdentityEnv(sourceIdentity);
    progress.persist({ sourceRevision: revision, sourceIdentity });
    candidate = assertCandidateSource(sourceIdentity);
    const recoveryTools = require('./release-recovery.cjs');
    sealLock = recoveryTools.acquireSealLock(repoRoot, progress.directory);
    progress.claimLatest();
    const previousDirectory = options.resume ? recoveryTools.previousAttempt(repoRoot, options.resume) : null;
    progress.persist({ candidate, currentStep: 'prerequisites' });
    externalFastly = fastlyAvailability();
    progress.persist({ externalFastly });
    if (options.requireFastly && externalFastly.status !== 'available') {
      throw Object.assign(new Error(`${externalFastly.message} Install the Fastly CLI with local Compute support.`),
        { code: externalFastly.code });
    }
    if (options.dependencyBundle && !fs.statSync(options.dependencyBundle).isFile()) {
      throw new Error(`Dependency bundle is not a file: ${options.dependencyBundle}`);
    }
    const preflight = require('./release-preflight.cjs').validatePreflight();
    process.stdout.write(`[pulse:release] Preflight passed: ${preflight.shards} release shards mapped; complete verified coverage required.\n`);
    deadline.remaining();
    progress.persist({ currentStep: 'setup' });
    packageManagerCache = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-seal-package-manager-'));
    packageManagerEnv = {
      ...process.env, ...identityEnv,
      COREPACK_HOME: path.join(packageManagerCache, 'corepack'),
      PNPM_HOME: path.join(packageManagerCache, 'pnpm-home'),
      XDG_CACHE_HOME: path.join(packageManagerCache, 'xdg-cache'),
      XDG_DATA_HOME: path.join(packageManagerCache, 'xdg-data'),
      npm_config_cache: path.join(packageManagerCache, 'npm')
    };
    if (options.dependencyBundle) {
      await runStep(
        steps,
        'dependencies',
        'Restore lockfile-pinned dependencies from the offline bundle',
        'bash',
        [path.join(repoRoot, 'restore_pulsewasm_dependencies_portable.sh'), options.dependencyBundle],
        { timeoutMs: 20 * 60 * 1000 }
      );
    } else if (options.install) {
      await runPackageManagerStep(
        'dependencies',
        'Restore the lockfile-pinned workspace dependency graph',
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        10 * 60 * 1000
      );
    }

    const sourceChecksFile = path.join(progress.directory || packageManagerCache, 'source-checks.json');
    await runStep(steps, 'source-checks', 'Validate control planes, catalog, generated docs and site before compilation',
      process.execPath, ['scripts/release-source-checks.cjs', '--out', sourceChecksFile],
      { timeoutMs: 10 * 60 * 1000, env: packageManagerEnv });
    assertCandidateSource(sourceIdentity);
    const sourceChecksSha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(sourceChecksFile)).digest('hex');
    progress.persist({ sourceChecks: { file: sourceChecksFile, sha256: sourceChecksSha256 } });
    await runPackageManagerStep('build', 'Build the TypeScript workspace', ['run', '-s', 'build'], 10 * 60 * 1000);
    await runStep(
      steps,
      'production-dependency-audit',
      'Regenerate production vulnerability and license evidence',
      'node',
      ['scripts/audit-production-dependencies.cjs'],
      { timeoutMs: 10 * 60 * 1000, env: packageManagerEnv }
    );
    await runPackageManagerStep('workspace-unit', 'Run workspace unit tests', ['run', '-s', 'test'], 10 * 60 * 1000);
    const currentCandidate = assertCandidateSource(sourceIdentity);
    if (currentCandidate.sourceTree !== candidate.sourceTree) throw new Error('Candidate tree changed before package qualification');
    const sharedPackDirectory = progress.directory ? path.join(progress.directory, 'packages') : path.join(packageManagerCache, 'packages');
    if (options.workers > 1) {
      await runStep(steps, 'workspaces', 'Prepare isolated local seal workers', process.execPath,
        ['scripts/release-parallel.cjs', repoRoot, String(options.workers), String(options.memoryBudgetMiB), String(options.compilerWorkers)],
        { timeoutMs: 10 * 60 * 1000 });
    }
    let packStore, packSpec;
    if (progress.directory) {
      const { createCheckpointStore, fingerprint } = require('./release-checkpoints.cjs');
      const context = recoveryTools.createContext(repoRoot, candidate, options, externalFastly);
      artifactFiles = recoveryTools.artifactPaths(progress.directory);
      recovery = { schemaVersion: recoveryTools.SCHEMA, directory: progress.directory, previousDirectory,
        context, contextSha256: fingerprint(context), artifacts: artifactFiles };
      progress.persist({ recovery });
      packStore = createCheckpointStore({ directory: path.join(progress.directory, 'checkpoints/pack'),
        previousDirectory: previousDirectory ? path.join(previousDirectory, 'checkpoints/pack') : undefined, context });
      packSpec = { id: 'shared-pack', definition: recoveryTools.sharedPackDefinition(), dependencies: {},
        artifacts: { pack: sharedPackDirectory, log: path.join(progress.directory, 'shared-pack.log') } };
    }
    const reusedPack = packStore?.tryReuse(packSpec);
    let packProof;
    if (reusedPack?.reused) {
      packProof = reusedPack;
      steps.push({ ...reusedPack.result, execution: 'reused', logPath: packSpec.artifacts.log,
        originalResult: reusedPack.result, proofId: reusedPack.proofId });
      progress.persist({ steps });
      process.stdout.write('[pulse:release] Reused verified exact package set from the preceding attempt.\n');
    } else {
      const step = await runStep(steps, 'shared-pack', 'Construct the exact package set once for isolated consumers', process.execPath,
        ['scripts/release-shared-pack.cjs', '--out', sharedPackDirectory,
          '--source-checks', sourceChecksFile, '--source-checks-sha256', sourceChecksSha256],
        { timeoutMs: 10 * 60 * 1000, env: packageManagerEnv });
      if (packStore) packProof = packStore.record({ ...packSpec, result: { ...step, cleanup: { status: 'passed' } } });
    }
    if (recovery) {
      recovery.sharedPack = { proofId: packProof.proofId, receiptPath: packProof.receiptPath,
        receiptSha256: packProof.receiptSha256, execution: reusedPack?.reused ? 'reused' : 'executed',
        reason: reusedPack?.reason || 'fresh attempt' };
      progress.persist({ recovery });
    }
    const consumerEnv = { ...identityEnv, ...require('./release-shared-pack.cjs').sharedPackEnv(sharedPackDirectory) };
    let releaseConfigFile, featureConfigFile;
    if (recovery) {
      const { expandProfile } = require('../wasm/test/suite/registry.cjs');
      releaseConfigFile = path.join(progress.directory, 'release-recovery.json');
      featureConfigFile = path.join(progress.directory, 'feature-recovery.json');
      recoveryTools.atomicJson(releaseConfigFile, recoveryTools.recoveryConfig(recovery, 'release', expandProfile('release')));
      recoveryTools.atomicJson(featureConfigFile, recoveryTools.recoveryConfig(recovery, 'features', require('./release-feature-acceptance.cjs').REQUIRED_TASKS));
    }
    await runStep(
      steps,
      'release',
      'Run native, JavaScript, conformance, provider, CLI, package, consumer, and determinism evidence',
      'node',
      ['wasm/scripts/run-wasm-tests.cjs', '--profile', 'release', '--report', artifactFiles?.taskReport || '.test-results/release-tasks.json',
        ...(releaseConfigFile ? ['--recovery-config', releaseConfigFile] : [])],
      { timeoutMs: 60 * 60 * 1000, env: consumerEnv }
    );

    await runStep(
      steps,
      'installed-features',
      'Qualify separately required installed feature gates on this exact candidate',
      process.execPath,
      ['scripts/release-feature-acceptance.cjs', ...(featureConfigFile ? ['--recovery-config', featureConfigFile] : [])],
      { timeoutMs: 60 * 60 * 1000, env: consumerEnv }
    );
    featureAcceptance = require('./release-feature-acceptance.cjs').validateSummary(
      JSON.parse(fs.readFileSync(artifactFiles?.featureReport || path.join(resultsRoot, 'release-feature-acceptance.json'), 'utf8')),
      revision
    );

    // Availability is a prerequisite, not reality evidence. Inspect it again
    // immediately before the separately required local execution.
    externalFastly = fastlyAvailability();
    if (externalFastly.status === 'available') {
      await runStep(
        steps,
        'fastly-reality',
        'Run external Fastly Compute reality evidence',
        'node',
        ['wasm/scripts/run-wasm-tests.cjs', '--task', 'provider-fastly-compute-reality', '--no-report'],
        {
          timeoutMs: 10 * 60 * 1000,
          env: { PULSE_FASTLY_REALITY_EVIDENCE: artifactFiles?.fastlyReality || path.join(resultsRoot, 'fastly-reality.json') }
        }
      );
      externalFastly = Object.freeze({ ...externalFastly, status: 'passed' });
    } else if (options.requireFastly) {
      const error = new Error(`${externalFastly.message} Use the default optional mode or install the Fastly CLI with local Compute support.`);
      error.code = externalFastly.code;
      throw error;
    } else {
      process.stdout.write(`\n[pulse:release] External Fastly reality unavailable (${externalFastly.code}); recorded as not available.\n`);
    }
    if (options.requireFastly || externalFastly.status === 'passed') {
      const provenGates = [
        'dependency-closure',
        'vulnerability-evidence',
        'dependency-license-evidence'
      ];
      if (externalFastly.status === 'passed') provenGates.push('fastly-cli');
      assertReleasePreflight(provenGates);
    }
    const finalCandidate = assertCandidateSource(sourceIdentity);
    if (finalCandidate.sourceTree !== candidate.sourceTree) throw new Error('Candidate tree changed during qualification');
    if (recovery) {
      const finalAvailability = externalFastly.status === 'passed' ? { ...externalFastly, status: 'available' } : externalFastly;
      assert.deepEqual(recoveryTools.createContext(repoRoot, finalCandidate, options, finalAvailability), recovery.context,
        'Candidate, dependency, toolchain, environment or built workspace bytes changed during qualification');
      if (externalFastly.status !== 'passed') delete recovery.artifacts.fastlyReality;
      recovery.artifactsSha256 = Object.fromEntries(Object.entries(recovery.artifacts).map(([name, file]) => [name, recoveryTools.describeArtifact(file)]));
      progress.persist({ recovery });
    }
    deadline.remaining();
    status = 'passed';
  } catch (error) {
    failure = error;
    status = controller.signal.aborted && controller.signal.reason !== 'deadline' ? 'interrupted' : 'failed';
  } finally {
    deadline.close();
    // Cleanup is a supervised subprocess: a stalled filesystem operation must
    // not prevent a terminal receipt or leave the parent waiting indefinitely.
    progress.persist({ currentStep: 'cleanup', steps, featureAcceptance, externalFastly });
    const result = packageManagerCache ? await runCommand(process.execPath, ['-e',
      "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true });" +
      (options.workers > 1 && candidate ? "const owner=require(process.argv[2]);owner.cleanupWorkspaces(process.argv[3],process.argv[4],Number(process.argv[5]));" : ''),
      packageManagerCache, path.join(repoRoot, 'scripts/release-parallel.cjs'), repoRoot, candidate?.sourceTree || '',
      String(require('./release-parallel.cjs').workerCount(options.workers, options.memoryBudgetMiB))
    ], { timeoutMs: 30000 }) : null;
    cleanup = result ? { status: result.status === 0 && !result.error && !result.timedOut ? 'passed' : 'failed',
      timedOut: result.timedOut, retainedPath: result.status === 0 ? null : packageManagerCache } : { status: 'not-needed', retainedPath: null };
    if (options.workers > 1 && candidate && cleanup.status === 'failed') {
      cleanup.retainedWorkerPath = require('./release-parallel.cjs').workspaceRoot(repoRoot, candidate.sourceTree,
        require('./release-parallel.cjs').workerCount(options.workers, options.memoryBudgetMiB));
    }
    if (cleanup.status === 'failed' && !failure) {
      failure = Object.assign(new Error('Release temporary-input cleanup failed or exceeded its deadline'), { code: 'PULSE_RELEASE_CLEANUP_FAILED' });
      status = 'failed';
    }
    if (controller.signal.aborted) {
      const timedOut = controller.signal.reason === 'deadline';
      status = timedOut ? 'failed' : 'interrupted';
      if (timedOut) failure = Object.assign(new Error('Release seal deadline exceeded'), { code: 'PULSE_RELEASE_SEAL_DEADLINE' });
      else failure ||= Object.assign(new Error(`Seal interrupted by ${controller.signal.reason}`), { code: 'PULSE_RELEASE_INTERRUPTED' });
    }
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    try { sealLock?.release(); } catch (error) { failure ||= error; status = 'failed'; }
  }

  const report = progress.finish({ status, steps, featureAcceptance, externalFastly, cleanup, recovery,
    ...(failure ? { error: { code: failure.code || null, message: failure.message } } : {}) });
  process.stdout.write(`\n[pulse:release] Seal ${status} with ${steps.length} completed step(s); Fastly reality: ${externalFastly.status}.\n`);
  if (progress.directory) process.stdout.write(`[pulse:release] Terminal report: ${path.join(progress.directory, 'report.json')}\n`);
  if (failure) throw failure;
  return report;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ parseArgs, fastlyAvailability, assertReleaseNode, assertReleasePreflight, createDeadline, main });
