#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveProject } = require('../../packages/cli/src/project-config.js');
const {
  buildProject,
  compileNativeProjectInMemory,
  inspectProject,
  prepareJavascriptApplication
} = require('../../packages/cli/src/project-execution.js');
const {
  createCanonicalSchemaCodecs
} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const nodeProvider = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const nodeJavascript = require('../../../packages/provider-node/src/javascript/test-runtime.js');
const {
  createNodeJavascriptFixtureFetch
} = require('../../../packages/provider-node/src/javascript/fetch-adapter.js');
const fastlyProvider = require('../../../packages/provider-fastly/src/runtime/canonical-api-runtime.js');
const fastlyJavascript = require('../../../packages/provider-fastly/src/javascript/test-runtime.js');
const fastlyNative = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const fastlyNativeMock = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const {
  canonicalize,
  stableStringify
} = require('../../packages/contracts/src/stable-id.js');
const {
  buildWorkspacePackage
} = require('./workspace-package-build.cjs');

const FOUR_MODE_CONFORMANCE_VERSION = 'pulse.four-mode-conformance.v1';
const FOUR_MODE_OBSERVATION_VERSION = 'pulse.four-mode-observation.v1';
const FOUR_MODE_PROOF_VERSION = 'pulse.four-mode-conformance-proof.v1';
const DRIFT_DIAGNOSTIC_CODE = 'PULSEWASM_FOUR_MODE_DRIFT';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/fastly-javascript-source');
const TRANSPORT_HEADERS = new Set([
  'connection',
  'content-length',
  'date',
  'server',
  'transfer-encoding',
  'via'
]);
const INTENTIONAL_DIFFERENCES = Object.freeze([
  'provider timestamps',
  'provider-specific log formatting',
  'console destination',
  'internal continuation mechanics',
  'JavaScript versus Native argument evaluation for pruned logs',
  'JSON serializer bytes when semantic values agree',
  'transport-owned headers',
  'provider deployment metadata'
]);
const MODES = Object.freeze([
  Object.freeze({ id: 'node-native', provider: 'node', target: 'native', targetId: 'node-native-host' }),
  Object.freeze({ id: 'node-javascript', provider: 'node', target: 'javascript', targetId: 'node-javascript' }),
  Object.freeze({ id: 'fastly-native', provider: 'fastly', target: 'native', targetId: 'fastly-compute-native' }),
  Object.freeze({ id: 'fastly-javascript', provider: 'fastly', target: 'javascript', targetId: 'fastly-javascript' })
]);

const assetsPackageBuild = buildWorkspacePackage('packages/assets');
const gripPackageBuild = buildWorkspacePackage('packages/grip');
const allowedPackages = Object.freeze({
  '@pulse-compute/runtime': require(path.join(repoRoot, 'packages/runtime/src/index.js')),
  '@pulse-compute/pulse': require(path.join(repoRoot, 'packages/pulse/src/index.js')),
  '@pulse-compute/assets': require(assetsPackageBuild.entry),
  '@pulse-compute/grip': require(gripPackageBuild.entry)
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function removeGeneratedRoot(root) {
  const relative = path.relative(fixtureRoot, root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.match(path.basename(root), /^\.four-mode-/);
  fs.rmSync(root, { recursive: true, force: true });
}

function generatedFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(path.relative(root, file).replace(/\\/g, '/'));
    }
  }
  visit(root);
  return files.sort();
}

function headerPairs(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(([name, value]) => [String(name), String(value)]);
  if (input instanceof Headers || typeof input.entries === 'function') {
    return [...input.entries()].map(([name, value]) => [String(name), String(value)]);
  }
  return Object.entries(input).flatMap(([name, value]) => Array.isArray(value)
    ? value.map((entry) => [String(name), String(entry)])
    : [[String(name), String(value)]]);
}

function normalizedHeaders(input, options = {}) {
  return headerPairs(input)
    .map(([name, value]) => [name.toLowerCase(), value])
    .filter(([name]) => options.includeTransport === true || !TRANSPORT_HEADERS.has(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
    ));
}

function headerValue(input, name) {
  const lower = String(name).toLowerCase();
  const found = normalizedHeaders(input, { includeTransport: true }).find(([key]) => key === lower);
  return found ? found[1] : null;
}

function responseBodyText(response) {
  if (!response) return '';
  if (response.body !== undefined && response.body !== null) {
    if (Buffer.isBuffer(response.body)) return response.body.toString('utf8');
    if (response.body instanceof Uint8Array) return Buffer.from(response.body).toString('utf8');
    return String(response.body);
  }
  const chunks = response.bodyStream && Array.isArray(response.bodyStream.chunks)
    ? response.bodyStream.chunks
    : [];
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk)))).toString('utf8');
}

function semanticBody(text, contentType) {
  if (!text) return '';
  if (!String(contentType || '').toLowerCase().includes('json')) return text;
  return canonicalize(JSON.parse(text));
}

function responseObservation(response, requestMethod) {
  const status = Number(response.status);
  const headers = normalizedHeaders(response.headers);
  const text = String(requestMethod).toUpperCase() === 'HEAD' ? '' : responseBodyText(response);
  const bodyAllowed = String(requestMethod).toUpperCase() !== 'HEAD'
    && status !== 204
    && status !== 205
    && status !== 304
    && !(status >= 100 && status < 200);
  assert.equal(bodyAllowed || text === '', true, `bodyless response ${status} must not expose bytes`);
  return Object.freeze({
    status,
    headers: Object.freeze(headers.map((entry) => Object.freeze(entry))),
    bodyClass: response.bodyClass || 'structured',
    bodyless: !bodyAllowed,
    body: semanticBody(text, headerValue(headers, 'content-type'))
  });
}

function requestObservation(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  const headers = normalizedHeaders(input.headers);
  const text = input.body === undefined || input.body === null
    ? ''
    : (typeof input.body === 'string' ? input.body : JSON.stringify(input.body));
  return Object.freeze({
    method,
    path: String(input.path || '/'),
    headers: Object.freeze(headers.map((entry) => Object.freeze(entry))),
    body: semanticBody(text, headerValue(headers, 'content-type'))
  });
}

function routeObservation(plan, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const segments = String(request.path || '/').split('?')[0].split('/').filter(Boolean);
  for (const route of plan.routing.routes) {
    if (route.method !== method) continue;
    const pattern = route.pathPattern.segments;
    if (pattern.length !== segments.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (pattern[index].kind === 'literal' && pattern[index].value !== segments[index]) {
        matched = false;
        break;
      }
      if (pattern[index].kind === 'param') params[pattern[index].name] = decodeURIComponent(segments[index]);
    }
    if (matched) {
      return Object.freeze({
        stableId: route.stableId,
        method: route.method,
        path: route.path,
        params: Object.freeze(params)
      });
    }
  }
  throw new Error(`No canonical route matched ${method} ${request.path}.`);
}

function canonicalBodyDigest(body) {
  if (body === null || body === undefined) return null;
  const text = typeof body === 'string'
    ? body
    : body instanceof Uint8Array || Buffer.isBuffer(body)
      ? Buffer.from(body).toString('utf8')
      : String(body);
  try {
    return sha256(JSON.stringify(canonicalize(JSON.parse(text))));
  } catch (_) {
    return null;
  }
}

function transportObservation(url, init = {}) {
  const headers = new Headers(init.headers);
  const body = init.body === undefined || init.body === null ? null : init.body;
  const bodyBuffer = body === null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(String(body));
  return Object.freeze({
    url: String(url),
    method: String(init.method || 'GET').toUpperCase(),
    authenticated: headers.has('authorization'),
    contentType: headers.get('content-type'),
    headerNames: Object.freeze([...headers.keys()].map((name) => name.toLowerCase()).sort()),
    hasBody: body !== null,
    bodyBytes: bodyBuffer.byteLength,
    bodySha256: body === null ? null : sha256(bodyBuffer),
    bodySemanticSha256: canonicalBodyDigest(body)
  });
}

function normalizeTransport(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    url: String(entry.url),
    method: String(entry.method || 'GET').toUpperCase(),
    authenticated: entry.authenticated === true,
    contentType: entry.contentType || null,
    headerNames: Object.freeze([...(entry.headerNames || [])].map(String).sort()),
    hasBody: entry.hasBody === true,
    bodySemanticSha256: entry.bodySemanticSha256 || null
  })));
}

function fixtureResponse(spec = {}, method = 'GET') {
  const headers = new Headers(spec.headers);
  let body = null;
  if (Object.prototype.hasOwnProperty.call(spec, 'value')) {
    body = JSON.stringify(spec.value);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  } else if (Object.prototype.hasOwnProperty.call(spec, 'json')) {
    body = JSON.stringify(spec.json);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  } else if (Object.prototype.hasOwnProperty.call(spec, 'text')) {
    body = String(spec.text);
  } else if (Object.prototype.hasOwnProperty.call(spec, 'body')) {
    body = spec.body;
  }
  const status = Number(spec.status || 200);
  const bodyAllowed = String(method).toUpperCase() !== 'HEAD'
    && status !== 204
    && status !== 205
    && status !== 304
    && !(status >= 100 && status < 200);
  return new Response(bodyAllowed ? body : null, { status, headers });
}

function rawFixtureFetch(testCase, capture) {
  return async function capturedFixtureFetch(url, init = {}) {
    capture.push(transportObservation(url, init));
    const method = String(init.method || 'GET').toUpperCase();
    const fixtures = testCase.fetches || {};
    const spec = fixtures[`${method} ${String(url)}`] || fixtures[String(url)];
    if (!spec) throw new Error(`No four-mode fixture for ${method} ${String(url)}.`);
    return fixtureResponse(spec, method);
  };
}

function capturedFetch(implementation, capture) {
  return async function captured(url, init = {}) {
    capture.push(transportObservation(url, init));
    return implementation(url, init);
  };
}

function normalizeJsonTrace(events) {
  return Object.freeze(events.map((entry) => Object.freeze({
    version: entry.version,
    kind: entry.kind,
    boundary: entry.boundary,
    schemaId: entry.schemaId,
    responseCaseId: entry.responseCaseId,
    operationId: entry.operationId,
    status: entry.status,
    contentType: entry.contentType,
    headers: Object.freeze(normalizedHeaders(entry.headers).map((pair) => Object.freeze(pair))),
    bodyOwnership: entry.bodyOwnership,
    valueDigest: entry.valueDigest,
    errorCode: entry.errorCode,
    errorPath: entry.errorPath
  })));
}

function normalizeLogs(events) {
  const config = events.find((entry) => entry.type === 'logging-config');
  assert.ok(config, 'every mode must emit one logging configuration observation');
  return Object.freeze({
    reporting: Object.freeze({
      name: config.reporting.name,
      level: config.reporting.level
    }),
    enabledLevels: Object.freeze(['error', 'warn']),
    disabledLevels: Object.freeze(['info', 'debug']),
    emitted: Object.freeze(events.filter((entry) => entry.type === 'log').map((entry) => Object.freeze({
      name: entry.name,
      level: entry.level,
      message: entry.message
    })))
  });
}

function javascriptEffects(events) {
  const groupKeys = new Map();
  const groups = [];
  for (const entry of events.filter((item) => item.type === 'parallel-dispatched')) {
    groups.push(Object.freeze([...entry.group.keys]));
    entry.group.effectIds.forEach((id, index) => groupKeys.set(id, entry.group.keys[index]));
  }
  const effects = events
    .filter((entry) => entry.type === 'effect-dispatched' && entry.effect.providerKind !== 'runtime')
    .map((entry) => Object.freeze({
      kind: entry.effect.kind,
      groupKey: groupKeys.get(entry.effect.id) || null
    }));
  const failures = events
    .filter((entry) => entry.type === 'effect-settled'
      && entry.effect.providerKind !== 'runtime'
      && entry.status !== 'fulfilled')
    .map((entry) => entry.effect.kind);
  return Object.freeze({
    effects: Object.freeze(effects),
    groups: Object.freeze(groups),
    failures: Object.freeze(failures)
  });
}

function nativeEffects(trace) {
  const effects = trace.filter((entry) => entry.type === 'native-effect-start').map((entry) => Object.freeze({
    kind: entry.kind,
    groupKey: entry.payload && entry.payload.groupKey || null
  }));
  const keys = effects.map((entry) => entry.groupKey).filter(Boolean);
  return Object.freeze({
    effects: Object.freeze(effects),
    groups: Object.freeze(keys.length > 0 ? [Object.freeze(keys)] : []),
    failures: Object.freeze([])
  });
}

function assertExpectation(testCase, response) {
  assert.equal(response.status, testCase.expect.status, `${testCase.name}: status`);
  if (testCase.expect.json !== undefined) {
    assert.deepEqual(response.body, canonicalize(testCase.expect.json), `${testCase.name}: semantic JSON response`);
  }
  if (testCase.expect.text !== undefined) {
    assert.equal(response.body, testCase.expect.text, `${testCase.name}: text response`);
  }
  for (const [name, value] of testCase.expect.headers || []) {
    assert.equal(headerValue(response.headers, name), value, `${testCase.name}: response header ${name}`);
  }
}

function comparableObservation(testCase, route, result) {
  const response = responseObservation(result.response, testCase.request.method);
  assertExpectation(testCase, response);
  return Object.freeze({
    version: FOUR_MODE_OBSERVATION_VERSION,
    caseId: testCase.name,
    request: requestObservation(testCase.request),
    route,
    response,
    effects: result.effects,
    fetches: normalizeTransport(result.fetches),
    jsonTrace: normalizeJsonTrace(result.jsonTrace),
    logging: normalizeLogs(result.logs),
    cleanup: Object.freeze({
      completed: true,
      aborted: result.cleanup.aborted === true,
      closed: result.cleanup.closed === true
    })
  });
}

async function executeNativeMode(mode, compiled, testCase, route, bindings) {
  const fetches = [];
  const fetchImplementation = rawFixtureFetch(testCase, fetches);
  const adapter = mode.provider === 'node'
    ? nodeProvider.createNodeProviderAdapter({ fetchImplementation, grip: testCase.grip })
    : fastlyProvider.createFastlyProviderAdapter({ bindings, fetchImplementation });
  const execution = await nativeHost.executeCanonicalNativeModule(compiled, {
    providerAdapter: adapter,
    executionId: `6d:${mode.id}:${testCase.name}`,
    request: testCase.request,
    fetchImplementation,
    config: testCase.config,
    secrets: testCase.secrets,
    kv: testCase.kv,
    grip: testCase.grip,
    reporting: 'warn',
    strict: true
  });
  assert.equal(execution.provider, mode.provider);
  assert.equal(execution.status, 'completed');
  assert.equal(execution.continuations.every((entry) => entry.state === 'completed'), true);
  const logs = execution.trace.filter((entry) => entry.type === 'logging-config' || entry.type === 'log');
  const jsonTrace = execution.trace.filter((entry) => typeof entry.kind === 'string' && entry.kind.startsWith('json.'));
  return Object.freeze({
    identity: Object.freeze({ provider: mode.provider, target: mode.target, targetId: mode.targetId }),
    comparable: comparableObservation(testCase, route, {
      response: execution.response,
      effects: nativeEffects(execution.trace),
      fetches,
      jsonTrace,
      logs,
      cleanup: { aborted: false, closed: true }
    }),
    raw: execution
  });
}

async function executeJavascriptMode(mode, prepared, schemaCodecs, testCase, route, bindings) {
  const logs = [];
  const jsonTrace = [];
  const effectEvents = [];
  let effectSummary;
  let execution;
  let fetches;
  const callbacks = {
    schemaCodecs,
    strict: true,
    reporting: 'warn',
    onLogObservation(event) { logs.push(event); },
    onJsonTrace(event) { jsonTrace.push(event); },
    onEffectObservation(event) { effectEvents.push(event); },
    onEffectSummary(summary) { effectSummary = summary; }
  };
  if (mode.provider === 'node') {
    fetches = [];
    const fixture = createNodeJavascriptFixtureFetch(testCase.fetches || {});
    const rawFixture = createNodeJavascriptFixtureFetch(testCase.fetches || {}, undefined, { rawResponse: true });
    execution = await nodeJavascript.executeNodeJavascriptTestCase(prepared.loaded.application, testCase, {
      ...callbacks,
      fetchImplementation: capturedFetch(fixture, fetches),
      gripFetchImplementation: capturedFetch(rawFixture, fetches)
    });
  } else {
    execution = await fastlyJavascript.executeFastlyJavascriptTestCase(prepared.loaded.application, testCase, {
      ...callbacks,
      bindings,
      networkFetch: false
    });
    fetches = execution.provider.fetches;
  }
  assert.ok(effectSummary);
  assert.equal(effectSummary.closed, true);
  assert.equal(effectSummary.aborted, false);
  return Object.freeze({
    identity: Object.freeze({ provider: mode.provider, target: mode.target, targetId: mode.targetId }),
    comparable: comparableObservation(testCase, route, {
      response: execution.response,
      effects: javascriptEffects(effectEvents),
      fetches,
      jsonTrace,
      logs,
      cleanup: effectSummary
    }),
    raw: execution
  });
}

function assertComparable(expected, actual, label) {
  if (stableStringify(expected) === stableStringify(actual)) return;
  const error = new Error(`${label} diverged from the normalized four-mode observation.`);
  error.code = DRIFT_DIAGNOSTIC_CODE;
  error.detail = Object.freeze({
    expectedSha256: sha256(stableStringify(expected)),
    actualSha256: sha256(stableStringify(actual))
  });
  throw error;
}

function negativeControls(baseline) {
  const controls = [
    ['response-status', (value) => { value.response.status = 599; }],
    ['semantic-body', (value) => { value.response.body = { drift: true }; }],
    ['effect-kind', (value) => { value.effects.effects[0].kind = 'drift.effect'; }],
    ['logging-level', (value) => { value.logging.emitted[0].name = 'debug'; }],
    ['route-params', (value) => { value.route.params.id = 'drift'; }]
  ];
  let rejected = 0;
  for (const [id, mutate] of controls) {
    const changed = clone(baseline);
    mutate(changed);
    assert.throws(
      () => assertComparable(baseline, changed, id),
      (error) => error && error.code === DRIFT_DIAGNOSTIC_CODE
    );
    rejected += 1;
  }
  return Object.freeze({ total: controls.length, rejected });
}

function targetFixtureOptions(testCase, bindings, extra = {}) {
  const fixtures = {};
  for (const [key, spec] of Object.entries(testCase.fetches || {})) {
    const separator = key.indexOf(' ');
    const method = separator > 0 ? key.slice(0, separator) : 'GET';
    const url = separator > 0 ? key.slice(separator + 1) : key;
    const backend = bindings.backends && bindings.backends[new URL(url).origin];
    fixtures[`${backend} ${method} ${url}`] = {
      ...spec,
      ...(Object.prototype.hasOwnProperty.call(spec, 'value') ? { json: spec.value } : {})
    };
  }
  const kvStores = {};
  for (const [logical, entries] of Object.entries(testCase.kv || {})) {
    const physical = bindings.kv && bindings.kv[logical];
    if (physical) kvStores[physical] = entries;
  }
  return {
    request: testCase.request,
    configStore: bindings.configStore,
    config: testCase.config,
    secretStore: bindings.secretStore,
    secrets: testCase.secrets,
    kvStores,
    fixtures,
    ...extra
  };
}

function targetResponseObservation(response, requestMethod, bodyClass) {
  return responseObservation({ ...response, bodyClass }, requestMethod);
}

function targetLogLevels(result) {
  return result.logs.map((entry) => {
    const matched = /^\[pulse:(error|warn|info|debug)\]/.exec(entry.message);
    return matched && matched[1];
  }).filter(Boolean);
}

function assertTargetExecution(compiled, testCase, portableObservation, bindings) {
  const result = fastlyNativeMock.executeFastlyNativePlatformCapabilities(
    compiled,
    targetFixtureOptions(testCase, bindings)
  );
  const response = targetResponseObservation(
    result.response,
    testCase.request.method,
    portableObservation.response.bodyClass
  );
  assert.deepEqual(response, portableObservation.response, `${testCase.name}: Fastly target response parity`);
  assert.doesNotMatch(JSON.stringify({
    trace: result.trace,
    logs: result.logs,
    requests: result.outboundRequests
  }), /representative-(?:user|grip)-token/);
  if (testCase.name === 'representative-request') {
    assert.deepEqual(targetLogLevels(result), ['error', 'warn']);
    assert.deepEqual(result.outboundRequests.map((entry) => [entry.backend, entry.method, entry.url]), [
      ['api_backend', 'POST', 'https://api.example.test/user'],
      ['publisher_backend', 'POST', 'https://publisher.example.test/publish']
    ]);
    assert.deepEqual(result.outboundRequests.map((entry) => canonicalize(JSON.parse(entry.body))), [
      { name: 'Ada' },
      { channel: 'users', data: { kind: 'updated' } }
    ]);
  }
  if (testCase.name === 'request-contained-redacted-error') {
    assert.deepEqual(targetLogLevels(result), ['error']);
  }
  return result;
}

function assertBuildIntegrity(mode, project, inspection, build, outputRoot) {
  assert.equal(inspection.project.provider, mode.provider);
  assert.equal(inspection.project.target, mode.target);
  assert.equal(inspection.provider.selectedTarget, mode.target);
  assert.equal(inspection.provider.selectedTargetDescriptor.targetId, mode.targetId);
  assert.equal(inspection.provider.selectedTargetDescriptor.automaticFallback, false);
  assert.equal(build.provider, mode.provider);
  assert.equal(build.manifest.configuredTarget, mode.target);
  assert.equal(build.manifest.targetDescriptor.targetId, mode.targetId);
  assert.equal(build.manifest.targetDescriptor.automaticFallback, false);
  assert.equal(build.outDir, outputRoot);

  const files = generatedFiles(outputRoot);
  const wasmFiles = files.filter((file) => /\.wasm$/i.test(file));
  const javascriptSourcePackages = files.filter((file) => /javascript-source-package\.json$/i.test(file));
  if (mode.target === 'javascript') {
    assert.equal(inspection.provider.realization.javascriptRuntime, true);
    assert.equal(inspection.provider.realization.nativeWasm, false);
    assert.equal(build.manifest.providerTarget.javascriptRuntime, true);
    assert.equal(build.manifest.providerTarget.nativeWasm, false);
    assert.equal(wasmFiles.length, 0, `${mode.id} must not contain a Native Wasm artifact`);
    assert.equal(javascriptSourcePackages.length, 1, `${mode.id} must contain one explicit JavaScript source-package manifest`);
    assert.equal(build.targetSupport.project.status, 'eligible');
    assert.equal(build.targetSupport.project.packages.some((entry) => entry.status === 'blocked'), false);
  } else {
    assert.equal(inspection.provider.realization.nativeWasm, true);
    assert.equal(inspection.provider.realization.javascriptRuntime, false);
    assert.equal(build.manifest.providerTarget.nativeWasm, true);
    assert.equal(build.manifest.providerTarget.javascriptRuntime, false);
    assert.ok(wasmFiles.length > 0, `${mode.id} must contain a Native Wasm artifact`);
    assert.equal(javascriptSourcePackages.length, 0, `${mode.id} must not masquerade as a JavaScript source package`);
  }
  return Object.freeze({
    mode: mode.id,
    provider: mode.provider,
    target: mode.target,
    targetId: mode.targetId,
    automaticFallback: false,
    artifactFiles: files.length,
    wasmFiles: wasmFiles.length,
    javascriptSourcePackages: javascriptSourcePackages.length,
    inspectMatchesBuild: true,
    packageEligibility: mode.target === 'javascript' ? build.targetSupport.project.status : 'native-plan-eligible'
  });
}

async function buildFourModeProof() {
  const projects = Object.fromEntries(MODES.map((mode) => [
    mode.id,
    resolveProject({ cwd: fixtureRoot, profile: mode.id })
  ]));
  const nativePrepared = compileNativeProjectInMemory(projects['node-native']);
  const schemaCodecs = createCanonicalSchemaCodecs(nativePrepared.compiled.schema.bundle.registry);
  const nodePrepared = prepareJavascriptApplication(projects['node-javascript'], {
    allowedPackages,
    schemaBundle: nativePrepared.compiled.schema.bundle
  });
  const fastlyPrepared = prepareJavascriptApplication(projects['fastly-javascript'], {
    allowedPackages,
    localEmulation: true,
    schemaBundle: nativePrepared.compiled.schema.bundle
  });
  assert.ok(nodePrepared.loaded);
  assert.ok(fastlyPrepared.loaded);

  const bindings = projects['fastly-native'].providerConfig.bindings;
  const cases = [];
  let comparisons = 0;
  for (const testCase of projects['node-native'].tests) {
    const route = routeObservation(nativePrepared.plan, testCase.request);
    const observations = {};
    observations['node-native'] = await executeNativeMode(
      MODES[0],
      nativePrepared.native,
      testCase,
      route,
      bindings
    );
    observations['node-javascript'] = await executeJavascriptMode(
      MODES[1],
      nodePrepared,
      schemaCodecs,
      testCase,
      route,
      bindings
    );
    observations['fastly-native'] = await executeNativeMode(
      MODES[2],
      nativePrepared.native,
      testCase,
      route,
      bindings
    );
    observations['fastly-javascript'] = await executeJavascriptMode(
      MODES[3],
      fastlyPrepared,
      schemaCodecs,
      testCase,
      route,
      bindings
    );
    const baseline = observations['node-native'].comparable;
    for (const mode of MODES.slice(1)) {
      assertComparable(baseline, observations[mode.id].comparable, `${testCase.name}:${mode.id}`);
      comparisons += 1;
    }
    assert.doesNotMatch(JSON.stringify(observations), /representative-(?:user|grip)-token/);
    cases.push(Object.freeze({
      id: testCase.name,
      matched: true,
      route: route.stableId,
      observationSha256: sha256(stableStringify(baseline)),
      identities: Object.freeze(MODES.map((mode) => observations[mode.id].identity)),
      comparable: baseline
    }));
  }

  assert.deepEqual(nativePrepared.plan.logging && {
    reporting: nativePrepared.plan.logging.reporting.name,
    enabledStatements: nativePrepared.plan.logging.enabledStatements,
    prunedStatements: nativePrepared.plan.logging.prunedStatements
  }, {
    reporting: 'warn',
    enabledStatements: 3,
    prunedStatements: 2
  });

  const targetCompiled = fastlyNative.compileFastlyNativePlatformCapabilitiesPlan(
    nativePrepared.plan,
    { cwd: repoRoot, bindings }
  );
  assert.equal(targetCompiled.inspection.importModules.includes('fastly_log'), true);
  assert.equal(targetCompiled.inspection.importModules.some((name) => /pulse_host|wasi|js/i.test(name)), false);
  const targetExecutions = [];
  for (const [index, testCase] of projects['node-native'].tests.entries()) {
    const result = assertTargetExecution(targetCompiled, testCase, cases[index].comparable, bindings);
    targetExecutions.push(Object.freeze({
      id: testCase.name,
      status: result.response.status,
      outboundRequests: result.outboundRequests.length,
      logs: result.logs.length
    }));
  }
  const loggingFailure = fastlyNativeMock.executeFastlyNativePlatformCapabilities(
    targetCompiled,
    targetFixtureOptions(projects['node-native'].tests[0], bindings, { logWriteFailure: true })
  );
  assert.equal(loggingFailure.response.status, 201, 'Fastly logging failure must not fail the request');

  const incompleteBindings = clone(bindings);
  delete incompleteBindings.kv.public;
  assert.throws(
    () => fastlyNative.compileFastlyNativePlatformCapabilitiesPlan(
      nativePrepared.plan,
      { cwd: repoRoot, bindings: incompleteBindings }
    ),
    (error) => error && error.code === 'PULSE_FASTLY_NATIVE_KV_STORE_MISSING',
    'statically known unavailable Assets binding must fail before deployment'
  );

  const buildEvidence = [];
  try {
    for (const mode of MODES) {
      const project = projects[mode.id];
      const outputRoot = path.resolve(project.root, project.outDir);
      removeGeneratedRoot(outputRoot);
      const inspection = inspectProject(project);
      const build = buildProject(project, { outDir: outputRoot, allowedPackages });
      buildEvidence.push(assertBuildIntegrity(mode, project, inspection, build, outputRoot));
    }
  } finally {
    for (const mode of MODES) removeGeneratedRoot(path.resolve(projects[mode.id].root, projects[mode.id].outDir));
  }

  const negative = negativeControls(cases[0].comparable);
  const proofCore = Object.freeze({
    version: FOUR_MODE_PROOF_VERSION,
    contract: FOUR_MODE_CONFORMANCE_VERSION,
    fixture: path.relative(repoRoot, fixtureRoot).replace(/\\/g, '/'),
    intentionalDifferences: INTENTIONAL_DIFFERENCES,
    summary: Object.freeze({
      cases: cases.length,
      modes: MODES.length,
      executions: cases.length * MODES.length,
      comparisons,
      mismatches: 0,
      fastlyTargetExecutions: targetExecutions.length
    }),
    logging: Object.freeze({
      reporting: 'warn',
      enabledLevels: Object.freeze(['error', 'warn']),
      disabledLevels: Object.freeze(['info', 'debug']),
      nativeEnabledStatements: nativePrepared.plan.logging.enabledStatements,
      nativePrunedStatements: nativePrepared.plan.logging.prunedStatements,
      providerFailureContained: true
    }),
    targetIntegrity: Object.freeze({
      automaticFallback: false,
      configuredTargetMatchesArtifact: true,
      inspectMatchesExecution: true,
      javascriptContainsNativeArtifact: false,
      nativeMasqueradesAsJavascript: false,
      unavailableBehaviorFailsBeforeDeployment: true,
      supportedClaimsWithEvidence: MODES.length,
      fastlyNativeImportModules: targetCompiled.inspection.importModules,
      fastlyNativeWasmSha256: targetCompiled.inspection.sha256,
      providerReality: false,
      providerRealityOwner: 'external-fastly-validation'
    }),
    builds: Object.freeze(buildEvidence),
    targetExecutions: Object.freeze(targetExecutions),
    negativeControls: negative,
    cases: Object.freeze(cases.map((entry) => Object.freeze({
      id: entry.id,
      matched: entry.matched,
      route: entry.route,
      observationSha256: entry.observationSha256,
      identities: entry.identities
    })))
  });
  return Object.freeze({
    ...proofCore,
    proofSha256: sha256(stableStringify(proofCore))
  });
}

module.exports = Object.freeze({
  FOUR_MODE_CONFORMANCE_VERSION,
  FOUR_MODE_OBSERVATION_VERSION,
  FOUR_MODE_PROOF_VERSION,
  DRIFT_DIAGNOSTIC_CODE,
  INTENTIONAL_DIFFERENCES,
  MODES,
  assertComparable,
  buildFourModeProof
});
