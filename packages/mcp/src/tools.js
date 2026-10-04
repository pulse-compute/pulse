'use strict';

const { projectCatalog, matches } = require('./catalog.js');
const { AdmissionError, readBody, checkDepth } = require('./bounded.js');
const { bearerToken } = require('./authorization.js');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const toolError = message => ({ isError: true, content: [{ type: 'text', text: message }] });

function createTools(options, limits) {
  if (!object(options) || Object.keys(options).some(key => !['catalog', 'schemas', 'routerId', 'target', 'endpoint', 'backendBearerToken'].includes(key))) {
    throw new TypeError('Invalid MCP tools configuration');
  }
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search
    || !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:'
      && ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)))) throw new TypeError('Invalid governed endpoint');
  const url = endpoint.href;
  if (options.backendBearerToken !== undefined && !bearerToken(options.backendBearerToken)) throw new TypeError('Invalid backend credential');
  const backendAuthorization = options.backendBearerToken === undefined ? {} : { authorization: 'Bearer ' + options.backendBearerToken };
  const { entries, list } = projectCatalog(options, limits);
  // Capture the host transport at construction; no per-tool executor callback.
  const transport = globalThis.fetch;
  async function call(name, args, signal) {
    const entry = entries.get(name);
    if (!matches(args, entry.tool.inputSchema)) return toolError('Tool input validation failed');
    if (signal.aborted) throw new AdmissionError(408, -32603, 'Request interrupted');
    const body = JSON.stringify({ jsonrpc: '2.0', id: 'pulse-mcp', method: name,
      ...(entry.noInput ? {} : { params: args }) });
    if (new TextEncoder().encode(body).length > limits.maxRequestBytes) return toolError('Tool input limit exceeded');
    let response;
    try {
      // Fixed endpoint, no redirects, retries, client headers, cookies or bearer forwarding.
      response = await transport(url, { method: 'POST', redirect: 'error', credentials: 'omit',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...backendAuthorization }, body, signal });
      if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error('Invalid governed response');
      }
      const text = await readBody(response, { maxRequestBytes: limits.maxResponseBytes }, signal);
      checkDepth(text, limits.maxDepth);
      const reply = JSON.parse(text);
      if (!object(reply) || reply.jsonrpc !== '2.0' || reply.id !== 'pulse-mcp'
        || Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error')) throw new Error('Invalid governed envelope');
      if (Object.hasOwn(reply, 'error')) {
        if (!object(reply.error) || !Number.isInteger(reply.error.code)) throw new Error('Invalid governed error');
        if (reply.error.code === -32602) return toolError('Tool input validation failed');
        if (reply.error.code === -32603) return toolError('Tool execution or output validation failed');
        throw new Error('Governed catalog mismatch');
      }
      if (entry.noOutput ? reply.result !== null : !matches(reply.result, entry.tool.outputSchema)) {
        return toolError('Tool output validation failed');
      }
      return { isError: false, content: [{ type: 'text', text: JSON.stringify(reply.result) }],
        ...(entry.noOutput ? {} : { structuredContent: reply.result }) };
    } catch {
      if (signal.aborted) throw new AdmissionError(408, -32603, 'Request interrupted');
      throw new AdmissionError(502, -32603, 'Governed backend unavailable or invalid');
    }
  }
  return { list, has: name => entries.has(name), call };
}

module.exports = { createTools };
