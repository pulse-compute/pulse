'use strict';

const { checkDepth } = require('./bounded.js');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new TypeError('Invalid or unsupported MCP catalog/schema artifact'); };
const schemaUri = 'https://json-schema.org/draft/2020-12/schema';

// Artifact data only: never load generated codecs, registries or application modules.
function snapshot(value) {
  const text = JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > 1048576) fail();
  checkDepth(text, 32);
  return JSON.parse(text);
}

function projectCatalog(options, limits) {
  const catalog = snapshot(options.catalog), registry = snapshot(options.schemas);
  if (catalog.version !== 'pulse.entities-catalog.v1' || catalog.contractId !== 'pulse.entities'
    || !/^[a-f0-9]{64}$/.test(catalog.catalogHash) || !Array.isArray(catalog.routers)
    || registry.version !== 'pulse.canonical-schema-registry.v4' || registry.registryIrVersion !== 'pulse.schema-registry-ir.v5'
    || !/^[a-f0-9]{64}$/.test(registry.registryHash) || !Array.isArray(registry.schemas)
    || !['node-javascript', 'node-native', 'fastly-javascript', 'fastly-native'].includes(options.target)) fail();
  const schemas = new Map();
  for (const schema of registry.schemas) {
    if (!object(schema) || typeof schema.id !== 'string' || schemas.has(schema.id)) fail();
    schemas.set(schema.id, schema);
  }
  const routerIds = new Set();
  for (const router of catalog.routers) {
    if (!object(router) || typeof router.id !== 'string' || !router.id || routerIds.has(router.id)) fail();
    routerIds.add(router.id);
  }
  const router = catalog.routers.find(item => item.id === options.routerId);
  if (!router || router.adapter !== 'json-rpc' || router.binding !== 'request' || !Array.isArray(router.entities)
    || router.entities.length > 128) fail();
  let nodes = 0;
  function project(node, output, depth = 0) {
    if (!object(node) || ++nodes > 4096 || depth > 24) fail();
    const descend = child => project(child, output, depth + 1);
    switch (node.kind) {
      case 'string': return { type: 'string' };
      case 'boolean': return { type: 'boolean' };
      case 'i32': return { type: 'integer', minimum: -2147483648, maximum: 2147483647 };
      case 'u32': return { type: 'integer', minimum: 0, maximum: 4294967295 };
      case 'f64': return { type: 'number' };
      case 'json-value': return {};
      case 'json-object': return { type: 'object' };
      case 'array': return { type: 'array', items: descend(node.element) };
      case 'nullable': return { anyOf: [descend(node.value), { type: 'null' }] };
      case 'string-enum':
        if (!Array.isArray(node.values) || !node.values.length || node.values.some(value => typeof value !== 'string')
          || new Set(node.values).size !== node.values.length) fail();
        return { type: 'string', enum: node.values };
      case 'object': {
        if (!Array.isArray(node.fields) || (node.additionalProperties !== undefined
          && (!object(node.additionalProperties) || node.additionalProperties.kind !== 'json-value'))) fail();
        const properties = Object.create(null), required = [];
        for (const field of node.fields) {
          if (!object(field) || typeof field.name !== 'string' || !field.name || Object.hasOwn(properties, field.name)
            || typeof field.required !== 'boolean') fail();
          properties[field.name] = descend(field.value);
          if (field.required) required.push(field.name);
        }
        // Closed Pulse inputs drop extras; encoded outputs contain declared fields only.
        return { type: 'object', properties, required, additionalProperties: !output || node.additionalProperties !== undefined };
      }
      default: fail(); // ScalarRecord byte/key semantics need a separately qualified projection.
    }
  }
  function schemaFor(id, output) {
    const schema = schemas.get(id);
    if (!schema || schema.root?.kind !== 'object') fail();
    return { $schema: schemaUri, ...project(schema.root, output) };
  }
  const entries = new Map();
  for (const entity of router.entities) {
    if (!object(entity) || typeof entity.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(entity.name)
      || entries.has(entity.name) || entity.eligibility?.[options.target] !== true
      || ![entity.inputSchema, entity.outputSchema].every(id => id === null || typeof id === 'string')) fail();
    const tool = { name: entity.name, inputSchema: entity.inputSchema === null
      ? { $schema: schemaUri, type: 'object', additionalProperties: false } : schemaFor(entity.inputSchema, false) };
    if (entity.outputSchema !== null) tool.outputSchema = schemaFor(entity.outputSchema, true);
    if (entity.metadata !== undefined && !object(entity.metadata)) fail();
    for (const key of ['title', 'description']) if (entity.metadata?.[key] !== undefined) {
      if (typeof entity.metadata[key] !== 'string') fail();
      tool[key] = entity.metadata[key];
    }
    const annotations = {};
    for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      const value = entity.metadata?.mcp?.[key];
      if (value !== undefined) { if (typeof value !== 'boolean') fail(); annotations[key] = value; }
    }
    if (Object.keys(annotations).length) tool.annotations = annotations;
    entries.set(entity.name, { tool, noInput: entity.inputSchema === null, noOutput: entity.outputSchema === null });
  }
  const list = [...entries.values()].map(entry => entry.tool).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // Leave room for the largest admitted ID and protocol/server metadata.
  if (new TextEncoder().encode(JSON.stringify(list)).length + limits.maxRequestBytes + 2048 > limits.maxResponseBytes) fail();
  return { entries, list };
}

// Structural check of successful backend output. The governed schema codec owns
// byte, depth, aggregate JSON and ScalarRecord admission; it remains authoritative.
function matches(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(item => matches(value, item));
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case undefined: return true;
    case 'null': return value === null;
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
    case 'array': return Array.isArray(value) && value.every(item => matches(item, schema.items));
    case 'object': return object(value) && (schema.required ?? []).every(key => Object.hasOwn(value, key))
      && Object.entries(value).every(([key, item]) => Object.hasOwn(schema.properties ?? {}, key)
        ? matches(item, schema.properties[key]) : schema.additionalProperties !== false);
    default: return false;
  }
}

module.exports = { projectCatalog, matches };
