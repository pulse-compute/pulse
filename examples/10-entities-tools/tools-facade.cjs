'use strict';

const TOOLS_FACADE_VERSION = 'pulse.entities-tools-facade-demo.v1';
const TOOLS_CATALOG_VERSION = 'pulse.entities-tools-catalog-demo.v1';

const TOOLS_FACADE_POLICY = Object.freeze({
  completeMcpServer: false,
  discovery: 'static-entity-catalog',
  invocation: 'json-rpc-2.0-request-boundary',
  governedExecution: 'pulse-entity-handler',
  excluded: Object.freeze([
    'sse',
    'sessions',
    'tasks',
    'resources',
    'prompts',
    'sampling',
    'authorization',
    'transport-negotiation',
    'runtime-core-protocol-state'
  ])
});

class ToolsFacadeInvocationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolsFacadeInvocationError';
    this.code = code;
  }
}

function staticMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : Object.freeze({});
}

function projectTool(entity) {
  const metadata = staticMetadata(entity.metadata);
  const hints = staticMetadata(metadata.mcp);
  return Object.freeze({
    name: entity.name,
    title: typeof metadata.title === 'string' ? metadata.title : entity.name,
    description: typeof metadata.description === 'string' ? metadata.description : '',
    inputSchemaId: entity.inputSchema,
    outputSchemaId: entity.outputSchema,
    annotations: Object.freeze({ readOnlyHint: hints.readOnlyHint === true })
  });
}

function readTools(catalog) {
  if (!catalog || catalog.version !== 'pulse.entities-catalog.v1') {
    throw new TypeError('Tools facade requires a pulse.entities-catalog.v1 artifact.');
  }
  if (!Array.isArray(catalog.routers) || catalog.routers.length !== 1) {
    throw new TypeError('Tools facade demonstration requires exactly one static entity router.');
  }
  const router = catalog.routers[0];
  if (!router || router.adapter !== 'json-rpc' || !Array.isArray(router.entities)) {
    throw new TypeError('Tools facade demonstration requires one JSON-RPC entity router.');
  }
  const tools = router.entities.map(projectTool);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new TypeError('Tools facade catalog contains duplicate tool names.');
  }
  return Object.freeze(tools);
}

function requestId(value) {
  if (value === null || typeof value === 'string' || Number.isFinite(value)) return value;
  throw new TypeError('Tools facade request ID must be a string, finite number, or null.');
}

function createToolsFacade({ catalog, invoke }) {
  if (typeof invoke !== 'function') {
    throw new TypeError(
      'Tools facade requires an injected request-boundary invoker.'
    );
  }
  const tools = readTools(catalog);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  return Object.freeze({
    version: TOOLS_FACADE_VERSION,
    policy: TOOLS_FACADE_POLICY,
    listTools() {
      return Object.freeze({ version: TOOLS_CATALOG_VERSION, tools });
    },
    async callTool(name, input, options = {}) {
      const tool = toolsByName.get(name);
      if (!tool) throw new RangeError(`Unknown catalog tool ${String(name)}.`);
      if (
        tool.inputSchemaId !== null
        && (input === null || typeof input !== 'object' || Array.isArray(input))
      ) {
        throw new TypeError(`Tool ${name} requires a named object input.`);
      }
      if (tool.inputSchemaId === null && input !== undefined) {
        throw new TypeError(`Tool ${name} does not accept input.`);
      }
      const envelope = {
        jsonrpc: '2.0',
        method: name,
        ...(tool.inputSchemaId === null ? {} : { params: input }),
        id: requestId(options.id === undefined ? `tools:${name}` : options.id)
      };
      const response = await invoke(Object.freeze({
        method: 'POST',
        headers: Object.freeze([Object.freeze(['content-type', 'application/json'])]),
        body: JSON.stringify(envelope)
      }));
      const status = Number(response && response.status);
      const body = response && typeof response.body === 'string' ? response.body : '';
      if (status !== 200 || body.length === 0) {
        throw new ToolsFacadeInvocationError(
          'PULSE_TOOLS_BOUNDARY_RESPONSE_INVALID',
          'Tool request boundary returned an invalid response.'
        );
      }
      let payload;
      try { payload = JSON.parse(body); }
      catch (_) {
        throw new ToolsFacadeInvocationError(
          'PULSE_TOOLS_BOUNDARY_JSON_INVALID',
          'Tool request boundary returned invalid JSON.'
        );
      }
      if (
        !payload
        || payload.jsonrpc !== '2.0'
        || JSON.stringify(payload.id) !== JSON.stringify(envelope.id)
      ) {
        throw new ToolsFacadeInvocationError(
          'PULSE_TOOLS_BOUNDARY_ENVELOPE_INVALID',
          'Tool request boundary returned an invalid JSON-RPC envelope.'
        );
      }
      if (payload.error) {
        throw new ToolsFacadeInvocationError(
          'PULSE_TOOLS_CALL_FAILED',
          typeof payload.error.message === 'string' ? payload.error.message : 'Tool call failed.'
        );
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
        throw new ToolsFacadeInvocationError(
          'PULSE_TOOLS_BOUNDARY_RESULT_MISSING',
          'Tool request boundary omitted the result.'
        );
      }
      return payload.result;
    }
  });
}

module.exports = Object.freeze({
  TOOLS_FACADE_POLICY,
  TOOLS_FACADE_VERSION,
  ToolsFacadeInvocationError,
  createToolsFacade
});
