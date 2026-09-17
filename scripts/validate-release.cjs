#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fastly = require('../packages/provider-fastly/src/testing/fastly-cli.js');
const { PUBLICATION, versionSatisfiesCaretRange } = require('./package-support.cjs');
const { validatePreflight } = require('./release-preflight.cjs');
const { resolveSourceIdentity, sourceIdentityEnv } = require('./source-identity.cjs');

const repoRoot = path.resolve(__dirname, '..');
const resultsRoot = path.join(repoRoot, 'wasm', '.test-results');
const reportFile = path.join(resultsRoot, 'release-seal.json');

function parseArgs(argv) {
  const options = { install: true, report: true, requireFastly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--skip-install') options.install = false;
    else if (token === '--no-report') options.report = false;
    else if (token === '--require-fastly') options.requireFastly = true;
    else if (token === '--dependency-bundle') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--dependency-bundle requires a path');
      options.dependencyBundle = path.resolve(value);
      index += 1;
    } else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown release-seal option: ${token}`);
  }
  if (!options.install && options.dependencyBundle) throw new Error('--skip-install and --dependency-bundle cannot be combined');
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
    '  --no-report                 do not write wasm/.test-results/release-seal.json',
    '  -h, --help                  show this help'
  ].join('\n');
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function packageManagerInvocation() {
  return require('./pnpm-toolchain.cjs').pnpmInvocation(repoRoot);
}

function runStep(steps, id, description, command, args, options = {}) {
  process.stdout.write(`\n[pulse:release] Step ${steps.length + 1} started: ${id} — ${description}\n`);
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    timeout: options.timeoutMs || 20 * 60 * 1000
  });
  const step = Object.freeze({
    id,
    description,
    command: commandText(command, args),
    status: !result.error && result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal || null,
    startedAt,
    completedAt: new Date().toISOString(),
    error: result.error ? result.error.message : null
  });
  steps.push(step);
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
  return validatePreflight({ stage: 'release-seal', provenGates });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const runtime = assertReleaseNode();
  const preflight = validatePreflight();
  process.stdout.write(`[pulse:release] Preflight passed: ${preflight.shards} release shards mapped; full replay still required.\n`);

  const startedAt = new Date().toISOString();
  const sourceIdentity = resolveSourceIdentity(repoRoot);
  const revision = sourceIdentity.sourceRevision;
  const identityEnv = sourceIdentityEnv(sourceIdentity);
  const steps = [];
  const packageManagerCache = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-seal-package-manager-'));
  const packageManagerEnv = {
    ...process.env,
    ...identityEnv,
    COREPACK_HOME: path.join(packageManagerCache, 'corepack'),
    PNPM_HOME: path.join(packageManagerCache, 'pnpm-home'),
    XDG_CACHE_HOME: path.join(packageManagerCache, 'xdg-cache'),
    XDG_DATA_HOME: path.join(packageManagerCache, 'xdg-data'),
    npm_config_cache: path.join(packageManagerCache, 'npm')
  };
  let externalFastly = Object.freeze({ status: 'not-inspected' });
  let status = 'running';
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
    if (options.dependencyBundle) {
      if (!fs.existsSync(options.dependencyBundle)) throw new Error(`Dependency bundle does not exist: ${options.dependencyBundle}`);
      runStep(
        steps,
        'dependencies',
        'Restore lockfile-pinned dependencies from the offline bundle',
        'bash',
        [path.join(repoRoot, 'restore_pulsewasm_dependencies_portable.sh'), options.dependencyBundle],
        { timeoutMs: 20 * 60 * 1000 }
      );
    } else if (options.install) {
      runPackageManagerStep(
        'dependencies',
        'Restore the lockfile-pinned workspace dependency graph',
        ['install', '--frozen-lockfile', '--ignore-scripts'],
        10 * 60 * 1000
      );
    }

    runStep(steps, 'maintainer', 'Validate the maintainer control plane', 'node', ['scripts/validate-maintainer-control-plane.cjs']);
    runStep(steps, 'publication', 'Validate publication and deployment controls', 'node', ['scripts/validate-publication-workflows.cjs']);
    runPackageManagerStep('build', 'Build the TypeScript workspace', ['run', '-s', 'build'], 10 * 60 * 1000);
    runStep(
      steps,
      'documentation-sizes',
      'Preflight documented Wasm sizes before the complete release replay',
      process.execPath,
      ['wasm/test/docs/assert-executable-documentation.cjs', '--section', 'sizes'],
      { timeoutMs: 10 * 60 * 1000, env: identityEnv }
    );
    runStep(
      steps,
      'production-dependency-audit',
      'Regenerate production vulnerability and license evidence',
      'node',
      ['scripts/audit-production-dependencies.cjs'],
      { timeoutMs: 10 * 60 * 1000, env: packageManagerEnv }
    );
    runPackageManagerStep('workspace-unit', 'Run workspace unit tests', ['run', '-s', 'test'], 10 * 60 * 1000);
    runPackageManagerStep('documentation', 'Validate synchronized documentation and generated site output', ['run', '-s', 'docs:check'], 10 * 60 * 1000);
    runStep(
      steps,
      'release',
      'Run native, JavaScript, conformance, provider, CLI, package, consumer, and determinism evidence',
      'node',
      ['wasm/scripts/run-wasm-tests.cjs', '--profile', 'release', '--report', '.test-results/release-tasks.json'],
      { timeoutMs: 60 * 60 * 1000, env: identityEnv }
    );

    externalFastly = fastlyAvailability();
    if (externalFastly.status === 'available') {
      runStep(
        steps,
        'fastly-reality',
        'Run external Fastly Compute reality evidence',
        'node',
        ['wasm/scripts/run-wasm-tests.cjs', '--task', 'provider-fastly-compute-reality', '--no-report'],
        {
          timeoutMs: 10 * 60 * 1000,
          env: { PULSE_FASTLY_REALITY_EVIDENCE: path.join(resultsRoot, 'fastly-reality.json') }
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
    status = 'passed';
  } catch (error) {
    status = 'failed';
    if (options.report) {
      atomicJson(reportFile, {
        schemaVersion: 'pulse.release-seal.v1',
        sourceRevision: revision,
        sourceIdentity,
        runtime,
        status,
        startedAt,
        completedAt: new Date().toISOString(),
        steps,
        externalFastly,
        error: { code: error.code || null, message: error.message }
      });
    }
    throw error;
  } finally {
    fs.rmSync(packageManagerCache, { recursive: true, force: true });
  }

  const report = Object.freeze({
    schemaVersion: 'pulse.release-seal.v1',
    sourceRevision: revision,
    sourceIdentity,
    runtime,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    steps: Object.freeze(steps),
    externalFastly
  });
  if (options.report) atomicJson(reportFile, report);
  process.stdout.write(`\n[pulse:release] Seal passed with ${steps.length} completed step(s); Fastly reality: ${externalFastly.status}.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ parseArgs, fastlyAvailability, assertReleaseNode, assertReleasePreflight, main });
