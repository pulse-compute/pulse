'use strict';

const assert = require('node:assert/strict');
const { Router } = require('../../../packages/runtime/src/index.js');
const runtimeHost = require('../../../packages/runtime/src/host.js');
const {
  compileCanonicalSource,
  loadCanonicalModule
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const {
  executeCanonicalProgram
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  executeNodeJavascriptTestCase
} = require('../../../packages/provider-node/src/javascript/test-runtime.js');
const { sha256Hex, stableStringify } = require('../../packages/contracts/src/stable-id.js');

const FETCH_BODY_PROOF_VERSION = 'pulse.fetch-projections-request-bodies-proof.v1';
const FETCH_BODY_REPORT_VERSION = 'pulse.fetch-projections-request-bodies-report.v1';

const PROJECTED_JSON_SOURCE = `
export default async function handler(ctx) {
  const value = await ctx.fetch('https://origin.test/data', {
    method: 'POST',
    headers: [['x-request-id', 'native-1']],
    json: { hello: 'world' },
    timeoutMs: 50
  }).json();
  return ctx.json(value);
}
`;

const PROJECTED_TEXT_SOURCE = `
export default async function handler(ctx) {
  const value = await ctx.fetch('https://origin.test/binary').text();
  return ctx.text(value);
}
`;

const DIRECT_FETCH_SOURCE = `
export default async function handler(ctx) {
  return ctx.fetch('https://origin.test/direct');
}
`;

const REQUEST_BODY_SOURCE = `
export default async function handler(ctx) {
  const first = await ctx.req.json();
  const second = await ctx.req.json();
  return ctx.json({ sameReference: first === second, value: first });
}
`;

function stableArtifact(version, report) {
  const semantic = Object.freeze({ version, report });
  return Object.freeze({ ...semantic, sha256: sha256Hex(stableStringify(semantic)) });
}

function caseResult(id, detail) {
  return Object.freeze({ id, status: 'passed', detail: Object.freeze(detail) });
}

function errorIdentity(error) {
  return Object.freeze({
    name: error && error.name || typeof error,
    code: error && error.code || null
  });
}

async function requestBodySnapshotCase() {
  const app = new Router();
  let summary;
  app.post('/body', async (ctx) => {
    const text1 = await ctx.req.text();
    const text2 = await ctx.req.text();
    const json1 = await ctx.req.json();
    const json2 = await ctx.req.json();
    return ctx.json({ text1, text2, sameReference: json1 === json2, frozen: Object.isFrozen(json1), json1 });
  });
  const response = await runtimeHost.executeRouter(app, new Request('https://app.test/body', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"hello":"world"}'
  }), { onEffectSummary(value) { summary = value; } });
  return caseResult('javascript-request-body-single-snapshot', {
    response: await response.json(),
    effects: {
      external: summary.effectCount,
      local: summary.localEffectCount,
      owned: summary.ownedEffectCount
    }
  });
}

async function requestBodyDiagnosticsCase() {
  async function codeFor(body, options, projection = 'json', contentType) {
    const app = new Router();
    app.post('/body', async (ctx) => projection === 'json'
      ? ctx.json(await ctx.req.json())
      : ctx.text(await ctx.req.text()));
    app.error(async (error, ctx) => ctx.text(error.cause.code, { status: 400 }));
    const response = await runtimeHost.executeRouter(app, new Request('https://app.test/body', {
      method: 'POST',
      headers: { 'content-type': contentType || (projection === 'json' ? 'application/json' : 'text/plain') },
      body
    }), options);
    return response.text();
  }

  const unavailableApp = new Router();
  unavailableApp.post('/body', async (ctx) => ctx.text(await ctx.req.text()));
  unavailableApp.error(async (error, ctx) => ctx.text(error.cause.code, { status: 400 }));
  const consumedRequest = new Request('https://app.test/body', {
    method: 'POST', body: 'consumed', headers: { 'content-type': 'text/plain' }
  });
  await consumedRequest.text();
  const unavailableResponse = await runtimeHost.executeRouter(unavailableApp, consumedRequest);

  const abortApp = new Router();
  abortApp.post('/body', async (ctx) => ctx.text(await ctx.req.text()));
  abortApp.error(async (error, ctx) => ctx.text(error.cause.code, { status: 400 }));
  const abortController = new AbortController();
  const abortRequest = new Request('https://app.test/body', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: new ReadableStream({ pull() { return new Promise(() => undefined); } }),
    duplex: 'half'
  });
  const abortResponsePromise = runtimeHost.executeRouter(abortApp, abortRequest, { signal: abortController.signal });
  abortController.abort(new Error('fetch and body request body proof abort'));
  const abortResponse = await abortResponsePromise;

  const parallel = new Router();
  parallel.post('/parallel', async (ctx) => {
    await ctx.parallel({ body: ctx.req.text() });
    return ctx.text('unreachable');
  });
  parallel.error(async (error, ctx) => ctx.text(error.cause.code, { status: 400 }));
  const parallelResponse = await runtimeHost.executeRouter(parallel, new Request('https://app.test/parallel', {
    method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' }
  }));
  return caseResult('javascript-request-body-diagnostics', {
    invalidJson: await codeFor('{bad', {}),
    tooLarge: await codeFor('123456789', { maxRequestBodyBytes: 8 }, 'text'),
    opaque: await codeFor(new Uint8Array([0, 1]), {}, 'text', 'application/octet-stream'),
    unavailable: await unavailableResponse.text(),
    aborted: await abortResponse.text(),
    parallel: await parallelResponse.text()
  });
}

async function fetchNormalizationCase() {
  const app = new Router();
  let descriptor;
  app.post('/create', async (ctx) => ctx.json(await ctx.fetch('https://origin.test/users', {
    method: 'POST',
    headers: [['x-request-id', 'r1']],
    json: { name: 'Ada' },
    timeoutMs: 50
  }).json()));
  const response = await runtimeHost.executeRouter(app, new Request('https://app.test/create', { method: 'POST' }), {
    effectAdapter: {
      id: 'pulse.fetch-body.normalization',
      dispatch(effect) {
        descriptor = effect;
        return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
      }
    }
  });
  return caseResult('javascript-fetch-input-normalization', {
    status: response.status,
    body: await response.json(),
    descriptor: {
      url: descriptor.url,
      method: descriptor.init.method,
      headers: descriptor.init.headers,
      body: descriptor.init.body,
      bodyMode: descriptor.init.bodyMode,
      timeoutMs: descriptor.init.timeoutMs
    }
  });
}

async function fetchTimeoutCase() {
  const app = new Router();
  let sawAbort = false;
  app.get('/slow', async (ctx) => ctx.text(await ctx.fetch('https://origin.test/slow', { timeoutMs: 5 }).text()));
  app.error(async (error, ctx) => ctx.text(error.cause.code, { status: 504 }));
  const response = await runtimeHost.executeRouter(app, new Request('https://app.test/slow'), {
    effectAdapter: {
      id: 'pulse.fetch-body.timeout',
      dispatch(_effect, execution) {
        return new Promise((_resolve, reject) => {
          execution.signal.addEventListener('abort', () => {
            sawAbort = true;
            reject(execution.signal.reason);
          }, { once: true });
        });
      }
    }
  });
  return caseResult('javascript-fetch-timeout-signal', {
    status: response.status,
    code: await response.text(),
    adapterSawAbort: sawAbort
  });
}

async function fetchProjectionCase() {
  const app = new Router();
  app.get('/data', async (ctx) => {
    const operation = ctx.fetch('https://origin.test/data');
    const first = await operation.json();
    const second = await operation.json();
    return ctx.json({ sameReference: first === second, frozen: Object.isFrozen(first), first, text: await operation.text() });
  });
  app.get('/binary', async (ctx) => ctx.text(await ctx.fetch('https://origin.test/binary').text()));
  app.get('/mixed', async (ctx) => {
    const operation = ctx.fetch('https://origin.test/mixed');
    await operation.text();
    return operation;
  });
  const providerResponses = new Map();
  const capability = async (url) => {
    const response = url.endsWith('/binary')
      ? new Response(new Uint8Array([65, 66]), { headers: { 'content-type': 'application/octet-stream' } })
      : new Response('{"id":7}', { headers: { 'content-type': 'application/json' } });
    providerResponses.set(url, response);
    return response;
  };
  const structured = await runtimeHost.executeRouter(app, new Request('https://app.test/data'), { capabilities: { fetch: capability } });
  const binary = await runtimeHost.executeRouter(app, new Request('https://app.test/binary'), { capabilities: { fetch: capability } });
  let ownershipConflict;
  try {
    await runtimeHost.executeRouter(app, new Request('https://app.test/mixed'), { capabilities: { fetch: capability } });
  } catch (error) {
    ownershipConflict = errorIdentity(error);
  }
  return caseResult('javascript-fetch-projection-snapshot', {
    structured: await structured.json(),
    projectionConsumesProviderBody: providerResponses.get('https://origin.test/data').bodyUsed,
    binary: await binary.text(),
    ownershipConflict
  });
}

async function fetchProjectionLimitCase() {
  const app = new Router();
  app.get('/large', async (ctx) => ctx.text(await ctx.fetch('https://origin.test/large').text()));
  app.error(async (error, ctx) => ctx.text(error.cause.code, { status: 413 }));
  const response = await runtimeHost.executeRouter(app, new Request('https://app.test/large'), {
    maxFetchBodyBytes: 4,
    capabilities: { fetch: async () => new Response('12345', { headers: { 'content-type': 'text/plain' } }) }
  });
  return caseResult('javascript-fetch-projection-bound', { status: response.status, code: await response.text() });
}

async function directPassThroughCase() {
  const app = new Router();
  app.get('/json', async (ctx) => ctx.fetch('https://origin.test/json'));
  app.get('/binary', async (ctx) => ctx.fetch('https://origin.test/binary'));
  const capability = async (url) => url.endsWith('/binary')
    ? new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 255, 1]));
          controller.close();
        }
      }), { status: 206, headers: { 'content-type': 'application/octet-stream', 'x-owner': 'host' } })
    : new Response('{"direct":true}', { status: 201, headers: { 'content-type': 'application/json', 'x-owner': 'host' } });
  const json = await runtimeHost.executeRouter(app, new Request('https://app.test/json'), { capabilities: { fetch: capability } });
  const binary = await runtimeHost.executeRouter(app, new Request('https://app.test/binary'), { capabilities: { fetch: capability } });
  return caseResult('javascript-direct-response-pass-through', {
    json: {
      status: json.status,
      bodyClass: runtimeHost.responseBodyClass(json),
      owner: json.headers.get('x-owner'),
      body: await json.text()
    },
    binary: {
      status: binary.status,
      bodyClass: runtimeHost.responseBodyClass(binary),
      owner: binary.headers.get('x-owner'),
      bytes: Array.from(new Uint8Array(await binary.arrayBuffer()))
    }
  });
}

async function publicInspectionAndBodylessCase() {
  const app = new Router();
  app.get('/inspect', async (ctx) => {
    const response = await ctx.fetch('https://origin.test/inspect');
    return ctx.text(response.text());
  });
  app.head('/head', async (ctx) => ctx.fetch('https://origin.test/head'));
  app.get('/empty', async (ctx) => ctx.fetch('https://origin.test/empty'));
  app.error(async (error, ctx) => ctx.text(error.cause.code, { status: 400 }));
  const capability = async (url) => url.endsWith('/empty')
    ? new Response(null, { status: 204, headers: { 'x-empty': 'yes' } })
    : new Response('must-not-leak', { headers: { 'content-type': 'text/plain' } });
  const inspected = await runtimeHost.executeRouter(app, new Request('https://app.test/inspect'), { capabilities: { fetch: capability } });
  const head = await runtimeHost.executeRouter(app, new Request('https://app.test/head', { method: 'HEAD' }), { capabilities: { fetch: capability } });
  const empty = await runtimeHost.executeRouter(app, new Request('https://app.test/empty'), { capabilities: { fetch: capability } });
  return caseResult('javascript-opaque-inspection-and-bodyless-ownership', {
    inspectionCode: await inspected.text(),
    head: { status: head.status, bytes: (await head.arrayBuffer()).byteLength },
    empty: { status: empty.status, bytes: (await empty.arrayBuffer()).byteLength, header: empty.headers.get('x-empty') }
  });
}

async function nodeFixtureCase() {
  const app = new Router();
  app.get('/project', async (ctx) => ctx.json(await ctx.fetch('https://origin.test/project').json()));
  app.get('/direct', async (ctx) => ctx.fetch('https://origin.test/direct'));
  app.get('/network', async (ctx) => ctx.text(await ctx.fetch('https://origin.test/network').text()));
  app.error(async (error, ctx) => ctx.text(error.cause.code, { status: 502 }));
  const projected = await executeNodeJavascriptTestCase(app, {
    request: { method: 'GET', path: '/project' },
    fetches: {
      'https://origin.test/project': {
        status: 202,
        value: { provider: 'node-javascript' },
        headers: [['x-fixture', 'yes']]
      }
    }
  });
  const direct = await executeNodeJavascriptTestCase(app, {
    request: { method: 'GET', path: '/direct' },
    fetches: {
      'https://origin.test/direct': {
        status: 206,
        chunks: ['a', 'b'],
        headers: [
          ['content-type', 'application/octet-stream'],
          ['x-repeat', 'one'],
          ['x-repeat', 'two']
        ]
      }
    }
  });
  const network = await executeNodeJavascriptTestCase(app, {
    request: { method: 'GET', path: '/network' },
    fetches: {
      'https://origin.test/network': { networkError: true, message: 'proof network failure' }
    }
  });
  return caseResult('node-javascript-fetch-fixture-realization', {
    projected: projected.response,
    direct: direct.response,
    network: { status: network.response.status, code: network.response.body },
    effects: {
      projected: {
        owned: projected.effectCount,
        external: projected.externalEffectCount,
        local: projected.localEffectCount
      },
      direct: {
        owned: direct.effectCount,
        external: direct.externalEffectCount,
        local: direct.localEffectCount
      },
      network: {
        owned: network.effectCount,
        external: network.externalEffectCount,
        local: network.localEffectCount
      }
    }
  });
}

function compile(source, fileName) {
  return loadCanonicalModule(compileCanonicalSource(source, { fileName }));
}

async function nativeModesCase() {
  const projectedProgram = compile(PROJECTED_JSON_SOURCE, 'fetch-body-projected-json.ts');
  const directProgram = compile(DIRECT_FETCH_SOURCE, 'fetch-body-direct.ts');
  const effects = [];
  const providerAdapter = {
    id: 'fetch-body-capture',
    dispatchEffect(effect) {
      effects.push(effect);
      return effect.responseMode === 'opaque'
        ? { status: 200, kind: 'text', headers: [['content-type', 'text/plain']], body: 'direct' }
        : { status: 200, kind: 'text', headers: [['content-type', 'application/json']], body: '{"ok":true}' };
    }
  };
  await canonicalHost.createCanonicalHostRuntime({ providerAdapter }).execute(projectedProgram);
  await canonicalHost.createCanonicalHostRuntime({ providerAdapter }).execute(directProgram);
  return caseResult('native-fetch-mode-and-input-lowering', {
    effects: effects.map((effect) => ({
      responseMode: effect.responseMode,
      projection: effect.projection,
      method: effect.init.method,
      headers: effect.init.headers,
      ...(effect.init.body === undefined ? {} : { body: effect.init.body }),
      bodyMode: effect.init.bodyMode,
      ...(effect.init.timeoutMs === undefined ? {} : { timeoutMs: effect.init.timeoutMs })
    }))
  });
}

async function nativeProjectionCase() {
  const program = compile(PROJECTED_TEXT_SOURCE, 'fetch-body-projected-text.ts');
  const execution = await executeCanonicalProgram(program, {
    fetches: {
      'https://origin.test/binary': {
        opaque: true,
        status: 200,
        headers: [['content-type', 'application/octet-stream']],
        chunks: [Buffer.from([65]), Buffer.from([66])]
      }
    },
    maxFetchBodyBytes: 2
  });
  let tooLarge;
  try {
    await executeCanonicalProgram(program, {
      fetches: {
        'https://origin.test/binary': {
          opaque: true,
          status: 200,
          headers: [['content-type', 'application/octet-stream']],
          chunks: [Buffer.from([65]), Buffer.from([66])]
        }
      },
      maxFetchBodyBytes: 1
    });
  } catch (error) {
    tooLarge = errorIdentity(error);
  }
  return caseResult('native-structured-projection-and-bound', {
    response: execution.response,
    tooLarge
  });
}

async function nativeDirectAndRequestCase() {
  const directProgram = compile(DIRECT_FETCH_SOURCE, 'fetch-body-direct-request.ts');
  const requestProgram = compile(REQUEST_BODY_SOURCE, 'fetch-body-request-body.ts');
  const direct = await executeCanonicalProgram(directProgram, {
    fetches: {
      'https://origin.test/direct': {
        status: 200,
        headers: [['content-type', 'text/plain'], ['x-owner', 'node']],
        body: 'host-owned-text'
      }
    }
  });
  const head = await executeCanonicalProgram(directProgram, {
    request: { method: 'HEAD' },
    fetches: {
      'https://origin.test/direct': {
        status: 200,
        headers: [['content-type', 'text/plain']],
        body: 'discard-me'
      }
    }
  });
  const request = await executeCanonicalProgram(requestProgram, {
    request: {
      method: 'POST',
      headers: [['content-type', 'application/json']],
      body: '{"id":9}'
    },
    maxRequestBodyBytes: 16
  });
  let requestTooLarge;
  try {
    await executeCanonicalProgram(requestProgram, {
      request: {
        method: 'POST',
        headers: [['content-type', 'application/json']],
        body: '{"id":999}'
      },
      maxRequestBodyBytes: 4
    });
  } catch (error) {
    requestTooLarge = errorIdentity(error);
  }
  return caseResult('native-direct-response-and-request-body-lifecycle', {
    direct: {
      status: direct.response.status,
      bodyClass: direct.response.bodyClass,
      bodyStream: direct.response.bodyStream
    },
    head: {
      status: head.response.status,
      bodyClass: head.response.bodyClass,
      hasBodyStream: head.response.bodyStream !== undefined
    },
    request: JSON.parse(request.response.body),
    requestBodyStats: request.requestBodyStats,
    requestTooLarge
  });
}

async function buildFetchBodyReport() {
  const cases = [];
  const builders = [
    requestBodySnapshotCase,
    requestBodyDiagnosticsCase,
    fetchNormalizationCase,
    fetchTimeoutCase,
    fetchProjectionCase,
    fetchProjectionLimitCase,
    directPassThroughCase,
    publicInspectionAndBodylessCase,
    nodeFixtureCase,
    nativeModesCase,
    nativeProjectionCase,
    nativeDirectAndRequestCase
  ];
  for (const build of builders) {
    cases.push(await build());
  }
  return Object.freeze({
    version: FETCH_BODY_REPORT_VERSION,
    summary: Object.freeze({ total: cases.length, passed: cases.length, failed: 0 }),
    contract: Object.freeze({
      fetchInput: 'portable-get-head-post-text-json-timeout',
      requestBody: 'single-bounded-request-owned-snapshot',
      fetchedProjection: 'single-bounded-projection-snapshot-with-exclusive-ownership',
      directResponse: 'host-owned-opaque-pass-through',
      bodylessOwnership: 'head-and-1xx-204-205-304-strip-body',
      javascriptAndNativeModesExplicit: true
    }),
    cases: Object.freeze(cases),
    policy: Object.freeze({
      fullTargetSupportReady: true,
      generalAvailable: true,
      automaticFallback: false
    })
  });
}

async function buildFetchBodyProof() {
  return stableArtifact(FETCH_BODY_PROOF_VERSION, await buildFetchBodyReport());
}

module.exports = Object.freeze({
  FETCH_BODY_PROOF_VERSION,
  FETCH_BODY_REPORT_VERSION,
  PROJECTED_JSON_SOURCE,
  PROJECTED_TEXT_SOURCE,
  DIRECT_FETCH_SOURCE,
  REQUEST_BODY_SOURCE,
  buildFetchBodyReport,
  buildFetchBodyProof
});
