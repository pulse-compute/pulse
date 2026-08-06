#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  buildCanonicalSchemaBundle,
  createCanonicalSchemaCodecs,
  stableStringify
} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  semanticValueDigest
} = require('../../packages/contracts/src/schema-json/semantic-trace.js');
const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require('../../../packages/provider-node/src/javascript/support.js');

const NODE_CROSS_TARGET_CORPUS_VERSION = 'pulse.node-cross-target-conformance-corpus.v1';
const NODE_CROSS_TARGET_OBSERVATION_VERSION = 'pulse.node-cross-target-observation.v1';
const NODE_CROSS_TARGET_PROOF_VERSION = 'pulse.node-cross-target-conformance-proof.v1';
const DRIFT_DIAGNOSTIC_CODE = 'PULSEWASM_NODE_CROSS_TARGET_DRIFT';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-registry');
const schemaFile = path.join(fixtureRoot, 'src/pulse/schemas/index.ts');
const corpusFile = path.join(repoRoot, 'wasm/test/fixtures/conformance/schema-conformance-corpus.json');
const buildScratch = path.join(fixtureRoot, '.pulse-cross-target-conformance-build');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = clone(child);
  return output;
}

function materialize(value) {
  if (Array.isArray(value)) return value.map(materialize);
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, '$pulseNumber')) {
    const special = String(value.$pulseNumber);
    if (special === 'NaN') return Number.NaN;
    if (special === 'Infinity') return Number.POSITIVE_INFINITY;
    if (special === '-Infinity') return Number.NEGATIVE_INFINITY;
    throw new TypeError(`Unsupported conformance special number ${special}.`);
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = materialize(child);
  return output;
}

function pointerSegments(pointer) {
  if (pointer === '' || pointer === '/') return pointer === '' ? [] : [''];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new TypeError(`Conformance pointer must be an RFC 6901 path; received ${String(pointer)}.`);
  }
  return pointer.slice(1).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function setPointer(root, pointer, value) {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) throw new TypeError('Conformance pointer replacement cannot target the root.');
  let target = root;
  for (const segment of segments.slice(0, -1)) {
    if (!target || typeof target !== 'object') throw new TypeError(`Conformance pointer ${pointer} traverses a non-object.`);
    target = target[segment];
  }
  target[segments[segments.length - 1]] = materialize(clone(value));
  return root;
}

function deletePointer(root, pointer) {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) throw new TypeError('Conformance pointer deletion cannot target the root.');
  let target = root;
  for (const segment of segments.slice(0, -1)) {
    if (!target || typeof target !== 'object') throw new TypeError(`Conformance pointer ${pointer} traverses a non-object.`);
    target = target[segment];
  }
  if (Array.isArray(target)) target.splice(Number(segments[segments.length - 1]), 1);
  else delete target[segments[segments.length - 1]];
  return root;
}

function valueFromSpec(spec, corpus) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('Conformance value specifications must be objects.');
  }
  let value;
  if (Object.prototype.hasOwnProperty.call(spec, 'value')) value = materialize(clone(spec.value));
  else if (spec.fixture) {
    if (!Object.prototype.hasOwnProperty.call(corpus.fixtures, spec.fixture)) {
      throw new TypeError(`Unknown conformance fixture ${String(spec.fixture)}.`);
    }
    value = materialize(clone(corpus.fixtures[spec.fixture]));
  } else value = {};
  for (const [pointer, replacement] of Object.entries(spec.set || {})) setPointer(value, pointer, replacement);
  for (const pointer of spec.remove || []) deletePointer(value, pointer);
  return value;
}

function readCorpus() {
  const source = fs.readFileSync(corpusFile);
  const corpus = JSON.parse(source);
  assert.equal(corpus.version, NODE_CROSS_TARGET_CORPUS_VERSION);
  assert.equal(corpus.authority.registry, 'pulse.schema');
  assert.equal(corpus.authority.parity, 'semantic-not-byte');
  assert.equal(corpus.authority.automaticFallback, false);
  assert.ok(Array.isArray(corpus.cases) && corpus.cases.length > 0);
  assert.equal(new Set(corpus.cases.map((entry) => entry.id)).size, corpus.cases.length);
  assert.ok(corpus.cases.every((entry) => ['portable-semantic', 'caller-owned-exact-text'].includes(entry.classification)));
  assert.ok(Array.isArray(corpus.negativeControls) && corpus.negativeControls.length > 0);
  return Object.freeze({ corpus, sha256: sha256(source) });
}

function schemaFixture() {
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: fixtureRoot });
  const bundle = buildCanonicalSchemaBundle(extracted.registry, {
    contentTypePolicy: 'require-json',
    maxBytes: 32_768
  });
  return Object.freeze({
    extracted,
    bundle,
    javascriptCodecs: createCanonicalSchemaCodecs(bundle.registry)
  });
}

function compileNativeHarness(bundle) {
  const program = compileCanonicalSource(
    "export default async function handler(ctx) { return ctx.text('ok') }\n",
    {
      fileName: 'node-cross-target-schema-harness.ts',
      schemaBundle: bundle,
      strict: true,
      requireAsync: true
    }
  );
  const plan = buildCanonicalNativePlan(program);
  const first = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  const second = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  assert.equal(first.source, second.source, 'Native generated source must be deterministic');
  assert.deepEqual(first.wasm, second.wasm, 'Native Wasm bytes must be deterministic');
  assert.equal(first.inspection.sha256, second.inspection.sha256);
  assert.equal(first.sourceHash, second.sourceHash);
  const controller = nativeHost.instantiateCanonicalNativeModule(first, {
    providerAdapter: {
      id: 'node',
      async dispatchEffect() {
        throw new Error('The schema conformance codec harness does not dispatch effects.');
      }
    }
  });
  return Object.freeze({ program, plan, first, second, controller });
}

function safeValue(value, sensitiveValues) {
  return canonicalHost.redactRuntimeValue(value, sensitiveValues);
}

function traceSink(codecs, target, events, sensitiveValues) {
  return Object.freeze({
    push() {},
    json(input, value) {
      const semanticValue = value === undefined ? undefined : safeValue(value, sensitiveValues);
      const headers = input.headers === undefined ? undefined : safeValue(input.headers, sensitiveValues);
      events.push(codecs.createTraceEvent({
        ...input,
        ...(headers === undefined ? {} : { headers }),
        ...(semanticValue === undefined ? {} : { semanticValue }),
        target,
        provider: 'node'
      }));
    }
  });
}

function normalizedTrace(events) {
  return Object.freeze(events.map((entry) => Object.freeze({
    version: entry.version,
    kind: entry.kind,
    boundary: entry.boundary,
    schemaId: entry.schemaId,
    responseCaseId: entry.responseCaseId,
    operationId: entry.operationId,
    status: entry.status,
    contentType: entry.contentType,
    headers: entry.headers,
    bodyOwnership: entry.bodyOwnership,
    valueDigest: entry.valueDigest,
    errorCode: entry.errorCode,
    errorPath: entry.errorPath,
    expected: entry.expected,
    actualKind: entry.actualKind,
    provider: entry.provider,
    effectId: entry.effectId,
    groupId: entry.groupId
  })));
}

function errorIdentity(error) {
  const detail = error && (error.detail || error.details) || {};
  return Object.freeze({
    name: error && error.name || 'Error',
    code: error && error.code || null,
    path: detail.path || detail.field || null,
    expected: detail.expected || null,
    actualKind: detail.actualKind || detail.actual || null
  });
}

function semanticDigest(value, sensitiveValues) {
  return semanticValueDigest(safeValue(value, sensitiveValues));
}

function caseSchemaIds(entry) {
  if (Array.isArray(entry.schemaIds)) return Object.freeze(entry.schemaIds.map(String));
  return Object.freeze(entry.schemaId ? [String(entry.schemaId)] : []);
}

function createObservation(target, entry, fields, actual = {}) {
  const comparable = Object.freeze({
    version: NODE_CROSS_TARGET_OBSERVATION_VERSION,
    caseId: entry.id,
    classification: entry.classification,
    boundary: entry.boundary,
    schemaIds: caseSchemaIds(entry),
    ...fields
  });
  return Object.freeze({
    target,
    comparable,
    observationSha256: sha256(stableStringify({ target, comparable })),
    actual
  });
}

function requestObservation(target, codecs, entry, corpus) {
  const events = [];
  const sensitiveValues = new Set(entry.sensitiveValues || []);
  const sink = traceSink(codecs, target, events, sensitiveValues);
  const body = entry.rawBody === undefined
    ? JSON.stringify(valueFromSpec(entry.input, corpus))
    : String(entry.rawBody);
  const context = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: codecs,
    target,
    provider: 'node',
    request: {
      method: entry.requestMethod || 'POST',
      path: `/5c/${entry.id}`,
      headers: entry.headers || [['content-type', 'application/json']],
      body
    }
  }, sink);
  try {
    const values = entry.schemaIds.map((schemaId) => context.ctx.req.json(schemaId));
    const sameSchemas = new Set(entry.schemaIds).size === 1;
    const semantic = values.length === 1 ? values[0] : (sameSchemas ? values[0] : values);
    const stats = context.requestBody.stats();
    return createObservation(target, entry, {
      outcome: 'value',
      semanticDigest: semanticDigest(semantic, sensitiveValues),
      identity: Object.freeze({
        same: values.length > 1 && sameSchemas ? values.every((value) => value === values[0]) : null,
        different: values.length > 1 && !sameSchemas ? values.every((value, index) => index === 0 || value !== values[0]) : null
      }),
      cache: Object.freeze({ bodyCopies: stats.bodyCopies, textTransforms: stats.textTransforms }),
      trace: normalizedTrace(events)
    }, { semantic, values, error: null });
  } catch (error) {
    const stats = context.requestBody.stats();
    return createObservation(target, entry, {
      outcome: 'error',
      error: errorIdentity(error),
      cache: Object.freeze({ bodyCopies: stats.bodyCopies, textTransforms: stats.textTransforms }),
      trace: normalizedTrace(events)
    }, { semantic: undefined, values: [], error });
  }
}

function fetchedResponseObservation(target, codecs, entry, corpus) {
  const events = [];
  const sensitiveValues = new Set(entry.sensitiveValues || []);
  const sink = traceSink(codecs, target, events, sensitiveValues);
  const body = entry.rawBody === undefined
    ? JSON.stringify(valueFromSpec(entry.input, corpus))
    : String(entry.rawBody);
  const response = canonicalHost.createStructuredFetchResponse({
    status: entry.status || 200,
    headers: entry.headers || [['content-type', 'application/json']],
    body
  }, codecs, {
    strict: true,
    trace: sink,
    target,
    provider: 'node',
    effectId: entry.id
  });
  try {
    const values = entry.schemaIds.map((schemaId) => response.json(schemaId));
    const sameSchemas = new Set(entry.schemaIds).size === 1;
    const semantic = values.length === 1 ? values[0] : (sameSchemas ? values[0] : values);
    const stats = response.bodyStats();
    return createObservation(target, entry, {
      outcome: 'value',
      status: response.status,
      semanticDigest: semanticDigest(semantic, sensitiveValues),
      identity: Object.freeze({
        same: values.length > 1 && sameSchemas ? values.every((value) => value === values[0]) : null,
        different: values.length > 1 && !sameSchemas ? values.every((value, index) => index === 0 || value !== values[0]) : null
      }),
      cache: Object.freeze({ bodyCopies: stats.bodyCopies, textTransforms: stats.textTransforms }),
      trace: normalizedTrace(events)
    }, { semantic, values, error: null });
  } catch (error) {
    const stats = response.bodyStats();
    return createObservation(target, entry, {
      outcome: 'error',
      status: response.status,
      error: errorIdentity(error),
      cache: Object.freeze({ bodyCopies: stats.bodyCopies, textTransforms: stats.textTransforms }),
      trace: normalizedTrace(events)
    }, { semantic: undefined, values: [], error });
  }
}

function responseObservation(target, codecs, entry, corpus) {
  const events = [];
  const sensitiveValues = new Set(entry.sensitiveValues || []);
  const sink = traceSink(codecs, target, events, sensitiveValues);
  const context = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: codecs,
    target,
    provider: 'node',
    request: {
      method: entry.requestMethod || 'GET',
      path: `/5c/${entry.id}`
    }
  }, sink);
  const input = valueFromSpec(entry.input, corpus);
  try {
    const result = context.ctx.json(input, materialize(clone(entry.descriptor)));
    const response = canonicalHost.finalResponse(result, entry.requestMethod || 'GET');
    const semantic = result.value;
    if (response.body !== '') assert.deepEqual(JSON.parse(response.body), semantic);
    return createObservation(target, entry, {
      outcome: 'value',
      status: response.status,
      headers: Object.freeze(response.headers.map((header) => Object.freeze([...header]))),
      responseCaseId: typeof entry.descriptor === 'string' ? entry.descriptor : null,
      bodyless: response.body === '',
      semanticDigest: semanticDigest(semantic, sensitiveValues),
      trace: normalizedTrace(events)
    }, { semantic, response, error: null });
  } catch (error) {
    return createObservation(target, entry, {
      outcome: 'error',
      responseCaseId: typeof entry.descriptor === 'string' ? entry.descriptor : null,
      error: errorIdentity(error),
      trace: normalizedTrace(events)
    }, { semantic: undefined, response: undefined, error });
  }
}

function fetchRequestObservation(target, codecs, entry, corpus) {
  const events = [];
  const sensitiveValues = new Set(entry.sensitiveValues || []);
  const sink = traceSink(codecs, target, events, sensitiveValues);
  const input = valueFromSpec(entry.input, corpus);
  try {
    const normalized = canonicalHost.normalizedInit({
      method: 'POST',
      json: input,
      schema: entry.schemaId
    }, codecs, {
      strict: true,
      trace: sink,
      target,
      provider: 'node',
      effectId: entry.id
    });
    const semantic = JSON.parse(normalized.body);
    return createObservation(target, entry, {
      outcome: 'value',
      bodyMode: normalized.bodyMode,
      semanticDigest: semanticDigest(semantic, sensitiveValues),
      trace: normalizedTrace(events)
    }, { semantic, normalized, error: null });
  } catch (error) {
    return createObservation(target, entry, {
      outcome: 'error',
      error: errorIdentity(error),
      trace: normalizedTrace(events)
    }, { semantic: undefined, normalized: undefined, error });
  }
}

function exactBodyObservation(target, codecs, entry) {
  const events = [];
  const sink = traceSink(codecs, target, events, new Set());
  try {
    const normalized = canonicalHost.normalizedInit({
      method: 'POST',
      body: String(entry.rawBody)
    }, codecs, {
      strict: true,
      trace: sink,
      target,
      provider: 'node',
      effectId: entry.id
    });
    return createObservation(target, entry, {
      outcome: 'value',
      bodyMode: normalized.bodyMode,
      exactBodySha256: sha256(normalized.body),
      trace: normalizedTrace(events)
    }, { exactBody: normalized.body, normalized, error: null });
  } catch (error) {
    return createObservation(target, entry, {
      outcome: 'error',
      error: errorIdentity(error),
      trace: normalizedTrace(events)
    }, { exactBody: undefined, normalized: undefined, error });
  }
}

function runCase(target, codecs, entry, corpus) {
  if (entry.operation === 'request-decode') return requestObservation(target, codecs, entry, corpus);
  if (entry.operation === 'fetch-response-decode') return fetchedResponseObservation(target, codecs, entry, corpus);
  if (entry.operation === 'response-encode') return responseObservation(target, codecs, entry, corpus);
  if (entry.operation === 'fetch-request-encode') return fetchRequestObservation(target, codecs, entry, corpus);
  if (entry.operation === 'exact-body') return exactBodyObservation(target, codecs, entry);
  throw new TypeError(`Unsupported conformance operation ${String(entry.operation)}.`);
}

function assertExpected(entry, observation, corpus) {
  const expected = entry.expected;
  const actual = observation.actual;
  assert.equal(
    observation.comparable.outcome,
    expected.outcome,
    `${entry.id} ${observation.target} outcome: ${stableStringify(observation.comparable)}`
  );
  if (expected.outcome === 'value') {
    if (expected.semantic) {
      const semantic = valueFromSpec(expected.semantic, corpus);
      assert.deepEqual(actual.semantic, semantic, `${entry.id} ${observation.target} semantic result`);
    }
    if (expected.exactBody !== undefined) {
      assert.equal(actual.exactBody, expected.exactBody, `${entry.id} ${observation.target} exact caller body`);
    }
    if (expected.status !== undefined) assert.equal(observation.comparable.status, expected.status, `${entry.id} ${observation.target} status`);
    if (expected.headers !== undefined) assert.deepEqual(observation.comparable.headers, expected.headers, `${entry.id} ${observation.target} headers`);
    if (expected.responseCaseId !== undefined) {
      assert.equal(observation.comparable.responseCaseId, expected.responseCaseId, `${entry.id} ${observation.target} response case`);
    }
    if (expected.bodyless !== undefined) assert.equal(observation.comparable.bodyless, expected.bodyless, `${entry.id} ${observation.target} bodyless`);
    if (expected.sameIdentity !== undefined) assert.equal(observation.comparable.identity.same, expected.sameIdentity, `${entry.id} ${observation.target} same-schema identity`);
    if (expected.differentIdentity !== undefined) assert.equal(observation.comparable.identity.different, expected.differentIdentity, `${entry.id} ${observation.target} different-schema identity`);
    if (expected.bodyCopies !== undefined) assert.equal(observation.comparable.cache.bodyCopies, expected.bodyCopies, `${entry.id} ${observation.target} body copies`);
    if (expected.textTransforms !== undefined) assert.equal(observation.comparable.cache.textTransforms, expected.textTransforms, `${entry.id} ${observation.target} text transforms`);
  } else {
    assert.deepEqual(observation.comparable.error, {
      name: observation.comparable.error.name,
      code: expected.code,
      path: expected.path,
      expected: expected.expected,
      actualKind: expected.actualKind
    }, `${entry.id} ${observation.target} structured error`);
  }
  assert.deepEqual(
    observation.comparable.trace.map((trace) => trace.kind),
    expected.traceKinds,
    `${entry.id} ${observation.target} trace kinds`
  );
  if (expected.secretAbsentFromObservation) {
    for (const secret of entry.sensitiveValues || []) {
      assert.doesNotMatch(JSON.stringify(observation.comparable), new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
  if (expected.authorizationRedacted) {
    const authorization = observation.comparable.trace
      .flatMap((trace) => trace.headers)
      .filter(([name]) => name === 'authorization');
    assert.ok(authorization.length > 0, `${entry.id} must retain the redacted authorization header identity`);
    assert.ok(authorization.every(([, value]) => value === '<redacted>'));
  }
}

function escapePointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function firstDifference(left, right, pointer = '') {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return pointer || '/';
    if (left.length !== right.length) return `${pointer}/length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${pointer}/${index}`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(left, key) || !Object.prototype.hasOwnProperty.call(right, key)) {
        return `${pointer}/${escapePointer(key)}`;
      }
      const difference = firstDifference(left[key], right[key], `${pointer}/${escapePointer(key)}`);
      if (difference) return difference;
    }
    return null;
  }
  return pointer || '/';
}

function mismatchClass(pointer, classification) {
  if (classification === 'caller-owned-exact-text' && pointer.startsWith('/exactBodySha256')) return 'caller-owned-exact-text';
  if (pointer.startsWith('/semanticDigest')) return 'semantic-value';
  if (pointer.startsWith('/error/code')) return 'error-code';
  if (pointer.startsWith('/error/path')) return 'error-path';
  if (pointer.startsWith('/error/expected')) return 'error-expected';
  if (pointer.startsWith('/error/actualKind')) return 'error-actual-kind';
  if (pointer.startsWith('/status')) return 'status';
  if (pointer.startsWith('/bodyless')) return 'bodyless-response';
  if (pointer.startsWith('/trace')) return 'trace';
  if (pointer.startsWith('/cache') || pointer.startsWith('/identity')) return 'projection-cache';
  if (pointer.startsWith('/classification')) return 'classification';
  return 'normalized-observation';
}

class NodeCrossTargetDriftError extends Error {
  constructor(entry, javascriptObservation, nativeObservation, pointer) {
    const mismatch = mismatchClass(pointer, entry.classification);
    super(`Node JavaScript/Native drift in ${entry.id} at ${pointer}: ${mismatch}.`);
    this.name = 'NodeCrossTargetDriftError';
    this.code = DRIFT_DIAGNOSTIC_CODE;
    this.detail = Object.freeze({
      caseId: entry.id,
      boundary: entry.boundary,
      schemaId: entry.schemaId || entry.schemaIds && entry.schemaIds[0] || null,
      schemaIds: caseSchemaIds(entry),
      path: pointer,
      mismatch,
      classification: entry.classification,
      javascriptObservation: javascriptObservation.comparable,
      nativeObservation: nativeObservation.comparable
    });
  }
}

function compareObservations(entry, javascriptObservation, nativeObservation) {
  const pointer = firstDifference(javascriptObservation.comparable, nativeObservation.comparable);
  if (pointer) throw new NodeCrossTargetDriftError(entry, javascriptObservation, nativeObservation, pointer);
  return Object.freeze({
    caseId: entry.id,
    classification: entry.classification,
    matched: true,
    normalizedObservationSha256: sha256(stableStringify(javascriptObservation.comparable))
  });
}

function perturbedObservation(observation, pointer, replacement) {
  const comparable = clone(observation.comparable);
  setPointer(comparable, pointer, replacement);
  return Object.freeze({
    target: observation.target,
    comparable: Object.freeze(comparable),
    observationSha256: sha256(stableStringify({ target: observation.target, comparable })),
    actual: observation.actual
  });
}

function runNegativeControls(corpus, observations) {
  const controls = [];
  for (const control of corpus.negativeControls) {
    const matched = observations.get(control.caseId);
    assert.ok(matched, `Negative control ${control.id} references unknown case ${control.caseId}.`);
    const entry = corpus.cases.find((candidate) => candidate.id === control.caseId);
    const nativeDrift = perturbedObservation(matched.native, control.pointer, control.replacement);
    let diagnostic;
    try {
      compareObservations(entry, matched.javascript, nativeDrift);
    } catch (error) {
      diagnostic = error;
    }
    assert.ok(diagnostic, `Negative control ${control.id} must be rejected.`);
    assert.equal(diagnostic.code, DRIFT_DIAGNOSTIC_CODE);
    assert.equal(diagnostic.detail.caseId, entry.id);
    assert.equal(diagnostic.detail.boundary, entry.boundary);
    assert.equal(diagnostic.detail.path, control.pointer);
    assert.equal(diagnostic.detail.mismatch, control.mismatch);
    assert.doesNotMatch(JSON.stringify(diagnostic.detail), /5c-secret-do-not-leak/);
    controls.push(Object.freeze({
      id: control.id,
      caseId: entry.id,
      rejected: true,
      diagnostic: Object.freeze({
        code: diagnostic.code,
        boundary: diagnostic.detail.boundary,
        schemaId: diagnostic.detail.schemaId,
        path: diagnostic.detail.path,
        mismatch: diagnostic.detail.mismatch,
        classification: diagnostic.detail.classification
      })
    }));
  }
  const first = observations.values().next().value;
  assert.doesNotThrow(() => compareObservations(
    corpus.cases.find((entry) => entry.id === first.javascript.comparable.caseId),
    first.javascript,
    Object.freeze({ ...first.native, target: 'native-distinct-identity' })
  ));
  return Object.freeze({
    controls: Object.freeze(controls),
    targetIdentityIgnored: true
  });
}

function directorySnapshot(root, excluded = new Set()) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (!excluded.has(relative)) files.push(Object.freeze({
          file: relative,
          bytes: fs.statSync(file).size,
          sha256: sha256(fs.readFileSync(file))
        }));
      }
    }
  };
  walk(root);
  return Object.freeze({
    files: Object.freeze(files),
    treeSha256: sha256(stableStringify(files))
  });
}

function sourcePackageIntegrity() {
  fs.rmSync(buildScratch, { recursive: true, force: true });
  try {
    const project = resolveProject({
      cwd: fixtureRoot,
      profile: 'javascript',
      env: {}
    });
    const first = buildProject(project, { outDir: buildScratch });
    const buildManifestName = path.relative(first.outDir, first.files.manifest).replace(/\\/g, '/');
    const firstSnapshot = directorySnapshot(first.outDir, new Set([buildManifestName]));
    const firstBuildManifest = JSON.parse(fs.readFileSync(first.files.manifest, 'utf8'));
    const firstSourceManifest = JSON.parse(fs.readFileSync(first.files.sourcePackage, 'utf8'));
    const second = buildProject(project, { outDir: buildScratch });
    const secondSnapshot = directorySnapshot(second.outDir, new Set([buildManifestName]));
    assert.deepEqual(secondSnapshot, firstSnapshot, 'JavaScript source package files must be deterministic');
    assert.equal(first.buildMode, 'javascript-source-package');
    assert.equal(first.automaticFallback, false);
    assert.equal(firstBuildManifest.configuredTarget, 'javascript');
    assert.equal(firstBuildManifest.providerTarget.target, 'node-javascript');
    assert.equal(firstBuildManifest.providerTarget.sourceOnly, true);
    assert.equal(firstBuildManifest.providerTarget.nativeWasm, false);
    assert.equal(firstBuildManifest.providerTarget.compiledWasmPresent, false);
    assert.equal(firstBuildManifest.providerTarget.javascriptRuntime, true);
    assert.equal(firstSourceManifest.target, 'javascript');
    assert.equal(firstSourceManifest.targetId, 'node-javascript');
    assert.equal(firstSourceManifest.automaticFallback, false);
    assert.equal(firstSnapshot.files.some((entry) => /\.(?:wasm|wat)$/.test(entry.file)), false);
    assert.equal(firstSnapshot.files.some((entry) => /assemblyscript|native-plan/i.test(entry.file)), false);
    return Object.freeze({
      target: firstSourceManifest.target,
      targetId: firstSourceManifest.targetId,
      sourceOnly: firstBuildManifest.providerTarget.sourceOnly,
      javascriptRuntime: firstBuildManifest.providerTarget.javascriptRuntime,
      nativeWasm: firstBuildManifest.providerTarget.nativeWasm,
      compiledWasmPresent: firstBuildManifest.providerTarget.compiledWasmPresent,
      automaticFallback: firstSourceManifest.automaticFallback,
      files: firstSnapshot.files.length,
      treeSha256: firstSnapshot.treeSha256,
      deterministic: true
    });
  } finally {
    fs.rmSync(buildScratch, { recursive: true, force: true });
  }
}

function gateStatus(declaration, id) {
  const gate = declaration.availability.gates
    .find((entry) => entry.id === id);
  assert.ok(gate, `Missing target-support gate ${id}.`);
  return Object.freeze({
    id: gate.id,
    status: gate.status,
    reasonId: gate.reasonId,
    owner: gate.owner
  });
}

async function buildNodeCrossTargetProof(options = {}) {
  const targetSupportDeclaration = options.declaration || NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION;
  const { corpus, sha256: corpusSha256 } = readCorpus();
  const { extracted, bundle, javascriptCodecs } = schemaFixture();
  const secondBundle = buildCanonicalSchemaBundle(extracted.registry, {
    contentTypePolicy: bundle.registry.contentTypePolicy,
    maxBytes: bundle.registry.maxBytes
  });
  assert.equal(secondBundle.moduleSource, bundle.moduleSource);
  assert.equal(secondBundle.codecTableHash, bundle.codecTableHash);
  assert.equal(secondBundle.sourceHash, bundle.sourceHash);

  const native = compileNativeHarness(bundle);
  const targets = Object.freeze({
    javascript: javascriptCodecs,
    native: native.controller.schemaCodecs
  });
  const observationMap = new Map();
  const cases = [];
  for (const entry of corpus.cases) {
    const javascript = runCase('javascript', targets.javascript, entry, corpus);
    const nativeObservation = runCase('native', targets.native, entry, corpus);
    assertExpected(entry, javascript, corpus);
    assertExpected(entry, nativeObservation, corpus);
    const comparison = compareObservations(entry, javascript, nativeObservation);
    observationMap.set(entry.id, Object.freeze({ javascript, native: nativeObservation }));
    cases.push(Object.freeze({
      id: entry.id,
      classification: entry.classification,
      boundary: entry.boundary,
      schemaIds: caseSchemaIds(entry),
      outcome: javascript.comparable.outcome,
      traceKinds: Object.freeze(javascript.comparable.trace.map((trace) => trace.kind)),
      matched: comparison.matched,
      normalizedObservationSha256: comparison.normalizedObservationSha256,
      javascriptObservationSha256: javascript.observationSha256,
      nativeObservationSha256: nativeObservation.observationSha256
    }));
  }

  const negativeControls = runNegativeControls(corpus, observationMap);
  const sourcePackage = sourcePackageIntegrity();
  const portableCases = cases.filter((entry) => entry.classification === 'portable-semantic');
  const callerOwnedCases = cases.filter((entry) => entry.classification === 'caller-owned-exact-text');
  assert.equal(cases.every((entry) => entry.matched), true);
  assert.equal(portableCases.length + callerOwnedCases.length, cases.length);
  assert.equal(gateStatus(targetSupportDeclaration, 'cross-target-conformance').status, 'satisfied');
  assert.equal(gateStatus(targetSupportDeclaration, 'target-integrity').status, 'satisfied');
  assert.equal(targetSupportDeclaration.availability.automaticFallback, false);

  const proof = {
    version: NODE_CROSS_TARGET_PROOF_VERSION,
    authority: Object.freeze({
      registry: 'pulse.schema',
      registryVersion: extracted.registry.version,
      registryHash: extracted.registry.registryHash,
      codecTableHash: bundle.codecTableHash,
      parity: 'semantic-not-byte',
      comparator: NODE_CROSS_TARGET_OBSERVATION_VERSION,
      diagnosticCode: DRIFT_DIAGNOSTIC_CODE,
      automaticFallback: false
    }),
    corpus: Object.freeze({
      artifact: 'wasm/test/fixtures/conformance/schema-conformance-corpus.json',
      version: corpus.version,
      sha256: corpusSha256,
      cases: cases.length,
      portableSemanticCases: portableCases.length,
      callerOwnedExactTextCases: callerOwnedCases.length,
      negativeControls: negativeControls.controls.length,
      boundaries: Object.freeze([...new Set(cases.map((entry) => entry.boundary))].sort())
    }),
    classifications: Object.freeze({
      portableSemanticParity: Object.freeze({
        compared: true,
        cases: portableCases.length,
        fields: Object.freeze([
          'semantic result or structured error',
          'boundary and schema identity',
          'JSON Pointer error path',
          'status, application-owned headers, and bodyless behavior',
          'normalized redaction-safe trace'
        ])
      }),
      targetOwnedImplementationDetail: Object.freeze({
        comparedForIdentity: false,
        classified: true,
        javascript: 'generated CommonJS schema codec table',
        native: 'generated internal json-as classes and Wasm ABI'
      }),
      deterministicPerTargetBytes: Object.freeze({
        comparedWithinTarget: true,
        javascript: Object.freeze({
          codecModuleSha256: sha256(bundle.moduleSource),
          sourceHash: bundle.sourceHash
        }),
        native: Object.freeze({
          sourceSha256: native.first.sourceHash,
          wasmSha256: native.first.inspection.sha256,
          wasmBytes: native.first.wasm.length
        })
      }),
      callerOwnedExactText: Object.freeze({
        semanticNormalization: false,
        exactSha256Compared: true,
        cases: callerOwnedCases.length
      })
    }),
    summary: Object.freeze({
      total: cases.length,
      matched: cases.length,
      mismatches: 0,
      javascriptPassed: cases.length,
      nativePassed: cases.length
    }),
    cases: Object.freeze(cases),
    negativeControls: Object.freeze({
      total: negativeControls.controls.length,
      rejected: negativeControls.controls.length,
      targetIdentityIgnored: negativeControls.targetIdentityIgnored,
      cases: negativeControls.controls
    }),
    determinism: Object.freeze({
      registry: Object.freeze({
        registryHash: extracted.registry.registryHash,
        codecTableHash: bundle.codecTableHash,
        sourceHash: bundle.sourceHash,
        repeatable: true
      }),
      javascript: Object.freeze({
        codecModuleSha256: sha256(bundle.moduleSource),
        repeatable: secondBundle.moduleSource === bundle.moduleSource
      }),
      native: Object.freeze({
        sourceSha256: native.first.sourceHash,
        wasmSha256: native.first.inspection.sha256,
        wasmBytes: native.first.wasm.length,
        sourceRepeatable: native.first.source === native.second.source,
        wasmRepeatable: native.first.wasm.equals(native.second.wasm),
        jsonAs: native.first.manifest.jsonAs
      }),
      sourcePackage
    }),
    targetIntegrity: Object.freeze({
      selectedTarget: sourcePackage.target,
      targetId: sourcePackage.targetId,
      sourceOnly: sourcePackage.sourceOnly,
      javascriptRuntime: sourcePackage.javascriptRuntime,
      nativeWasm: sourcePackage.nativeWasm,
      compiledWasmPresent: sourcePackage.compiledWasmPresent,
      automaticFallback: sourcePackage.automaticFallback,
      conformanceTargetIdentityExplicit: true,
      targetOwnedDifferencesClassified: true
    }),
    availability: Object.freeze({
      crossTargetConformance: gateStatus(targetSupportDeclaration, 'cross-target-conformance'),
      targetIntegrity: gateStatus(targetSupportDeclaration, 'target-integrity'),
      gripReadiness: gateStatus(targetSupportDeclaration, 'grip-readiness'),
      fullTargetSupportReady: targetSupportDeclaration.availability.fullTargetSupportReady,
      generalAvailable: targetSupportDeclaration.availability.generalAvailable,
      automaticFallback: targetSupportDeclaration.availability.automaticFallback
    })
  };
  return Object.freeze({
    ...proof,
    proofSha256: sha256(JSON.stringify(proof))
  });
}

module.exports = Object.freeze({
  DRIFT_DIAGNOSTIC_CODE,
  NodeCrossTargetDriftError,
  NODE_CROSS_TARGET_CORPUS_VERSION,
  NODE_CROSS_TARGET_OBSERVATION_VERSION,
  NODE_CROSS_TARGET_PROOF_VERSION,
  buildNodeCrossTargetProof,
  compareObservations,
  corpusFile,
  fixtureRoot,
  firstDifference,
  runCase,
  schemaFile
});
