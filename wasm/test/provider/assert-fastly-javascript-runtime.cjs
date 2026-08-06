#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { Router } = require(path.join(repoRoot, 'packages/runtime/src/index.js'));
const {
  createFastlyJavascriptHandler,
  installFastlyJavascriptApplication
} = require(path.join(repoRoot, 'packages/provider-fastly/src/javascript/lifecycle.js'));
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR
} = require(path.join(repoRoot, 'packages/provider-fastly/src/javascript/target.js'));
const { createHash } = require(path.join(repoRoot, 'packages/provider-fastly/src/javascript/sha256.js'));

const FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE_VERSION = 'pulse.fastly-javascript-runtime-evidence.v1';
const TOKEN = 'request-secret-token';
const GRIP_TOKEN = 'grip-provider-secret';

function hexBytes(value) {
  assert.match(value, /^(?:[0-9a-f]{2})*$/i);
  return Uint8Array.from(value.match(/[0-9a-f]{2}/gi) || [], (entry) => Number.parseInt(entry, 16));
}

function streamText(text, onCancel, keepOpen = false) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      if (!keepOpen) controller.close();
    },
    cancel() {
      if (onCancel) onCancel();
    }
  });
}

async function main() {
  assert.equal(
    createHash('sha256').update('abc').digest('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'the Fastly schema trace SHA-256 bridge must match the standard digest'
  );
  const assetsPackageBuild = buildWorkspacePackage('packages/assets');
  const gripPackageBuild = buildWorkspacePackage('packages/grip');
  const cryptoPackageBuild = buildWorkspacePackage('packages/crypto');
  const assets = await import(pathToFileURL(assetsPackageBuild.entry).href);
  const grip = await import(pathToFileURL(gripPackageBuild.entry).href);
  const pulseCrypto = await import(pathToFileURL(cryptoPackageBuild.entry).href);
  const constructed = [];
  const fetchCalls = [];
  const logs = [];
  const observations = [];
  const summaries = [];
  const traces = [];
  let activeRequests = 0;
  let assetStreamCancellations = 0;
  let headAssetBodyReads = 0;
  let slowAborts = 0;

  const configValues = new Map([['MODE', 'edge']]);
  const secretValues = new Map([['TOKEN', TOKEN], ['GRIP_TOKEN', GRIP_TOKEN]]);
  const kvValues = new Map([
    ['session_store', new Map([['session:1', JSON.stringify({ id: 'session-1', count: 1 })]])],
    ['asset_store', new Map([
      ['app.js', 'console.log("pulse")'],
      ['head.txt', 'head-body']
    ])]
  ]);

  function assertRequestConstruction(api, resource) {
    assert.ok(activeRequests > 0, `${api}(${resource}) must be constructed inside request handling`);
    constructed.push(Object.freeze({ api, resource }));
  }

  class ConfigStore {
    constructor(resource) {
      assertRequestConstruction('ConfigStore', resource);
      assert.equal(resource, 'app_config');
    }
    get(name) {
      return configValues.has(name) ? configValues.get(name) : null;
    }
  }

  class SecretStore {
    constructor(resource) {
      assertRequestConstruction('SecretStore', resource);
      assert.equal(resource, 'app_secrets');
    }
    async get(name) {
      if (!secretValues.has(name)) return null;
      const value = secretValues.get(name);
      return Object.freeze({ plaintext: () => value });
    }
  }

  class KVStore {
    constructor(resource) {
      assertRequestConstruction('KVStore', resource);
      assert.ok(kvValues.has(resource), `unexpected KV resource ${resource}`);
      this.resource = resource;
    }
    async get(key) {
      const value = kvValues.get(this.resource).get(key);
      if (value === undefined) return null;
      if (this.resource === 'asset_store') {
        return Object.freeze({
          get body() {
            if (key === 'head.txt') headAssetBodyReads += 1;
            return streamText(value, () => { assetStreamCancellations += 1; }, key === 'head.txt');
          }
        });
      }
      return Object.freeze({
        json: async () => JSON.parse(value),
        text: async () => value,
        get body() { return streamText(value); }
      });
    }
    async put(key, value) {
      assert.equal(typeof value, 'string', 'Fastly KV puts must serialize Pulse values to JSON');
      kvValues.get(this.resource).set(key, value);
    }
  }

  async function fetchImplementation(url, init = {}) {
    const parsed = new URL(url);
    fetchCalls.push(Object.freeze({
      url: parsed.href,
      backend: init.backend,
      method: init.method,
      authorization: init.headers && new Headers(init.headers).get('authorization')
    }));
    if (parsed.origin === 'https://publisher.example.test') {
      assert.equal(init.backend, 'publisher_backend');
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${GRIP_TOKEN}`);
      return new Response(JSON.stringify({ accepted: true, messageId: 'message-1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' }
      });
    }
    assert.equal(parsed.origin, 'https://api.example.test');
    assert.equal(init.backend, 'api_backend');
    if (parsed.pathname === '/slow') {
      return new Promise((resolve, reject) => {
        const abort = () => {
          slowAborts += 1;
          reject(init.signal.reason || new Error('aborted'));
        };
        if (init.signal.aborted) abort();
        else init.signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (parsed.pathname.includes(TOKEN)) {
      throw new Error(`provider leaked ${TOKEN}`);
    }
    return new Response(JSON.stringify({ id: 'upstream-1', ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  const schemaCodecs = Object.freeze({
    ids: Object.freeze(['app.Payload']),
    registry: Object.freeze({
      contentTypePolicy: 'accept-json-or-missing',
      maxBytes: 4096
    }),
    has(id) { return id === 'app.Payload'; },
    encodeJsonText(id, value) {
      assert.equal(id, 'app.Payload');
      return JSON.stringify({ value: String(value.value) });
    },
    decodeJsonText(id, text) {
      assert.equal(id, 'app.Payload');
      return Object.freeze(JSON.parse(text));
    },
    createTraceEvent(input) {
      const { semanticValue, ...event } = input;
      return Object.freeze({ ...event, valueDigest: semanticValue === undefined ? null : `value:${semanticValue.value}` });
    }
  });

  const app = new Router();
  app.use(async (ctx, next) => {
    ctx.state.set('middleware', 'seen');
    return next();
  });
  app.get('/all/:id', async (ctx) => {
    const sessions = ctx.kv('sessions');
    const grouped = await ctx.parallel({
      mode: ctx.config.get('MODE'),
      token: ctx.secret.get('TOKEN'),
      current: sessions.get('session:1'),
      upstream: ctx.fetch('https://api.example.test/user').json(),
      acknowledgement: grip.broadcast(ctx, { channel: 'updates', data: { id: ctx.param('id') } })
    });
    await sessions.put('session:last', { id: ctx.param('id'), mode: grouped.mode });
    ctx.log.error(`error ${grouped.token}`);
    ctx.log.warn(`warn ${grouped.token}`);
    ctx.log.info(`info ${grouped.token}`);
    ctx.log.debug(`debug ${grouped.token}`);
    return ctx.json({
      id: ctx.param('id'),
      middleware: ctx.state.get('middleware'),
      mode: grouped.mode,
      current: grouped.current,
      upstream: grouped.upstream,
      acknowledgement: grouped.acknowledgement
    });
  });
  app.get('/asset', async (ctx) => assets.respond(
    await assets.lookup(ctx, 'public', 'app.js', { cacheControl: 'public, max-age=60' })
  ));
  app.head('/asset-head', async (ctx) => assets.respond(
    await assets.lookup(ctx, 'public', 'head.txt', { method: 'HEAD' })
  ));
  app.get('/asset-missing', async (ctx) => assets.respond(
    await assets.lookup(ctx, 'public', 'missing.txt')
  ));
  app.get('/schema', async (ctx) => ctx.json({ value: 'encoded' }, { schema: 'app.Payload' }));
  app.get('/crypto/:validity', async (ctx) => {
    const tag = hexBytes('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
    if (ctx.param('validity') === 'invalid') tag[0] ^= 0x80;
    return ctx.json(await pulseCrypto.crypto.mac.verify({
      algorithm: 'HS256',
      key: {
        type: 'hmac-key-bytes',
        bytes: new Uint8Array(131).fill(0xaa)
      },
      data: hexBytes('54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374'),
      tag
    }));
  });
  app.get('/provider-failure', async (ctx) => {
    const token = await ctx.secret.get('TOKEN');
    return ctx.json(await ctx.fetch(`https://api.example.test/${token}`).json());
  });
  app.get('/unmapped', async (ctx) => ctx.json(await ctx.fetch('https://unmapped.example.test/data').json()));
  app.get('/unawaited', async (ctx) => {
    ctx.fetch('https://api.example.test/slow');
    return ctx.text('should-not-escape');
  });

  const handler = createFastlyJavascriptHandler(app, {
    apis: { ConfigStore, SecretStore, KVStore },
    bindings: {
      configStore: 'app_config',
      secretStore: 'app_secrets',
      kv: { sessions: 'session_store', public: 'asset_store' },
      backends: {
        'https://api.example.test': 'api_backend',
        'https://publisher.example.test': 'publisher_backend'
      },
      dynamicBackends: false,
      grip: {
        publishEndpoint: 'https://publisher.example.test/publish',
        publishBackend: 'publisher_backend',
        authentication: { scheme: 'bearer', secretRef: 'GRIP_TOKEN' }
      }
    },
    fetchImplementation,
    schemaCodecs,
    reporting: 'debug',
    console: Object.freeze({
      error(value) { logs.push(['error', String(value)]); },
      warn(value) { logs.push(['warn', String(value)]); },
      info(value) { logs.push(['info', String(value)]); },
      debug(value) { logs.push(['debug', String(value)]); }
    }),
    onEffectObservation(value) { observations.push(value); },
    onEffectSummary(value) { summaries.push(value); },
    onJsonTrace(value) { traces.push(value); }
  });

  async function request(pathname, method = 'GET') {
    activeRequests += 1;
    try {
      return await handler(Object.freeze({
        request: new Request(`https://service.example.test${pathname}`, { method })
      }));
    } finally {
      activeRequests -= 1;
    }
  }

  const all = await request('/all/42');
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), {
    id: '42',
    middleware: 'seen',
    mode: 'edge',
    current: { id: 'session-1', count: 1 },
    upstream: { id: 'upstream-1', ok: true },
    acknowledgement: { accepted: true, status: 202, messageId: 'message-1' }
  });
  assert.deepEqual(JSON.parse(kvValues.get('session_store').get('session:last')), { id: '42', mode: 'edge' });
  assert.ok(fetchCalls.some((entry) => entry.url === 'https://api.example.test/user' && entry.backend === 'api_backend'));
  assert.ok(fetchCalls.some((entry) => entry.url === 'https://publisher.example.test/publish' && entry.backend === 'publisher_backend'));
  assert.deepEqual(logs.map(([level]) => level), ['error', 'warn', 'info', 'debug']);
  assert.ok(logs.every(([, line]) => line.includes('<redacted>')));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${TOKEN}|${GRIP_TOKEN}`));

  const asset = await request('/asset');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(await asset.text(), 'console.log("pulse")');
  const head = await request('/asset-head', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(headAssetBodyReads, 1, 'HEAD must acquire the provider body stream exactly once');
  assert.equal(assetStreamCancellations, 1);
  assert.equal((await request('/asset-missing')).status, 404);

  const schema = await request('/schema');
  assert.deepEqual(await schema.json(), { value: 'encoded' });
  assert.ok(traces.some((entry) => entry.kind === 'json.encode.response' && entry.schemaId === 'app.Payload'));

  assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms[0].kind, 'runtime-builtin');
  assert.equal(FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.crypto.algorithms[0].implemented, true);
  assert.deepEqual(await (await request('/crypto/valid')).json(), { status: 'valid' });
  assert.deepEqual(await (await request('/crypto/invalid')).json(), { status: 'invalid-authenticator' });

  const failed = await request('/provider-failure');
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), 'Internal Server Error');
  assert.doesNotMatch(JSON.stringify(observations), new RegExp(`${TOKEN}|${GRIP_TOKEN}`));
  assert.doesNotMatch(JSON.stringify(summaries), new RegExp(`${TOKEN}|${GRIP_TOKEN}`));
  assert.equal((await request('/all/43')).status, 200, 'a provider failure must not poison the next request');
  assert.equal((await request('/unmapped')).status, 500, 'unmapped origins must fail inside the request');

  const unawaited = await request('/unawaited');
  assert.equal(unawaited.status, 500);
  assert.equal(slowAborts, 1);
  assert.ok(summaries.some((entry) => (
    entry.aborted
    && entry.abortCode === 'PULSE_RUNTIME_EFFECT_PENDING_AT_HANDLER_RETURN'
    && entry.closed
  )));
  assert.ok(constructed.some((entry) => entry.api === 'ConfigStore'));
  assert.ok(constructed.some((entry) => entry.api === 'SecretStore'));
  assert.ok(constructed.some((entry) => entry.api === 'KVStore'));

  let installedListener;
  installFastlyJavascriptApplication(app, {
    addEventListener(type, listener) {
      assert.equal(type, 'fetch');
      installedListener = listener;
    },
    apis: { ConfigStore, SecretStore, KVStore },
    bindings: {
      configStore: 'app_config',
      secretStore: 'app_secrets',
      kv: { sessions: 'session_store', public: 'asset_store' },
      backends: { 'https://api.example.test': 'api_backend' },
      dynamicBackends: false
    },
    fetchImplementation,
    reporting: 'off'
  });
  let installedResponse;
  activeRequests += 1;
  try {
    installedListener({
      request: new Request('https://service.example.test/asset'),
      respondWith(value) { installedResponse = Promise.resolve(value); }
    });
    assert.equal((await installedResponse).status, 200);
  } finally {
    activeRequests -= 1;
  }

  console.log(JSON.stringify({
    version: FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE_VERSION,
    cases: 27,
    matched: 27,
    mismatches: 0,
    status: 'passed',
    capabilities: Object.freeze([
      'request-response-lifecycle',
      'fetch',
      'config',
      'secret',
      'kv',
      'parallel',
      'schema-json',
      'crypto-runtime-builtin',
      'assets',
      'grip-broadcast',
      'logging-redaction',
      'request-cleanup'
    ])
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(cleanupWorkspacePackageBuilds);
