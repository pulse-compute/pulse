#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const {
  compileCanonicalSource,
  loadCanonicalModule
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  buildCanonicalSchemaBundle,
  createCanonicalSchemaCodecs
} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const nodeJavascriptHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const {
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
} = require('../../../packages/provider-node/src/javascript/support.js');

const SCHEMA_CODEC_PROOF_VERSION = 'pulse.schema-codecs-proof.v1';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-registry');
const schemaFile = path.join(fixtureRoot, 'src/pulse/schemas/index.ts');
const buildScratch = path.join(fixtureRoot, '.pulse-schema-codec-build');
const TRACE_SECRET = 'schema-trace-secret';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
    codecs: createCanonicalSchemaCodecs(bundle.registry)
  });
}

function validInput(name = TRACE_SECRET) {
  return {
    name,
    attempts: 2,
    quota: 3,
    role: 'admin',
    address: {
      city: 'Denver',
      postalCode: '80202',
      ignoredNested: 'removed'
    },
    tags: ['alpha', 'beta'],
    referralCode: null,
    ignoredRoot: 'removed'
  };
}

function handlerSource() {
  return `
export default async function handler(ctx) {
  const input = await ctx.req.json('app.createInput')
  const repeated = await ctx.req.json('app.createInput')
  const user = await ctx.fetch('https://origin.test/users', {
    method: 'POST',
    json: {
      id: '7',
      name: input.name,
      score: 98.5,
      active: input === repeated,
      ignored: 'removed'
    },
    schema: 'app.user'
  }).json('app.user')
  return ctx.json({
    id: user.id,
    name: user.name,
    score: user.score,
    active: user.active,
    ignored: 'removed'
  }, 'user.created')
}
`;
}

function requestOptions() {
  return Object.freeze({
    request: Object.freeze({
      method: 'POST',
      path: '/users',
      headers: Object.freeze([
        Object.freeze(['authorization', `Bearer ${TRACE_SECRET}`]),
        Object.freeze(['content-type', 'application/json'])
      ]),
      body: JSON.stringify(validInput())
    }),
    secrets: Object.freeze({ TRACE_TOKEN: TRACE_SECRET })
  });
}

function originSnapshot() {
  return Object.freeze({
    status: 200,
    headers: Object.freeze([Object.freeze(['content-type', 'application/json'])]),
    body: JSON.stringify({
      id: '8',
      name: 'Upstream',
      score: 42.5,
      active: true,
      ignored: 'removed'
    })
  });
}

function schemaTrace(trace) {
  return trace.filter((entry) => String(entry && entry.kind || '').startsWith('json.'));
}

function parityTrace(trace) {
  return trace.map((entry) => Object.freeze({
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
  }));
}

function errorIdentity(error) {
  const detail = error && (error.detail || error.details) || {};
  return Object.freeze({
    name: error && error.name,
    code: error && error.code,
    path: detail.path || null,
    expected: detail.expected || null,
    actualKind: detail.actualKind || null
  });
}

function expectCode(callback, code) {
  let actual;
  try {
    callback();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual, `expected ${code}`);
  assert.equal(actual.code, code);
  return errorIdentity(actual);
}

async function expectRejectedCode(callback, code) {
  let actual;
  try {
    await callback();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual, `expected rejected ${code}`);
  assert.equal(actual.code, code);
  return actual;
}

function compileRequestMatrix(bundle) {
  const source = (argument) => `
export default async function handler(ctx) {
  await ctx.req.json(${argument})
  return ctx.text('ok')
}
`;
  const compile = (strict, argument) => compileCanonicalSource(source(argument), {
    fileName: `matrix-${strict ? 'strict' : 'non-strict'}-${argument || 'missing'}.ts`,
    schemaBundle: bundle,
    strict,
    requireAsync: true
  });
  const diagnostic = (strict, argument, code) => {
    let error;
    try { compile(strict, argument); } catch (value) { error = value; }
    assert.ok(error, `expected compile diagnostic ${code}`);
    assert.ok(error.diagnostics.some((entry) => entry.code === code));
    return code;
  };
  const strictKnown = compile(true, "'app.user'");
  const nonStrictMissing = compile(false, '');
  const nonStrictKnown = compile(false, "'app.user'");
  return Object.freeze({
    strictMissing: diagnostic(true, '', 'PULSE_SCHEMA_REQUIRED'),
    strictKnown: strictKnown.metadata.schemaReferences[0].id,
    strictUnknown: diagnostic(true, "'app.unknown'", 'PULSE_CANONICAL_SCHEMA_MISSING'),
    nonStrictMissing: nonStrictMissing.metadata.json.genericRequestCount === 1 ? 'generic-json' : 'failed',
    nonStrictKnown: nonStrictKnown.metadata.schemaReferences[0].id,
    nonStrictUnknown: diagnostic(false, "'app.unknown'", 'PULSE_CANONICAL_SCHEMA_MISSING')
  });
}

function codecSemantics(registryIr, bundle, codecs) {
  const decoded = codecs.decode('app.createInput', validInput('Ada'), 'proof');
  assert.deepEqual(decoded, {
    name: 'Ada',
    attempts: 2,
    quota: 3,
    role: 'admin',
    address: { city: 'Denver', postalCode: '80202' },
    tags: ['alpha', 'beta'],
    referralCode: null
  });
  assert.ok(Object.isFrozen(decoded));
  assert.ok(Object.isFrozen(decoded.address));
  assert.ok(Object.isFrozen(decoded.tags));

  const encoded = codecs.encodeJsonText('app.createInput', validInput('Ada'), 'proof');
  assert.equal(
    encoded,
    '{"name":"Ada","attempts":2,"quota":3,"role":"admin","address":{"city":"Denver","postalCode":"80202"},"tags":["alpha","beta"],"referralCode":null}'
  );
  const second = buildCanonicalSchemaBundle(registryIr, {
    contentTypePolicy: bundle.registry.contentTypePolicy,
    maxBytes: bundle.registry.maxBytes
  });
  assert.equal(second.codecTableHash, bundle.codecTableHash);
  assert.equal(second.moduleSource, bundle.moduleSource);

  const missing = validInput('Ada');
  delete missing.address.postalCode;
  const wrongEnum = validInput('Ada');
  wrongEnum.role = 'owner';
  const nonFinite = validInput('Ada');
  nonFinite.quota = Infinity;
  const nonFiniteF64 = { id: '1', name: 'Ada', score: Infinity, active: true };
  const collisionBundle = buildCanonicalSchemaBundle([
    { id: 'app.a-b', type: 'Dash', fields: [{ name: 'dash', type: 'string' }] },
    { id: 'app.a_b', type: 'Underscore', fields: [{ name: 'underscore', type: 'string' }] }
  ]);
  const collisionCodecs = createCanonicalSchemaCodecs(collisionBundle.registry);
  assert.deepEqual(collisionCodecs.decode('app.a-b', { dash: 'left' }), { dash: 'left' });
  assert.deepEqual(collisionCodecs.decode('app.a_b', { underscore: 'right' }), { underscore: 'right' });
  assert.notEqual(collisionBundle.registry.codecs[0].javascript.symbol, collisionBundle.registry.codecs[1].javascript.symbol);
  assert.notEqual(collisionBundle.registry.codecs[0].native.symbol, collisionBundle.registry.codecs[1].native.symbol);

  return Object.freeze({
    encoded,
    unknownFields: 'removed-recursively',
    required: expectCode(() => codecs.decode('app.createInput', missing, 'proof'), 'PULSE_SCHEMA_DECODE'),
    enum: expectCode(() => codecs.decode('app.createInput', wrongEnum, 'proof'), 'PULSE_SCHEMA_DECODE'),
    finite: expectCode(() => codecs.encode('app.createInput', nonFinite, 'proof'), 'PULSE_SCHEMA_ENCODE'),
    finiteF64: expectCode(() => codecs.encode('app.user', nonFiniteF64, 'proof'), 'PULSE_SCHEMA_ENCODE'),
    malformed: expectCode(() => codecs.decodeJsonText('app.createInput', '{', 'proof'), 'PULSE_SCHEMA_JSON_MALFORMED'),
    unknownId: expectCode(() => codecs.decode('app.unknown', {}, 'proof'), 'PULSE_SCHEMA_REFERENCE'),
    symbolCollisionSafety: Object.freeze({
      ids: Object.freeze(collisionCodecs.ids),
      javascriptSymbols: Object.freeze(collisionBundle.registry.codecs.map((entry) => entry.javascript.symbol)),
      nativeSymbols: Object.freeze(collisionBundle.registry.codecs.map((entry) => entry.native.symbol))
    }),
    codecTableHash: bundle.codecTableHash,
    sourceHash: bundle.sourceHash
  });
}

function traceSink(codecs, target, events) {
  return Object.freeze({
    push() {},
    json(input, value) {
      events.push(codecs.createTraceEvent({
        ...input,
        target,
        ...(value === undefined ? {} : { semanticValue: value })
      }));
    }
  });
}

function boundaryPolicyAndCache(registryIr, codecs) {
  const decodeCalls = new Map();
  const counted = Object.freeze({
    ...codecs,
    decodeJsonText(schemaId, text, source) {
      const key = String(schemaId);
      decodeCalls.set(key, (decodeCalls.get(key) || 0) + 1);
      return codecs.decodeJsonText(key, text, source);
    }
  });
  const unionBody = JSON.stringify({
    id: '9',
    name: 'Both',
    score: 12.5,
    active: true,
    code: 'both',
    message: 'compatible snapshot',
    ignored: true
  });
  const requestTrace = [];
  const requestContext = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: counted,
    target: 'javascript',
    provider: 'node',
    request: {
      method: 'POST',
      path: '/cache',
      headers: [['content-type', 'application/json']],
      body: unionBody
    }
  }, traceSink(codecs, 'javascript', requestTrace));
  const requestUser = requestContext.ctx.req.json('app.user');
  const requestUserAgain = requestContext.ctx.req.json('app.user');
  const requestError = requestContext.ctx.req.json('app.error');
  assert.equal(requestUserAgain, requestUser);
  assert.deepEqual(requestUser, { id: '9', name: 'Both', score: 12.5, active: true });
  assert.deepEqual(requestError, { code: 'both', message: 'compatible snapshot' });

  const fetchTrace = [];
  const fetched = canonicalHost.createStructuredFetchResponse({
    status: 200,
    headers: [['content-type', 'application/json']],
    body: unionBody
  }, counted, {
    strict: true,
    trace: traceSink(codecs, 'javascript', fetchTrace),
    target: 'javascript',
    provider: 'node',
    effectId: 'fetch-1'
  });
  const fetchedUser = fetched.json('app.user');
  const fetchedUserAgain = fetched.json('app.user');
  const fetchedError = fetched.json('app.error');
  assert.equal(fetchedUserAgain, fetchedUser);
  assert.deepEqual(fetchedError, { code: 'both', message: 'compatible snapshot' });

  const responseTrace = [];
  const responseContext = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: codecs,
    target: 'javascript',
    provider: 'node',
    request: { method: 'GET', path: '/' }
  }, traceSink(codecs, 'javascript', responseTrace));
  const mutable = { id: '1', name: 'Before', score: 1.5, active: true, ignored: 'removed' };
  const created = responseContext.ctx.json(mutable, 'user.created');
  mutable.name = 'After';
  const success = responseContext.ctx.json({ id: '1', name: 'Before', score: 1.5, active: true }, 'user.success');
  const failure = responseContext.ctx.json({ code: 'denied', message: 'No access' }, 'user.failure');
  const createdResponse = canonicalHost.finalResponse(created);
  const successResponse = canonicalHost.finalResponse(success);
  const failureResponse = canonicalHost.finalResponse(failure);
  assert.equal(createdResponse.status, 201);
  assert.equal(successResponse.status, 200);
  assert.equal(failureResponse.status, 200);
  assert.equal(createdResponse.body, '{"id":"1","name":"Before","score":1.5,"active":true}');
  assert.equal(failureResponse.body, '{"code":"denied","message":"No access"}');
  assert.deepEqual(
    responseTrace.map((entry) => [entry.responseCaseId, entry.status]),
    [['user.created', 201], ['user.success', 200], ['user.failure', 200]]
  );

  const fetchValue = { id: '2', name: 'Before', score: 2.5, active: true, ignored: 'removed' };
  const normalizedFetch = canonicalHost.normalizedInit({
    method: 'POST',
    json: fetchValue,
    schema: 'app.user'
  }, codecs, {
    strict: true,
    trace: traceSink(codecs, 'javascript', []),
    target: 'javascript',
    provider: 'node',
    effectId: 'fetch-2'
  });
  fetchValue.name = 'After';
  assert.equal(normalizedFetch.body, '{"id":"2","name":"Before","score":2.5,"active":true}');

  const strictMissingContext = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: codecs,
    request: {
      method: 'POST',
      path: '/',
      headers: [['content-type', 'application/json']],
      body: '{}'
    }
  }, { push() {} });
  const nonStrictContext = canonicalHost.createCanonicalContext({
    strict: false,
    schemaCodecs: codecs,
    request: {
      method: 'POST',
      path: '/',
      headers: [['content-type', 'application/json']],
      body: '{"generic":true}'
    }
  }, { push() {} });
  assert.deepEqual(nonStrictContext.ctx.req.json(), { generic: true });

  const wrongContentType = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: codecs,
    request: {
      method: 'POST',
      path: '/',
      headers: [['content-type', 'text/plain']],
      body: unionBody
    }
  }, { push() {} });

  const smallBundle = buildCanonicalSchemaBundle(registryIr, {
    contentTypePolicy: 'require-json',
    maxBytes: 8
  });
  const smallCodecs = createCanonicalSchemaCodecs(smallBundle.registry);
  const tooLarge = canonicalHost.createCanonicalContext({
    strict: true,
    schemaCodecs: smallCodecs,
    request: {
      method: 'POST',
      path: '/',
      headers: [['content-type', 'application/json']],
      body: unionBody
    }
  }, { push() {} });

  return Object.freeze({
    requestSameSchemaIdentity: requestUser === requestUserAgain,
    fetchedSameSchemaIdentity: fetchedUser === fetchedUserAgain,
    differentSchemasIndependent: requestUser !== requestError && fetchedUser !== fetchedError,
    decodeCalls: Object.freeze(Object.fromEntries([...decodeCalls].sort())),
    requestBodyStats: requestContext.requestBody.stats(),
    fetchedBodyStats: fetched.bodyStats(),
    responseCases: Object.freeze(responseTrace.map((entry) => Object.freeze({
      id: entry.responseCaseId,
      status: entry.status,
      schemaId: entry.schemaId
    }))),
    encodeAtCallTime: createdResponse.body,
    outboundEncodeAtCallTime: normalizedFetch.body,
    strictMissing: expectCode(() => strictMissingContext.ctx.req.json(), 'PULSE_SCHEMA_REQUIRED'),
    nonStrictMissing: 'generic-json',
    nonStrictUnknown: expectCode(
      () => nonStrictContext.ctx.req.json('app.unknown'),
      'PULSE_SCHEMA_REFERENCE'
    ),
    invalidIds: Object.freeze({
      response: expectCode(
        () => responseContext.ctx.json({}, { schema: undefined }),
        'PULSE_SCHEMA_ID_INVALID'
      ),
      fetch: expectCode(
        () => canonicalHost.normalizedInit({
          method: 'POST',
          json: {},
          schema: undefined
        }, codecs, { strict: false }),
        'PULSE_SCHEMA_ID_INVALID'
      )
    }),
    contentType: expectCode(
      () => wrongContentType.ctx.req.json('app.user'),
      'PULSE_SCHEMA_CONTENT_TYPE'
    ),
    maxBytes: expectCode(
      () => tooLarge.ctx.req.json('app.user'),
      'PULSE_BODY_TOO_LARGE'
    ),
    bodyJsonConflict: expectCode(
      () => canonicalHost.normalizedInit({
        method: 'POST',
        body: '{}',
        json: {},
        schema: 'app.user'
      }, codecs, { strict: true }),
      'PULSE_FETCH_BODY_AMBIGUOUS'
    ),
    schemaWithoutJson: expectCode(
      () => canonicalHost.normalizedInit({
        method: 'POST',
        body: '{}',
        schema: 'app.user'
      }, codecs, { strict: true }),
      'PULSE_FETCH_SCHEMA_WITHOUT_JSON'
    )
  });
}

async function javascriptExecution(codecs) {
  let capturedFetch;
  const trace = [];
  const application = async (ctx) => {
    const input = await ctx.req.json('app.createInput');
    const repeated = await ctx.req.json('app.createInput');
    const user = await ctx.fetch('https://origin.test/users', {
      method: 'POST',
      json: {
        id: '7',
        name: input.name,
        score: 98.5,
        active: input === repeated,
        ignored: 'removed'
      },
      schema: 'app.user'
    }).json('app.user');
    return ctx.json({
      id: user.id,
      name: user.name,
      score: user.score,
      active: user.active,
      ignored: 'removed'
    }, 'user.created');
  };
  const request = new Request('https://app.test/users', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TRACE_SECRET}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(validInput())
  });
  const response = await nodeJavascriptHost.executeNodeJavascriptApplication(application, request, {
    schemaCodecs: codecs,
    strict: true,
    provider: 'node',
    secrets: { TRACE_TOKEN: TRACE_SECRET },
    onJsonTrace(event) { trace.push(event); },
    async fetchImplementation(url, init) {
      capturedFetch = Object.freeze({
        url: String(url),
        method: init.method,
        headers: Object.freeze([...init.headers].map((entry) => Object.freeze([...entry]))),
        body: init.body
      });
      const snapshot = originSnapshot();
      return new Response(snapshot.body, {
        status: snapshot.status,
        headers: snapshot.headers
      });
    }
  });
  const body = await response.text();
  assert.equal(response.status, 201);
  assert.equal(body, '{"id":"8","name":"Upstream","score":42.5,"active":true}');
  assert.equal(capturedFetch.body, `{"id":"7","name":"${TRACE_SECRET}","score":98.5,"active":true}`);
  assert.deepEqual(trace.map((entry) => entry.kind), [
    'json.decode.request',
    'json.encode.fetch',
    'json.decode.fetch',
    'json.encode.response'
  ]);
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(TRACE_SECRET));
  return Object.freeze({
    status: response.status,
    body,
    fetch: capturedFetch,
    trace: Object.freeze(trace)
  });
}

async function compiledJavascriptExecution(bundle) {
  const compiled = compileCanonicalSource(handlerSource(), {
    fileName: 'schema-codecs.ts',
    schemaBundle: bundle,
    strict: true,
    requireAsync: true
  });
  const program = loadCanonicalModule(compiled);
  let capturedFetch;
  const host = canonicalHost.createCanonicalHostRuntime({
    providerAdapter: {
      id: 'node',
      async dispatchEffect(effect) {
        capturedFetch = effect;
        return originSnapshot();
      }
    }
  });
  const execution = await host.execute(program, requestOptions());
  assert.equal(execution.response.status, 201);
  assert.equal(execution.response.body, '{"id":"8","name":"Upstream","score":42.5,"active":true}');
  assert.doesNotMatch(JSON.stringify(execution.trace), new RegExp(TRACE_SECRET));
  return Object.freeze({
    compiled,
    status: execution.response.status,
    body: execution.response.body,
    fetch: capturedFetch,
    trace: Object.freeze(schemaTrace(execution.trace))
  });
}

async function nativeExecution(compiledProgram) {
  const plan = buildCanonicalNativePlan(compiledProgram);
  const compiled = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  let capturedFetch;
  const execution = await nativeHost.executeCanonicalNativeModule(compiled, {
    ...requestOptions(),
    providerAdapter: {
      id: 'node',
      async dispatchEffect(effect) {
        capturedFetch = effect;
        return originSnapshot();
      }
    }
  });
  assert.equal(execution.response.status, 201);
  assert.equal(execution.response.body, '{"id":"8","name":"Upstream","score":42.5,"active":true}');
  assert.doesNotMatch(JSON.stringify(execution.trace), new RegExp(TRACE_SECRET));
  assert.match(compiled.source, /@json/);
  assert.match(compiled.source, /JSON\.parse</);
  assert.equal(compiled.manifest.jsonAs.version, '1.5.0');
  assert.equal(compiled.manifest.jsonAs.transform, true);
  assert.equal(compiled.manifest.jsonAs.strict, true);
  assert.equal(compiled.manifest.policy.providerNeutral, true);
  assert.equal(compiled.manifest.policy.javascriptRuntime, false);
  assert.equal(compiled.plan.schemas.codecTableHash, compiledProgram.schemaBundle.codecTableHash);

  const malformedError = await expectRejectedCode(
    () => nativeHost.executeCanonicalNativeModule(compiled, {
      request: {
        method: 'POST',
        path: '/users',
        headers: [['content-type', 'application/json']],
        body: '{'
      },
      providerAdapter: {
        id: 'node',
        async dispatchEffect() { throw new Error('must not dispatch'); }
      }
    }),
    'PULSE_SCHEMA_JSON_MALFORMED'
  );
  const malformedTrace = schemaTrace(malformedError.execution && malformedError.execution.trace || []);
  assert.equal(malformedTrace.length, 1);
  assert.equal(malformedTrace[0].kind, 'json.decode.error');
  assert.equal(malformedTrace[0].errorCode, 'PULSE_SCHEMA_JSON_MALFORMED');
  assert.equal(malformedTrace[0].valueDigest, null);
  const malformed = Object.freeze({
    ...errorIdentity(malformedError),
    traceKind: malformedTrace[0].kind,
    traceValueDigest: malformedTrace[0].valueDigest
  });

  return Object.freeze({
    plan,
    compiled,
    status: execution.response.status,
    body: execution.response.body,
    fetch: capturedFetch,
    trace: Object.freeze(schemaTrace(execution.trace)),
    malformed
  });
}

function sourcePackaging() {
  fs.rmSync(buildScratch, { recursive: true, force: true });
  try {
    const project = resolveProject({
      cwd: fixtureRoot,
      profile: 'javascript',
      env: {}
    });
    const build = buildProject(project, { outDir: buildScratch });
    const packageJson = JSON.parse(fs.readFileSync(build.files.package, 'utf8'));
    const codecSource = fs.readFileSync(build.files.schemaCodecs, 'utf8');
    const registry = JSON.parse(fs.readFileSync(build.files.schemaRegistry, 'utf8'));
    assert.equal(build.manifest.buildMode, 'javascript-source-package');
    assert.equal(build.manifest.schemas.fullCodecRealization, true);
    assert.equal(build.sourcePackage.schemas.fullCodecRealization, true);
    assert.ok(packageJson.dependencies['@pulse-compute/wasm-contracts']);
    assert.match(codecSource, /createTraceEvent/);
    assert.deepEqual(registry.schemas.map((entry) => entry.id), [
      'app.createInput',
      'app.user',
      'app.error'
    ]);
    return Object.freeze({
      mode: build.manifest.buildMode,
      schemaIds: build.manifest.schemas.ids,
      responseCaseIds: build.manifest.schemas.responseCaseIds,
      registryHash: build.manifest.schemas.registryHash,
      codecTableHash: build.manifest.schemas.codecTableHash,
      fullCodecRealization: build.manifest.schemas.fullCodecRealization,
      codecDependency: packageJson.dependencies['@pulse-compute/wasm-contracts'],
      emitted: Object.freeze([
        path.basename(build.files.schemaRegistry),
        path.basename(build.files.schemaCodecs)
      ])
    });
  } finally {
    fs.rmSync(buildScratch, { recursive: true, force: true });
  }
}

async function buildSchemaCodecProof() {
  const { extracted, bundle, codecs } = schemaFixture();
  const semantics = codecSemantics(extracted.registry, bundle, codecs);
  const matrix = compileRequestMatrix(bundle);
  const boundaries = boundaryPolicyAndCache(extracted.registry, codecs);
  const javascript = await javascriptExecution(codecs);
  const generatedJavascript = await compiledJavascriptExecution(bundle);
  const native = await nativeExecution(generatedJavascript.compiled);

  assert.deepEqual(generatedJavascript.body, native.body);
  assert.deepEqual(generatedJavascript.fetch.init, native.fetch.init);
  assert.deepEqual(parityTrace(generatedJavascript.trace), parityTrace(native.trace));
  assert.deepEqual(parityTrace(javascript.trace), parityTrace(native.trace));
  assert.deepEqual(
    javascript.trace.map((entry) => entry.valueDigest),
    native.trace.map((entry) => entry.valueDigest)
  );

  const packaging = sourcePackaging();
  assert.equal(NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.generalAvailable, true);
  assert.equal(NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.fullTargetSupportReady, true);
  assert.equal(NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.automaticFallback, false);

  const proof = {
    version: SCHEMA_CODEC_PROOF_VERSION,
    authority: Object.freeze({
      registry: 'pulse.schema',
      registryVersion: extracted.registry.version,
      registryHash: extracted.registry.registryHash,
      schemaIds: bundle.schemaIds,
      responseCaseIds: bundle.responseCaseIds,
      codecTableHash: bundle.codecTableHash,
      fullCodecRealization: bundle.fullCodecRealization,
      automaticFallback: false
    }),
    contract: Object.freeze({
      subset: 'required-object; scalar; nested-object; array; string-enum; nullable',
      inputUnknownFields: 'drop',
      outputFields: 'declared-only-declaration-order',
      finiteNumbers: true,
      cache: 'per-schema-id-over-one-owned-body-snapshot',
      jsonOwnership: 'pulse-semantic-encode-at-call-time',
      bodyOwnership: 'caller-exact-payload',
      parity: 'semantic-not-byte',
      trace: 'redaction-safe-sha256-digest',
      nativeBackend: 'json-as@1.5.0'
    }),
    semantics,
    strictMatrix: matrix,
    boundaries,
    javascript: Object.freeze({
      status: javascript.status,
      body: javascript.body,
      fetchBodySha256: sha256(javascript.fetch.body),
      traceKinds: Object.freeze(javascript.trace.map((entry) => entry.kind)),
      valueDigests: Object.freeze(javascript.trace.map((entry) => entry.valueDigest))
    }),
    native: Object.freeze({
      status: native.status,
      body: native.body,
      fetchBodySha256: sha256(native.fetch.init.body),
      wasmBytes: native.compiled.wasm.length,
      wasmSha256: native.compiled.inspection.sha256,
      sourceSha256: native.compiled.sourceHash,
      jsonAs: native.compiled.manifest.jsonAs,
      schemaExports: native.compiled.manifest.exports
        .map((entry) => typeof entry === 'string' ? entry : entry.name)
        .filter((entry) => String(entry).startsWith('pulse_schema_')),
      traceKinds: Object.freeze(native.trace.map((entry) => entry.kind)),
      valueDigests: Object.freeze(native.trace.map((entry) => entry.valueDigest)),
      malformed: native.malformed
    }),
    parity: Object.freeze({
      responseSemanticEqual: JSON.stringify(JSON.parse(javascript.body)) === JSON.stringify(JSON.parse(native.body)),
      outboundSemanticEqual: JSON.stringify(JSON.parse(javascript.fetch.body)) === JSON.stringify(JSON.parse(native.fetch.init.body)),
      tracesEqualIgnoringTargetIdentity: true,
      fourBoundaries: Object.freeze(javascript.trace.map((entry) => entry.boundary))
    }),
    packaging,
    availability: Object.freeze({
      generalAvailable: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.generalAvailable,
      fullTargetSupportReady: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.fullTargetSupportReady,
      automaticFallback: NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability.automaticFallback
    })
  };
  return Object.freeze({
    ...proof,
    proofSha256: sha256(JSON.stringify(proof))
  });
}

module.exports = Object.freeze({
  SCHEMA_CODEC_PROOF_VERSION,
  buildSchemaCodecProof,
  fixtureRoot,
  parityTrace,
  schemaFile
});
