#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { EXAMPLES, compileExample } = require('../support/canonical-projects.cjs');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const mock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

function planForExample(name) {
  return buildCanonicalNativePlan(compileExample(EXAMPLES[name]).compiled);
}

function headerValues(headers, name) {
  const target = String(name).toLowerCase();
  return headers.filter(([headerName]) => String(headerName).toLowerCase() === target).map(([, value]) => value);
}

function assertNativePlatformModule(name, compiled, expectedModules, forbiddenModules = [], options = {}) {
  assert.equal(compiled.version, platform.FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION, `${name} target version`);
  assert.equal(compiled.manifest.planHash, compiled.plan.planHash, `${name} plan hash binding`);
  assert.equal(compiled.manifest.policy.nativeFastly, true, `${name} native Fastly policy`);
  assert.equal(compiled.manifest.policy.platformCapabilities, options.platformCapabilities !== false, `${name} platform capability policy`);
  assert.equal(compiled.manifest.policy.javascriptRuntime, false, `${name} no JavaScript runtime`);
  assert.equal(compiled.manifest.policy.jsComputeRuntime, false, `${name} no js-compute-runtime`);
  assert.equal(compiled.manifest.policy.wasi, false, `${name} no WASI`);
  assert.equal(compiled.inspection.valid, true, `${name} valid Wasm`);
  assert.equal(compiled.inspection.magic, '0061736d01000000', `${name} Wasm magic`);
  assert.ok(compiled.wasm.length > 1024 && compiled.wasm.length < platform.FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES, `${name} compact native Wasm`);
  assert.equal(compiled.inspection.imports.some((entry) => entry.module === 'env' || /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false, `${name} excludes env.abort, the portable host, WASI, and JavaScript runtime imports`);
  for (const moduleName of expectedModules) assert.ok(compiled.inspection.importModules.includes(moduleName), `${name} imports ${moduleName}`);
  for (const moduleName of forbiddenModules) assert.equal(compiled.inspection.importModules.includes(moduleName), false, `${name} excludes unrelated ${moduleName} imports`);
  const exportNames = new Set(compiled.inspection.exports.map((entry) => entry.name));
  for (const exportName of ['_start', 'memory', 'pulse_start', 'pulse_resume', 'pulse_set_effect_result', 'pulse_result_handle', 'pulse_fastly_last_error', 'pulse_fastly_error_stage', 'pulse_fastly_error_effect']) {
    assert.ok(exportNames.has(exportName), `${name} exports ${exportName}`);
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-platform-capabilities-'));
try {
  require('./assert-fastly-request-budget.cjs');
  require('./assert-fastly-bounded-concatenation.cjs').main();
  require('./assert-fastly-native-value-parity.cjs').main('platform');
  const zeroEffectPlan = planForExample('hello');
  assert.equal(zeroEffectPlan.effects.length, 0, 'hello plan must exercise the zero-effect provider path');
  const zeroEffectCompiled = platform.compileFastlyNativePlatformCapabilitiesPlan(zeroEffectPlan, { cwd: repoRoot, bindings: {}, requirePlatformCapability: false, canonicalBuild: true });
  assertNativePlatformModule('zero-effect-http', zeroEffectCompiled, ['fastly_abi', 'fastly_http_req', 'fastly_http_resp', 'fastly_http_body'], ['fastly_config_store', 'fastly_secret_store', 'fastly_kv_store'], { platformCapabilities: false });
  assert.doesNotMatch(zeroEffectCompiled.source, /^\s*else __pulse_fastly_fail\(PULSE_ERROR_UNSUPPORTED/m, 'zero-effect dispatch must not emit a dangling else');
  const zeroEffectResult = mock.executeFastlyNativePlatformCapabilities(zeroEffectCompiled, {
    request: { method: 'GET', path: '/health' },
    kvStores: {}
  });
  assert.equal(zeroEffectResult.response.status, 200);
  assert.deepEqual(JSON.parse(zeroEffectResult.response.body), { ok: true });

  const configPlan = planForExample('fastlyCapabilities');
  const configBindings = {
    configStore: 'app_config',
    secretStore: 'app_secrets',
    effectBackends: { [configPlan.effects.find((effect) => effect.kind === 'fetch').id]: 'api_backend' },
    kv: { sessions: 'app_sessions' },
    grip: {
      publishEndpoint: 'https://publisher.example.com/publish',
      publishBackend: 'publisher_backend',
      authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
    }
  };
  const configFirst = platform.compileFastlyNativePlatformCapabilitiesPlan(configPlan, { cwd: repoRoot, bindings: configBindings });
  const configSecond = platform.compileFastlyNativePlatformCapabilitiesPlan(configPlan, { cwd: os.tmpdir(), bindings: configBindings });
  const configExperimentalFirst = platform.compileFastlyNativePlatformCapabilitiesPlan(configPlan, {
    cwd: repoRoot,
    bindings: configBindings,
    experimentalNativeSize: true
  });
  const configExperimentalSecond = platform.compileFastlyNativePlatformCapabilitiesPlan(configPlan, {
    cwd: os.tmpdir(),
    bindings: configBindings,
    experimentalNativeSize: true
  });
  assertNativePlatformModule('fastly-capabilities', configFirst, ['fastly_config_store', 'fastly_secret_store', 'fastly_http_req', 'fastly_kv_store']);
  assertNativePlatformModule('fastly-capabilities-experimental-size', configExperimentalFirst, ['fastly_config_store', 'fastly_secret_store', 'fastly_http_req', 'fastly_kv_store']);
  assert.deepEqual(configFirst.wasm, configSecond.wasm, 'config/secret module must be byte deterministic across cwd');
  assert.equal(configFirst.source, configSecond.source, 'config/secret AssemblyScript must be deterministic across cwd');
  assert.equal(configFirst.wat, configSecond.wat, 'config/secret WAT must be deterministic across cwd');
  assert.deepEqual(configFirst.manifest, configSecond.manifest, 'config/secret manifest must be deterministic across cwd');
  assert.deepEqual(configExperimentalFirst.wasm, configExperimentalSecond.wasm, 'experimental size module must be byte deterministic across cwd');
  assert.ok(configExperimentalFirst.wasm.length < configFirst.wasm.length, 'experimental O3z optimization must reduce the representative Fastly Native module');
  assert.deepEqual(configExperimentalFirst.inspection.imports, configFirst.inspection.imports, 'experimental size optimization must preserve the Fastly host import surface');
  assert.deepEqual(configExperimentalFirst.inspection.exports, configFirst.inspection.exports, 'experimental size optimization must preserve the required export surface');
  assert.deepEqual(configExperimentalFirst.manifest.optimization, platform.FASTLY_NATIVE_SIZE_OPTIMIZATION);
  assert.equal(configFirst.manifest.optimization, undefined, 'default Fastly Native artifacts must not opt into experimental optimization');

  const secretValue = 'platform-capability-secret';
  let result = mock.executeFastlyNativePlatformCapabilities(configFirst, {
    request: { method: 'GET', path: '/users/7' },
    configStore: 'app_config',
    config: { API_BASE: 'https://api.example.com' },
    secretStore: 'app_secrets',
    secrets: { API_TOKEN: secretValue },
    kvStores: {},
    fixtures: {
      'api_backend GET https://api.example.com/users/7': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        json: { id: 7, name: 'Ada' }
      }
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.response.body), { user: { id: 7, name: 'Ada' } });
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_config_store' && entry.name === 'get' && entry.key === 'API_BASE'));
  assert.ok(result.trace.some((entry) => entry.module === 'fastly_secret_store' && entry.name === 'plaintext' && entry.value === '[REDACTED]'));
  assert.equal(JSON.stringify(result.trace).includes(secretValue), false, 'secret plaintext must never appear in native proof traces');
  const authorization = result.trace.find((entry) => entry.module === 'fastly_http_req' && entry.name === 'header_insert' && entry.header[0] === 'authorization');
  assert.deepEqual(authorization.header, ['authorization', '[REDACTED]'], 'sensitive outbound headers must be trace-redacted');

  const experimentalResult = mock.executeFastlyNativePlatformCapabilities(configExperimentalFirst, {
    request: { method: 'GET', path: '/users/7' },
    configStore: 'app_config',
    config: { API_BASE: 'https://api.example.com' },
    secretStore: 'app_secrets',
    secrets: { API_TOKEN: secretValue },
    kvStores: {},
    fixtures: {
      'api_backend GET https://api.example.com/users/7': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        json: { id: 7, name: 'Ada' }
      }
    }
  });
  assert.equal(experimentalResult.response.status, result.response.status);
  assert.equal(experimentalResult.response.body, result.response.body, 'experimental size optimization must preserve representative response semantics');

  const zeroCapabilityHandles = mock.executeFastlyNativePlatformCapabilities(configFirst, {
    request: { method: 'GET', path: '/users/7' },
    handleStarts: { request: 0, body: 0, response: 0, pending: 0, configStore: 0, secretStore: 0, secret: 0 },
    configStore: 'app_config',
    config: { API_BASE: 'https://api.example.com' },
    secretStore: 'app_secrets',
    secrets: { API_TOKEN: secretValue },
    kvStores: {},
    fixtures: {
      'api_backend GET https://api.example.com/users/7': {
        status: 200,
        headers: { 'content-type': 'application/json' },
        json: { id: 7, name: 'Ada' }
      }
    }
  });
  assert.equal(zeroCapabilityHandles.response.status, 200, 'zero-valued Fastly request, body, response, pending, config, and secret handles must be valid');
  assert.ok(zeroCapabilityHandles.trace.some((entry) => entry.name === 'open' && entry.module === 'fastly_config_store' && entry.handle === 0) || zeroCapabilityHandles.trace.some((entry) => entry.name === 'get' && entry.module === 'fastly_config_store' && entry.handle === 0));
  assert.ok(zeroCapabilityHandles.trace.some((entry) => entry.name === 'send_async' && entry.pendingHandle === 0));

  const kvPlan = configPlan;
  const kvCompiled = configFirst;
  result = mock.executeFastlyNativePlatformCapabilities(kvCompiled, {
    request: { method: 'GET', path: '/session' },
    kvStores: { app_sessions: { 'session:123': { id: 123, name: 'Ada' } } }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(result.response.body), { session: { id: 123, name: 'Ada' } });
  assert.deepEqual(result.stores.kv.app_sessions['session:last'], { id: 123, name: 'Ada' }, 'KV put must persist the canonical Pulse envelope value');
  assert.deepEqual(result.trace.filter((entry) => entry.module === 'fastly_kv_store').map((entry) => entry.name), [
    'open', 'lookup', 'lookup_wait_v2', 'open', 'insert', 'insert_wait'
  ]);

  const zeroKvHandles = mock.executeFastlyNativePlatformCapabilities(kvCompiled, {
    request: { method: 'GET', path: '/session' },
    handleStarts: { body: 0, response: 0, kvStore: 0, kvLookup: 0, kvInsert: 0 },
    kvStores: { app_sessions: { 'session:123': { id: 123, name: 'Ada' } } }
  });
  assert.equal(zeroKvHandles.response.status, 200, 'zero-valued Fastly KV store and pending handles must be valid');
  assert.ok(zeroKvHandles.trace.some((entry) => entry.name === 'lookup' && entry.pendingHandle === 0));
  assert.ok(zeroKvHandles.trace.some((entry) => entry.name === 'insert' && entry.pendingHandle === 0));

  result = mock.executeFastlyNativePlatformCapabilities(kvCompiled, {
    request: { method: 'GET', path: '/session' },
    kvStores: { app_sessions: {} }
  });
  assert.equal(result.response.status, 404);
  assert.deepEqual(JSON.parse(result.response.body), { error: 'not_found' });
  assert.equal(result.trace.some((entry) => entry.name === 'insert'), false, 'KV miss branch must not perform the later put');

  const gripPlan = configPlan;
  const gripCompiled = configFirst;

  result = mock.executeFastlyNativePlatformCapabilities(gripCompiled, {
    request: { method: 'POST', path: '/publish' },
    secretStore: 'app_secrets',
    secrets: { GRIP_TOKEN: 'grip-token' },
    kvStores: {},
    fixtures: {
      'publisher_backend POST https://publisher.example.com/publish': {
        status: 204,
        headers: [['x-publisher', 'accepted']],
        body: 'publisher-specific-body-must-not-leak'
      }
    }
  });
  assert.equal(result.response.status, 202);
  assert.deepEqual(JSON.parse(result.response.body), { accepted: true });
  assert.equal(result.response.origin, false, "GRIP broadcast must return Pulse's canonical structured receipt, not the publisher response handles");
  assert.match(headerValues(result.response.headers, 'content-type')[0], /^application\/json(?:;|$)/i);
  assert.equal(headerValues(result.response.headers, 'x-publisher').length, 0, 'publisher-specific headers must not leak into the canonical receipt');
  assert.equal(result.outboundRequests.length, 1, 'GRIP publish must expose one sanitized outbound request proof');
  const outboundPublish = result.outboundRequests[0];
  assert.equal(outboundPublish.backend, 'publisher_backend');
  assert.equal(outboundPublish.method, 'POST');
  assert.equal(outboundPublish.url, 'https://publisher.example.com/publish');
  assert.deepEqual(Object.fromEntries(outboundPublish.headers), {
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json',
    authorization: '[REDACTED]'
  });
  assert.deepEqual(JSON.parse(outboundPublish.body), {
    channel: 'events:demo',
    event: 'pulse.message',
    id: 'message-1',
    data: { message: 'hello from Pulse' }
  });
  const publish = result.trace.find((entry) => entry.name === 'send_async');
  assert.equal(publish.backend, 'publisher_backend');
  assert.equal(publish.method, 'POST');
  assert.equal(publish.url, 'https://publisher.example.com/publish');
  assert.ok(publish.bodyBytes > 0);

  assert.throws(
    () => mock.executeFastlyNativePlatformCapabilities(gripCompiled, {
      request: { method: 'POST', path: '/publish' },
      secretStore: 'app_secrets',
      secrets: { GRIP_TOKEN: 'grip-token' },
      kvStores: {},
      fixtures: {
        'publisher_backend POST https://publisher.example.com/publish': {
          status: 503,
          headers: { 'content-type': 'text/plain' },
          body: 'publisher unavailable'
        }
      }
    }),
    (error) => error
      && error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
      && error.detail.lastError === 1006
      && error.detail.errorStage === 144,
    'non-2xx publisher responses must fail the GRIP broadcast effect rather than becoming downstream responses'
  );

  const writtenRoot = path.join(tempRoot, 'written');
  const written = platform.writeFastlyNativePlatformCapabilitiesModule(gripCompiled, writtenRoot);
  for (const file of [written.sourceFile, written.wasmFile, written.watFile, written.planFile, written.manifestFile]) assert.equal(fs.existsSync(file), true, `${path.basename(file)} must be written`);
  assert.deepEqual(fs.readFileSync(written.wasmFile), gripCompiled.wasm);

  assert.throws(
    () => platform.compileFastlyNativePlatformCapabilitiesPlan(configPlan, { cwd: repoRoot, bindings: { secretStore: 'app_secrets', effectBackends: configBindings.effectBackends } }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_CONFIG_STORE_MISSING',
    'config effects require an explicit physical Config Store binding'
  );
  assert.throws(
    () => platform.compileFastlyNativePlatformCapabilitiesPlan(kvPlan, { cwd: repoRoot, bindings: { ...configBindings, kv: {} } }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_KV_STORE_MISSING',
    'KV effects require an explicit logical-to-physical store binding'
  );
  assert.throws(
    () => platform.compileFastlyNativePlatformCapabilitiesPlan(gripPlan, { cwd: repoRoot, bindings: { ...configBindings, grip: {} } }),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_GRIP_PUBLISH_URL_MISSING',
    'native platform capability requires an explicit GRIP broadcast endpoint'
  );

  const proof = {
    version: platform.FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
    plans: [
      { name: 'fastly-capabilities', planHash: configPlan.planHash, bytes: configFirst.wasm.length, sha256: configFirst.inspection.sha256 }
    ],
    assertions: {
      directFastlyImports: true,
      configStore: true,
      secretStore: true,
      secretTraceRedaction: true,
      kvGetPutAndMiss: true,
      pulseKvEnvelope: true,
      gripBroadcast: true,
      gripAuthenticationRedaction: true,
      structuredPublishReceipt: true,
      outboundRequestEvidence: true,
      nonSuccessPublisherRejected: true,
      deterministic: true,
      zeroValuedOpaqueHandles: true,
      javascriptRuntime: false,
      realFastlyExecution: false
    }
  };
  const proofFlag = process.argv.indexOf('--proof-file');
  if (proofFlag >= 0) {
    const proofValue = process.argv[proofFlag + 1];
    assert.ok(proofValue && !proofValue.startsWith('--'), '--proof-file requires a path');
    const proofFile = path.resolve(proofValue);
    fs.mkdirSync(path.dirname(proofFile), { recursive: true });
    fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - the consolidated Fastly capability example realizes native Config Store, Secret Store, KV Store, and authenticated GRIP broadcast without a JavaScript runtime');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
