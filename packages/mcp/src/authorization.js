'use strict';

const { readBody, checkDepth, AdmissionError } = require('./bounded.js');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const scopePattern = /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const bearerPattern = /^[A-Za-z0-9._~+/-]+=*$/;
const badConfiguration = () => { throw new TypeError('Invalid MCP authorization configuration'); };
const component = value => new URLSearchParams({ v: value }).toString().slice(2);

class AuthorizationError extends Error {
  constructor(status, code, challenge) { super('Authorization failed'); this.status = status; this.code = code; this.challenge = challenge; }
}

function bearerToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192 && bearerPattern.test(value);
}

function createAuthorization(options, path, toolNames) {
  if (!object(options) || Object.keys(options).some(key => !['resource', 'issuer', 'introspectionEndpoint',
    'clientId', 'clientSecret', 'scopes', 'operations', 'allowInsecureLoopback'].includes(key))
    || (options.allowInsecureLoopback !== undefined && typeof options.allowInsecureLoopback !== 'boolean')) badConfiguration();
  function url(value) {
    if (typeof value !== 'string' || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) badConfiguration();
    let parsed; try { parsed = new URL(value); } catch { badConfiguration(); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || /["\\]/.test(value)
      || !(parsed.protocol === 'https:' || (options.allowInsecureLoopback === true && parsed.protocol === 'http:'
        && ['127.0.0.1', '[::1]'].includes(parsed.hostname)))) badConfiguration();
    return parsed;
  }
  const resource = options.resource, issuer = options.issuer;
  const resourceUrl = url(resource), issuerUrl = url(issuer), endpoint = url(options.introspectionEndpoint);
  if (resourceUrl.pathname !== path || resourceUrl.href !== resource || endpoint.origin !== issuerUrl.origin) badConfiguration();
  for (const key of ['clientId', 'clientSecret']) {
    if (typeof options[key] !== 'string' || !options[key] || options[key].length > 4096) badConfiguration();
  }
  const credentials = 'Basic ' + btoa(component(options.clientId) + ':' + component(options.clientSecret));
  function scopes(value, nonempty = false) {
    if (!Array.isArray(value) || value.length > 32 || (nonempty && !value.length)
      || value.some(scope => typeof scope !== 'string' || !scopePattern.test(scope)) || new Set(value).size !== value.length) badConfiguration();
    return [...value].sort();
  }
  const baseScopes = scopes(options.scopes, true), operations = new Map();
  if (!object(options.operations) || Object.keys(options.operations).length > 128) badConfiguration();
  for (const [name, required] of Object.entries(options.operations)) {
    if (!toolNames.includes(name)) badConfiguration();
    operations.set(name, scopes(required));
  }
  const metadataPath = '/.well-known/oauth-protected-resource' + (path === '/' ? '' : path);
  const metadataUrl = resourceUrl.origin + metadataPath;
  const metadata = JSON.stringify({ resource, authorization_servers: [issuer],
    scopes_supported: baseScopes, bearer_methods_supported: ['header'] });
  const transport = globalThis.fetch;
  const introspectionUrl = endpoint.href;
  function reject(status, code, required) {
    const challenge = `Bearer resource_metadata="${metadataUrl}"`
      + (code ? `, error="${code}"` : '') + (required?.length ? `, scope="${required.join(' ')}"` : '');
    throw new AuthorizationError(status, code ?? 'unauthorized', challenge);
  }
  const fresh = principal => { if (principal.expires <= Date.now() / 1000) reject(401, 'invalid_token', baseScopes); };
  const allowed = (principal, name) => operations.has(name) && operations.get(name).every(scope => principal.scopes.has(scope));
  function requireOperation(principal, name) {
    fresh(principal);
    if (!allowed(principal, name)) reject(403, 'insufficient_scope', operations.has(name)
      ? [...new Set([...baseScopes, ...operations.get(name)])].sort() : undefined);
  }
  async function authenticate(request, signal) {
    if (new URL(request.url).searchParams.has('access_token')) reject(400, 'invalid_request');
    const header = request.headers.get('authorization');
    if (header === null) reject(401, undefined, baseScopes);
    const match = /^Bearer ([^ ]+)$/i.exec(header);
    if (!match || !bearerToken(match[1])) reject(401, 'invalid_token', baseScopes);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 3000);
    const boundedSignal = AbortSignal.any([signal, timeout.signal]);
    let claims;
    try {
      const response = await transport(introspectionUrl, { method: 'POST', redirect: 'error', credentials: 'omit',
        headers: { authorization: credentials, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: match[1], token_type_hint: 'access_token' }).toString(), signal: boundedSignal });
      if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error('Invalid introspection response');
      }
      const text = await readBody(response, { maxRequestBytes: 16384 }, boundedSignal);
      checkDepth(text, 8);
      claims = JSON.parse(text);
    } catch {
      if (signal.aborted) throw new AdmissionError(408, -32603, 'Request interrupted');
      // An unavailable verifier never becomes either anonymous access or a token verdict.
      throw new AuthorizationError(503, 'temporarily_unavailable');
    } finally { clearTimeout(timer); }
    const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (!object(claims) || claims.active !== true || claims.iss !== issuer
      || !audience.length || audience.length > 32 || audience.some(value => typeof value !== 'string') || !audience.includes(resource)
      || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000
      || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > Date.now() / 1000))
      || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256
      || (claims.token_type !== undefined && String(claims.token_type).toLowerCase() !== 'bearer')
      || typeof claims.scope !== 'string' || claims.scope.length > 8192) reject(401, 'invalid_token', baseScopes);
    const granted = claims.scope === '' ? [] : claims.scope.split(' ');
    if (granted.length > 64 || granted.some(scope => !scopePattern.test(scope))) reject(401, 'invalid_token', baseScopes);
    const principal = { expires: claims.exp, scopes: new Set(granted) };
    if (!baseScopes.every(scope => principal.scopes.has(scope))) reject(403, 'insufficient_scope', baseScopes);
    return principal;
  }
  return { metadataPath, metadata, authenticate, fresh, allowed, requireOperation };
}

module.exports = { createAuthorization, AuthorizationError, bearerToken };
