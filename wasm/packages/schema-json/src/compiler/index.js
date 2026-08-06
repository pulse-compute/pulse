'use strict';

const schemaJsonCompile = require('./schema-json-compile.js');
const schemaJsonSidecar = require('./schema-json-sidecar.js');
const schemaJsonGenericParser = require('./schema-json-generic-parser.js');
const schemaJsonSidecarV2 = require('./schema-json-sidecar-v2.js');
const canonicalSchemaCodecs = require('./canonical-schema-codecs.js');
const schemaRegistry = require('./schema-registry.js');

module.exports = {
  schemaJsonCompile,
  schemaJsonSidecar,
  schemaJsonGenericParser,
  schemaJsonSidecarV2,
  canonicalSchemaCodecs,
  schemaRegistry,
  ...schemaJsonCompile,
  ...schemaJsonSidecar,
  ...schemaJsonGenericParser,
  ...schemaJsonSidecarV2,
  ...canonicalSchemaCodecs,
  ...schemaRegistry
};
