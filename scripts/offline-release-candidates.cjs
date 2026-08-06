#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveProject } = require('../wasm/packages/cli/src/project-config.js');
const { buildProject } = require('../wasm/packages/cli/src/project-execution.js');
const { resolveSourceIdentity } = require('./source-identity.cjs');

const CANDIDATE_REPORT_VERSION = 'pulse.offline-deployment-candidates.v1';
const CANDIDATE_MANIFEST_VERSION = 'pulse.offline-deployment-candidate.v1';
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(
  repoRoot,
  'wasm',
  'test',
  'fixtures',
  'projects',
  'fastly-javascript-source'
);
const defaultOutput = path.join(repoRoot, 'wasm', '.test-results', 'deployment-candidates');
const defaultReport = path.join(repoRoot, 'wasm', '.test-results', 'deployment-candidates.json');
const fastlyPackageRoot = path.join(repoRoot, 'packages', 'provider-fastly');
const esbuildRoot = path.join(fastlyPackageRoot, 'node_modules', 'esbuild');
const javascriptCompiler = path.join(
  fastlyPackageRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'js-compute-runtime.cmd' : 'js-compute-runtime'
);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function snapshot(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        files.push(Object.freeze({
          file: slash(path.relative(root, file)),
          bytes: fs.statSync(file).size,
          sha256: sha256File(file)
        }));
      } else {
        fail('PULSE_CANDIDATE_SPECIAL_FILE', `Candidate output contains a non-regular file: ${file}`);
      }
    }
  }
  visit(root);
  return Object.freeze(files);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(
      options.code || 'PULSE_CANDIDATE_COMMAND_FAILED',
      `${options.description || command} failed${output ? `:\n${output}` : ''}`
    );
  }
  return Object.freeze({
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  });
}

function parseArgs(argv) {
  const options = {
    outDir: defaultOutput,
    reportFile: defaultReport,
    replace: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const take = (name) => {
      const value = argv[++index];
      if (!value || value.startsWith('-')) fail('PULSE_CANDIDATE_ARGUMENT', `${name} requires a path`);
      return value;
    };
    if (token === '--out') options.outDir = path.resolve(take(token));
    else if (token.startsWith('--out=')) options.outDir = path.resolve(token.slice(6));
    else if (token === '--report') options.reportFile = path.resolve(take(token));
    else if (token.startsWith('--report=')) options.reportFile = path.resolve(token.slice(9));
    else if (token === '--replace') options.replace = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else fail('PULSE_CANDIDATE_ARGUMENT', `Unknown offline-candidate option: ${token}`);
  }
  return Object.freeze(options);
}

function usage() {
  return [
    'Usage: node scripts/offline-release-candidates.cjs [options]',
    '',
    'Options:',
    '  --out <directory>   candidate output directory',
    '  --report <file>     persisted JSON report',
    '  --replace           replace only a prior marked candidate directory',
    '  -h, --help          show this help',
    '',
    'This command builds candidates locally. It never deploys or publishes them.'
  ].join('\n');
}

function assertReplaceable(output) {
  const marker = path.join(output, 'candidate-report.json');
  if (!fs.existsSync(marker)) {
    fail(
      'PULSE_CANDIDATE_REPLACE_UNSAFE',
      `Refusing to replace an unmarked output directory: ${output}`
    );
  }
  let report;
  try { report = readJson(marker); }
  catch (error) {
    fail('PULSE_CANDIDATE_REPLACE_UNSAFE', `Refusing to replace an unreadable candidate directory: ${error.message}`);
  }
  if (report.schemaVersion !== CANDIDATE_REPORT_VERSION) {
    fail('PULSE_CANDIDATE_REPLACE_UNSAFE', `Refusing to replace an output with schema ${String(report.schemaVersion)}.`);
  }
}

function assertOutputTarget(output, replace) {
  const resolved = path.resolve(output);
  if (resolved === path.parse(resolved).root || resolved === repoRoot || resolved === fixtureRoot) {
    fail('PULSE_CANDIDATE_OUTPUT_UNSAFE', `Unsafe candidate output directory: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) return;
  if (!replace) fail('PULSE_CANDIDATE_OUTPUT_EXISTS', `Candidate output already exists: ${resolved}`);
  assertReplaceable(resolved);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function assertWasm(file, label) {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 8, `${label} must not be empty`);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d], `${label} must be WebAssembly`);
}

function withEsbuildLink(candidateRoot, operation) {
  const nodeModules = path.join(candidateRoot, 'node_modules');
  const link = path.join(nodeModules, 'esbuild');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.symlinkSync(esbuildRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    return operation();
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    if (fs.existsSync(nodeModules) && fs.readdirSync(nodeModules).length === 0) fs.rmdirSync(nodeModules);
  }
}

function compileJavascriptCandidate(candidateRoot) {
  if (!fs.existsSync(esbuildRoot)) {
    fail('PULSE_CANDIDATE_ESBUILD_UNAVAILABLE', 'The exact provider Fastly esbuild installation is unavailable.');
  }
  if (!fs.existsSync(javascriptCompiler)) {
    fail('PULSE_CANDIDATE_JAVASCRIPT_COMPILER_UNAVAILABLE', 'The exact @fastly/js-compute compiler is unavailable.');
  }
  withEsbuildLink(candidateRoot, () => run(process.execPath, ['pulse-esbuild.config.js'], {
    cwd: candidateRoot,
    code: 'PULSE_CANDIDATE_ESBUILD_FAILED',
    description: 'Fastly JavaScript candidate bundling'
  }));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-javascript-cache-'));
  try {
    run(javascriptCompiler, [
      '--env',
      `XDG_CACHE_HOME=${cacheRoot}`,
      'dist/index.js',
      'bin/main.wasm'
    ], {
      cwd: candidateRoot,
      code: 'PULSE_CANDIDATE_JAVASCRIPT_COMPILE_FAILED',
      description: 'Fastly JavaScript runtime compilation'
    });
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
  assertWasm(path.join(candidateRoot, 'bin', 'main.wasm'), 'Fastly JavaScript runtime candidate');
}

function verifyJavascriptBuild(root, build) {
  assert.equal(build.provider, 'fastly');
  assert.equal(build.configuredTarget, 'javascript');
  assert.equal(build.automaticFallback, false);
  assert.equal(build.targetSupport.availability.fullTargetSupportReady, true);
  assert.equal(build.targetSupport.availability.generalAvailable, true);
  assert.equal(build.manifest.providerTarget.nativeWasm, false);
  assert.equal(build.manifest.providerTarget.deploymentCandidate, true);
  assert.equal(build.manifest.providerTarget.providerRealityValidated, false);
  const candidate = readJson(path.join(root, 'pulse-fastly-javascript-candidate.json'));
  assert.equal(candidate.provider, 'fastly');
  assert.equal(candidate.target, 'javascript');
  assert.equal(candidate.targetId, 'fastly-javascript');
  assert.equal(candidate.automaticFallback, false);
  assert.equal(candidate.providerRealityValidated, false);
  assert.equal(candidate.deployed, false);
  assert.equal(candidate.validation.providerReality, 'not-executed');
  assert.equal(candidate.validation.deployment, 'not-executed');
}

function verifyNativeBuild(root, build) {
  assert.equal(build.provider, 'fastly');
  assert.equal(build.project.target, 'native');
  assert.equal(build.manifest.provider, 'fastly');
  assert.equal(build.manifest.configuredTarget, 'native');
  assert.equal(build.manifest.providerTarget.nativeWasm, true);
  assert.equal(build.manifest.providerTarget.javascriptRuntime, false);
  assertWasm(path.join(root, 'bin', 'main.wasm'), 'Fastly Native candidate');
}

function buildCandidate(profile, target, destination, sourceIdentity) {
  const buildRoot = path.join(fixtureRoot, `.release-candidate-${process.pid}-${target}`);
  fs.rmSync(buildRoot, { recursive: true, force: true });
  try {
    const project = resolveProject({ cwd: fixtureRoot, profile });
    assert.equal(project.provider, 'fastly');
    assert.equal(project.target, target);
    const first = buildProject(project, { outDir: buildRoot });
    if (target === 'javascript') {
      verifyJavascriptBuild(buildRoot, first);
    } else {
      verifyNativeBuild(buildRoot, first);
    }
    const firstSnapshot = snapshot(buildRoot);
    fs.cpSync(buildRoot, destination, { recursive: true });

    const second = buildProject(project, { outDir: buildRoot });
    if (target === 'javascript') {
      verifyJavascriptBuild(buildRoot, second);
    } else {
      verifyNativeBuild(buildRoot, second);
    }
    const secondSnapshot = snapshot(buildRoot);
    assert.deepEqual(firstSnapshot, secondSnapshot, `${target} candidate inputs and metadata must be byte-identical`);
    if (target === 'javascript') compileJavascriptCandidate(destination);

    const runtimeArtifact = path.join(destination, 'bin', 'main.wasm');
    const pulseBuild = path.join(destination, 'pulse-build.json');
    const manifest = Object.freeze({
      schemaVersion: CANDIDATE_MANIFEST_VERSION,
      status: 'structurally-deployable',
      sourceRevision: sourceIdentity.sourceRevision,
      sourceIdentity,
      provider: 'fastly',
      target,
      targetId: `fastly-${target}`,
      artifactClass: target === 'javascript'
        ? 'fastly-javascript-runtime-wasm'
        : 'fastly-native-wasm',
      runtimeArtifact: Object.freeze({
        file: 'bin/main.wasm',
        bytes: fs.statSync(runtimeArtifact).size,
        sha256: sha256File(runtimeArtifact)
      }),
      pulseBuild: Object.freeze({
        file: 'pulse-build.json',
        sha256: sha256File(pulseBuild)
      }),
      deterministicInputClosure: true,
      deterministicMetadata: true,
      runtimeArtifactDeterminism: target === 'native'
        ? 'byte-identical'
        : 'not-claimed-by-downstream-toolchain',
      automaticFallback: false,
      providerRealityValidated: false,
      deploymentPerformed: false,
      publicationPerformed: false
    });
    atomicJson(path.join(destination, 'pulse-offline-candidate.json'), manifest);
    const files = snapshot(destination);
    return Object.freeze({
      provider: 'fastly',
      target,
      targetId: manifest.targetId,
      directory: path.basename(destination),
      status: manifest.status,
      deterministicInputClosure: true,
      deterministicMetadata: true,
      runtimeArtifactDeterminism: manifest.runtimeArtifactDeterminism,
      inputClosureSha256: sha256(JSON.stringify(firstSnapshot)),
      comparisons: 2,
      runtimeArtifact: manifest.runtimeArtifact,
      providerRealityValidated: false,
      deploymentPerformed: false,
      publicationPerformed: false,
      files
    });
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}

function buildOfflineCandidates(options) {
  const output = path.resolve(options.outDir);
  const reportFile = path.resolve(options.reportFile);
  assertOutputTarget(output, options.replace);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = path.join(path.dirname(output), `.${path.basename(output)}.tmp-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const sourceIdentity = resolveSourceIdentity(repoRoot);
    const candidates = Object.freeze([
      buildCandidate('fastly-native', 'native', path.join(staging, 'fastly-native'), sourceIdentity),
      buildCandidate('fastly-javascript', 'javascript', path.join(staging, 'fastly-javascript'), sourceIdentity)
    ]);
    const report = Object.freeze({
      schemaVersion: CANDIDATE_REPORT_VERSION,
      sourceRevision: sourceIdentity.sourceRevision,
      sourceIdentity,
      status: 'passed',
      mode: 'offline',
      generatedAt: new Date().toISOString(),
      candidates,
      summary: Object.freeze({
        total: candidates.length,
        deterministicInputClosures: candidates.filter((entry) => entry.deterministicInputClosure).length,
        deterministicMetadata: candidates.filter((entry) => entry.deterministicMetadata).length,
        byteIdenticalRuntimeArtifacts: candidates.filter((entry) => entry.runtimeArtifactDeterminism === 'byte-identical').length,
        providerRealityValidated: 0,
        deployed: 0,
        published: 0
      }),
      policy: Object.freeze({
        localCompilationOnly: true,
        fastlyCliInvoked: false,
        providerRealityInvoked: false,
        deploymentPerformed: false,
        publicationPerformed: false
      })
    });
    atomicJson(path.join(staging, 'candidate-report.json'), report);
    fs.renameSync(staging, output);
    if (reportFile !== path.join(output, 'candidate-report.json')) atomicJson(reportFile, report);
    return report;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = buildOfflineCandidates(options);
  process.stdout.write(
    `Offline deployment candidates passed: ${report.summary.total}; ` +
    'provider reality 0, deployments 0, publications 0.\n'
  );
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  CANDIDATE_REPORT_VERSION,
  CANDIDATE_MANIFEST_VERSION,
  parseArgs,
  snapshot,
  buildOfflineCandidates
});
