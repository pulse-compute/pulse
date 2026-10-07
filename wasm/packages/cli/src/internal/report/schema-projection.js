'use strict';

const { copyData, canonicalJson, fail, freeze } = require('./data');
const { capsuleSchema } = require('./schema');
const { validate } = require('./validate');
const VERSION = 'pulse.report-schema-shape.v1';
const REGISTRY_VERSION = 'pulse.schema-registry-ir.v5';
const order = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const unknown = reason => ({ representation: VERSION, state: 'unavailable', reason,
  descriptor: null, descriptorBytes: null, keyCountsState: 'unavailable', topLevelKeys: null, requiredKeys: null, properties: [] });
function normalizeNode(node) {
  if (node.kind === 'object') {
    const seen = new Set();
    for (const field of node.fields) {
      if (seen.has(field.name)) fail('REPORT_SCHEMA');
      seen.add(field.name); normalizeNode(field.value);
    }
    node.fields.sort(order);
  } else if (node.kind === 'array') normalizeNode(node.element);
  else if (node.kind === 'nullable') normalizeNode(node.value);
  return node;
}
function structureFromDescriptor(input) {
  const descriptor = copyData(input);
  validate(descriptor, capsuleSchema.$defs.Descriptor, capsuleSchema);
  normalizeNode(descriptor.root);
  const object = descriptor.root.kind === 'object';
  const properties = object ? descriptor.root.fields.map(field => ({ name: field.name, type: field.value.kind, required: field.required })) : [];
  return { representation: VERSION, state: 'available', reason: null, descriptor,
    descriptorBytes: Buffer.byteLength(canonicalJson(descriptor)), keyCountsState: object ? 'available' : 'not-applicable',
    topLevelKeys: object ? properties.length : null,
    requiredKeys: object ? properties.filter(field => field.required).length : null, properties };
}
function projectSchema(schema, registryVersion = REGISTRY_VERSION) {
  if (registryVersion !== REGISTRY_VERSION) return freeze(unknown('unsupported-schema-version'));
  try {
    const input = copyData(schema);
    function node(value) {
      switch (value.kind) {
        case 'string': case 'boolean': case 'i32': case 'u32': case 'f64': case 'json-value': case 'json-object':
          return { kind: value.kind };
        case 'string-enum':
          if (!Array.isArray(value.values) || !value.values.length || value.values.some(v => typeof v !== 'string')
            || new Set(value.values).size !== value.values.length) fail('REPORT_SCHEMA');
          return { kind: value.kind, literalCount: value.values.length };
        case 'scalar-record': return { kind: value.kind, limits: value.limits };
        case 'array': return { kind: value.kind, element: node(value.element) };
        case 'nullable': return { kind: value.kind, value: node(value.value) };
        case 'object':
          if (value.additionalProperties !== undefined && value.additionalProperties?.kind !== 'json-value') fail('REPORT_SCHEMA');
          return { kind: value.kind, fields: value.fields.map(field => ({ name: field.name,
            required: field.required, value: node(field.value) })), additionalProperties: value.additionalProperties !== undefined };
        default: fail('REPORT_SCHEMA');
      }
    }
    // Defaults, examples, descriptions, literal enum values, source and unknown
    // constraints are deliberately excluded from this structural representation.
    const descriptor = { representation: VERSION, root: node(input.root), jsonLimits: input.jsonLimits || null };
    return freeze(structureFromDescriptor(descriptor));
  } catch { return freeze(unknown('unsupported-schema-shape')); }
}
module.exports = { DESCRIPTOR_VERSION: VERSION, REGISTRY_VERSION, projectSchema, structureFromDescriptor };
