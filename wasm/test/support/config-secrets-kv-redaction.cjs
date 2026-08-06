'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { Router } = require('../../../packages/runtime/src/index.js');
const runtimeHost = require('../../../packages/runtime/src/host.js');
const {
  compileCanonicalSource,
  loadCanonicalModule
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  createNodeProviderAdapter,
  executeCanonicalProgram
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  createNodeJavascriptBindingCapabilities
} = require('../../../packages/provider-node/src/javascript/bindings-adapter.js');
const {
  executeNodeJavascriptApplication
} = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { createNodeJavascriptHandler } = require('../../../packages/provider-node/src/javascript/node-adapter.js');
const {
  executeNodeJavascriptTestCase
} = require('../../../packages/provider-node/src/javascript/test-runtime.js');
const {
  classifyNodeJavascriptCapability: classifyCapability,
  classifyNodeJavascriptProviderRequirement: classifyProviderRequirement
} = require('../../../packages/provider-node/src/javascript/target-support-policy.js');
const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require('../../../packages/provider-node/src/javascript/support.js');
const {
  sha256Hex,
  stableStringify
} = require('../../packages/contracts/src/stable-id.js');

const BINDINGS_REDACTION_PROOF_VERSION = 'pulse.config-secrets-kv-redaction-proof.v1';
const BINDINGS_REDACTION_REPORT_VERSION = 'pulse.config-secrets-kv-redaction-report.v1';

const NATIVE_BINDINGS_SOURCE = `
export default async function handler(ctx) {
  const users = ctx.kv('users');
  const { mode, token, current } = await ctx.parallel({
    mode: ctx.config.get('MODE'),
    token: ctx.secret.get('TOKEN'),
    current: users.get('current')
  });
  await ctx.kv('users').put('last', { mode, current });
  return ctx.json({ mode, current });
}
`;

const NATIVE_REDACTION_SOURCE = `
export default async function handler(ctx) {
  const token = await ctx.secret.get('TOKEN');
  const value = await ctx.fetch('https://origin.test/' + token).json();
  return ctx.json(value);
}
`;

function stableArtifact(version, report) {
  const semantic = Object.freeze({ version, report });
  return Object.freeze({ ...semantic, sha256: sha256Hex(stableStringify(semantic)) });
}

function passed(id, detail) {
  return Object.freeze({ id, status: 'passed', detail: Object.freeze(detail) });
}

function responseJson(result) {
  return JSON.parse(result.response.body || '{}');
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected focused bindings and redaction operation to fail.');
}

async function javascriptExactBindingsEvidence() {
  const ambientName = 'PULSE_4C_AMBIENT_ONLY';
  const previous = process.env[ambientName];
  process.env[ambientName] = 'ambient-must-not-be-read';
  try {
    const app = new Router();
    app.get('/bindings', async (ctx) => {
      const { mode, token, ambient, absentSecret } = await ctx.parallel({
        mode: ctx.config.get('MODE'),
        token: ctx.secret.get('TOKEN'),
        ambient: ctx.config.get(ambientName),
        absentSecret: ctx.secret.get('MISSING')
      });
      return ctx.json({
        mode,
        tokenPresent: token !== undefined,
        ambientMissing: ambient === undefined,
        absentSecret: absentSecret === undefined
      });
    });
    const result = await executeNodeJavascriptTestCase(app, {
      request: { method: 'GET', path: '/bindings' },
      config: { MODE: 'test' },
      secrets: { TOKEN: 'javascript-secret-value' }
    });
    const body = responseJson(result);
    assert.deepEqual(body, {
      mode: 'test',
      tokenPresent: true,
      ambientMissing: true,
      absentSecret: true
    });
    return {
      response: Object.freeze({ status: result.response.status, body }),
      effects: Object.freeze({ external: result.externalEffectCount, owned: result.effectCount }),
      group: result.continuations[0]
    };
  } finally {
    if (previous === undefined) delete process.env[ambientName];
    else process.env[ambientName] = previous;
  }
}

async function javascriptParallelKvEvidence() {
  const app = new Router();
  app.get('/parallel-bindings', async (ctx) => {
    const users = ctx.kv('users');
    const { mode, token, current } = await ctx.parallel({
      mode: ctx.config.get('MODE'),
      token: ctx.secret.get('TOKEN'),
      current: users.get('current')
    });
    const stored = await users.put('last', { mode, current });
    const last = await users.get('last');
    return ctx.json({
      mode,
      tokenPresent: token !== undefined,
      current,
      stored,
      last,
      currentFrozen: Object.isFrozen(current),
      nestedFrozen: Object.isFrozen(current.profile)
    });
  });
  const result = await executeNodeJavascriptTestCase(app, {
    request: { method: 'GET', path: '/parallel-bindings' },
    config: { MODE: 'test' },
    secrets: { TOKEN: 'javascript-secret-value' },
    kv: { users: { current: { profile: { id: 7 } } } }
  });
  const body = responseJson(result);
  assert.deepEqual(body, {
    mode: 'test',
    tokenPresent: true,
    current: { profile: { id: 7 } },
    stored: true,
    last: { mode: 'test', current: { profile: { id: 7 } } },
    currentFrozen: true,
    nestedFrozen: true
  });
  return {
    response: Object.freeze({ status: result.response.status, body }),
    effectCount: result.effectCount,
    resolutionOrder: result.resolutionOrder,
    group: result.continuations[0]
  };
}

async function javascriptKvCloneIsolationEvidence() {
  const seed = { nested: { count: 1 } };
  const bindings = createNodeJavascriptBindingCapabilities({
    kv: { users: { current: seed } }
  });
  seed.nested.count = 9;
  const users = bindings.kv('users');
  const first = await users.get('current');
  const input = { nested: { count: 2 } };
  assert.equal(await users.put('last', input), true);
  input.nested.count = 10;
  const second = await users.get('last');
  assert.deepEqual(first, { nested: { count: 1 } });
  assert.deepEqual(second, { nested: { count: 2 } });

  const app = new Router();
  app.get('/counter', async (ctx) => {
    const state = ctx.kv('state');
    const current = await state.get('counter');
    const next = { value: current.value + 1 };
    await state.put('counter', next);
    return ctx.json(next);
  });
  const handler = createNodeJavascriptHandler(app, {
    kv: { state: { counter: { value: 0 } } }
  });
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const firstResponse = await fetch(`http://127.0.0.1:${address.port}/counter`);
    const secondResponse = await fetch(`http://127.0.0.1:${address.port}/counter`);
    assert.deepEqual(await firstResponse.json(), { value: 1 });
    assert.deepEqual(await secondResponse.json(), { value: 2 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    seedDetached: first.nested.count === 1,
    putDetached: second.nested.count === 2,
    firstFrozen: Object.isFrozen(first),
    firstNestedFrozen: Object.isFrozen(first.nested),
    secondFrozen: Object.isFrozen(second),
    secondNestedFrozen: Object.isFrozen(second.nested)
  };
}

async function javascriptProviderDiagnosticsEvidence() {
  const bindingExecution = runtimeHost.createJavascriptEffectExecution({
    effectAdapter: { id: 'pulse.bindings-redaction.invalid-binding', dispatch: () => ({ forbidden: 'not-a-string' }) }
  });
  const bindingError = await captureError(bindingExecution.dispatch({
    kind: 'config.get', providerKind: 'config', operation: 'get', capability: 'config.get', name: 'MODE'
  }));
  await bindingExecution.close();

  const acknowledgementExecution = runtimeHost.createJavascriptEffectExecution({
    effectAdapter: { id: 'pulse.bindings-redaction.invalid-ack', dispatch: () => 'yes' }
  });
  const acknowledgementError = await captureError(acknowledgementExecution.dispatch({
    kind: 'kv.put', providerKind: 'kv', operation: 'put', capability: 'kv.put', namespace: 'users', key: 'last', value: { ok: true }
  }));
  await acknowledgementExecution.close();

  let invalidKvValue;
  try {
    runtimeHost.cloneKvValue({ value: new Date('2026-07-23T00:00:00.000Z') });
  } catch (error) {
    invalidKvValue = error;
  }
  assert.equal(bindingError.code, 'PULSE_BINDING_VALUE_INVALID');
  assert.equal(acknowledgementError.code, 'PULSE_KV_ACK_INVALID');
  assert.equal(invalidKvValue.code, 'PULSE_KV_VALUE_INVALID');
  const serialized = JSON.stringify([bindingError, acknowledgementError, invalidKvValue]);
  assert.equal(serialized.includes('not-a-string'), false);
  return {
    binding: Object.freeze({ name: bindingError.name, code: bindingError.code, valueType: bindingError.detail.valueType }),
    acknowledgement: Object.freeze({ name: acknowledgementError.name, code: acknowledgementError.code, valueType: acknowledgementError.detail.valueType }),
    kvValue: Object.freeze({ name: invalidKvValue.name, code: invalidKvValue.code, valueType: invalidKvValue.detail.valueType }),
    forbiddenProviderValueRecorded: serialized.includes('not-a-string')
  };
}

async function javascriptProviderRedactionEvidence() {
  const secretValue = 'javascript-redaction-secret';
  const observations = [];
  let summary;
  let captured;
  const app = new Router();
  app.get('/provider-redaction', async (ctx) => {
    const token = await ctx.secret.get('TOKEN');
    return ctx.fetch(`https://origin.test/${token}`).text();
  });
  app.error(async (error, ctx) => {
    captured = error.cause;
    return ctx.text('contained', { status: 502 });
  });
  const response = await executeNodeJavascriptApplication(app, new Request('https://example.test/provider-redaction'), {
    secrets: { TOKEN: secretValue },
    effectAdapter: {
      id: 'pulse.bindings-redaction.redaction',
      dispatch(effect) {
        if (effect.kind === 'secret.get') return secretValue;
        const failure = new Error(`upstream failed for ${effect.url}`);
        failure.code = 'UPSTREAM_FAILED';
        failure.detail = { authorization: `Bearer ${secretValue}`, url: effect.url };
        throw failure;
      }
    },
    onEffectObservation(entry) { observations.push(entry); },
    onEffectSummary(value) { summary = value; }
  });
  const serialized = JSON.stringify({ observations, captured });
  const fetchObservation = observations.find((entry) => entry.type === 'effect-dispatched' && entry.effect.kind === 'fetch');
  assert.equal(serialized.includes(secretValue), false);
  assert.equal(captured.code, 'UPSTREAM_FAILED');
  assert.equal(fetchObservation.effect.url, 'https://origin.test/<redacted>');
  return {
    status: response.status,
    body: await response.text(),
    error: Object.freeze({ code: captured.code, message: captured.message, detail: captured.detail }),
    observedFetchUrl: fetchObservation.effect.url,
    registeredSecretCount: summary.redactedSecretCount,
    secretRecorded: serialized.includes(secretValue),
    redactionMarkerPresent: serialized.includes('<redacted>')
  };
}

async function javascriptHandlerRedactionEvidence() {
  const secretValue = 'javascript-handler-secret';
  let captured;
  const app = new Router();
  app.get('/handler-redaction', async (ctx) => {
    const token = await ctx.secret.get('TOKEN');
    const failure = new Error(`handler failed with ${token}`);
    failure.detail = { token, endpoint: `https://origin.test/${token}` };
    throw failure;
  });
  app.error(async (error, ctx) => {
    captured = error.cause;
    return ctx.text('contained', { status: 500 });
  });
  const response = await executeNodeJavascriptApplication(app, new Request('https://example.test/handler-redaction'), {
    secrets: { TOKEN: secretValue },
    effectAdapter: {
      id: 'pulse.bindings-redaction.handler-redaction',
      dispatch(effect) {
        if (effect.kind === 'secret.get') return secretValue;
        throw new Error(`unexpected ${effect.kind}`);
      }
    }
  });
  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes(secretValue), false);
  assert.equal(String(captured.stack).includes(secretValue), false);
  return {
    status: response.status,
    message: captured.message,
    detail: captured.detail,
    stackContainsSecret: String(captured.stack).includes(secretValue),
    serializedContainsSecret: serialized.includes(secretValue)
  };
}

function nativeLoweringEvidence() {
  const compiled = compileCanonicalSource(NATIVE_BINDINGS_SOURCE, {
    fileName: 'bindings-redaction-native-bindings.ts',
    strict: true
  });
  assert.equal(compiled.ok, true);
  const sites = compiled.metadata.effectSites.map((entry) => Object.freeze({
    id: entry.id,
    kind: entry.kind,
    grouped: entry.grouped,
    groupKey: entry.groupKey || null
  }));
  assert.deepEqual(sites.map((entry) => entry.kind), ['config.get', 'secret.get', 'kv.get', 'kv.put']);
  return {
    capabilities: compiled.metadata.capabilities,
    effects: Object.freeze(sites),
    continuations: Object.freeze(compiled.metadata.continuationSites.map((entry) => Object.freeze({
      id: entry.id,
      kind: entry.kind,
      effectIds: entry.effectIds
    })))
  };
}

async function nativeNodeBindingKvEvidence() {
  const inherited = Object.create({ MODE: 'ambient-prototype-value' });
  const seed = { nested: { count: 1 } };
  const adapter = createNodeProviderAdapter({
    config: inherited,
    secrets: { TOKEN: 'native-provider-secret' },
    kv: { users: { current: seed } }
  });
  const execution = { executionId: 'bindings-redaction-native-provider' };
  let accessorInvoked = false;
  const accessorConfig = {};
  Object.defineProperty(accessorConfig, 'MODE', {
    enumerable: true,
    get() { accessorInvoked = true; return 'must-not-run'; }
  });
  const accessorAdapter = createNodeProviderAdapter({ config: accessorConfig });
  const accessorError = await captureError(accessorAdapter.dispatchEffect(
    { kind: 'config.get', name: 'MODE' },
    { executionId: 'bindings-redaction-native-accessor' }
  ));
  accessorAdapter.disposeExecution({ executionId: 'bindings-redaction-native-accessor' });
  assert.equal(accessorInvoked, false);
  assert.equal(accessorError.code, 'PULSE_BINDING_VALUE_INVALID');

  const missingConfig = await adapter.dispatchEffect({ kind: 'config.get', name: 'MODE' }, execution);
  const secret = await adapter.dispatchEffect({ kind: 'secret.get', name: 'TOKEN' }, execution);
  const first = await adapter.dispatchEffect({ kind: 'kv.get', store: 'users', key: 'current' }, execution);
  seed.nested.count = 9;
  const input = { nested: { count: 2 } };
  const acknowledgement = await adapter.dispatchEffect({ kind: 'kv.put', store: 'users', key: 'last', value: input }, execution);
  input.nested.count = 10;
  const second = await adapter.dispatchEffect({ kind: 'kv.get', store: 'users', key: 'last' }, execution);
  adapter.disposeExecution(execution);
  assert.equal(missingConfig, undefined);
  assert.equal(secret, 'native-provider-secret');
  assert.deepEqual(first, { nested: { count: 1 } });
  assert.deepEqual(second, { nested: { count: 2 } });
  return {
    inheritedConfigIgnored: missingConfig === undefined,
    secretPresent: secret !== undefined,
    seedDetached: first.nested.count === 1,
    putDetached: second.nested.count === 2,
    acknowledgement,
    firstFrozen: Object.isFrozen(first),
    secondFrozen: Object.isFrozen(second)
  };
}

async function nativeRuntimeRedactionEvidence() {
  const secretValue = 'native-redaction-secret';
  const program = loadCanonicalModule(compileCanonicalSource(NATIVE_REDACTION_SOURCE, {
    fileName: 'bindings-redaction-native-redaction.ts',
    strict: true
  }));
  const error = await captureError(executeCanonicalProgram(program, {
    executionId: 'bindings-redaction-native-redaction',
    secrets: { TOKEN: secretValue },
    fetches: { [`https://origin.test/${secretValue}`]: { kind: 'network-error' } }
  }));
  const trace = error.execution.trace.map((entry) => Object.freeze({
    type: entry.type,
    effectId: entry.effectId || null,
    kind: entry.kind || null,
    url: entry.url || null,
    value: entry.value || null,
    code: entry.code || null
  }));
  const serialized = JSON.stringify({ error: { name: error.name, code: error.code, message: error.message, detail: error.detail }, trace });
  assert.equal(serialized.includes(secretValue), false);
  return {
    error: Object.freeze({ name: error.name, code: error.code, message: error.message, detail: error.detail }),
    trace: Object.freeze(trace),
    secretRecorded: serialized.includes(secretValue),
    redactionMarkerPresent: serialized.includes('<redacted>')
  };
}

function supportAndEligibilityEvidence() {
  const gate = NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.gates
    .find((entry) => entry.id === 'bindings-redaction');
  const capability = classifyCapability('config.get', { bindingsRedaction: true });
  const providerRequirement = classifyProviderRequirement('kv.put', [], { bindingsRedaction: true });
  assert.equal(gate.status, 'satisfied');
  assert.equal(capability.status, 'eligible');
  assert.equal(providerRequirement.status, 'eligible');
  return {
    summary: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.summary,
    gate: Object.freeze({ id: gate.id, status: gate.status, reasonId: gate.reasonId, owner: gate.owner }),
    capability,
    providerRequirement,
    policy: Object.freeze({
      definition: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.definition,
      coreExecutionReady: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.coreExecutionReady,
      fullTargetSupportReady: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.fullTargetSupportReady,
      generalAvailable: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.generalAvailable,
      automaticFallback: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.automaticFallback
    })
  };
}

async function buildBindingsRedactionReport() {
  const cases = Object.freeze([
    passed('javascript-node-exact-bindings-and-no-ambient-fallback', await javascriptExactBindingsEvidence()),
    passed('javascript-parallel-config-secret-kv-realization', await javascriptParallelKvEvidence()),
    passed('javascript-kv-clone-isolation', await javascriptKvCloneIsolationEvidence()),
    passed('javascript-provider-contract-diagnostics', await javascriptProviderDiagnosticsEvidence()),
    passed('javascript-provider-failure-redaction', await javascriptProviderRedactionEvidence()),
    passed('javascript-handler-error-redaction', await javascriptHandlerRedactionEvidence()),
    passed('native-binding-kv-lowering', nativeLoweringEvidence()),
    passed('native-node-binding-kv-realization', await nativeNodeBindingKvEvidence()),
    passed('native-known-secret-trace-and-error-redaction', await nativeRuntimeRedactionEvidence()),
    passed('target-support-and-eligibility-policy', supportAndEligibilityEvidence())
  ]);
  return Object.freeze({
    version: BINDINGS_REDACTION_REPORT_VERSION,
    summary: Object.freeze({ total: cases.length, passed: cases.length, failed: 0 }),
    cases,
    contract: Object.freeze({
      config: 'exact-provider-bound-string-or-undefined',
      secrets: 'exact-provider-bound-string-or-undefined-with-request-owned-redaction',
      kv: 'provider-neutral-json-compatible-clone-isolated-values-and-boolean-put-acknowledgement',
      redaction: 'known-secret-and-sensitive-field-redaction-at-observation-trace-error-and-handler-boundaries',
      ambientFallback: false,
      javascriptAndNativeLoweringAligned: true
    })
  });
}

async function buildBindingsRedactionProof() {
  return stableArtifact(BINDINGS_REDACTION_PROOF_VERSION, await buildBindingsRedactionReport());
}

module.exports = Object.freeze({
  BINDINGS_REDACTION_PROOF_VERSION,
  BINDINGS_REDACTION_REPORT_VERSION,
  NATIVE_BINDINGS_SOURCE,
  NATIVE_REDACTION_SOURCE,
  buildBindingsRedactionReport,
  buildBindingsRedactionProof
});
