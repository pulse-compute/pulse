import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [adapterFile, reportFile, fixtureFile] = process.argv.slice(2);
const { fixture } = createRequire(import.meta.url)(fixtureFile);
const f = await fixture();
// Explicit baseline grant for the one operation used by this independent flow.
f.options.authorization.operations.status = [];
f.configure(f.options);
const report = { status: 'running', client: '@modelcontextprotocol/client@2.2.0',
  productionAdapter: true, controlledIssuer: true, productionIssuerConfigured: false, checks: [] };
let tokens, verifier, discovery, authorizationUrl;
const provider = {
  redirectUrl: 'http://127.0.0.1/callback',
  clientMetadata: { redirect_uris: ['http://127.0.0.1/callback'], grant_types: ['authorization_code'],
    response_types: ['code'], token_endpoint_auth_method: 'none' },
  clientInformation: () => ({ client_id: 'preregistered-client' }),
  tokens: () => tokens, saveTokens: value => { tokens = value; },
  saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
  saveDiscoveryState: value => { discovery = value; }, discoveryState: () => discovery,
  state: () => 'fixture-state', redirectToAuthorization: url => { authorizationUrl = url; }
};
const clients = [];
const client = () => { const value = new Client({ name: 'mcp-04-independent-client', version: '0.0.0' }, {
  capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } }); clients.push(value); return value; };
const transport = () => new StreamableHTTPClientTransport(new URL(f.resource), { authProvider: provider,
  onInsufficientScope: 'throw', fetch: (input, init) => fetch(input, { ...init,
    signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(5000)]) }) });
try {
  const first = transport();
  await assert.rejects(client().connect(first));
  assert.ok(authorizationUrl, '401 must drive protected-resource and issuer discovery');
  assert.equal(authorizationUrl.origin, f.issuer);
  assert.equal(authorizationUrl.searchParams.get('resource'), f.resource);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  const redirect = await fetch(authorizationUrl, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const callback = new URL(redirect.headers.get('location')).searchParams;
  assert.equal(callback.get('state'), 'fixture-state'); // Host owns CSRF state validation.
  const forged = new URLSearchParams(callback); forged.set('iss', 'https://attacker.invalid');
  await assert.rejects(first.finishAuth(forged));
  assert.equal(f.counts.tokenRequests, 0, 'issuer mismatch must precede code redemption');
  await first.finishAuth(callback);
  assert.ok(tokens.access_token);
  const active = client(); await active.connect(transport());
  assert.deepEqual((await active.listTools()).tools.map(tool => tool.name), ['status']);
  assert.equal((await active.callTool({ name: 'status' })).isError, false);
  assert.equal(f.counts.effects, 1);
  await assert.rejects(active.callTool({ name: 'write' }));
  assert.equal(f.counts.effects, 1, 'scope failure cannot dispatch');
  assert.deepEqual(f.observed.authorizationResources, [f.resource]);
  assert.deepEqual(f.observed.tokenResources, [f.resource]);
  assert.equal(f.observed.backendAuthorization[0], 'Bearer ' + f.options.tools.backendBearerToken);
  assert.notEqual(f.observed.backendAuthorization[0], 'Bearer ' + tokens.access_token);
  report.checks.push('401-resource-metadata-discovery', 'rfc8414-issuer-discovery', 'preregistered-client',
    'pkce-s256', 'authorization-and-token-resource-binding', 'reject-mismatched-issuer-before-token',
    'filtered-tools', 'authorized-call', 'deny-before-effects', 'distinct-backend-credential');
  report.counts = f.counts; report.status = 'passed';
  console.log('ok - independent OAuth client: discovery, PKCE, issuer validation, scoped invocation and backend protection');
} catch (error) {
  report.status = 'failed'; report.error = error.name; throw error;
} finally {
  for (const item of clients) await item.close();
  await f.close(); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
}
