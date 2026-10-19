'use strict';
const { EntityRouter, jsonRpc } = require('@pulse-compute/entities');
const { describeEntityRouter, invokeEntityOperation, sealEntityRouter } = require('@pulse-compute/entities/internal/transport');
const { pulseConfiguration, MAX_TOOL_RESULT_BYTES } = require('./pulse-config.js');
const { projectLocalCatalog } = require('./catalog.js');
const { createProtocolHandler } = require('./protocol.js');
const { AdmissionError } = require('./bounded.js');
const httpRuntime = require('@pulse-compute/runtime/package').createPackageHttpRuntime({ version: 'pulse.package-http-runtime.v1', package: '@pulse-compute/mcp', contractId: 'pulse.mcp' });
function mcp(options) {
  const { router, ...protocol } = options;
  if (!(router instanceof EntityRouter)) throw new TypeError('MCP requires a local EntityRouter');
  const config = pulseConfiguration(protocol);
  sealEntityRouter(router);
  return Object.freeze({ async handle(ctx) {
    let projection, responseId;
    const lifecycle = httpRuntime.bind(ctx, { maxDurationMs: config.limits.deadlineMs, failure(kind) {
      const status = kind === 1 ? 408 : kind === 2 ? 413 : 400;
      return new Response(JSON.stringify({ jsonrpc: '2.0', ...(responseId === undefined ? {} : { id: responseId }), error: {
        code: kind === 3 ? -32700 : -32600, message: kind === 1 ? 'Request interrupted' : kind === 2 ? 'Request body limit exceeded' : 'Invalid request body'
      } }), { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
    } });
    const tools = () => {
      if (!projection) {
        const facts = describeEntityRouter(router, ctx);
        projection = projectLocalCatalog(facts.catalog, facts.schemas, 'tools', 'node-javascript', config.limits);
      }
      return projection;
    };
    const handler = createProtocolHandler(config, {
      admittedId(id) { responseId = id; },
      get list() { return tools().list; },
      has(name) { return tools().entries.has(name); },
      async call(name, args, signal, legacy) {
        const failed = message => ({ isError: true, content: [{ type: 'text', text: message }] });
        const result = await invokeEntityOperation(router, ctx, name, args);
        if (signal.aborted) throw new AdmissionError(408, -32600, 'Request interrupted');
        if (!result.ok) return failed(result.failure === 'invalid-input' ? 'Tool input validation failed' : 'Tool execution or output validation failed');
        const output = { isError: false, content: [{ type: 'text', text: result.text }], ...(result.noOutput ? {} : { structuredContent: JSON.parse(result.text) }) };
        if (new TextEncoder().encode(JSON.stringify(legacy ? output : { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': config.serverInfo }, ...output })).length > MAX_TOOL_RESULT_BYTES) throw new AdmissionError(500, -32603, 'Response body limit exceeded');
        return output;
      }
    });
    // Body acquisition is lazy: rejected Origin/path/method/header requests never read it.
    let body;
    const request = { url: ctx.req.url, method: ctx.req.method, headers: new Headers(ctx.req.headers), signal: lifecycle.signal,
      get body() {
        if (!body) body = new ReadableStream({ async pull(controller) {
          try { controller.enqueue(new TextEncoder().encode(await ctx.req.text())); controller.close(); }
          catch (error) { controller.error(error?.code === 'PULSE_BODY_TOO_LARGE' ? new AdmissionError(413, -32600, 'Request body limit exceeded') : error); }
        } }, { highWaterMark: 0 });
        return body;
      }
    };
    return handler.fetch(request);
  } });
}
module.exports = { mcp, EntityRouter, jsonRpc };
