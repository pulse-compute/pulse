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
const reportRoot = path.join(repoRoot, 'wasm/.test-results/entities-i11');
const tempParent = process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir();
fs.mkdirSync(tempParent, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(tempParent, 'pulse-entities-i11-'));
const stageRoot = path.join(testRoot, 'stage');
const tarballRoot = path.join(testRoot, 'tarballs');
const consumerRoot = path.join(testRoot, 'consumer');
const npmCache = path.join(testRoot, 'npm-cache');
const reportVersion = 'pulse.entities-experimental-candidate-seal.i11.v1';
const candidatePackages = Object.freeze([
  Object.freeze({ name: '@pulse-compute/entities', dir: 'packages/entities' }),
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

function stageCandidate(entry) {
  const sourceRoot = path.join(repoRoot, entry.dir);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  assert.equal(sourceManifest.name, entry.name);
  assert.equal(sourceManifest.version, '1.0.0-beta.1');
  assert.equal(sourceManifest.license, 'Apache-2.0');
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
  const before = new Set(fs.readdirSync(tarballRoot));
  const packed = run('npm', ['pack', '--json', '--pack-destination', tarballRoot], {
    cwd: targetRoot,
    timeoutMs: 180_000
  });
  const created = fs.readdirSync(tarballRoot)
    .filter((name) => name.endsWith('.tgz') && !before.has(name));
  assert.equal(created.length, 1, `${entry.name} must produce one candidate tarball: ${packed.stdout}`);
  return Object.freeze({ entry, sourceManifest, manifest, tarball: path.join(tarballRoot, created[0]) });
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

function validateTarball(candidate) {
  const entries = readTarEntries(candidate.tarball);
  const packageJson = entries.get('package/package.json');
  assert.ok(packageJson, `${candidate.entry.name} tarball is missing package.json`);
  const manifest = JSON.parse(packageJson.toString('utf8'));
  assert.equal(manifest.name, candidate.entry.name);
  assert.equal(manifest.version, '1.0.0-beta.1');
  assert.equal(manifest.license, 'Apache-2.0');
  recursiveStrings(manifest, (value) => assert.equal(value.startsWith('workspace:'), false, `${manifest.name} retains ${value}`));
  const files = [...entries.keys()].sort();
  for (const forbidden of [/^package\/(?:node_modules|test|tests)(?:\/|$)/, /^package\/(?:src\/.*\.tsbuildinfo|\.test-results)(?:\/|$)/]) {
    assert.equal(files.some((file) => forbidden.test(file)), false, `${manifest.name} contains a repository-only path`);
  }
  for (const legal of ['LICENSE', 'NOTICE']) {
    const packed = entries.get(`package/${legal}`);
    assert.ok(packed, `${manifest.name} tarball is missing ${legal}`);
    assert.deepEqual(packed, fs.readFileSync(path.join(repoRoot, legal)), `${manifest.name} ${legal} differs from repository authority`);
    assert.ok(manifest.files.includes(legal), `${manifest.name} files must name ${legal}`);
  }
  assert.ok(entries.has('package/README.md'), `${manifest.name} tarball is missing README.md`);

  if (manifest.name === '@pulse-compute/entities') {
    assert.deepEqual(Object.keys(manifest.exports), ['.', './pulsewasm/manifest', './pulsewasm/compiler', './pulsewasm-native']);
    for (const required of [
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/pulse.package.json',
      'package/pulsewasm.manifest.cjs',
      'package/pulsewasm.compiler.cjs',
      'package/pulsewasm.native.cjs',
      'package/as/index.as.ts',
      'package/conformance/i9.json'
    ]) assert.ok(entries.has(required), `Entities tarball is missing ${required}`);
    assert.equal(files.some((file) => file.startsWith('package/src/')), false, 'Entities tarball must not expose TypeScript source as public payload');
    assert.deepEqual(manifest.dependencies, {
      '@pulse-compute/runtime': '1.0.0-beta.1',
      '@pulse-compute/wasm-contracts': '1.0.0-beta.1'
    });
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
    dependencies: Object.freeze(sortedRecord(manifest.dependencies))
  });
}

function writeConsumer() {
  fs.mkdirSync(consumerRoot, { recursive: true });
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), stableJson({
    name: 'pulse-entities-i11-clean-consumer',
    version: '0.0.0',
    private: true,
    type: 'module'
  }));
  fs.writeFileSync(path.join(consumerRoot, 'runtime.mjs'), `
import * as entities from '@pulse-compute/entities'
import assert from 'node:assert/strict'

assert.deepEqual(Object.keys(entities).sort(), ['EntityRouter', 'jsonRpc'])
const adapter = entities.jsonRpc({ namedParamsOnly: true, acceptEmptyObjectForNoInput: true })
assert.equal(adapter.version, 'pulse.entities-adapter.v1')
assert.equal(adapter.id, 'json-rpc')
assert.equal(adapter.options.acceptEmptyObjectForNoInput, true)
const router = new entities.EntityRouter({ adapter })
function statusHandler() {}
assert.equal(router.on('system.status', { input: null, output: null }, statusHandler), router)
console.log(JSON.stringify({ exports: Object.keys(entities).sort(), adapter: adapter.id }))
`.trimStart());
  fs.writeFileSync(path.join(consumerRoot, 'toolchain.cjs'), `
'use strict'
const assert = require('node:assert/strict')
const manifest = require('@pulse-compute/entities/pulsewasm/manifest')
const compiler = require('@pulse-compute/entities/pulsewasm/compiler')
const native = require('@pulse-compute/entities/pulsewasm-native')
assert.equal(manifest.contractId, 'pulse.entities')
assert.equal(manifest.compiler.trust, 'first-party')
assert.equal(manifest.policy.automaticFallback, false)
assert.equal(typeof compiler.createEntitiesPackageCompilerBuilder, 'function')
assert.equal(typeof native.buildEntitiesNativeSource, 'function')
console.log(JSON.stringify({ contractId: manifest.contractId, trust: manifest.compiler.trust }))
`.trimStart());
  fs.writeFileSync(path.join(consumerRoot, 'index.ts'), `
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import type { EntityHandler, EntityDeclaration, JsonRpcOptions } from '@pulse-compute/entities'

type Input = Readonly<{ email: string }>
type Output = Readonly<{ email: string }>
const options: JsonRpcOptions = { namedParamsOnly: true }
const declaration: EntityDeclaration = { input: 'tools.Input', output: 'tools.Output' }
const handler: EntityHandler<Input, Output> = async (_ctx, input) => ({ email: input.email })
const router = new EntityRouter({ adapter: jsonRpc(options) })
router.on('customer.lookup', declaration, handler)
export { router }
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
    include: ['index.ts']
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
  const runtime = run(process.execPath, ['runtime.mjs'], { cwd: consumerRoot });
  const toolchain = run(process.execPath, ['toolchain.cjs'], { cwd: consumerRoot });
  const tsc = require.resolve('typescript/bin/tsc', { paths: [repoRoot] });
  run(process.execPath, [tsc, '--project', 'tsconfig.json'], { cwd: consumerRoot, timeoutMs: 180_000 });
  return Object.freeze({
    install: 'local-tarballs-offline',
    runtime: JSON.parse(runtime.stdout),
    toolchain: JSON.parse(toolchain.stdout),
    typescript: 'passed'
  });
}

function validateDeterministicCatalog() {
  const lowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
  const source = (registrations) => `
import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
function alphaHandler() {}
function betaHandler() {}
const rpc = new EntityRouter({ adapter: jsonRpc() })
${registrations.join('\n')}
export default function handler(ctx) { return rpc.handle(ctx) }
`;
  const alpha = "rpc.on('alpha.lookup', { input: 'tools.Input', output: 'tools.Output' }, alphaHandler)";
  const beta = "rpc.on('beta.status', { input: null, output: null }, betaHandler)";
  const build = (registrations, cwd) => lowerer.buildEntitiesLoweringPlan({
    cwd,
    sourcePath: path.join(cwd, 'src/index.ts'),
    sourceText: source(registrations),
    schemaBundle: {
      declaredSchemaIds: ['tools.Input', 'tools.Output'],
      registry: { schemas: [{ id: 'tools.Input' }, { id: 'tools.Output' }] }
    }
  });
  const first = build([beta, alpha], path.join(testRoot, 'checkout-a'));
  const second = build([alpha, beta], path.join(testRoot, 'checkout-b'));
  assert.equal(first.artifact.status, 'ok');
  assert.equal(second.artifact.status, 'ok');
  assert.equal(first.artifact.plan.planHash, second.artifact.plan.planHash);
  assert.equal(first.artifact.catalog.catalogHash, second.artifact.catalog.catalogHash);
  assert.deepEqual(first.artifact.catalog, second.artifact.catalog);
  assert.deepEqual(first.artifact.catalog.routers[0].entities.map((entry) => entry.name), ['alpha.lookup', 'beta.status']);
  return Object.freeze({
    planHash: first.artifact.plan.planHash,
    catalogHash: first.artifact.catalog.catalogHash,
    entities: Object.freeze(['alpha.lookup', 'beta.status'])
  });
}

function validateCandidateStatus() {
  const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/pulse-release-manifest.json'), 'utf8'));
  assert.equal(release.packages.some((entry) => entry.name === '@pulse-compute/entities'), false, 'candidate seal must not assign Entities to a release');
  const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/entities/pulse.package.json'), 'utf8'));
  assert.equal(product.targets.javascript.status, 'supported');
  assert.equal(product.targets.native.status, 'provider-dependent');
  assert.equal(product.targets.native.reasonCode, 'PULSE_ENTITIES_NATIVE_PROVIDER_INTEGRATION_REQUIRED');
  const packageManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/entities/package.json'), 'utf8'));
  assert.equal(product.targets.javascript.entry, './dist/index.js');
  assert.equal(Object.prototype.hasOwnProperty.call(packageManifest.exports, './dist/index.js'), false);
  for (const relative of [
    'packages/entities/README.md',
    'docs/packages/entities.md',
    'docs/concepts/entities-and-adapters.md',
    'docs/contributing/entities-lowering.md',
    'examples/10-entities-tools/README.md'
  ]) assert.ok(fs.existsSync(path.join(repoRoot, relative)), `candidate documentation is missing ${relative}`);
  return Object.freeze({
    releaseAssigned: false,
    javascript: product.targets.javascript.status,
    native: product.targets.native.status,
    javascriptLoaderEntry: product.targets.javascript.entry,
    javascriptLoaderEntryExported: false,
    automaticFallback: false
  });
}

function main() {
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.mkdirSync(tarballRoot, { recursive: true });
  const staged = candidatePackages.map(stageCandidate);
  const packageInventory = staged.map(validateTarball).sort((left, right) => left.name.localeCompare(right.name));
  const cleanConsumer = validateCleanConsumer(staged);
  const determinism = validateDeterministicCatalog();
  const productStatus = validateCandidateStatus();
  const legal = Object.freeze({
    license: 'Apache-2.0',
    licenseSha256: sha256(fs.readFileSync(path.join(repoRoot, 'LICENSE'))),
    noticeSha256: sha256(fs.readFileSync(path.join(repoRoot, 'NOTICE')))
  });
  assert.ok(packageInventory.every((entry) => entry.license === legal.license));

  const report = Object.freeze({
    version: reportVersion,
    decision: 'blocked-experimental-candidate',
    candidateBlockers: Object.freeze([
      Object.freeze({
        id: 'ordinary-javascript-application-loader',
        status: 'open',
        owner: 'cli',
        summary: 'The ordinary JavaScript loader requests the unexported physical package entry instead of loading the public package root.'
      }),
      Object.freeze({
        id: 'ordinary-native-project-integration',
        status: 'open',
        owner: 'compiler-and-providers',
        summary: 'Ordinary Native project builds do not adopt the Entities intrinsic and package-owned Native source.'
      })
    ]),
    releaseReady: false,
    releaseBlockers: Object.freeze([
      Object.freeze({
        id: 'release-assignment',
        status: 'open',
        owner: 'release-governance',
        summary: 'Entities is not assigned to the frozen release package set.'
      }),
      Object.freeze({
        id: 'ordinary-javascript-application-loader',
        status: 'open',
        owner: 'cli',
        summary: 'The ordinary JavaScript project lifecycle cannot load the package through its public root export.'
      }),
      Object.freeze({
        id: 'ordinary-native-project-integration',
        status: 'open',
        owner: 'compiler-and-providers',
        summary: 'Measured Native evidence uses package-owned source outside the ordinary project build adoption path.'
      })
    ]),
    exclusions: Object.freeze([
      'release-version-or-channel-change',
      'package-publication',
      'deployment-or-activation',
      'documentation-promotion',
      'mcp-runtime-lifecycle-state',
      'provider-authority-change',
      'automatic-target-fallback'
    ]),
    productStatus,
    legal,
    packageInventory: Object.freeze(packageInventory),
    cleanConsumer,
    determinism,
    externalEvidence: Object.freeze({
      required: true,
      task: 'entities-cross-target',
      engine: 'viceroy 0.20.1',
      ordinaryFastlyNativeProjectBuildClaimed: false
    })
  });
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, 'entities-candidate-seal.json'), stableJson(report));
  console.log(JSON.stringify({
    version: report.version,
    decision: report.decision,
    packages: report.packageInventory.length,
    cleanConsumer: report.cleanConsumer.typescript,
    candidateBlockers: report.candidateBlockers.length,
    releaseBlockers: report.releaseBlockers.length,
    releaseReady: report.releaseReady
  }));
  console.log('ok - Entities is sealed as an experimental working candidate with packed clean-consumer, legal/dependency, deterministic-catalog, and explicit blocker evidence');
}

try {
  main();
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
