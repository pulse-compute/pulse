#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const reportRoot = path.join(repoRoot, 'wasm/.test-results/events-ev9');
const tempParent = process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir();
fs.mkdirSync(tempParent, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(tempParent, 'pulse-events-ev9-'));
const consumerRoot = path.join(testRoot, 'consumer');
const npmCache = path.join(testRoot, 'npm-cache');
const reportVersion = 'pulse.events-experimental-candidate-seal.ev9.v1';
const candidatePackages = Object.freeze([
  Object.freeze({ name: '@pulse-compute/pulse', dir: 'packages/pulse' }),
  Object.freeze({ name: '@pulse-compute/runtime', dir: 'packages/runtime' }),
  Object.freeze({ name: '@pulse-compute/wasm-contracts', dir: 'wasm/packages/contracts' })
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      ...(options.env || {})
    },
    encoding: 'utf8',
    timeout: options.timeoutMs || 300_000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false
  });
  if (result.error || result.status !== (options.expectedStatus ?? 0)) {
    throw new Error([
      `command failed: ${command} ${args.join(' ')}`,
      `status: ${result.status}`,
      `stdout:\n${result.stdout || ''}`,
      `stderr:\n${result.stderr || ''}`,
      result.error ? `error: ${result.error.message}` : ''
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function sortedRecord(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function candidateManifest(source) {
  const manifest = JSON.parse(JSON.stringify(source));
  delete manifest.devDependencies;
  manifest.files = [...new Set([...(manifest.files || []), 'LICENSE', 'NOTICE'])];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!manifest[section]) continue;
    for (const [name, version] of Object.entries(manifest[section])) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        assert.ok(name.startsWith('@pulse-compute/'), `${manifest.name} has a workspace dependency outside Pulse`);
        manifest[section][name] = '1.0.0-beta.1';
      }
    }
    manifest[section] = sortedRecord(manifest[section]);
  }
  return manifest;
}

function stageCandidate(entry, pass) {
  const sourceRoot = path.join(repoRoot, entry.dir);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  assert.equal(sourceManifest.name, entry.name);
  assert.equal(sourceManifest.version, '1.0.0-beta.1');
  assert.equal(sourceManifest.license, 'Apache-2.0');
  const stageRoot = path.join(testRoot, `stage-${pass}`);
  const tarballRoot = path.join(testRoot, `tarballs-${pass}`);
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.mkdirSync(tarballRoot, { recursive: true });
  const targetRoot = path.join(stageRoot, entry.name.replace(/[^A-Za-z0-9._-]/g, '-'));
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(file) {
      const relative = path.relative(sourceRoot, file).replace(/\\/g, '/');
      return relative === '' || !/(?:^|\/)(?:node_modules|test|tests|\.test-results)(?:\/|$)/.test(relative);
    }
  });
  const manifest = candidateManifest(sourceManifest);
  fs.writeFileSync(path.join(targetRoot, 'package.json'), stableJson(manifest));
  for (const legal of ['LICENSE', 'NOTICE']) {
    fs.copyFileSync(path.join(repoRoot, legal), path.join(targetRoot, legal));
  }
  const packed = run('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
    cwd: targetRoot,
    timeoutMs: 180_000
  });
  const packReport = JSON.parse(packed.stdout);
  assert.equal(packReport.length, 1, `${entry.name} must produce one candidate tarball: ${packed.stdout}`);
  const tarball = path.join(tarballRoot, packReport[0].filename);
  assert.equal(fs.existsSync(tarball), true, `${entry.name} candidate tarball is missing ${packReport[0].filename}`);
  return Object.freeze({ entry, sourceManifest, manifest, tarball });
}

function recursiveStrings(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) recursiveStrings(entry, visit);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) recursiveStrings(entry, visit);
  } else if (typeof value === 'string') {
    visit(value);
  }
}

function packedText(entries, name) {
  const value = entries.get(name);
  assert.ok(value, `candidate tarball is missing ${name}`);
  return value.toString('utf8');
}

function validateTarball(candidate) {
  const entries = readTarEntries(candidate.tarball);
  const manifest = JSON.parse(packedText(entries, 'package/package.json'));
  assert.equal(manifest.name, candidate.entry.name);
  assert.equal(manifest.version, '1.0.0-beta.1');
  assert.equal(manifest.license, 'Apache-2.0');
  recursiveStrings(manifest, (value) => assert.equal(value.startsWith('workspace:'), false, `${manifest.name} retains ${value}`));
  const files = [...entries.keys()].sort();
  assert.equal(files.some((file) => /^package\/(?:node_modules|test|tests|\.test-results)(?:\/|$)/.test(file)), false, `${manifest.name} contains repository-only paths`);
  assert.ok(entries.has('package/README.md'), `${manifest.name} tarball is missing README.md`);
  for (const legal of ['LICENSE', 'NOTICE']) {
    const packed = entries.get(`package/${legal}`);
    assert.ok(packed, `${manifest.name} tarball is missing ${legal}`);
    assert.deepEqual(packed, fs.readFileSync(path.join(repoRoot, legal)), `${manifest.name} ${legal} differs from repository authority`);
    assert.ok(manifest.files.includes(legal), `${manifest.name} files must name ${legal}`);
  }

  if (manifest.name === '@pulse-compute/pulse') {
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './schema']);
    const types = packedText(entries, 'package/src/index.d.ts');
    const runtime = packedText(entries, 'package/src/index.js');
    const applicationRuntime = packedText(entries, 'package/src/internal/application.js');
    assert.match(types, /class Pulse extends Router/);
    assert.match(types, /\bon<Payload = unknown>\(/);
    assert.match(types, /PulseEventHandler<Payload>/);
    assert.doesNotMatch(types, /\b(?:call|exec|invoke)\s*\(/);
    assert.match(runtime, /\.\/internal\/application\.js/);
    assert.match(applicationRuntime, /addEventRegistration/);
    assert.ok(entries.has('package/src/internal/event-registration.js'));
    assert.deepEqual(manifest.dependencies, {
      '@pulse-compute/runtime': '1.0.0-beta.1',
      '@pulse-compute/wasm-contracts': '1.0.0-beta.1'
    });
  }

  if (manifest.name === '@pulse-compute/runtime') {
    assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './host', './package']);
    const authorTypes = packedText(entries, 'package/src/index.d.ts');
    const hostTypes = packedText(entries, 'package/src/host.d.ts');
    assert.match(authorTypes, /interface PulseEventContext/);
    assert.match(authorTypes, /emit<Payload = unknown>\(/);
    assert.match(authorTypes, /type PulseEventHandler/);
    assert.doesNotMatch(authorTypes, /\b(?:call|exec|invoke)\s*\(/);
    assert.match(hostTypes, /function executeEvent\(/);
    assert.match(hostTypes, /function createEventRecordingAdapter\(/);
    assert.match(hostTypes, /autoLoopback: false/);
    for (const required of [
      'package/src/internal/event-execution.js',
      'package/src/internal/event-emission.js',
      'package/src/host.js',
      'package/docs/API.md',
      'package/docs/preview-scope.md'
    ]) assert.ok(entries.has(required), `runtime tarball is missing ${required}`);
  }

  if (manifest.name === '@pulse-compute/wasm-contracts') {
    assert.equal(manifest.exports['./events'], './src/events/contracts.js', 'internal event authority must have one declared toolchain entry');
    assert.equal(Object.prototype.hasOwnProperty.call(manifest.exports, './events/contracts'), false, 'internal event contracts must remain outside package exports');
    assert.ok(entries.has('package/src/events/contracts.js'), 'contracts tarball must carry the synchronized internal event authority');
  }

  const bytes = fs.readFileSync(candidate.tarball);
  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    tarball: path.basename(candidate.tarball),
    bytes: bytes.length,
    sha256: sha256(bytes),
    files: files.length,
    dependencies: Object.freeze(sortedRecord(manifest.dependencies)),
    entries
  });
}

function compareDeterministicPacks(first, second) {
  const firstByName = new Map(first.map((entry) => [entry.entry.name, entry]));
  const results = [];
  for (const candidate of second) {
    const prior = firstByName.get(candidate.entry.name);
    assert.ok(prior, `second pack contains unexpected package ${candidate.entry.name}`);
    const left = fs.readFileSync(prior.tarball);
    const right = fs.readFileSync(candidate.tarball);
    assert.deepEqual(right, left, `${candidate.entry.name} candidate tarball is not byte-deterministic`);
    results.push(Object.freeze({ name: candidate.entry.name, sha256: sha256(left), byteIdentical: true }));
  }
  return Object.freeze(results.sort((left, right) => left.name.localeCompare(right.name)));
}

function writeConsumer() {
  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), stableJson({
    name: 'pulse-events-ev9-clean-consumer',
    version: '0.0.0',
    private: true,
    type: 'module'
  }));
  fs.writeFileSync(path.join(consumerRoot, 'runtime.cjs'), `
'use strict'
const assert = require('node:assert/strict')
const { Pulse } = require('@pulse-compute/pulse')
const { createEventRecordingAdapter, executeEvent } = require('@pulse-compute/runtime/host')

async function main() {
  const app = new Pulse({ auto: true })
  app.on('system.tick', { schema: null }, async (ctx) => {
    await ctx.emit('system.heartbeat', { schema: null })
  })
  assert.equal(typeof app.on, 'function')
  assert.equal(app.call, undefined)
  assert.equal(app.exec, undefined)
  assert.equal(app.invoke, undefined)
  const adapter = createEventRecordingAdapter({ maxQueueDepth: 4 })
  const result = await executeEvent(app, {
    version: 'pulse.event-frame.v1',
    type: 'system.tick',
    schemaId: null,
  }, { effectAdapter: adapter })
  assert.deepEqual(result, { version: 'pulse.event-execution-result.v1', status: 'completed' })
  assert.deepEqual(adapter.acceptedFrames(), [{
    version: 'pulse.event-frame.v1',
    type: 'system.heartbeat',
    schemaId: null,
  }])
  console.log(JSON.stringify({ status: result.status, accepted: adapter.acceptedFrames().length }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`.trimStart());
  fs.writeFileSync(path.join(consumerRoot, 'index.ts'), `
import { Pulse, type PulseEventContext } from '@pulse-compute/pulse'

type Reading = Readonly<{ deviceId: string; temperatureC: number }>
declare const typedContext: PulseEventContext<Reading>
const deviceId: string = typedContext.event.payload.deviceId
void deviceId

const app = new Pulse({ auto: true })
app.get('/health', async (ctx) => ctx.text('ok'))
app.on<Reading>('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  await ctx.emit('device.reading.accepted', {
    schema: 'events.DeviceReadingAccepted',
    payload: { deviceId: ctx.event.payload.deviceId, accepted: true },
  })
})
app.on('system.tick', { schema: null }, async (ctx) => {
  const payload: null = ctx.event.payload
  void payload
  await ctx.emit('system.heartbeat', { schema: null })
})
export default app
`.trimStart());
  fs.writeFileSync(path.join(consumerRoot, 'host.ts'), `
import {
  createEventRecordingAdapter,
  executeEvent,
  type PulseEventExecutionResult,
  type PulseEventFrame,
} from '@pulse-compute/runtime/host'
import app from './index.js'

const adapter = createEventRecordingAdapter({ maxQueueDepth: 4 })
const frame: PulseEventFrame = {
  version: 'pulse.event-frame.v1',
  type: 'system.tick',
  schemaId: null,
}
const execution: Promise<PulseEventExecutionResult> = executeEvent(app, frame, { effectAdapter: adapter })
void execution
`.trimStart());
  fs.writeFileSync(path.join(consumerRoot, 'tsconfig.json'), stableJson({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
      strict: true,
      noEmit: true,
      skipLibCheck: false
    },
    include: ['index.ts', 'host.ts']
  }));
}

function validateCleanConsumer(candidates) {
  writeConsumer();
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-save',
    '--no-audit',
    '--no-fund',
    '--offline',
    '--package-lock=false',
    ...candidates.map((candidate) => candidate.tarball)
  ], { cwd: consumerRoot, timeoutMs: 300_000 });
  const runtime = run(process.execPath, ['runtime.cjs'], { cwd: consumerRoot, timeoutMs: 180_000 });
  const tsc = require.resolve('typescript/bin/tsc', { paths: [repoRoot] });
  run(process.execPath, [tsc, '--project', 'tsconfig.json'], { cwd: consumerRoot, timeoutMs: 180_000 });
  return Object.freeze({
    install: 'local-tarballs-offline',
    runtime: JSON.parse(runtime.stdout),
    typescript: 'passed',
    applicationSurface: 'Pulse.on-and-ctx.emit',
    hostSurface: 'executeEvent-and-recording-adapter'
  });
}

function fileEvidence(relative) {
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  return Object.freeze({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
}

function validateReleaseBoundary() {
  const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/pulse-release-manifest.json'), 'utf8'));
  assert.equal(release.releaseVersion, '1.0.0-beta.1');
  assert.equal(release.channel, 'beta');
  assert.equal(release.releasedAt, '2026-08-01');
  assert.equal(release.packages.length, 18);
  const releaseNames = new Set(release.packages.map((entry) => entry.name));
  for (const candidate of candidatePackages) assert.ok(releaseNames.has(candidate.name), `${candidate.name} must remain in the frozen package set`);
  for (const assigned of ['@pulse-compute/entities', '@pulse-compute/crypto', '@pulse-compute/jwt']) {
    assert.equal(releaseNames.has(assigned), true, `${assigned} must be assigned to the Beta release`);
  }
  const cryptoManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/crypto/package.json'), 'utf8'));
  const jwtManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/jwt/package.json'), 'utf8'));
  assert.equal(cryptoManifest.version, '1.0.0-beta.1');
  assert.equal(jwtManifest.version, '1.0.0-beta.1');
  const synchronizedDependencyVersions = Object.freeze({
    '@pulse-compute/crypto': cryptoManifest.version,
    '@pulse-compute/jwt': jwtManifest.version
  });
  const assignedProviderDependencies = ['provider-fastly', 'provider-node'].flatMap((provider) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, `packages/${provider}/package.json`), 'utf8'));
    assert.ok(releaseNames.has(manifest.name), `${manifest.name} must remain in the frozen package set`);
    return Object.entries(synchronizedDependencyVersions).map(([name, packageVersion]) => {
      assert.equal(manifest.dependencies[name], 'workspace:*');
      return Object.freeze({ provider: manifest.name, name, sourceRange: 'workspace:*', packageVersion });
    });
  });
  return Object.freeze({
    releaseVersion: release.releaseVersion,
    channel: release.channel,
    releasedAt: release.releasedAt,
    packageCount: release.packages.length,
    eventFacingPackagesAssigned: true,
    unassignedPackages: Object.freeze([]),
    assignedProviderDependencies: Object.freeze(assignedProviderDependencies),
    releaseIdentityChanged: true,
    publicationAuthorized: false
  });
}

function validateDocumentation() {
  const required = [
    'API.md',
    'docs/guides/events.md',
    'docs/architecture/current-contracts.md',
    'docs/reference/compatibility-matrix.md',
    'docs/maintainers/testing.md',
    'docs/maintainers/release-acceptance.md',
    'examples/11-events/README.md',
    'examples/11-events/src/index.ts',
    'examples/11-events/src/schemas.ts',
    'examples/11-events/tests/pulse.harness.ts'
  ];
  for (const relative of required) assert.ok(fs.existsSync(path.join(repoRoot, relative)), `event candidate documentation is missing ${relative}`);
  const guide = fs.readFileSync(path.join(repoRoot, 'docs/guides/events.md'), 'utf8');
  for (const requiredText of [
    'Pulse.on',
    'PulseEventContext',
    'ctx.emit',
    'pulse.event-frame.v1',
    'pulse.native-event-abi.v1',
    'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED',
    'No `call` or reflexive routing',
    'Fastly JavaScript',
    'Browser or ESP32'
  ]) assert.ok(guide.includes(requiredText), `event guide is missing ${requiredText}`);
  return Object.freeze({ files: required.length, guide: fileEvidence('docs/guides/events.md'), example: fileEvidence('examples/11-events/src/index.ts') });
}

function main() {
  const first = candidatePackages.map((entry) => stageCandidate(entry, 'a'));
  const second = candidatePackages.map((entry) => stageCandidate(entry, 'b'));
  const validated = first.map(validateTarball).sort((left, right) => left.name.localeCompare(right.name));
  const packageInventory = validated.map(({ entries: _entries, ...entry }) => Object.freeze(entry));
  const determinism = compareDeterministicPacks(first, second);
  const cleanConsumer = validateCleanConsumer(first);
  const releaseBoundary = validateReleaseBoundary();
  const documentation = validateDocumentation();
  const legal = Object.freeze({
    license: 'Apache-2.0',
    licenseSha256: sha256(fs.readFileSync(path.join(repoRoot, 'LICENSE'))),
    noticeSha256: sha256(fs.readFileSync(path.join(repoRoot, 'NOTICE')))
  });

  const report = Object.freeze({
    version: reportVersion,
    decision: 'working-candidate',
    candidateBlockers: Object.freeze([]),
    releaseReady: false,
    releaseBlockers: Object.freeze([
      Object.freeze({
        id: 'entities-ordinary-javascript-application-loader',
        status: 'open',
        owner: 'cli',
        summary: 'The existing Entities candidate still requires ordinary JavaScript loading through its public package root.'
      }),
      Object.freeze({
        id: 'entities-ordinary-native-project-integration',
        status: 'open',
        owner: 'compiler-and-providers',
        summary: 'The existing Entities candidate still requires adoption by the ordinary Native project build path.'
      }),
      Object.freeze({
        id: 'publication-authority',
        status: 'hold',
        owner: 'human-release-governance',
        summary: 'The Beta version, channel, date, and package composition are assigned; publication and documentation promotion remain human-only decisions.'
      })
    ]),
    exclusions: Object.freeze([
      'event-product-behavior-change',
      'call-or-reflexive-routing',
      'fastly-event-support',
      'browser-event-support',
      'esp32-event-support',
      'release-version-channel-or-date-change',
      'package-publication',
      'documentation-deployment-or-promotion',
      'provider-deployment-or-activation',
      'automatic-target-fallback'
    ]),
    packagePublicationAuthorized: false,
    releaseBoundary,
    legal,
    packageInventory: Object.freeze(packageInventory),
    deterministicPacks: determinism,
    cleanConsumer,
    documentation,
    conformanceAuthority: Object.freeze({
      corpus: fileEvidence('wasm/test/fixtures/conformance/event-conformance-corpus.json'),
      runner: fileEvidence('wasm/test/events/assert-events-conformance.cjs'),
      targets: Object.freeze(['node-javascript', 'node-native']),
      requiredSeparately: true
    }),
    externalEvidence: Object.freeze({
      viceroy: '0.20.1',
      fastlyHttpRegressionRequiredSeparately: true,
      fastlyEventEligibility: 'fail-closed',
      fastlyEventSupportClaimed: false
    })
  });
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, 'events-candidate-seal.json'), stableJson(report));
  console.log(JSON.stringify({
    version: report.version,
    decision: report.decision,
    packages: report.packageInventory.length,
    deterministicPacks: report.deterministicPacks.length,
    cleanConsumer: report.cleanConsumer.typescript,
    candidateBlockers: report.candidateBlockers.length,
    releaseBlockers: report.releaseBlockers.length,
    releaseReady: report.releaseReady
  }));
  console.log('ok - events are sealed as a working experimental candidate with deterministic packages, offline author/host consumers, complete documentation, and an explicit release blocker ledger');
}

try {
  main();
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
