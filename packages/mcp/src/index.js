'use strict';

const { AdmissionError, checkDepth, readBody } = require('./bounded.js');
const { createTools } = require('./tools.js');
const { createAuthorization, AuthorizationError } = require('./authorization.js');

const PROTOCOL_VERSION = '2026-07-28';
const META = 'io.modelcontextprotocol/';
const DEFAULT_LIMITS = Object.freeze({ maxRequestBytes: 65536, maxResponseBytes: 1048576,
  maxDepth: 32, deadlineMs: 10000 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' || Number.isSafeInteger(value);
const own = (value, key) => Object.hasOwn(value, key);
const encoder = new TextEncoder();

function configuration(options) {
  const path = options.path ?? '/mcp';
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(path)) throw new TypeError('Invalid MCP endpoint path');
  const info = options.serverInfo ?? { name: 'pulse-mcp', version: '0.0.0' };
  if (!object(info) || !['name', 'version'].every(key => typeof info[key] === 'string'
    && info[key].length > 0 && encoder.encode(info[key]).length <= 128)) throw new TypeError('Invalid MCP server identity');
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, ceiling] of Object.entries(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) throw new TypeError(`Invalid MCP limit: ${key}`);
  }
  // Even a rejected request with a long ID must have room for an exact echoed ID.
  if (limits.maxResponseBytes < limits.maxRequestBytes + 512) throw new TypeError('MCP response budget must cover the request budget plus 512 bytes');
  if (!Array.isArray(options.allowedOrigins ?? [])) throw new TypeError('Invalid MCP allowed origins');
  const origins = new Set((options.allowedOrigins ?? []).map(origin => {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new TypeError('MCP origins must be exact HTTP(S) origins');
    return origin;
  }));
  return { path, info: { name: info.name, version: info.version }, limits, origins };
}

function accepts(header, type) {
  // Require both explicit media ranges, including non-zero quality. Wildcards
  // alone do not satisfy the revision's explicit Accept-list requirement.
  return (header ?? '').split(',').some(part => {
    const [media, ...params] = part.trim().toLowerCase().split(';').map(value => value.trim());
    if (media !== type) return false;
    const qualities = params.filter(value => value.startsWith('q='));
    return qualities.length === 0 || (qualities.length === 1 && /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qualities[0]) && Number(qualities[0].slice(2)) > 0);
  });
}

function nameHeader(value) {
  if (value === null) return null;
  if (value.startsWith('=?base64?') && value.endsWith('?=')) {
    const encoded = value.slice(9, -2);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
    try {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      // Reject noncanonical pad bits as well as malformed UTF-8.
      if (btoa(String.fromCharCode(...bytes)) !== encoded) return null;
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { return null; }
  }
  return /^[\x20-\x7e\t]*$/.test(value) && value.trim() === value ? value : null;
}

/** Bounded, stateless HTTP protocol shell. No entity or tool executor is owned here. */
function createMcpHttpHandler(options = {}) {
  const { path, info, limits, origins } = configuration(options);
  const tools = options.tools === undefined ? null : createTools(options.tools, limits);
  const authorization = options.authorization === undefined ? null
    : createAuthorization(options.authorization, path, tools?.list.map(tool => tool.name) ?? []);
  if (authorization && tools && !options.tools.backendBearerToken) throw new TypeError('MCP authorization requires a separate backend credential');
  function response(status, body, headers = {}) {
    return new Response(body, { status, headers: { 'cache-control': 'no-store', ...headers,
      ...(body === null ? {} : { 'content-type': 'application/json' }) } });
  }
  function error(status, code, message, id, data) {
    return response(status, JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }),
      error: { code, message, ...(data === undefined ? {} : { data }) } }));
  }
  const headerError = id => error(400, -32020, 'Missing, malformed or mismatched MCP headers', id, { supported: [PROTOCOL_VERSION] });
  async function fetch(request) {
    let consumed = false, responseId;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), limits.deadlineMs);
    const signal = AbortSignal.any([request.signal, timeout.signal]);
    try {
      const origin = request.headers.get('origin');
      if (origin !== null && !origins.has(origin)) return response(403, null);
      const pathname = new URL(request.url).pathname;
      if (authorization && pathname === authorization.metadataPath) {
        if (!['GET', 'HEAD'].includes(request.method)) return response(405, null, { allow: 'GET, HEAD' });
        return response(200, request.method === 'HEAD' ? null : authorization.metadata, { 'content-type': 'application/json' });
      }
      if (pathname !== path) return response(404, null);
      if (request.method !== 'POST') return response(405, null, { allow: 'POST' });
      if (signal.aborted) return error(408, -32600, 'Request interrupted');
      // Authenticate before parsing or catalog disclosure; HTTP notifications do not bypass admission.
      const principal = authorization ? await authorization.authenticate(request, signal) : null;
      const type = request.headers.get('content-type') ?? '';
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type)) return response(415, null);
      if (!accepts(request.headers.get('accept'), 'application/json') || !accepts(request.headers.get('accept'), 'text/event-stream')) return response(406, null);
      if (request.headers.has('content-encoding') && request.headers.get('content-encoding').toLowerCase() !== 'identity') return response(415, null);
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return error(400, -32600, 'Invalid content length');
      if (length !== null && Number(length) > limits.maxRequestBytes) return error(413, -32600, 'Request body limit exceeded');
      consumed = true;
      const text = await readBody(request, limits, signal);
      checkDepth(text, limits.maxDepth);
      let message;
      try { message = JSON.parse(text); } catch { return error(400, -32700, 'Parse error'); }
      if (!object(message)) return error(400, -32600, 'Invalid request');
      const id = validId(message.id) ? message.id : undefined;
      responseId = id;
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method
        || own(message, 'result') || own(message, 'error') || (own(message, 'id') && id === undefined)
        || (own(message, 'params') && !object(message.params))) return error(400, -32600, 'Invalid request', id);
      // Core HTTP defines no client notifications. Accept and discard valid
      // one-way envelopes, including unknown names; never dispatch them.
      if (!own(message, 'id')) return response(202, null);
      const versionHeader = request.headers.get('mcp-protocol-version');
      const methodHeader = request.headers.get('mcp-method');
      if (!versionHeader || !methodHeader || methodHeader !== message.method
        || !/^[\x21-\x7e]+$/.test(methodHeader) || !/^[\x21-\x7e]+$/.test(versionHeader)) return headerError(id);
      const params = message.params;
      const meta = params?._meta;
      if (!object(meta) || typeof meta[META + 'protocolVersion'] !== 'string'
        || !object(meta[META + 'clientCapabilities'])) return error(400, -32602, 'Invalid request metadata', id);
      if (own(meta, META + 'clientInfo') && (!object(meta[META + 'clientInfo'])
        || !['name', 'version'].every(key => typeof meta[META + 'clientInfo'][key] === 'string'))) return error(400, -32602, 'Invalid client information', id);
      if (versionHeader !== meta[META + 'protocolVersion']) return headerError(id);
      if (versionHeader !== PROTOCOL_VERSION) return error(400, -32022, 'Unsupported protocol version', id,
        { supported: [PROTOCOL_VERSION], requested: versionHeader });
      const nameField = message.method === 'resources/read' ? 'uri'
        : ['tools/call', 'prompts/get'].includes(message.method) ? 'name' : undefined;
      if (nameField && (typeof params[nameField] !== 'string' || nameHeader(request.headers.get('mcp-name')) !== params[nameField])) return headerError(id);
      let result;
      if (authorization) authorization.fresh(principal);
      if (message.method === 'server/discover') {
        if (Object.keys(params).some(key => key !== '_meta')) return error(400, -32602, 'Invalid params', id);
        result = { supportedVersions: [PROTOCOL_VERSION], capabilities: tools ? { tools: { listChanged: false } } : {},
          ttlMs: 0, cacheScope: 'private' };
      } else if (tools && message.method === 'tools/list') {
        if (Object.keys(params).some(key => key !== '_meta')) return error(400, -32602, 'Invalid params', id);
        result = { tools: authorization ? tools.list.filter(tool => authorization.allowed(principal, tool.name)) : tools.list,
          ttlMs: 0, cacheScope: 'private' };
      } else if (tools && message.method === 'tools/call') {
        if (Object.keys(params).some(key => !['_meta', 'name', 'arguments'].includes(key))
          || (own(params, 'arguments') && !object(params.arguments))) return error(400, -32602, 'Invalid params', id);
        if (authorization) authorization.requireOperation(principal, params.name);
        if (!tools.has(params.name)) return error(400, -32602, 'Unknown tool', id);
        result = await tools.call(params.name, params.arguments ?? {}, signal);
      } else return error(404, -32601, 'Method not found', id);
      result = { resultType: 'complete', _meta: { [META + 'serverInfo']: info }, ...result };
      const body = JSON.stringify({ jsonrpc: '2.0', id, result });
      if (encoder.encode(body).length > limits.maxResponseBytes) return error(500, -32603, 'Response body limit exceeded', id);
      return response(200, body);
    } catch (cause) {
      if (cause instanceof AuthorizationError) return response(cause.status, JSON.stringify({ error: cause.code }),
        cause.challenge ? { 'www-authenticate': cause.challenge } : {});
      if (cause instanceof AdmissionError) return error(cause.status, cause.code, cause.message, responseId);
      return error(500, -32603, 'Internal error', responseId);
    } finally {
      clearTimeout(timer);
      if (!consumed && request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    }
  }
  return Object.freeze({ fetch });
}

module.exports = { createMcpHttpHandler, PROTOCOL_VERSION, DEFAULT_LIMITS };
