'use strict';

const { fail } = require('./data');
// Only the vocabulary used by the owned v1 schemas. No external $ref loading.
function resolve(schema, document) { return schema.$ref ? document.$defs[schema.$ref.slice('#/$defs/'.length)] : schema; }
function validate(value, schema, document = schema, field = '$') {
  schema = resolve(schema, document);
  if (!schema) fail('REPORT_SCHEMA', field);
  if (schema.anyOf || schema.oneOf) {
    const matches = (schema.anyOf || schema.oneOf).filter(branch => {
      try { validate(value, branch, document, field); return true; } catch { return false; }
    });
    if (schema.oneOf ? matches.length !== 1 : !matches.length) fail('REPORT_SCHEMA', field);
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail('REPORT_SCHEMA', field);
  if (schema.enum && !schema.enum.includes(value)) fail('REPORT_SCHEMA', field);
  if (schema.type === 'null' && value !== null) fail('REPORT_SCHEMA', field);
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail('REPORT_SCHEMA', field);
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)) fail('REPORT_SCHEMA', field);
  if (schema.type === 'string' && (typeof value !== 'string' || value.length < (schema.minLength || 0)
    || value.length > (schema.maxLength || Infinity) || schema.pattern && !new RegExp(schema.pattern).test(value))) fail('REPORT_SCHEMA', field);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) fail('REPORT_SCHEMA', field);
    value.forEach((entry, index) => validate(entry, schema.items, document, `${field}[${index}]`));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('REPORT_SCHEMA', field);
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))
      || schema.required.some(key => !Object.hasOwn(value, key))) fail('REPORT_SCHEMA', field);
    for (const key of Object.keys(value)) validate(value[key], schema.properties[key], document, `${field}.${key}`);
  }
}
function project(value, schema, document = schema) {
  schema = resolve(schema, document);
  if (schema.anyOf) return value === null ? null : project(value, schema.anyOf.find(s => s.type !== 'null'), document);
  if (schema.oneOf) {
    const branch = schema.oneOf.find(s => s.properties?.kind?.const === value?.kind || s.properties?.kind?.enum?.includes(value?.kind));
    if (!branch) fail('REPORT_SCHEMA');
    return project(value, branch, document);
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(schema.properties).filter(key => Object.hasOwn(value, key))
      .map(key => [key, project(value[key], schema.properties[key], document)]));
  }
  if (schema.type === 'array' && Array.isArray(value)) return value.map(item => project(item, schema.items, document));
  return value;
}
module.exports = { validate, project };
