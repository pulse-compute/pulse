#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { fixture } = require('./authorization-fixture.cjs');
const { createMcpHttpHandler } = require('../../../packages/mcp/src/index.js');
const prefix = 'io.modelcontextprotocol/';
const clone = value => JSON.parse(JSON.stringify(value));
function request(url, token, method = 'tools/list', params = {}, signal) {
  return new Request(url, { method: 'POST', signal, headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method,
    ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}), ...(token === undefined ? {} : { authorization: 'Bearer ' + token }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: {
      [prefix + 'protocolVersion']: '2026-07-28', [prefix + 'clientCapabilities']: {} } } }) });
}
async function main() {
  const f = await fixture();
  try {
    const handler = createMcpHttpHandler(f.options);
    const exchange = async (token, method, params, target = handler) => {
      const response = await target.fetch(request(f.resource, token, method, params));
      const text = await response.text();
      for (const secret of [token, 'resource-secret', f.options.tools.backendBearerToken, 'secret-issuer-detail']) {
        if (secret) assert.ok(!text.includes(secret) && !JSON.stringify([...response.headers]).includes(secret), 'secret-safe response');
      }
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    };
    const missing = await exchange(undefined);
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('www-authenticate'), `Bearer resource_metadata="${new URL(f.resource).origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:access"`);
    assert.equal(f.counts.introspections, 0);
    const metadataUrl = new URL('/.well-known/oauth-protected-resource/mcp', f.resource);
    assert.equal((await exchange(undefined, 'server/discover')).status, 401);
    let cancelled = false;
    const unread = await handler.fetch(new Request(f.resource, { method: 'POST', duplex: 'half',
      body: new ReadableStream({ cancel() { cancelled = true; } }) }));
    assert.equal(unread.status, 401); assert.equal(cancelled, true);
    const metadata = await fetch(metadataUrl);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), { resource: f.resource, authorization_servers: [f.issuer],
      scopes_supported: ['mcp:access'], bearer_methods_supported: ['header'] });
    assert.equal((await fetch(metadataUrl, { method: 'POST' })).status, 405);
    const head = await fetch(metadataUrl, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const query = await handler.fetch(request(f.resource + '?access_token=forbidden', undefined));
    assert.equal(query.status, 400); assert.equal(f.counts.introspections, 0);
    for (const token of ['invalid-token', 'bad token', 'x'.repeat(8193)]) assert.equal((await exchange(token)).status, 401);
    for (const invalid of [{ active: false }, { iss: 'https://wrong.example' }, { aud: 'https://wrong.example/mcp' },
      { exp: 1 }, { exp: undefined }, { exp: '9999999999' }, { nbf: Math.floor(Date.now() / 1000) + 60 },
      { sub: '' }, { scope: 'bad"scope' }, { token_type: 'DPoP' }, { aud: [] }, { active: 'true' }]) {
      assert.equal((await exchange(f.issue(invalid))).status, 401);
    }
    assert.equal((await exchange(f.issue({ scope: 'status:read' }))).status, 403);
    assert.equal(f.counts.effects, 0); assert.equal(f.counts.backendAttempts, 0);
    const reader = f.issue(), writer = f.issue({ sub: 'other-user', scope: 'mcp:access status:write' });
    const baseOnly = f.issue({ scope: 'mcp:access' });
    assert.deepEqual((await exchange(reader)).body.result.tools.map(tool => tool.name), ['status']);
    assert.deepEqual((await exchange(writer)).body.result.tools.map(tool => tool.name), ['write']);
    assert.deepEqual((await exchange(baseOnly)).body.result.tools, []);
    const denied = await exchange(reader, 'tools/call', { name: 'write' });
    assert.equal(denied.status, 403); assert.match(denied.headers.get('www-authenticate'), /scope="mcp:access status:write"/);
    for (const name of ['unmapped', 'absent', '__proto__', 'constructor']) assert.equal((await exchange(reader, 'tools/call', { name })).status, 403);
    assert.equal(f.counts.backendAttempts, 0, 'deny before effects');
    assert.equal((await exchange(reader, 'tools/call', { name: 'status' })).body.result.isError, false);
    assert.equal(f.counts.effects, 1);
    assert.equal(f.observed.backendAuthorization[0], 'Bearer ' + f.options.tools.backendBearerToken);
    const bypass = await fetch(f.backendUrl, { method: 'POST', headers: { authorization: 'Bearer ' + reader }, body: '{}' });
    assert.equal(bypass.status, 401); assert.equal(f.counts.effects, 1);
    f.tokens.get(reader).active = false; assert.equal((await exchange(reader)).status, 401); // no positive token cache
    const valid = f.issue({ aud: ['https://other.example', f.resource] });
    for (const mode of ['http', 'redirect', 'media', 'malformed', 'oversize']) {
      f.mode(mode); const result = await exchange(valid); assert.equal(result.status, 503);
      assert.equal(result.body.error, 'temporarily_unavailable');
    }
    f.mode('stall');
    const timed = createMcpHttpHandler({ ...f.options, limits: { deadlineMs: 40 } });
    assert.equal((await exchange(valid, 'tools/call', { name: 'status' }, timed)).status, 408);
    f.mode('body-stall');
    assert.equal((await exchange(valid, 'tools/list', {}, timed)).status, 408);
    f.mode('stall');
    const controller = new AbortController();
    const pending = handler.fetch(request(f.resource, valid, 'tools/list', {}, controller.signal));
    setTimeout(() => controller.abort(), 20); assert.equal((await pending).status, 408);
    f.mode('normal');
    const notification = await request(f.resource, valid, 'tools/call', { name: 'status' }).json(); delete notification.id;
    const envelope = request(f.resource, valid, 'tools/call', { name: 'status' });
    const acknowledged = await handler.fetch(new Request(f.resource, { method: 'POST', headers: envelope.headers, body: JSON.stringify(notification) }));
    assert.equal(acknowledged.status, 202); assert.equal(f.counts.effects, 1);
    // Authentication cannot outlive the credential while a client slowly uploads its body.
    const expiring = f.issue({ exp: Math.ceil(Date.now() / 1000) + 1 });
    const slow = request(f.resource, expiring, 'tools/call', { name: 'status' });
    const bytes = new TextEncoder().encode(await slow.text());
    let uploadTimer;
    const delayed = new ReadableStream({
      start(controller) { uploadTimer = setTimeout(() => { controller.enqueue(bytes); controller.close(); }, 2100); },
      cancel() { clearTimeout(uploadTimer); }
    });
    const expired = await handler.fetch(new Request(f.resource, { method: 'POST', headers: slow.headers, body: delayed, duplex: 'half' }));
    assert.equal(expired.status, 401); assert.equal(f.counts.effects, 1);
    const before = f.counts.effects;
    await Promise.all(Array.from({ length: 12 }, (_, i) => exchange(i % 2 ? valid : writer).then(reply => {
      assert.deepEqual(reply.body.result.tools.map(tool => tool.name), [i % 2 ? 'status' : 'write']);
    })));
    assert.equal(f.counts.effects, before);
    // Configuration is copied: mutating granted scope policy cannot expand an existing handler.
    f.options.authorization.operations.write = [];
    assert.equal((await exchange(valid, 'tools/call', { name: 'write' })).status, 403);
    const invalidConfig = change => { const config = clone(f.options); change(config); assert.throws(() => createMcpHttpHandler(config)); };
    invalidConfig(config => delete config.tools.backendBearerToken);
    invalidConfig(config => config.tools.backendBearerToken = 'bad\r\nsecret');
    invalidConfig(config => config.authorization.issuer = 'http://remote.example');
    invalidConfig(config => config.authorization.allowInsecureLoopback = false);
    invalidConfig(config => config.authorization.introspectionEndpoint = 'http://127.0.0.1:1/introspect');
    invalidConfig(config => config.authorization.resource = f.resource + '?q=1');
    invalidConfig(config => config.authorization.scopes = ['bad"scope']);
    invalidConfig(config => config.authorization.operations.unknown = []);
    invalidConfig(config => config.authorization.verify = () => true);
    console.log('ok - MCP-04 metadata/challenges, issuer/audience/expiry/scopes, deny-before-effects, backend isolation and cancellation');
  } finally { await f.close(); }
}
main().then(() => require('./assert-directory-authorization.cjs').directoryAuthorization()).catch(error => { console.error(error); process.exitCode = 1; });
