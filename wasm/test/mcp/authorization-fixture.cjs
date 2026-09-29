'use strict';

// Test-only OAuth issuer and protected HTTP backend. No issuer is hosted by the adapter.
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server => `http://127.0.0.1:${server.address().port}`;
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const body = async req => { let text = ''; for await (const chunk of req) text += chunk; return text; };

async function fixture({ adapter = require('../../../packages/mcp/src/node.js').createMcpNodeHandler, backendEndpoint } = {}) {
  const tokens = new Map(), codes = new Map();
  const counts = { introspections: 0, tokenRequests: 0, effects: 0, backendAttempts: 0, metadata: 0, grants: 0 };
  const observed = { backendAuthorization: [], tokenResources: [], authorizationResources: [] };
  let resource, issuer, mode = 'normal', backendMode = 'normal', handler;
  const backendToken = randomBytes(24).toString('base64url');
  const issue = (overrides = {}) => {
    const token = randomBytes(24).toString('base64url');
    tokens.set(token, { active: true, iss: issuer, aud: resource, exp: Math.floor(Date.now() / 1000) + 300,
      sub: 'fixture-user', scope: 'mcp:access status:read', token_type: 'Bearer', ...overrides });
    return token;
  };
  const authorizationServer = http.createServer((req, res) => { void (async () => {
    const url = new URL(req.url, issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      counts.metadata++;
      return json(res, 200, { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
        introspection_endpoint: issuer + '/introspect', response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true, scopes_supported: ['mcp:access', 'status:read', 'status:write'] });
    }
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const params = url.searchParams;
      if (params.get('client_id') !== 'preregistered-client' || params.get('response_type') !== 'code'
        || params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')
        || params.get('resource') !== resource || params.get('redirect_uri') !== 'http://127.0.0.1/callback') return json(res, 400, { error: 'invalid_request' });
      counts.grants++; observed.authorizationResources.push(params.get('resource'));
      const code = randomBytes(16).toString('base64url'); codes.set(code, params);
      const callback = new URL(params.get('redirect_uri'));
      callback.searchParams.set('code', code); callback.searchParams.set('state', params.get('state'));
      callback.searchParams.set('iss', issuer);
      res.writeHead(302, { location: callback.href }); res.end(); return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
    const params = new URLSearchParams(await body(req));
    if (url.pathname === '/token') {
      counts.tokenRequests++; observed.tokenResources.push(params.get('resource'));
      const grant = codes.get(params.get('code')); codes.delete(params.get('code'));
      const challenge = createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url');
      if (!grant || challenge !== grant.get('code_challenge') || params.get('resource') !== resource
        || params.get('redirect_uri') !== grant.get('redirect_uri') || params.get('client_id') !== 'preregistered-client'
        || params.get('grant_type') !== 'authorization_code') return json(res, 400, { error: 'invalid_grant' });
      const scope = grant.get('scope') ?? '';
      return json(res, 200, { access_token: issue({ scope }), token_type: 'Bearer', expires_in: 300, scope });
    }
    if (url.pathname !== '/introspect') return json(res, 404, { error: 'not_found' });
    counts.introspections++;
    if (req.headers.authorization !== 'Basic ' + Buffer.from('resource-client:resource-secret').toString('base64')) return json(res, 401, { error: 'invalid_client' });
    if (mode === 'stall') return;
    if (mode === 'body-stall') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); return; }
    if (mode === 'redirect') { res.writeHead(307, { location: issuer + '/other' }); res.end(); return; }
    if (mode === 'http') return json(res, 500, { error: 'secret-issuer-detail' });
    if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{secret'); return; }
    if (mode === 'oversize') return json(res, 200, { padding: 'x'.repeat(17000) });
    if (mode === 'media') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('secret'); return; }
    return json(res, 200, tokens.get(params.get('token')) ?? { active: false });
  })().catch(() => json(res, 500, { error: 'fixture_failure' })); });
  const backend = http.createServer((req, res) => { void (async () => {
    counts.backendAttempts++; observed.backendAuthorization.push(req.headers.authorization);
    if (req.headers.authorization !== 'Bearer ' + backendToken) return json(res, 401, { error: 'unauthorized' });
    const message = JSON.parse(await body(req)); counts.effects++;
    if (backendMode === 'failure') return json(res, 503, { error: 'private-backend-detail' });
    if (backendMode === 'stall') {
      res.once('close', () => { counts.cancelled = (counts.cancelled ?? 0) + 1; });
      return;
    }
    if (backendEndpoint) {
      const controller = new AbortController();
      const abort = () => controller.abort(); res.once('close', abort);
      try {
        const response = await fetch(backendEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        const bytes = await response.text();
        if (!res.destroyed) { res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(bytes); }
      } finally { res.removeListener('close', abort); }
      return;
    }
    return json(res, 200, { jsonrpc: '2.0', id: message.id, result: null });
  })().catch(() => json(res, 500, { error: 'fixture_failure' })); });
  const server = http.createServer((req, res) => handler(req, res));
  await listen(authorizationServer); issuer = address(authorizationServer);
  await listen(backend); await listen(server); resource = address(server) + '/mcp';
  const entity = name => ({ name, inputSchema: null, outputSchema: null, eligibility: { 'node-javascript': true } });
  const options = { tools: { endpoint: address(backend), backendBearerToken: backendToken, routerId: 'rpc', target: 'node-javascript',
    catalog: { version: 'pulse.entities-catalog.v1', contractId: 'pulse.entities', catalogHash: 'a'.repeat(64),
      routers: [{ id: 'rpc', adapter: 'json-rpc', binding: 'request', entities: ['status', 'write', 'unmapped'].map(entity) }] },
    schemas: { version: 'pulse.canonical-schema-registry.v4', registryIrVersion: 'pulse.schema-registry-ir.v5', registryHash: 'b'.repeat(64), schemas: [] } },
    authorization: { resource, issuer, introspectionEndpoint: issuer + '/introspect', clientId: 'resource-client', clientSecret: 'resource-secret',
      scopes: ['mcp:access'], operations: { status: ['status:read'], write: ['status:write'] }, allowInsecureLoopback: true } };
  handler = adapter(options);
  return { options, resource, issuer, backendUrl: address(backend), issue, tokens, counts, observed,
    backendMode: value => { backendMode = value; }, mode: value => { mode = value; }, configure: config => { handler = adapter(config); },
    close: async () => { await Promise.all([server, backend, authorizationServer].map(item => {
      item.closeAllConnections(); return new Promise(resolve => item.close(resolve));
    })); } };
}

module.exports = { fixture };
