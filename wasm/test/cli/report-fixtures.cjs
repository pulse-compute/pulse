'use strict';

const path = require('node:path');
const reportRoot = path.resolve(__dirname, '../../packages/cli/src/internal/report');
const { createCapsule, artifactId, bodyId, stableReportId, serializeCapsule } = require(path.join(reportRoot, 'capsule'));
const { sha256 } = require(path.join(reportRoot, 'data'));
const { projectSchema } = require(path.join(reportRoot, 'schema-projection'));
const { capsuleSchema, completionSchema, attributionSchema } = require(path.join(reportRoot, 'schema'));
const wasm = Buffer.from([0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 3,4,3,0,0,0, 10,14,3,4,0,16,2,11,4,0,16,2,11,2,0,11]);
const hash = sha256(wasm), aid = artifactId(hash), buildId = stableReportId('evidence', 'synthetic-build');
const id = (kind, key) => stableReportId(kind, key);
const coverage = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const fact = (value, basis = 'measured') => ({ state: 'available', basis, coverage: 'exact', value, reason: null, evidenceIds: [buildId] });
const unavailable = reason => ({ state: 'unavailable', basis: 'measured', coverage: 'partial', value: null, reason, evidenceIds: [] });
function fixture(rich = true) {
  const result = {
    kind: 'pulse.application-report', reportVersion: 1,
    producer: { pulseVersion: '1.0.0-beta.7', reporterVersion: '1' },
    context: { profile: 'native', host: 'node', target: 'native', representation: 'canonical-native-wasm', primaryArtifactId: aid },
    provenance: { revision: null, dirty: null, sourceFingerprint: null, buildEvidenceId: buildId,
      toolchain: [{ name: 'contract-fixture', version: '1' }], recipe: { name: 'synthetic', version: '1', optimization: 'unavailable', guestLinked: false } },
    coverage: Object.fromEntries(['routes', 'entries', 'schemas', 'bindings', 'resources'].map(name => [name, coverage(0)])),
    application: { name: 'Synthetic capsule contract fixture' }, routes: [], entries: [], declarations: [], schemas: [], bindings: [], resources: [],
    artifacts: [{ id: aid, representation: 'canonical-native-wasm', stage: 'final', host: 'node', target: 'portable-native-wasm',
      bytes: wasm.length, sha256: hash, sections: [{ index: 0, id: 1, bytes: 6, payloadBytes: 4 },
        { index: 1, id: 3, bytes: 6, payloadBytes: 4 }, { index: 2, id: 10, bytes: 16, payloadBytes: 14 }],
      sectionCoverage: coverage(3), evidenceIds: [buildId] }],
    bodies: [], rootSets: [], measurements: [], observations: [],
    evidence: [{ id: buildId, kind: 'build', producer: { name: 'contract-fixture', version: '1' },
      method: 'synthetic fixture, not application qualification', artifactIds: [aid], source: null, subjectIds: [],
      result: 'passed', scope: { corpus: null, cases: [], targets: ['native'] }, recordedAt: null }]
  };
  if (!rich) return result;
  const schema = id('schema', 'app.UpdateInput'), binding = id('binding', 'items'), handler = id('handler', 'shared');
  result.bodies = [4,4,2].map((bytes, index) => ({ id: bodyId(hash, index), index, bytes, artifactId: aid }));
  for (const index of [0, 1]) {
    const entry = id('entry', 'entry-' + index), route = id('route', 'route-' + index);
    result.entries.push({ id: entry, canonicalId: 'entry-' + index, kind: 'route', order: index, handlerId: handler,
      name: 'shared', source: { file: 'src/routes.ts', line: index + 1, column: 1 }, schemaIds: [schema], bindingIds: [binding], declarationIds: [], evidenceIds: [buildId] });
    result.routes.push({ id: route, canonicalId: 'route-' + index, order: index, method: 'GET', path: '/same', handlerId: handler,
      handlerName: 'shared', entryId: entry, source: null, composition: [entry], schemaIds: [schema], bindingIds: [binding], declarationIds: [], evidenceIds: [buildId] });
    result.measurements.push({ id: id('measurement', 'direct-' + index), subjectId: route, artifactId: aid, stage: 'final',
      metric: 'handler-body', method: 'final-body-map-v1', fact: fact(4), mappedChunks: 1, expectedChunks: 1,
      bodyIds: [bodyId(hash, index)], rootSetId: null, rootId: null });
  }
  const routeIds = result.routes.map(row => row.id), entryIds = result.entries.map(row => row.id);
  result.schemas.push({ id: schema, schemaId: 'app.UpdateInput', registryVersion: 'pulse.schema-registry-ir.v5', source: { file: 'src/schemas.ts', line: 1, column: 1 },
    routeIds, entryIds, evidenceIds: [buildId], structure: projectSchema({ root: { kind: 'object', fields: [
      { name: 'label', required: true, value: { kind: 'string' }, default: 'SECRET_DEFAULT_CANARY' },
      { name: 'enabled', required: false, value: { kind: 'boolean' } }
    ] }, examples: ['SECRET_EXAMPLE_CANARY'] }) });
  result.bindings.push({ id: binding, name: 'items', kind: 'kv', declared: true, referenced: true, resolution: 'bound', routeIds, entryIds, evidenceIds: [buildId] });
  result.resources.push({ id: id('resource', 'asset'), name: 'logo.svg', kind: 'embedded-asset', mediaType: 'image/svg+xml', artifactId: null,
    inputBytes: fact(12, 'declared'), retainedPayloadBytes: unavailable('unsupported-mapping'), routeIds: [], entryIds: [], evidenceIds: [buildId] });
  const setId = id('root-set', 'http');
  result.rootSets.push({ id: setId, artifactId: aid, universeComplete: false, graph: 'static-direct-calls', evidenceIds: [buildId],
    roots: routeIds.map((subjectId, index) => ({ id: id('root', 'root-' + index), kind: 'route', subjectId, bodyIds: [bodyId(hash, index), bodyId(hash, 2)] })) });
  result.measurements.push({ id: id('measurement', 'reachable'), subjectId: routeIds[0], artifactId: aid, stage: 'final', metric: 'reachable',
    method: 'static-direct-calls-v1', fact: { ...fact(6), coverage: 'bounded' }, mappedChunks: 1, expectedChunks: 1,
    bodyIds: [bodyId(hash, 0), bodyId(hash, 2)], rootSetId: setId, rootId: id('root', 'root-0') });
  result.measurements.push({ id: id('measurement', 'own-unavailable'), subjectId: routeIds[0], artifactId: aid, stage: 'final', metric: 'own',
    method: 'unavailable', fact: unavailable('incomplete-root-universe'), mappedChunks: 1, expectedChunks: 1,
    bodyIds: [], rootSetId: setId, rootId: id('root', 'root-0') });
  for (const name of Object.keys(result.coverage)) result.coverage[name] = coverage(result[name].length);
  return structuredClone(result);
}
function completed() {
  const inventory = Buffer.from(serializeCapsule(createCapsule(fixture(false))));
  const completion = { kind: 'pulse.report-completion', completionVersion: 1, status: 'complete', operation: 'compile',
    manifestVersion: 'pulse.project-execution.v10', context: fixture(false).context,
    snapshot: { inputsSha256: '1'.repeat(64), profileSha256: '2'.repeat(64), recipeSha256: '3'.repeat(64) },
    artifacts: [{ id: aid, file: 'app.wasm', bytes: wasm.length, sha256: hash, stage: 'final' }],
    sidecars: [{ kind: 'inventory', version: 1, file: 'inventory.json', bytes: inventory.length, sha256: sha256(inventory), required: true },
      { kind: 'attribution', version: 1, file: 'attribution.json', bytes: 2, sha256: sha256('{}'), required: false }] };
  const completionBytes = Buffer.from(JSON.stringify(completion));
  const manifest = { version: 'pulse.project-execution.v10', status: 'compiled', target: 'portable-native-wasm', configuredProvider: 'node',
    configuredTarget: 'native', native: { wasm: { file: 'app.wasm', bytes: wasm.length, sha256: hash } },
    reportCompletion: { file: 'report-completion.json', bytes: completionBytes.length, sha256: sha256(completionBytes) } };
  return { completion, completionBytes, manifest, files: new Map([['app.wasm', wasm], ['inventory.json', inventory]]) };
}
function ts(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  if (schema.anyOf || schema.oneOf) return (schema.anyOf || schema.oneOf).map(ts).join(' | ');
  if (schema.type === 'object') return '{ ' + Object.entries(schema.properties).map(([key, value]) =>
    `readonly ${JSON.stringify(key)}${schema.required.includes(key) ? '' : '?'}: ${ts(value)};`).join(' ') + ' }';
  if (schema.type === 'array') return `ReadonlyArray<${ts(schema.items)}>`;
  return schema.type === 'integer' ? 'number' : schema.type;
}
function generated() {
  const definitions = { ...capsuleSchema.$defs, ...completionSchema.$defs };
  return {
    'capsule.schema.json': JSON.stringify(capsuleSchema, null, 2) + '\n',
    'completion.schema.json': JSON.stringify(completionSchema, null, 2) + '\n',
    'attribution.schema.json': JSON.stringify(attributionSchema, null, 2) + '\n',
    'model.d.ts': '// Generated from schema.js; regenerate with the report contract fixture task.\n'
      + Object.entries(definitions).map(([name, schema]) => `export type ${name} = ${ts(schema)};`).join('\n')
      + `\nexport type ReportCapsule = ${ts(capsuleSchema)};\nexport type ReportCompletion = ${ts(completionSchema)};\nexport type ReportAttribution = ${ts(attributionSchema)};\n`
  };
}
module.exports = { fixture, completed, generated, reportRoot, wasm, hash, aid, buildId, id, coverage, fact, unavailable, createCapsule };
