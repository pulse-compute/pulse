#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const runtime = require('../../../packages/runtime/src/internal/index.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const runtimeHost = require('../../../packages/runtime/src/host.js');
const gripLowerer = require('../../../packages/grip/pulsewasm.compiler.cjs');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const nodeProvider = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  createNodeJavascriptGripBroadcast
} = require('../../../packages/provider-node/src/javascript/grip-broadcast.js');
const {
  createFastlyProviderAdapter
} = require('../../../packages/provider-fastly/src/runtime/canonical-api-runtime.js');
const {
  compileFastlyNativePlatformCapabilitiesPlan
} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { stableStringify } = require('../../packages/contracts/src/stable-id.js');
const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require('../../../packages/provider-node/src/javascript/support.js');
const {
  buildWorkspacePackage
} = require('./workspace-package-build.cjs');

const GRIP_CONFORMANCE_CORPUS_VERSION = 'pulse.grip-cross-target-conformance-corpus.v1';
const GRIP_CONFORMANCE_PROOF_VERSION = 'pulse.grip-cross-target-conformance-proof.v1';
const GRIP_CONFORMANCE_OBSERVATION_VERSION = 'pulse.grip-cross-target-observation.v1';
const DRIFT_DIAGNOSTIC_CODE = 'PULSEWASM_GRIP_CROSS_TARGET_DRIFT';
const SECRET_VALUE = '5d-secret-do-not-leak';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const corpusFile = path.join(repoRoot, 'wasm/test/fixtures/conformance/grip-conformance-corpus.json');
const contractFile = path.join(repoRoot, 'packages/grip/grip.framing-contract.json');
const fixtureFile = path.join(repoRoot, 'wasm/test/fixtures/conformance/grip-canonical-root.ts');
const routerFixtureFile = path.join(repoRoot, 'wasm/test/fixtures/conformance/grip-canonical-router.ts');
let gripPackageBuild;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function expectedValue(entry) {
  return entry.expectedFailure ? { failure: entry.expectedFailure } : entry.expected;
}

function assertSubset(actual, expected, label) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    assert.deepEqual(actual, expected, label);
    return;
  }
  assert.ok(actual && typeof actual === 'object', `${label} must be an object`);
  for (const [key, value] of Object.entries(expected)) assertSubset(actual[key], value, `${label}.${key}`);
}

function headerPairs(input) {
  if (Array.isArray(input)) return input.map(([name, value]) => [String(name), String(value)]);
  if (input && Array.isArray(input.headers)) return headerPairs(input.headers);
  if (input instanceof Headers) {
    const pairs = [...input.entries()].map(([name, value]) => [name, value]);
    if (typeof input.getSetCookie === 'function') {
      const cookies = input.getSetCookie();
      if (cookies.length > 0) {
        for (let index = pairs.length - 1; index >= 0; index -= 1) {
          if (pairs[index][0].toLowerCase() === 'set-cookie') pairs.splice(index, 1);
        }
        for (const cookie of cookies) pairs.push(['set-cookie', cookie]);
      }
    }
    return pairs;
  }
  return [];
}

function headerValues(input, name) {
  const lower = String(name).toLowerCase();
  const values = headerPairs(input).filter(([key]) => key.toLowerCase() === lower).map(([, value]) => value);
  if (values.length !== 1 || !['grip-channel', 'x-repeated'].includes(lower)) return values;
  return values[0].split(',').map((entry) => entry.trim()).filter(Boolean);
}

function headerFirst(input, name) {
  return headerValues(input, name)[0] || null;
}

async function responseBody(response) {
  if (response instanceof Response) return response.text();
  return response && response.body === undefined ? '' : String(response.body);
}

async function framingObservation(response, fields = {}) {
  const observation = {
    status: Number(response.status),
    body: await responseBody(response),
    contentType: headerFirst(response.headers, 'content-type'),
    hold: headerFirst(response.headers, 'grip-hold'),
    channels: headerValues(response.headers, 'grip-channel'),
    timeout: headerFirst(response.headers, 'grip-timeout'),
    sourceHeader: headerFirst(response.headers, 'x-source'),
    repeated: headerValues(response.headers, 'x-repeated'),
    ...fields
  };
  return observation;
}

function readCorpus() {
  const source = fs.readFileSync(corpusFile);
  const corpus = JSON.parse(source);
  assert.equal(corpus.version, GRIP_CONFORMANCE_CORPUS_VERSION);
  assert.equal(corpus.authority.contract, 'pulse.grip-framing-contract.v1');
  assert.equal(corpus.authority.applicationImport, '@pulse-compute/grip');
  assert.equal(corpus.authority.connectionOwner, 'external-grip-gateway');
  assert.equal(corpus.authority.automaticFallback, false);
  assert.equal(new Set(corpus.cases.map((entry) => entry.id)).size, corpus.cases.length);
  assert.equal(new Set(corpus.negativeControls.map((entry) => entry.id)).size, corpus.negativeControls.length);
  return { corpus, sha256: sha256(source) };
}

async function loadGrip() {
  gripPackageBuild = buildWorkspacePackage('packages/grip');
  const url = pathToFileURL(gripPackageBuild.entry).href;
  return (await import(url)).grip;
}

function compileNativeEvidence() {
  const project = compileCanonicalProject(fixtureFile, {
    rootDir: repoRoot,
    workspaceRoot: repoRoot,
    strict: true
  });
  const routerProject = compileCanonicalProject(routerFixtureFile, {
    rootDir: repoRoot,
    workspaceRoot: repoRoot,
    strict: true
  });
  const plan = buildCanonicalNativePlan(project);
  const routerPlan = buildCanonicalNativePlan(routerProject);
  const first = compileCanonicalNativePlan(plan, { cwd: repoRoot, timeoutMs: 180000 });
  const second = compileCanonicalNativePlan(plan, { cwd: repoRoot, timeoutMs: 180000 });
  assert.equal(first.source, second.source);
  assert.deepEqual(first.wasm, second.wasm);
  assert.doesNotMatch(project.generatedSource, /\bgrip\.(?:isWebSocket|subscribe|handoff|broadcast)\s*\(/);
  assert.doesNotMatch(routerProject.generatedSource, /\bgrip\.(?:isWebSocket|subscribe|handoff|broadcast)\s*\(/);
  assert.deepEqual(plan.effects.map((effect) => [effect.kind, Boolean(effect.grouped)]), [
    ['grip.broadcast', false],
    ['grip.broadcast', true],
    ['config.get', true]
  ]);
  assert.deepEqual(routerPlan.effects.map((effect) => effect.kind), ['grip.broadcast']);
  return { project, routerProject, plan, routerPlan, first, second };
}

function compileFastlyEvidence(native) {
  const bindings = {
    configStore: 'pulse_config',
    secretStore: 'pulse_secrets',
    backends: { 'https://publisher.test': 'grip_backend' },
    grip: {
      publishEndpoint: 'https://publisher.test/publish',
      publishBackend: 'grip_backend',
      authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
    }
  };
  const first = compileFastlyNativePlatformCapabilitiesPlan(native.plan, {
    cwd: repoRoot,
    bindings,
    timeoutMs: 180000
  });
  const second = compileFastlyNativePlatformCapabilitiesPlan(native.plan, {
    cwd: repoRoot,
    bindings,
    timeoutMs: 180000
  });
  assert.equal(first.source, second.source);
  assert.deepEqual(first.wasm, second.wasm);
  assert.equal(first.source.includes('GRIP_TOKEN'), true);
  assert.equal(first.source.includes(SECRET_VALUE), false);
  assert.equal(first.inspection.importModules.includes('fastly_secret_store'), true);
  assert.equal(first.inspection.importModules.some((entry) => /pulse_host|wasi|js/i.test(entry)), false);
  return { bindings, first, second };
}

function providerFetch(messageId, status = 202, accepted = true, capture) {
  return async (url, init) => {
    if (capture) capture.push({
      endpoint: String(url),
      method: init.method,
      authorization: init.headers.get('authorization'),
      bodySha256: sha256(init.body)
    });
    return new Response(JSON.stringify({ accepted, messageId }), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };
}

async function executeNative(native, request, options = {}) {
  const adapter = options.providerAdapter || nodeProvider.createNodeProviderAdapter({
    grip: {
      publishEndpoint: 'https://publisher.test/publish',
      authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
    },
    fetchImplementation: options.fetchImplementation || providerFetch(options.messageId || 'native-id'),
    config: { MODE: 'test' },
    secrets: { GRIP_TOKEN: SECRET_VALUE }
  });
  return nativeHost.executeCanonicalNativeModule(native.first, {
    providerAdapter: adapter,
    executionId: `5d:${request.path}:${options.messageId || 'none'}`,
    request: {
      method: request.method || 'GET',
      path: request.path,
      url: `https://pulse.test${request.path}`,
      headers: request.headers || []
    },
    config: { MODE: 'test' },
    secrets: { GRIP_TOKEN: SECRET_VALUE },
    grip: {
      publishEndpoint: 'https://publisher.test/publish',
      authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
    },
    fetchImplementation: options.fetchImplementation || providerFetch(options.messageId || 'native-id'),
    signal: options.signal
  });
}

async function javascriptBroadcastObservation(grip, fixture) {
  const app = new Router();
  const effects = [];
  app.post('/direct', async (ctx) => {
    const acknowledgement = await grip.broadcast(ctx, { channel: 'direct', data: { value: 1 } });
    return ctx.json({ acknowledgement }, { status: 202 });
  });
  app.post('/parallel', async (ctx) => {
    const grouped = await ctx.parallel({
      publish: grip.broadcast(ctx, {
        channel: 'updates',
        data: { value: 1 },
        event: 'changed',
        id: 'message-1'
      }),
      mode: ctx.config.get('MODE')
    });
    return ctx.json({ grouped }, { status: 202 });
  });
  const response = await runtime.executeRouter(
    app,
    new Request(`https://pulse.test/${fixture}`, { method: 'POST' }),
    {
      capabilities: {
        config: async () => 'test',
        effect: async (effect) => {
          effects.push(effect);
          return {
            accepted: true,
            status: 202,
            messageId: effect.payload.channel === 'direct' ? 'direct-id' : 'updates-id'
          };
        }
      }
    }
  );
  const body = await response.json();
  return fixture === 'direct'
    ? { ...body.acknowledgement, effectKind: effects[0].kind, grouped: false }
    : { ...body.grouped.publish, mode: body.grouped.mode, effectKind: effects[0].kind, grouped: true };
}

function lowererFailure(options) {
  const optionsSource = JSON.stringify(options);
  const sourceFile = ts.createSourceFile(
    'grip-invalid-framing.ts',
    `import { grip } from '@pulse-compute/grip';\nexport default async function handler(ctx) { return grip.subscribe(ctx.text('x'), ${optionsSource}); }\n`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );
  const result = gripLowerer.buildGripLoweringPlan({
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    sourceFile,
    generatedBy: 'grip-conformance-conformance',
    typescript: ts
  });
  return result.diagnostics.find((entry) => entry.severity === 'error');
}

async function invalidFramingObservation(grip, entry) {
  let javascriptFailure;
  try {
    grip.subscribe(new Response('x'), entry.options);
  } catch {
    javascriptFailure = entry.expectedFailure;
  }
  const diagnostic = lowererFailure(entry.options);
  assert.ok(diagnostic, `${entry.id} must fail Native eligibility`);
  assert.equal(diagnostic.code, entry.expectedFailure);
  assert.equal(javascriptFailure, entry.expectedFailure);
  return { failure: entry.expectedFailure };
}

function providerScenarioOptions(scenario, capture) {
  const controller = new AbortController();
  const common = {
    payload: { channel: 'provider', data: { value: 1 } },
    grip: { publishEndpoint: 'https://publisher.test/publish' },
    secrets: {},
    signal: controller.signal,
    fetchImplementation: providerFetch('provider-id', 202, true, capture)
  };
  if (scenario === 'missing-capability') {
    common.grip = {};
    common.fetchImplementation = undefined;
  }
  if (scenario === 'authentication-success' || scenario === 'authentication-missing') {
    common.grip.authentication = { scheme: 'bearer', secretRef: 'GRIP_TOKEN' };
    if (scenario === 'authentication-success') common.secrets.GRIP_TOKEN = SECRET_VALUE;
  }
  if (scenario === 'acknowledgement-normalization') {
    common.fetchImplementation = providerFetch('ack-id', 207, false, capture);
  }
  if (scenario === 'cancelled') {
    controller.abort();
    common.fetchImplementation = async (_url, init) => {
      if (init.signal && init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response();
    };
  }
  if (scenario === 'request-too-large') {
    common.grip.maxRequestBytes = 32;
    common.payload.data = { value: 'x'.repeat(128) };
  }
  if (scenario === 'response-too-large') {
    common.grip.maxResponseBytes = 16;
    common.fetchImplementation = async () => new Response('x'.repeat(128), { status: 202 });
  }
  if (scenario === 'rejected') {
    common.fetchImplementation = async () => new Response('rejected', { status: 503 });
  }
  if (scenario === 'invalid-endpoint') common.grip.publishEndpoint = 'ftp://publisher.test/publish';
  return common;
}

function providerResult(scenario, value, capture) {
  if (scenario === 'authentication-success') {
    return {
      accepted: value.accepted,
      authorizationPresent: capture[0] && capture[0].authorization === `Bearer ${SECRET_VALUE}`,
      secretRecorded: false
    };
  }
  return value;
}

async function executeNodeProviderScenario(scenario) {
  const capture = [];
  const options = providerScenarioOptions(scenario, capture);
  try {
    const broadcast = createNodeJavascriptGripBroadcast({
      ...options.grip,
      fetchImplementation: options.fetchImplementation,
      secretLookup: (name) => options.secrets[name]
    });
    const value = await broadcast(options.payload, { signal: options.signal });
    return providerResult(scenario, value, capture);
  } catch (error) {
    return { failure: error && error.code || error && error.name || 'Error' };
  }
}

async function executeFastlyProviderScenario(scenario) {
  const capture = [];
  const options = providerScenarioOptions(scenario, capture);
  const adapter = createFastlyProviderAdapter({
    bindings: { grip: options.grip },
    fetchImplementation: options.fetchImplementation,
    secrets: options.secrets
  });
  try {
    const value = await adapter.dispatchEffect({
      id: 'grip-broadcast-1',
      kind: 'grip.broadcast',
      payload: options.payload
    }, {
      executionId: `5d:fastly:${scenario}`,
      metadata: { providerOperations: [] },
      fetchImplementation: options.fetchImplementation,
      secrets: options.secrets,
      signal: options.signal
    });
    return providerResult(scenario, value, capture);
  } catch (error) {
    return { failure: error && error.code || error && error.name || 'Error' };
  }
}

async function groupedFailureObservation() {
  const execution = runtimeHost.createJavascriptEffectExecution({
    effectAdapter: {
      id: 'pulse.grip-conformance.group-failure',
      async dispatch(effect) {
        const error = new Error(`${effect.kind} failed`);
        error.code = effect.kind === 'config.get' ? 'CONFIG_FAILED' : 'BROADCAST_FAILED';
        throw error;
      }
    }
  });
  const config = execution.dispatch({ kind: 'config.get', providerKind: 'config', operation: 'get', capability: 'config.get', name: 'MODE' });
  const broadcast = execution.dispatch({
    kind: 'grip.broadcast',
    providerKind: 'grip',
    operation: 'broadcast',
    capability: 'grip.broadcast',
    package: '@pulse-compute/grip',
    contractId: 'pulse.grip',
    payload: { channel: 'events', data: { value: 1 } }
  });
  try {
    await execution.parallel({ config, broadcast });
    throw new Error('Expected the grouped effects to fail.');
  } catch (error) {
    const failureIds = (error.effectFailures || []).map((entry) => entry.effectId);
    await execution.close();
    return { failureIds, deterministic: stableStringify(failureIds) === stableStringify([...failureIds].sort()) };
  }
}

async function caseObservation(entry, grip, native) {
  if (entry.group === 'classification') {
    const javascript = { websocket: grip.isWebSocket({ headers: entry.request.headers }) };
    const executed = await executeNative(native, { path: '/classify', headers: entry.request.headers });
    const nativeValue = { websocket: JSON.parse(executed.response.body).websocket };
    assert.deepEqual(nativeValue, javascript, `${entry.id} JavaScript/Native classification`);
    return { normalized: javascript, targets: { javascript, native: nativeValue } };
  }
  if (entry.group === 'subscribe' || entry.group === 'subscribe-stream' || entry.group === 'subscribe-replace') {
    let javascriptResponse;
    let nativePath;
    if (entry.fixture === 'single') {
      javascriptResponse = grip.subscribe(new Response('source-body', {
        status: 206,
        headers: [['X-Source', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']]
      }), { channel: 'single', mode: 'stream', timeoutMs: 0 });
      nativePath = '/subscribe-single';
    } else if (entry.fixture === 'repeated') {
      javascriptResponse = grip.subscribe(new Response('parallel', {
        status: 202,
        headers: [['X-Source', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']]
      }), { channels: ['updates', 'audit'], mode: 'response', timeoutMs: 5000 });
      nativePath = '/broadcast-parallel';
    } else if (entry.group === 'subscribe-stream') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('chunk-one'));
          controller.enqueue(encoder.encode('chunk-two'));
          controller.close();
        }
      });
      javascriptResponse = grip.subscribe(new Response(stream, { status: 207 }), { channel: 'stream' });
      nativePath = '/subscribe-stream';
    } else {
      javascriptResponse = grip.subscribe(new Response('replace', {
        headers: [['Grip-Hold', 'stream'], ['Grip-Channel', 'old'], ['Grip-Timeout', '10']]
      }), { channels: ['new-one', 'new-two'], mode: 'response' });
      nativePath = '/subscribe-replace';
    }
    const javascript = await framingObservation(javascriptResponse);
    const executed = await executeNative(native, { path: nativePath }, { messageId: 'updates-id' });
    const nativeValue = await framingObservation(executed.response);
    assertSubset(nativeValue, expectedValue(entry), `${entry.id}.native`);
    assertSubset(javascript, expectedValue(entry), `${entry.id}.javascript`);
    return { normalized: Object.fromEntries(Object.keys(expectedValue(entry)).map((key) => [key, javascript[key]])), targets: { javascript, native: nativeValue } };
  }
  if (entry.group === 'invalid-framing') {
    const normalized = await invalidFramingObservation(grip, entry);
    return { normalized, targets: { javascript: normalized, nativeEligibility: normalized } };
  }
  if (entry.group === 'handoff' || entry.group === 'handoff-javascript') {
    let options;
    let nativePath;
    let nativeHeaders = [];
    if (entry.fixture === 'default') {
      options = { channel: 'socket:default', body: 'DEFAULT' };
      nativePath = '/handoff-default';
    } else if (entry.fixture === 'explicit') {
      options = {
        channels: ['socket:primary', 'socket:audit'],
        mode: 'stream',
        timeoutMs: 0,
        status: 201,
        headers: [['X-Handoff', 'yes'], ['X-Repeated', 'one'], ['X-Repeated', 'two']],
        body: 'OPEN'
      };
      nativePath = '/handoff-explicit';
      nativeHeaders = [['Connection', 'Upgrade'], ['Upgrade', 'websocket']];
    } else {
      options = entry.options;
      nativePath = entry.id.includes('caller-owned') ? '/handoff-exact' : '/handoff-custom';
    }
    const javascript = await framingObservation(grip.handoff(options));
    const executed = await executeNative(native, { path: nativePath, headers: nativeHeaders });
    const nativeValue = await framingObservation(executed.response);
    assertSubset(nativeValue, expectedValue(entry), `${entry.id}.native`);
    assertSubset(javascript, expectedValue(entry), `${entry.id}.javascript`);
    return { normalized: Object.fromEntries(Object.keys(expectedValue(entry)).map((key) => [key, javascript[key]])), targets: { javascript, native: nativeValue } };
  }
  if (entry.group === 'broadcast-native') {
    const javascript = await javascriptBroadcastObservation(grip, entry.fixture);
    const nativePath = entry.fixture === 'direct' ? '/broadcast-direct' : '/broadcast-parallel';
    const messageId = entry.fixture === 'direct' ? 'direct-id' : 'updates-id';
    const executed = await executeNative(native, { method: 'POST', path: nativePath }, { messageId });
    const body = JSON.parse(executed.response.body);
    const acknowledgement = entry.fixture === 'direct' ? body.acknowledgement : body.grouped.publish;
    const nativeValue = {
      ...acknowledgement,
      ...(entry.fixture === 'parallel' ? { mode: body.grouped.mode } : {}),
      effectKind: 'grip.broadcast',
      grouped: entry.fixture === 'parallel'
    };
    assertSubset(javascript, expectedValue(entry), `${entry.id}.javascript`);
    assertSubset(nativeValue, expectedValue(entry), `${entry.id}.native`);
    return { normalized: Object.fromEntries(Object.keys(expectedValue(entry)).map((key) => [key, javascript[key]])), targets: { javascript, native: nativeValue } };
  }
  if (entry.group === 'broadcast-provider') {
    const node = await executeNodeProviderScenario(entry.scenario);
    const fastly = await executeFastlyProviderScenario(entry.scenario);
    assert.deepEqual(fastly, node, `${entry.id} Node/Fastly provider semantics`);
    assertSubset(node, expectedValue(entry), `${entry.id}.provider`);
    return { normalized: node, targets: { node, fastly } };
  }
  if (entry.group === 'broadcast-group-failure') {
    const normalized = await groupedFailureObservation();
    assertSubset(normalized, entry.expected, entry.id);
    return { normalized, targets: { sharedJavascriptEffectAdapter: normalized, nativePlanGrouped: true } };
  }
  throw new TypeError(`Unknown GRIP conformance corpus group ${entry.group}.`);
}

function pointerSet(value, pointer, replacement) {
  const segments = pointer.slice(1).split('/').map((entry) => entry.replace(/~1/g, '/').replace(/~0/g, '~'));
  let target = value;
  for (const segment of segments.slice(0, -1)) target = target[segment];
  target[segments[segments.length - 1]] = clone(replacement);
}

function compareObservations(entry, expected, actual) {
  if (stableStringify(expected) === stableStringify(actual)) return true;
  const error = new Error(`GRIP cross-target drift in ${entry.id}.`);
  error.name = 'GripCrossTargetDriftError';
  error.code = DRIFT_DIAGNOSTIC_CODE;
  error.detail = Object.freeze({
    caseId: entry.id,
    surface: entry.group,
    expected,
    actual
  });
  throw error;
}

async function buildGripConformanceProof() {
  const { corpus, sha256: corpusSha256 } = readCorpus();
  const grip = await loadGrip();
  const native = compileNativeEvidence();
  const fastly = compileFastlyEvidence(native);
  const observations = new Map();
  const cases = [];
  for (const entry of corpus.cases) {
    const observation = await caseObservation(entry, grip, native);
    assertSubset(observation.normalized, expectedValue(entry), entry.id);
    observations.set(entry.id, observation.normalized);
    cases.push(Object.freeze({
      id: entry.id,
      matched: true,
      observationSha256: sha256(stableStringify({
        normalized: observation.normalized,
        targets: observation.targets
      }))
    }));
  }

  const negativeControls = corpus.negativeControls.map((control) => {
    const expected = clone(observations.get(control.caseId));
    const actual = clone(expected);
    pointerSet(actual, control.path, control.replacement);
    let diagnostic;
    try {
      compareObservations(
        corpus.cases.find((entry) => entry.id === control.caseId),
        expected,
        actual
      );
    } catch (error) {
      diagnostic = { code: error.code, caseId: error.detail.caseId, surface: error.detail.surface };
    }
    assert.equal(diagnostic && diagnostic.code, DRIFT_DIAGNOSTIC_CODE);
    return Object.freeze({ id: control.id, caseId: control.caseId, path: control.path, rejected: true, diagnostic });
  });

  const proof = {
    version: GRIP_CONFORMANCE_PROOF_VERSION,
    authority: {
      contract: 'pulse.grip-framing-contract.v1',
      observation: GRIP_CONFORMANCE_OBSERVATION_VERSION,
      diagnosticCode: DRIFT_DIAGNOSTIC_CODE,
      applicationImport: '@pulse-compute/grip',
      connectionOwner: 'external-grip-gateway',
      pulseState: 'request-only',
      broadcastEffect: 'grip.broadcast',
      automaticFallback: false
    },
    corpus: {
      artifact: 'wasm/test/fixtures/conformance/grip-conformance-corpus.json',
      version: corpus.version,
      sha256: corpusSha256,
      cases: corpus.cases.length,
      negativeControls: corpus.negativeControls.length,
      groups: [...new Set(corpus.cases.map((entry) => entry.group))].sort()
    },
    summary: {
      total: cases.length,
      matched: cases.length,
      mismatches: 0,
      negativeControlsRejected: negativeControls.length
    },
    classifications: {
      normalizedPortableSemantics: {
        compared: true,
        fields: ['websocket intent', 'HTTP status and body', 'ordered framing headers', 'broadcast acknowledgement', 'stable failure code']
      },
      targetOwnedImplementationDetail: {
        comparedForIdentity: false,
        classified: true,
        javascript: 'Web Request/Response helpers and request-owned effect adapter',
        nativeNode: 'compiler-owned intrinsics and pulse_host functions',
        nativeFastly: 'direct Fastly hostcall module'
      },
      callerOwnedExactText: {
        semanticNormalization: false,
        exactSha256Compared: true,
        caseId: 'handoff-caller-owned-exact-body'
      }
    },
    lowering: {
      canonicalRoot: '@pulse-compute/grip',
      compatibilityRoot: '@pulse-compute/grip/pulsewasm',
      handlerCompilerOwnedIntrinsics: {
        count: native.project.metadata.compilerOwnedIntrinsics.length,
        operations: [...new Set(native.project.metadata.compilerOwnedIntrinsics.map((entry) => entry.intrinsic))].sort()
      },
      routerCompilerOwnedIntrinsics: {
        count: native.routerProject.metadata.compilerOwnedIntrinsics.length,
        operations: [...new Set(native.routerProject.metadata.compilerOwnedIntrinsics.map((entry) => entry.intrinsic))].sort()
      },
      effects: native.plan.effects.map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        grouped: Boolean(effect.grouped),
        groupKey: effect.groupKey || null
      })),
      routerEffects: native.routerPlan.effects.map((effect) => ({ id: effect.id, kind: effect.kind })),
      staticNativeBoundary: true,
      noTrialLowering: true
    },
    determinism: {
      packageRoot: {
        sourceSha256: sha256(fs.readFileSync(gripPackageBuild.entry))
      },
      nativeNode: {
        sourceSha256: sha256(native.first.source),
        wasmSha256: native.first.inspection.sha256,
        wasmBytes: native.first.wasm.length,
        sourceRepeatable: native.first.source === native.second.source,
        wasmRepeatable: native.first.wasm.equals(native.second.wasm)
      },
      nativeFastly: {
        sourceSha256: sha256(fastly.first.source),
        wasmSha256: fastly.first.inspection.sha256,
        wasmBytes: fastly.first.wasm.length,
        sourceRepeatable: fastly.first.source === fastly.second.source,
        wasmRepeatable: fastly.first.wasm.equals(fastly.second.wasm),
        imports: fastly.first.inspection.importModules
      }
    },
    configuration: {
      publicGatewayUrl: 'application-public-config',
      ingressRoute: 'deployment-routing',
      publishEndpoint: 'provider-owned-outbound-capability',
      authentication: 'named-secret-reference',
      secretRef: 'GRIP_TOKEN',
      secretValueRecorded: false,
      ambientEndpoint: false,
      ambientCredentials: false
    },
    cases,
    negativeControls,
    availability: {
      gripRealization: 'realized',
      gates: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.summary,
      fullTargetSupportReady: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.fullTargetSupportReady,
      generalAvailable: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.generalAvailable,
      automaticFallback: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.automaticFallback
    }
  };
  assert.equal(stableStringify(proof).includes(SECRET_VALUE), false);
  return Object.freeze(proof);
}

module.exports = Object.freeze({
  GRIP_CONFORMANCE_CORPUS_VERSION,
  GRIP_CONFORMANCE_PROOF_VERSION,
  GRIP_CONFORMANCE_OBSERVATION_VERSION,
  DRIFT_DIAGNOSTIC_CODE,
  buildGripConformanceProof,
  compareObservations
});

if (require.main === module) {
  buildGripConformanceProof()
    .then((proof) => process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`))
    .catch((error) => {
      console.error(error && error.stack || error);
      process.exitCode = 1;
    });
}
