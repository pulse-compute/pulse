#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const providerRoot = path.join(repoRoot, 'packages', 'provider-fastly');
const retiredRoot = path.join(repoRoot, 'wasm', 'packages', 'provider-fastly');
const provider = require(providerRoot);
const config = require(path.join(providerRoot, 'src', 'config-api.js'));
const contract = require(path.join(providerRoot, 'src', 'provider-contract.js'));
const runtime = require(path.join(providerRoot, 'src', 'runtime', 'canonical-api-runtime.js'));
const build = require(path.join(providerRoot, 'src', 'build', 'canonical-target.js'));
const nativePlatform = require(path.join(providerRoot, 'src', 'build', 'native-platform-capabilities.js'));
const compiler = require(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'src', 'canonical-api-compiler.js'));
const { buildCanonicalNativePlan } = require(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'src', 'canonical-native-plan.js'));
const { EXAMPLES, compileExample } = require('../support/canonical-projects.cjs');

assert.equal(fs.existsSync(retiredRoot), false, 'Fastly must not remain under wasm/packages');
assert.deepEqual(Object.keys(provider).sort(), ['FASTLY_PROVIDER_API_VERSION', 'fastly']);
assert.equal(provider.fastly, config.fastly);
assert.equal(provider.FASTLY_PROVIDER_API_VERSION, config.FASTLY_PROVIDER_API_VERSION);
assert.equal(Object.prototype.hasOwnProperty.call(provider, 'runtime'), false, 'default Fastly API must not expose runtime authority');
assert.equal(Object.prototype.hasOwnProperty.call(provider, 'compiler'), false, 'default Fastly API must not expose compiler internals');

const safeDefaults = provider.fastly();
assert.equal(safeDefaults.bindings.dynamicBackends, false, 'Fastly dynamic backends must require explicit opt-in');
assert.deepEqual(safeDefaults.bindings.backends, {});
assert.equal(Object.hasOwn(safeDefaults, 'maxDurationMs'), false, 'omitting the deadline preserves the existing configuration shape');
assert.equal(provider.fastly({maxDurationMs: 10000}).maxDurationMs, 10000);
assert.throws(() => provider.fastly({maxDurationMs: 0}), {code: 'PULSE_REQUEST_DURATION_INVALID'});

const { normalizeFastlyProviderConfig, fastlyProjectConfigDocument } = require(path.join(providerRoot, 'src/toolchain/config.js'));
assert.equal(safeDefaults.build.maxWasmBytes, 4194304);
assert.equal(provider.fastly({maxWasmBytes: 8388608}).build.maxWasmBytes, 8388608);
assert.equal(normalizeFastlyProviderConfig({build:{maxWasmBytes:8388608}}).build.maxWasmBytes, 8388608);
assert.equal(fastlyProjectConfigDocument(normalizeFastlyProviderConfig({build:{maxWasmBytes:1024}})).build.maxWasmBytes, 1024);
for (const value of [0, -1, 1.5, NaN, Infinity, '4194304', null, true, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => provider.fastly({maxWasmBytes:value}), {code:'PULSE_FASTLY_MAX_WASM_BYTES_INVALID'});
  assert.throws(() => normalizeFastlyProviderConfig({build:{maxWasmBytes:value}}), {code:'PULSE_FASTLY_MAX_WASM_BYTES_INVALID'});
}

const profileFixture = fs.mkdtempSync(path.join(repoRoot, 'wasm', '.fastly-budget-config-'));
try {
  const exampleRoot = path.join(repoRoot, 'examples', '05-fastly-capabilities');
  fs.cpSync(exampleRoot, profileFixture, {recursive:true});
  const configFile = path.join(profileFixture, '.pulse', 'config.ts');
  const source = fs.readFileSync(configFile, 'utf8');
  assert.ok(source.includes('build: { name:'));
  fs.writeFileSync(configFile, source.replace('build: { name:', 'build: { maxWasmBytes: 8388608, name:'));
  const {resolveProject} = require('../../packages/cli/src/project-config.js');
  assert.equal(resolveProject({cwd:profileFixture,profile:'local'}).providerConfig.build.maxWasmBytes, 8388608);
  fs.writeFileSync(configFile, source.replace('build: { name:', 'build: { maxWasmBytes: 0, name:'));
  assert.throws(() => resolveProject({cwd:profileFixture,profile:'local'}), {code:'PULSE_FASTLY_MAX_WASM_BYTES_INVALID'});
} finally { fs.rmSync(profileFixture, {recursive:true,force:true}); }

const configured = provider.fastly({
  name: 'package-contract',
  description: 'Fastly package extraction proof',
  authors: ['Pulse'],
  configStore: 'app_config',
  secretStore: 'app_secrets',
  kv: { sessions: 'app_sessions' },
  backends: {
    'https://api.example.com': 'api_backend',
    'https://publisher.example.com': 'publisher_backend'
  },
  grip: {
    publishEndpoint: 'https://publisher.example.com/publish',
    publishBackend: 'publisher_backend',
    authentication: {
      scheme: 'bearer',
      secretRef: 'GRIP_TOKEN'
    }
  },
  dynamicBackends: false,
  local: { networkFetch: true }
});
assert.deepEqual(configured, {
  kind: 'fastly',
  version: config.FASTLY_PROVIDER_API_VERSION,
  bindings: {
    configStore: 'app_config',
    secretStore: 'app_secrets',
    kv: { sessions: 'app_sessions' },
    backends: {
      'https://api.example.com': 'api_backend',
      'https://publisher.example.com': 'publisher_backend'
    },
    dynamicBackends: false,
    grip: {
      fanoutBackend: undefined,
      publishEndpoint: 'https://publisher.example.com/publish',
      publishUrl: undefined,
      publishBackend: 'publisher_backend',
      authentication: {
        scheme: 'bearer',
        secretRef: 'GRIP_TOKEN'
      },
      directHold: true
    }
  },
  build: {
    maxWasmBytes: 4194304,
    name: 'package-contract',
    description: 'Fastly package extraction proof',
    authors: ['Pulse'],
    language: 'other'
  },
  local: { networkFetch: true },
  providerSpecificUserland: false
});
assert.equal(Object.isFrozen(configured), true);
assert.equal(Object.isFrozen(configured.bindings), true);
assert.equal(Object.isFrozen(configured.bindings.kv), true);
assert.equal(Object.isFrozen(configured.bindings.backends), true);

assert.equal(contract.FASTLY_PROVIDER_DESCRIPTOR.package, '@pulse-compute/provider-fastly');
assert.equal(contract.FASTLY_PROVIDER_DESCRIPTOR.buildTarget, 'fastly-compute');
assert.equal(contract.FASTLY_PROVIDER_DESCRIPTOR.providerSpecificUserland, false);
assert.equal(contract.FASTLY_PROVIDER_DESCRIPTOR.providerSdkUserland, false);
for (const capability of ['request', 'response.json', 'response.text', 'fetch', 'config.get', 'secret.get', 'kv.get', 'kv.put', 'opaque.pass-through']) {
  assert.ok(contract.FASTLY_PROVIDER_DESCRIPTOR.capabilities.includes(capability), `Fastly descriptor must implement ${capability}`);
}
assert.equal(typeof runtime.createCanonicalFastlyRuntime, 'function');
assert.equal(typeof runtime.executeCanonicalProgram, 'function');
assert.equal(typeof build.writeFastlyCanonicalTarget, 'function');
assert.equal(typeof build.inspectFastlyCanonicalTarget, 'function');
assert.equal(build.FASTLY_CANONICAL_TARGET, 'fastly-compute-native');

const compiled = compileExample(EXAMPLES.fastlyCapabilities).compiled;
const nativePlan = buildCanonicalNativePlan(compiled);
const lowering = contract.createFastlyLoweringPlan(compiled.metadata, configured.bindings);
assert.equal(lowering.provider, 'fastly');
assert.equal(lowering.package, '@pulse-compute/provider-fastly');
assert.equal(lowering.providerSpecificUserland, false);
assert.equal(lowering.providerSdkUserland, false);
assert.deepEqual(lowering.requirements, [
  'config.get',
  'fetch',
  'grip.broadcast',
  'kv.get',
  'kv.put',
  'response.json',
  'response.text',
  'secret.get'
]);
assert.equal(lowering.operations.find((entry) => entry.kind === 'config').binding, 'app_config');
assert.equal(lowering.operations.find((entry) => entry.kind === 'secret').binding, 'app_secrets');
assert.equal(lowering.operations.find((entry) => entry.kind === 'fetch').lowering, 'fastly.backend.fetch');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-package-'));
try {
  compiler.writeCanonicalBuild(compiled, tmp);
  const output = build.writeFastlyCanonicalTarget({
    outDir: tmp,
    projectRoot: repoRoot,
    plan: nativePlan,
    providerPlan: lowering,
    providerConfig: configured
  });
  assert.equal(output.build.provider, 'fastly');
  assert.equal(output.build.target, 'fastly-compute-native');
  assert.equal(output.build.sourcePackage, true);
  assert.equal(output.build.sourceOnly, false);
  assert.equal(output.build.compiledWasmPresent, true);
  assert.equal(output.build.deployable, true);
  assert.equal(output.build.deploymentValidated, false);
  assert.equal(output.build.javascriptRuntime, false);
  assert.equal(output.build.jsComputeRuntime, false);
  assert.equal(output.build.providerSpecificUserland, false);
  assert.equal(output.build.providerSdkUserland, false);
  for (const file of [
    output.providerFile,
    output.entryFile,
    output.buildFile,
    output.fastlyTomlFile,
    output.packageFile,
    output.sourceEntryFile,
    output.wasmFile,
    output.nativePlanFile,
    output.nativeManifestFile
  ]) assert.equal(fs.existsSync(file), true, `${path.basename(file)} must be emitted`);
  assert.equal(output.watFile, null);
  assert.deepEqual(output.build.wat, { file: null, emitted: false, bytes: 0, sha256: null });
  assert.equal(output.build.files.wat, null);
  assert.equal(fs.existsSync(path.join(tmp, 'bin', 'main.wat')), false);

  const wasmBytes = fs.readFileSync(output.wasmFile);
  assert.equal(WebAssembly.validate(wasmBytes), true);
  const wasmHash = crypto.createHash('sha256').update(wasmBytes).digest('hex');
  assert.equal(output.build.wasm.bytes, wasmBytes.length);
  assert.equal(output.build.wasm.sha256, wasmHash);
  assert.equal(output.build.wasm.magic, '0061736d01000000');
  assert.equal(output.build.compiler.package, 'assemblyscript');
  assert.equal(output.build.compiler.version, '0.28.18');
  assert.equal(output.build.compiler.invoked, true);
  assert.ok(wasmBytes.length > 1024 && wasmBytes.length < 1024 * 1024, 'native Fastly Wasm must remain compact');

  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasmBytes));
  assert.ok(imports.some((entry) => entry.module === 'fastly_abi' && entry.name === 'init'));
  assert.ok(imports.some((entry) => entry.module === 'fastly_http_req' && entry.name === 'send_async'));
  assert.equal(imports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false);
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes));
  assert.ok(exports.some((entry) => entry.name === '_start'));

  const generatedPackage = JSON.parse(fs.readFileSync(output.packageFile, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(generatedPackage, 'dependencies'), false);
  assert.match(generatedPackage.scripts.build, /bin\/main\.wasm/);
  assert.doesNotMatch(generatedPackage.scripts.build, /js-compute-runtime/);
  const fastlyToml = fs.readFileSync(output.fastlyTomlFile, 'utf8');
  assert.match(fastlyToml, /language = "other"/);
  assert.doesNotMatch(fastlyToml, /language = "javascript"/);
  const generatedSource = fs.readFileSync(output.sourceEntryFile, 'utf8');
  assert.match(generatedSource, /fastly_http_req/);
  assert.match(generatedSource, /fastly_config_store/);
  assert.match(generatedSource, /fastly_secret_store/);
  assert.doesNotMatch(generatedSource, /Promise|js-compute/);

  const secondDir = path.join(tmp, 'second');
  fs.mkdirSync(secondDir, { recursive: true });
  compiler.writeCanonicalBuild(compiled, secondDir);
  const second = build.writeFastlyCanonicalTarget({
    outDir: secondDir,
    projectRoot: repoRoot,
    plan: nativePlan,
    providerPlan: lowering,
    providerConfig: configured
  });
  assert.equal(fs.readFileSync(second.wasmFile).equals(wasmBytes), true, 'native Fastly Wasm must be deterministic');
  assert.equal(fs.readFileSync(second.sourceEntryFile, 'utf8'), generatedSource, 'generated native source must be deterministic');

  const opaqueCompiled = compileExample(EXAMPLES.opaqueProxy).compiled;
  const opaquePlan = buildCanonicalNativePlan(opaqueCompiled);
  const opaqueProviderConfig = provider.fastly({ backends: { 'https://assets.example.com': 'assets' } });
  const opaqueLowering = contract.createFastlyLoweringPlan(opaqueCompiled.metadata, opaqueProviderConfig.bindings);
  assert.equal(nativePlatform.planRequiresFetchBodyRead(opaquePlan), false, 'opaque pass-through must not require guest body materialization');
  assert.equal(nativePlatform.requiredImportsForPlan(opaquePlan).includes('fastly_http_body:read'), false, 'opaque pass-through must not require fastly_http_body.read');
  const opaqueDir = path.join(tmp, 'opaque');
  fs.mkdirSync(opaqueDir, { recursive: true });
  compiler.writeCanonicalBuild(opaqueCompiled, opaqueDir);
  const opaqueOutput = build.writeFastlyCanonicalTarget({
    outDir: opaqueDir,
    projectRoot: repoRoot,
    plan: opaquePlan,
    providerPlan: opaqueLowering,
    providerConfig: opaqueProviderConfig
  });
  const opaqueImports = WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(opaqueOutput.wasmFile)));
  assert.equal(opaqueImports.some((entry) => entry.module === 'fastly_http_body' && entry.name === 'read'), false, 'opaque native target must let AssemblyScript eliminate the unused body-read import');

  assert.throws(
    () => build.writeFastlyCanonicalTarget({
      outDir: path.join(tmp, 'source-only'),
      projectRoot: repoRoot,
      plan: nativePlan,
      providerPlan: lowering,
      providerConfig: configured,
      sourceOnly: true
    }),
    (error) => error.code === 'PULSE_SOURCE_ONLY_REMOVED'
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - extracted @pulse-compute/provider-fastly emits deterministic compact direct-host-ABI Fastly Wasm without JavaScript runtime ownership or source-only packaging');
