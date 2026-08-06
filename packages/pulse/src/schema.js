'use strict';

const SCHEMA_AUTHORING_VERSION = 'pulse.schema-authoring.v1';
const SCHEMA_DECLARATION_BRAND = Symbol.for('pulse.schema-declaration.v1');
const RESPONSE_CASE_DECLARATION_BRAND = Symbol.for('pulse.response-case-declaration.v1');
const SCHEMA_REGISTRY_BRAND = Symbol.for('pulse.schema-registry.v1');

function schema() {
  return Object.freeze({
    version: SCHEMA_AUTHORING_VERSION,
    [SCHEMA_DECLARATION_BRAND]: true
  });
}

function response(status, schemaId) {
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new TypeError('response(status, schemaId) requires an HTTP status from 100 through 599.');
  }
  if (typeof schemaId !== 'string' || schemaId.trim() === '') {
    throw new TypeError('response(status, schemaId) requires a non-empty schema ID.');
  }
  return Object.freeze({
    version: SCHEMA_AUTHORING_VERSION,
    status,
    schemaId: schemaId.trim(),
    [RESPONSE_CASE_DECLARATION_BRAND]: true
  });
}

function defineSchemaRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new TypeError('defineSchemaRegistry requires a static registry object.');
  }
  return Object.freeze({
    ...registry,
    [SCHEMA_REGISTRY_BRAND]: SCHEMA_AUTHORING_VERSION
  });
}

module.exports = Object.freeze({
  SCHEMA_AUTHORING_VERSION,
  defineSchemaRegistry,
  schema,
  response
});
