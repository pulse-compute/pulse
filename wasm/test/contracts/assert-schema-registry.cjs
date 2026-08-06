#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractSchemaRegistry,
  SchemaRegistryExtractionError
} = require('../../packages/schema-json/src/compiler/schema-registry.js');
const {
  SCHEMA_REGISTRY_IR_VERSION,
  SCHEMA_CODEC_INPUTS_VERSION,
  defaultSchemaBoundaryPolicy,
  defaultSchemaRegistryContract
} = require('../../packages/contracts/src/schema-json/registry.js');
const {
  JSON_SEMANTIC_TRACE_VERSION,
  semanticValueDigest,
  normalizeJsonTraceEvent,
  operationIdentity,
  defaultJsonSemanticTraceContract
} = require('../../packages/contracts/src/schema-json/semantic-trace.js');
const {
  resolveProject,
  projectJson,
  normalizeSchemaConfig,
  PulseProjectError
} = require('../../packages/cli/src/project-config.js');
const { compileProject } = require('../../packages/cli/src/project-execution.js');
const {
  compileCanonicalSource
} = require('../../packages/compiler/src/canonical-api-compiler.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-registry');
const schemaFile = path.join(fixtureRoot, 'src/pulse/schemas/index.ts');

function schemaById(registry, id) {
  const schema = registry.schemas.find((entry) => entry.id === id);
  assert.ok(schema, `missing schema ${id}`);
  return schema;
}

function fieldByName(schema, name) {
  const field = schema.root.fields.find((entry) => entry.name === name);
  assert.ok(field, `missing field ${schema.id}.${name}`);
  return field;
}

function writeCase(root, registryText, modelsText = 'export interface Value { id: string }\n') {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/models.ts'), modelsText);
  fs.writeFileSync(path.join(root, 'src/registry.ts'), registryText);
  return path.join(root, 'src/registry.ts');
}

function expectExtractionCode(registryText, code, modelsText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-schema-registry-negative-'));
  try {
    const file = writeCase(root, registryText, modelsText);
    assert.throws(
      () => extractSchemaRegistry(file, { projectRoot: root }),
      (error) => error instanceof SchemaRegistryExtractionError && error.code === code,
      `expected ${code}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const first = extractSchemaRegistry(schemaFile, { projectRoot: fixtureRoot });
const second = extractSchemaRegistry(schemaFile, { projectRoot: fixtureRoot });
assert.deepEqual(second, first, 'static registry extraction must be deterministic');
assert.equal(first.version, 'pulse.schema-registry-extractor.v1');
assert.equal(first.registry.version, SCHEMA_REGISTRY_IR_VERSION);
assert.equal(first.codecInputs.version, SCHEMA_CODEC_INPUTS_VERSION);
assert.equal(first.registry.schemas.length, 3);
assert.equal(first.registry.responses.length, 3);
assert.match(first.registry.registryHash, /^[0-9a-f]{64}$/);
assert.deepEqual(first.dependencies.map((file) => path.relative(fixtureRoot, file).replace(/\\/g, '/')), [
  'src/pulse/schemas/index.ts',
  'src/pulse/schemas/models.ts'
]);

const input = schemaById(first.registry, 'app.createInput');
assert.deepEqual(input.root.fields.map((field) => field.name), [
  'name',
  'attempts',
  'quota',
  'role',
  'address',
  'tags',
  'referralCode'
]);
assert.equal(fieldByName(input, 'attempts').value.kind, 'i32');
assert.equal(fieldByName(input, 'quota').value.kind, 'u32');
assert.deepEqual(fieldByName(input, 'role').value, { kind: 'string-enum', values: ['admin', 'member'] });
assert.deepEqual(fieldByName(input, 'address').value.fields.map((field) => field.name), ['city', 'postalCode']);
assert.deepEqual(fieldByName(input, 'tags').value, { kind: 'array', element: { kind: 'string' } });
assert.deepEqual(fieldByName(input, 'referralCode').value, { kind: 'nullable', value: { kind: 'string' } });
assert.deepEqual(first.registry.responses.map((entry) => [entry.id, entry.status, entry.schemaId]), [
  ['user.created', 201, 'app.user'],
  ['user.success', 200, 'app.user'],
  ['user.failure', 200, 'app.error']
]);
assert.equal(first.codecInputs.native.backend, 'json-as');
assert.equal(first.codecInputs.native.packageVersion, '1.5.0');
assert.equal(first.codecInputs.native.assemblyScriptVersion, '0.28.18');
assert.equal(first.codecInputs.native.generatedOnly, true);
assert.equal(first.codecInputs.native.publicDecorators, false);
assert.equal(first.codecInputs.javascript.backend, 'pulse-generated');
assert.deepEqual(
  first.codecInputs.native.schemas.find((entry) => entry.id === 'app.createInput').classes.map((entry) => entry.symbol),
  ['__Pulse_app_createInput_address', '__Pulse_app_createInput']
);

const project = resolveProject({ cwd: fixtureRoot, env: {} });
const inspection = projectJson(project);
assert.equal(project.schemaFile, schemaFile);
assert.equal(project.schemas.registry.registryHash, first.registry.registryHash);
assert.equal(project.schemas.contentTypePolicy, 'require-json');
assert.equal(project.schemas.maxBytes, 32768);
assert.deepEqual(inspection.schemas.ids, ['app.createInput', 'app.user', 'app.error']);
assert.deepEqual(inspection.schemas.responseCases, ['user.created', 'user.success', 'user.failure']);
assert.equal(inspection.schemas.authority, 'pulse.schema');
assert.equal(inspection.schemas.codecRealization, 'cross-target-codecs');
const compiled = compileProject(project);
assert.equal(compiled.schema.active, true);
assert.equal(compiled.schema.realization, 'cross-target-codecs');
assert.deepEqual(compiled.schema.bundle.schemaIds, ['app.createInput', 'app.user', 'app.error']);
assert.deepEqual(compiled.schema.bundle.declaredSchemaIds, ['app.createInput', 'app.user', 'app.error']);
assert.deepEqual(compiled.schema.bundle.deferredSchemaIds, []);
assert.equal(compiled.schema.bundle.fullCodecRealization, true);
const richSchemaProgram = compileCanonicalSource(
  `export default async function handler(ctx) {
    const value = await ctx.req.json('app.createInput')
    return ctx.text(value.name)
  }`,
  {
    fileName: 'realized-rich-schema.ts',
    strict: true,
    schemaBundle: compiled.schema.bundle,
    requireAsync: true
  }
);
assert.equal(richSchemaProgram.ok, true);
assert.deepEqual(richSchemaProgram.metadata.schemaIds, ['app.createInput', 'app.user', 'app.error']);
assert.deepEqual(
  compiled.watchFiles.filter((file) => file.includes('/pulse/schemas/')).map((file) => path.relative(fixtureRoot, file).replace(/\\/g, '/')),
  ['src/pulse/schemas/index.ts', 'src/pulse/schemas/models.ts']
);

assert.throws(
  () => normalizeSchemaConfig({ json: [] }, fixtureRoot),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED'
);
assert.throws(
  () => normalizeSchemaConfig({ defaultNamespace: 'app' }, fixtureRoot),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED'
);

const barrelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-schema-registry-barrel-'));
try {
  fs.mkdirSync(path.join(barrelRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(barrelRoot, 'src/leaf.ts'), 'export interface BarrelValue { id: string }\n');
  fs.writeFileSync(path.join(barrelRoot, 'src/barrel.ts'), "export { type BarrelValue as Value } from './leaf.js'\n");
  const barrelRegistry = writeCase(
    barrelRoot,
    `
      import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
      import type { Value } from './barrel.js'
      export default defineSchemaRegistry({ schemas: { 'app.value': schema<Value>() } })
    `
  );
  const barrelExtraction = extractSchemaRegistry(barrelRegistry, { projectRoot: barrelRoot });
  assert.deepEqual(
    barrelExtraction.dependencies.map((file) => path.relative(barrelRoot, file).replace(/\\/g, '/')),
    ['src/barrel.ts', 'src/leaf.ts', 'src/registry.ts']
  );
  assert.deepEqual(barrelExtraction.registry.schemas[0].root.fields.map((field) => field.name), ['id']);
} finally {
  fs.rmSync(barrelRoot, { recursive: true, force: true });
}

const sharedPrefix = `
  import { defineSchemaRegistry, schema, response } from '@pulse-compute/pulse/schema'
  import type { Value } from './models.js'
`;
expectExtractionCode(`${sharedPrefix}
  export default defineSchemaRegistry({ schemas: {
    'app.value': schema<Value>(),
    'app.value': schema<Value>(),
  } })
`, 'PULSE_SCHEMA_ID_DUPLICATE');
expectExtractionCode(`${sharedPrefix}
  export default defineSchemaRegistry({
    schemas: { 'app.value': schema<Value>() },
    responses: { 'value.ok': response(200, 'app.missing') },
  })
`, 'PULSE_RESPONSE_SCHEMA_UNKNOWN');
expectExtractionCode(`${sharedPrefix}
  const id = 'app.value'
  export default defineSchemaRegistry({ schemas: { [id]: schema<Value>() } })
`, 'PULSE_SCHEMA_REGISTRY_STATIC_KEY_REQUIRED');
expectExtractionCode(`${sharedPrefix}
  export default defineSchemaRegistry({ schemas: { 'app.value': schema<Value>() } })
`, 'PULSE_SCHEMA_OPTIONAL_FIELD_RESERVED', 'export interface Value { id?: string }\n');
expectExtractionCode(`
  import { JSON } from 'json-as'
  import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
  interface Value { id: string }
  export default defineSchemaRegistry({ schemas: { 'app.value': schema<Value>() } })
`, 'PULSE_SCHEMA_PUBLIC_JSON_AS_IMPORT_FORBIDDEN');

const registryContract = defaultSchemaRegistryContract();
assert.equal(registryContract.policies.canonicalEntrypoint, 'pulse.schema');
assert.equal(registryContract.policies.oldSchemasJsonSupported, false);
assert.equal(registryContract.policies.optionalPropertiesSupported, false);
assert.equal(registryContract.policies.publicJsonAsImportsSupported, false);
assert.equal(registryContract.policies.automaticFallback, false);
assert.deepEqual(registryContract.boundaryPolicy, defaultSchemaBoundaryPolicy());
assert.equal(registryContract.boundaryPolicy.strict.missingSchemaId, 'diagnostic');
assert.equal(registryContract.boundaryPolicy.nonStrict.missingSchemaId, 'generic-json');
assert.equal(registryContract.boundaryPolicy.nonStrict.unknownSchemaId, 'diagnostic');
assert.equal(registryContract.boundaryPolicy.genericJsonFallbackForUnknownId, false);
assert.equal(registryContract.boundaryPolicy.schemaTrialFallback, false);
assert.equal(registryContract.boundaryPolicy.jsonBodyOwnership, 'pulse-semantic-encoding');
assert.equal(registryContract.boundaryPolicy.bodyOwnership, 'caller-exact-payload');
assert.equal(registryContract.boundaryPolicy.bodyAndJsonMutuallyExclusive, true);

const redactor = (value, pointer) => pointer === '/token' ? '<redacted>' : value;
const digest = semanticValueDigest({ token: 'never-record', label: 'e\u0301', value: -0 }, { redact: redactor });
assert.equal(digest, semanticValueDigest({ label: '\u00e9', token: '<redacted>', value: 0 }));
assert.equal(JSON.stringify({ digest }).includes('never-record'), false);
const event = normalizeJsonTraceEvent({
  kind: 'json.encode.response',
  boundary: 'application-response',
  schemaId: 'app.user',
  responseCaseId: 'user.success',
  operationId: operationIdentity({ route: 'GET /user', site: 2 }),
  status: 200,
  contentType: ' Application/JSON; Charset=UTF-8 ',
  headers: [['X-B', ' two  words '], ['x-a', 'one']],
  bodyOwnership: 'application-owned',
  valueDigest: digest,
  target: 'native',
  provider: 'node'
});
assert.equal(event.version, JSON_SEMANTIC_TRACE_VERSION);
assert.equal(event.contentType, 'application/json; charset=utf-8');
assert.deepEqual(event.headers, [['x-a', 'one'], ['x-b', 'two words']]);
assert.match(event.operationId, /^jsonop:[0-9a-f]{24}$/);
assert.match(event.eventDigest, /^[0-9a-f]{64}$/);
const errorEvent = normalizeJsonTraceEvent({
  kind: 'json.decode.error',
  boundary: 'fetch-response',
  schemaId: 'app.user',
  operationId: 'fetch:3',
  bodyOwnership: 'fetched-response-snapshot',
  errorCode: 'PULSE_SCHEMA_DECODE',
  errorPath: ['items', '0', 'name'],
  expected: 'string',
  actualKind: 'number'
});
assert.equal(errorEvent.errorPath, '/items/0/name');
assert.equal(defaultJsonSemanticTraceContract().parity, 'semantic-not-byte');
assert.throws(
  () => normalizeJsonTraceEvent({
    kind: 'json.decode.request',
    boundary: 'fetch-response',
    operationId: 'request:1',
    bodyOwnership: 'request-snapshot'
  }),
  (error) => error.code === 'PULSE_JSON_TRACE_EVENT_BOUNDARY_MISMATCH'
);
assert.throws(
  () => semanticValueDigest({ 'e\u0301': 1, '\u00e9': 2 }),
  (error) => error.code === 'PULSE_JSON_TRACE_KEY_NORMALIZATION_COLLISION'
);
assert.throws(
  () => semanticValueDigest(new Date(0)),
  (error) => error.code === 'PULSE_JSON_TRACE_VALUE_UNSUPPORTED'
);

const pulseSchemaRuntime = require('../../../packages/pulse/src/schema.js');
const declaration = pulseSchemaRuntime.schema();
const responseCase = pulseSchemaRuntime.response(201, 'app.user');
const registryDeclaration = pulseSchemaRuntime.defineSchemaRegistry({
  schemas: { 'app.user': declaration },
  responses: { 'user.created': responseCase }
});
assert.equal(Object.isFrozen(registryDeclaration), true);
assert.equal(responseCase.schemaId, 'app.user');
assert.equal(pulseSchemaRuntime.SCHEMA_AUTHORING_VERSION, 'pulse.schema-authoring.v1');

console.log('ok - pulse.schema extracts versioned schema/response IR and locks semantic trace and backend-input contracts');
