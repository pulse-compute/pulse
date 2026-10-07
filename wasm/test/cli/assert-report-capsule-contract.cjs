#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const capsule = require(path.join(f.reportRoot, 'capsule'));
const completion = require(path.join(f.reportRoot, 'completion'));
const data = require(path.join(f.reportRoot, 'data'));
const projection = require(path.join(f.reportRoot, 'schema-projection'));
const { capsuleSchema, completionSchema } = require(path.join(f.reportRoot, 'schema'));
const { validate } = require(path.join(f.reportRoot, 'validate'));
const fixtures = path.join(__dirname, '../fixtures/report');
let assertions = 0;
function rejects(fn, code) { assertions++; assert.throws(fn, error => code ? error.code === code : error instanceof TypeError); }
function mutate(fn) { const value = f.fixture(); fn(value); return () => capsule.createCapsule(value); }
const minimal = capsule.createCapsule(f.fixture(false)), rich = capsule.createCapsule(f.fixture());
const goldens = { 'minimal.json': capsule.serializeCapsule(minimal), 'shared-routes.json': capsule.serializeCapsule(rich) };
if (process.argv.includes('--write-fixtures')) {
  fs.mkdirSync(fixtures, { recursive: true });
  for (const [file, text] of Object.entries(f.generated())) fs.writeFileSync(path.join(f.reportRoot, file), text);
  for (const [file, text] of Object.entries(goldens)) fs.writeFileSync(path.join(fixtures, file), text);
}
for (const [file, text] of Object.entries(f.generated())) assert.equal(fs.readFileSync(path.join(f.reportRoot, file), 'utf8'), text, file);
for (const [file, text] of Object.entries(goldens)) {
  assert.equal(fs.readFileSync(path.join(fixtures, file), 'utf8'), text, file);
  assert.equal(capsule.serializeCapsule(capsule.parseCapsule(text)), text);
}
assert.equal(WebAssembly.validate(f.wasm), true);
assert.equal(rich.routes.length, 2, 'duplicate registrations survive');
assert.equal(rich.routes[0].handlerId, rich.routes[1].handlerId, 'shared authored identity retained');
assert.deepEqual(rich.routes.map(row => row.order), [0, 1]);
assert.equal(rich.context.host, 'node', 'Node Native is eligible');
const optimization = require('../../packages/contracts/src/project/native-optimization');
for (const mode of ['default', optimization.EXPERIMENTAL_NATIVE_SIZE_MODE, optimization.EXPERIMENTAL_NATIVE_BOUNDED_SIZE_MODE]) {
  const value = f.fixture(false); value.provenance.recipe.optimization = mode;
  assert.equal(capsule.createCapsule(value).provenance.recipe.optimization, mode);
}
assert.equal(Object.isFrozen(rich.routes[0]), true);
assert.equal(data.canonicalJson({ '2': 2, '10': 10, a: -0 }), '{"10":10,"2":2,"a":0}');
const reordered = f.fixture();
for (const key of ['evidence', 'measurements', 'bodies', 'bindings', 'schemas']) reordered[key].reverse();
for (const schema of reordered.schemas) { schema.routeIds.reverse(); schema.entryIds.reverse(); schema.structure.descriptor.root.fields.reverse(); schema.structure.properties.reverse(); }
assert.equal(capsule.serializeCapsule(capsule.createCapsule(reordered)), goldens['shared-routes.json']);
assert.equal(capsule.stableReportId('route', 'canonical-entry'), capsule.stableReportId('route', 'canonical-entry'));
assert.notEqual(capsule.stableReportId('route', 'canonical-entry'), capsule.stableReportId('entry', 'canonical-entry'));
const localeScript = `process.stdout.write(require(${JSON.stringify(path.join(__dirname, 'report-fixtures.cjs'))}).createCapsule(require(${JSON.stringify(path.join(__dirname, 'report-fixtures.cjs'))}).fixture()).evidenceHash.value)`;
assert.equal(execFileSync(process.execPath, ['-e', localeScript], { cwd: '/', env: { ...process.env, LANG: 'tr_TR.UTF-8', TZ: 'Pacific/Auckland' }, encoding: 'utf8' }), rich.evidenceHash.value);

rejects(mutate(value => { value.entries[0].flow = { nextEntryId: 'missing', childEntryId: null, parentContinueEntryId: null, routerPath: ['app'], path: null, method: null, scoped: false, conditional: false }; }), 'REPORT_REFERENCE');
rejects(mutate(value => value.routes.reverse()), 'REPORT_ORDER');
rejects(mutate(value => value.routes[1].id = value.routes[0].id), 'REPORT_DUPLICATE');
rejects(mutate(value => value.routes[0].entryId = 'missing'), 'REPORT_REFERENCE');
rejects(mutate(value => value.schemas[0].routeIds = []), 'REPORT_REVERSE_REFERENCE');
rejects(mutate(value => value.entries[0].handlerId = 'different'), 'REPORT_REFERENCE');
rejects(mutate(value => value.coverage.routes.expected = 100), 'REPORT_COVERAGE');
const partial = f.fixture(); partial.coverage.routes = { status: 'partial', observed: 2, expected: 3, reason: 'upstream-partial' };
assert.equal(capsule.createCapsule(partial).coverage.routes.status, 'partial');
rejects(mutate(value => value.context.target = 'javascript'));
rejects(mutate(value => value.provenance.buildEvidenceId = 'missing'), 'REPORT_ELIGIBILITY');
rejects(mutate(value => value.evidence[0].result = 'failed'), 'REPORT_ELIGIBILITY');
rejects(mutate(value => value.artifacts[0].sections[0].bytes++), 'REPORT_LEDGER');
rejects(mutate(value => value.bodies[0].index = 4), 'REPORT_IDENTITY');
rejects(mutate(value => value.measurements[0].fact.value = 900), 'REPORT_MEASUREMENT');
rejects(mutate(value => value.measurements[0].stage = 'prelink'), 'REPORT_IDENTITY');
rejects(mutate(value => value.measurements[0].expectedChunks = 2), 'REPORT_COVERAGE');
const partialMap = f.fixture(); partialMap.measurements[0].expectedChunks = 2; partialMap.measurements[0].fact.coverage = 'partial';
assert.equal(capsule.createCapsule(partialMap).measurements.find(row => row.id === partialMap.measurements[0].id).fact.value, 4);
rejects(mutate(value => value.resources[0].retainedPayloadBytes.value = 0), 'REPORT_FACT');
const own = f.fixture(), ownRow = own.measurements.find(row => row.metric === 'own');
Object.assign(ownRow, { method: 'static-direct-calls-v1', bodyIds: [capsule.bodyId(f.hash, 0)], fact: f.fact(4) });
rejects(() => capsule.createCapsule(own), 'REPORT_ROOTS');
own.rootSets[0].universeComplete = true;
assert.equal(capsule.createCapsule(own).measurements.find(row => row.metric === 'own').fact.value, 4);
ownRow.metric = 'shared'; ownRow.bodyIds = [capsule.bodyId(f.hash, 2)]; ownRow.fact.value = 2;
assert.equal(capsule.createCapsule(own).measurements.find(row => row.metric === 'shared').fact.value, 2);
own.rootSets[0].graph = 'unsupported'; rejects(() => capsule.createCapsule(own), 'REPORT_ROOTS');
rejects(mutate(value => value.evidence.push({ ...value.evidence[0], id: 'test', kind: 'test', result: 'passed' })), 'REPORT_TEST_SCOPE');

const hostile = f.fixture();
hostile.application.name = '</script><svg onload=alert(1)>\u2028&\u001b[31m';
hostile.credentials = { token: 'SECRET_TOKEN_CANARY' };
hostile.provenance.inputsSha256 = data.sha256('SECRET_CONFIG_CANARY');
hostile.bindings[0].value = 'SECRET_BINDING_CANARY';
hostile.resources[0].body = 'SECRET_ASSET_CANARY';
const safe = capsule.createCapsule(hostile), serialized = capsule.serializeCapsule(safe);
assert.ok(!serialized.includes('CANARY')); assert.ok(!serialized.includes(data.sha256('SECRET_CONFIG_CANARY')));
const embedded = capsule.htmlPayload(safe);
assert.ok(!/[<>&\u2028\u2029]/.test(embedded));
assert.equal(capsule.serializeCapsule(JSON.parse(embedded)), serialized);
assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(capsule.terminalText(hostile.application.name)));
rejects(() => capsule.validateCapsule({ ...rich, secret: 'CANARY' }), 'REPORT_SCHEMA');
rejects(() => capsule.parseCapsule(goldens['minimal.json'].replace('Synthetic', 'Changed')), 'REPORT_HASH');
rejects(() => capsule.parseCapsule(goldens['minimal.json'].replace('"reportVersion":1', '"reportVersion":2')), 'REPORT_VERSION');
rejects(() => data.parseJson('{"kind":"first","kind":"second"}'), 'REPORT_DUPLICATE_KEY');
rejects(() => data.parseJson('{"kind":1,"k\\u0069nd":2}'), 'REPORT_DUPLICATE_KEY');
rejects(() => data.parseJson('{"__proto__":{"polluted":true}}'), 'REPORT_DUPLICATE_KEY');
rejects(() => data.parseJson(Buffer.from([0xff])), 'REPORT_JSON');
rejects(() => data.parseJson('['.repeat(65) + '0' + ']'.repeat(65)), 'REPORT_LIMIT');
rejects(() => data.parseJson(' '.repeat(data.LIMITS.bytes + 1)), 'REPORT_LIMIT');
rejects(() => data.copyData(new Array(data.LIMITS.records + 1)), 'REPORT_LIMIT');
rejects(() => data.copyData({ n: NaN }), 'REPORT_DATA');
rejects(() => data.copyData({ n: Infinity }), 'REPORT_DATA');
const cyclic = {}; cyclic.self = cyclic; rejects(() => data.copyData(cyclic), 'REPORT_DATA');
let getterCalls = 0; const getter = { get secret() { getterCalls++; return 'CANARY'; } };
rejects(() => capsule.createCapsule(getter), 'REPORT_DATA'); assert.equal(getterCalls, 0);
for (const unsafe of ['../escape', '/absolute', 'C:/secret', 'https://example.test/data', 'a\\b', 'a/%2e%2e/b', 'a/./b']) rejects(mutate(value => value.entries[0].source.file = unsafe), 'REPORT_PATH');

const projected = projection.projectSchema({ root: { kind: 'object', fields: [
  { name: 'z', required: false, value: { kind: 'array', element: { kind: 'nullable', value: { kind: 'string-enum', values: ['SECRET_ENUM_CANARY'] } } } },
  { name: 'a', required: true, value: { kind: 'object', fields: [], additionalProperties: { kind: 'json-value' } } }
] }, defaults: 'SECRET_CANARY' });
assert.equal(projected.state, 'available'); assert.equal(projected.topLevelKeys, 2); assert.equal(projected.requiredKeys, 1);
assert.ok(!JSON.stringify(projected).includes('CANARY'));
assert.equal(projected.descriptorBytes, Buffer.byteLength(data.canonicalJson(projected.descriptor)));
assert.equal(projection.projectSchema({ root: { kind: 'array', element: { kind: 'i32' } } }).keyCountsState, 'not-applicable');
for (const kind of ['ref', 'union', 'recursive']) assert.equal(projection.projectSchema({ root: { kind } }).state, 'unavailable');
assert.equal(projection.projectSchema({ root: { kind: 'object', fields: [{ name: 'x', value: { kind: 'string' } }] } }).requiredKeys, null);
assert.equal(projection.projectSchema(cyclic).state, 'unavailable');
assert.equal(projection.projectSchema({}, 'unknown').reason, 'unsupported-schema-version');
rejects(mutate(value => value.schemas[0].structure.descriptorBytes++), 'REPORT_SCHEMA_METRICS');
// Exercise the real v5 registry producer, without compiling Wasm or importing a project harness.
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry');
const sourceFile = path.resolve(__dirname, '../../../examples/02-request-schema/src/schemas.ts');
const registry = extractSchemaRegistry(sourceFile, { projectRoot: path.dirname(sourceFile) }).registry;
assert.equal(registry.version, projection.REGISTRY_VERSION);
for (const schema of registry.schemas) assert.equal(projection.projectSchema(schema).state, 'available');

function admit(value, snapshot) { return completion.admitCompletedBuild(value.manifest, value.completionBytes, { files: value.files,
  ...(snapshot ? { snapshot, selection: { profile: 'native', host: 'node', target: 'native' } } : {}) }); }
const built = f.completed();
validate(built.completion, completionSchema);
assert.equal(admit(built, built.completion.snapshot).currentSnapshotMatched, true);
assert.deepEqual(admit(built).missingOptionalSidecars, ['attribution']);
assert.equal(completion.classifyInput(goldens['minimal.json']).kind, 'historical-capsule');
assert.equal(completion.classifyInput(JSON.stringify(built.manifest)).kind, 'build-manifest');
rejects(() => completion.classifyInput('{}'), 'REPORT_INPUT_VERSION');
rejects(() => completion.classifyInput('null'), 'REPORT_INPUT_VERSION');
rejects(() => capsule.parseCapsule('null'), 'REPORT_VERSION');
rejects(() => capsule.createCapsule(null), 'REPORT_SCHEMA');
rejects(() => admit({ ...built, manifest: { ...built.manifest, reportCompletion: undefined } }));
rejects(() => admit(built, { ...built.completion.snapshot, inputsSha256: '4'.repeat(64) }), 'REPORT_STALE_INPUTS');
const noWasm = f.completed(); noWasm.files.delete('app.wasm'); rejects(() => admit(noWasm), 'REPORT_MISSING_ARTIFACT');
const noInventory = f.completed(); noInventory.files.delete('inventory.json'); rejects(() => admit(noInventory), 'REPORT_MISSING_SIDECAR');
const wrongOptional = f.completed(); wrongOptional.files.set('attribution.json', Buffer.from('[]')); rejects(() => admit(wrongOptional), 'REPORT_ARTIFACT_HASH');
const mismatch = f.completed(); mismatch.files.set('app.wasm', Buffer.from('bad')); rejects(() => admit(mismatch), 'REPORT_ARTIFACT_HASH');
const badCompletion = f.completed(); badCompletion.completionBytes = Buffer.from('{}'); rejects(() => admit(badCompletion), 'REPORT_ARTIFACT_HASH');
const javascript = f.completed(); javascript.manifest = { version: 'pulse.project-execution.v10', status: 'built', buildMode: 'javascript-source-package', configuredTarget: 'javascript' };
rejects(() => admit(javascript), 'REPORT_UNSUPPORTED_TARGET');
const failed = f.completed(); failed.manifest.status = 'failed'; rejects(() => admit(failed), 'REPORT_INCOMPLETE_BUILD');
const historical = completion.verifyHistoricalArtifacts(minimal);
assert.equal(historical.absent.length, 1); assert.equal(historical.currentProjectVerified, false);
assert.equal(completion.verifyHistoricalArtifacts(minimal, new Map([[f.aid, f.wasm]])).verified.length, 1);
rejects(() => completion.verifyHistoricalArtifacts(minimal, new Map([[f.aid, Buffer.from('bad')]])), 'REPORT_ARTIFACT_HASH');
assert.equal(capsule.serializeCapsule(historical.capsule), goldens['minimal.json']);
const rawAttribution = { kind: 'pulse.report-attribution', attributionVersion: 1, artifactId: f.aid,
  artifactSha256: f.hash, stage: 'final', importedFunctions: 0,
  functions: [4,4,2].map((bytes, index) => ({ index, bytes })),
  handlerBodies: [{ entryId: 'entry-0', handlerId: 'handler-0', chunks: [0] }],
  chunkMappings: [{ chunk: 0, functionIndex: 0, reason: null }],
  graph: { state: 'available', reason: null, method: 'static-direct-calls-v1', edges: [{ caller: 0, callee: 2, sites: 1 }, { caller: 1, callee: 2, sites: 1 }] } };
assert.equal(completion.validateAttribution(rawAttribution).functions.length, 3);
function repoint(value) {
  value.completionBytes = Buffer.from(JSON.stringify(value.completion));
  value.manifest.reportCompletion = { file: 'report-completion.json', bytes: value.completionBytes.length, sha256: data.sha256(value.completionBytes) };
  return value;
}
const nullCompletion = f.completed(); nullCompletion.completion = null;
rejects(() => admit(repoint(nullCompletion)), 'REPORT_INPUT_VERSION');
const withAttribution = f.completed(), attributeBytes = Buffer.from(JSON.stringify(rawAttribution));
Object.assign(withAttribution.completion.sidecars[1], { bytes: attributeBytes.length, sha256: data.sha256(attributeBytes) });
withAttribution.files.set('attribution.json', attributeBytes);
assert.deepEqual(admit(repoint(withAttribution)).availableSidecars, ['inventory', 'attribution']);
const partialAttribution = structuredClone(rawAttribution);
partialAttribution.chunkMappings[0] = { chunk: 0, functionIndex: null, reason: 'unsupported-mapping' };
partialAttribution.graph = { state: 'unavailable', reason: 'unsupported-call-graph', method: 'static-direct-calls-v1', edges: [] };
assert.equal(completion.validateAttribution(partialAttribution).chunkMappings[0].functionIndex, null);
const wrongEdge = structuredClone(rawAttribution); wrongEdge.graph.edges[0].callee = 9;
rejects(() => completion.validateAttribution(wrongEdge), 'REPORT_ATTRIBUTION');
const wrongStage = f.completed(); wrongStage.completion.artifacts[0].stage = 'prelink'; rejects(() => admit(repoint(wrongStage)), 'REPORT_IDENTITY');
const missingCompletion = f.completed(); delete missingCompletion.manifest.reportCompletion;
rejects(() => admit(missingCompletion), 'REPORT_MISSING_COMPLETION');
const unsafeLink = f.completed(); unsafeLink.completion.sidecars[0].file = '../inventory.json'; rejects(() => admit(repoint(unsafeLink)), 'REPORT_PATH');
const badInventory = f.completed(); badInventory.files.set('inventory.json', Buffer.from('{}'));
Object.assign(badInventory.completion.sidecars[0], { bytes: 2, sha256: data.sha256('{}') });
rejects(() => admit(repoint(badInventory)), 'REPORT_VERSION');
const wrongSelection = f.completed();
rejects(() => completion.admitCompletedBuild(wrongSelection.manifest, wrongSelection.completionBytes, {
  files: wrongSelection.files, snapshot: wrongSelection.completion.snapshot, selection: { profile: 'other', host: 'node', target: 'native' }
}), 'REPORT_IDENTITY');
const nativeBuild = f.completed(); nativeBuild.completion.operation = 'native-build';
nativeBuild.manifest = { version: 'pulse.project-execution.v10', status: 'built', buildMode: 'native-provider', provider: 'node', configuredTarget: 'native',
  providerTarget: { nativeWasm: true, compiledWasmPresent: true, javascriptRuntime: false, wasm: { bytes: f.wasm.length, sha256: f.hash } },
  portable: { wasm: { file: 'app.wasm', bytes: f.wasm.length, sha256: f.hash } } };
assert.equal(admit(repoint(nativeBuild)).completion.operation, 'native-build');
nativeBuild.manifest.providerTarget.wasm.file = 'app.wasm';
assert.equal(admit(nativeBuild).completion.operation, 'native-build', 'explicit provider-final path adapter');
nativeBuild.manifest.providerTarget.wasm.sha256 = 'f'.repeat(64); rejects(() => admit(nativeBuild), 'REPORT_IDENTITY');
const missingRoot = f.fixture(); missingRoot.rootSets[0].universeComplete = true; missingRoot.rootSets[0].roots.pop();
rejects(() => capsule.createCapsule(missingRoot), 'REPORT_ROOTS');
// Consume the authentic 00C capture as data, with no native compilation.
const proof = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/internal/prpt00c/proof.json')));
for (const cell of proof.cells) {
  const capture = cell.capture, chunks = capture.functions.filter(fn => /\/__pulse_chunk_\d+$/.test(fn.name || ''));
  const input = { kind: 'pulse.report-attribution', attributionVersion: 1, artifactId: capsule.artifactId(capture.artifactSha256),
    artifactSha256: capture.artifactSha256, stage: 'final', importedFunctions: capture.importedFunctions,
    functions: capture.functions.map(({ index, bytes }) => ({ index, bytes })),
    handlerBodies: cell.attribution.routes.map(route => ({ entryId: route.routerEntryStableId, handlerId: route.handlerId,
      chunks: route.functionIndices.map(index => Number(chunks.find(fn => fn.index === index).name.match(/\d+$/)[0])) })),
    chunkMappings: chunks.map(fn => ({ chunk: Number(fn.name.match(/\d+$/)[0]), functionIndex: fn.index, reason: null })),
    graph: { state: 'available', reason: null, method: 'static-direct-calls-v1', edges: capture.graph.edges } };
  assert.equal(completion.validateAttribution(input).handlerBodies.length, 5);
}
const noWorkScript = `const M=require('node:module'),load=M._load;M._load=function(name,...args){
  if(/^(node:)?(fs|http|https|net|child_process)$/.test(name)||/compiler|project-config|project-execution/.test(name))throw Error('Unexpected work: '+name);
  return load.call(this,name,...args);
};const c=require(${JSON.stringify(path.join(f.reportRoot, 'capsule'))});
const e=require(${JSON.stringify(path.join(f.reportRoot, 'completion'))});
e.verifyHistoricalArtifacts(c.parseCapsule(process.argv[1]));process.stdout.write('pure');`;
assert.equal(execFileSync(process.execPath, ['-e', noWorkScript, goldens['minimal.json']], { encoding: 'utf8' }), 'pure');
// Owned schemas and types must remain usable with no dynamic imports or external references.
assert.ok(!JSON.stringify(capsuleSchema).includes('http://'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck',
  '--target', 'ES2022', '--module', 'Node16', '--moduleResolution', 'Node16', path.join(fixtures, 'typecheck.ts')], { stdio: 'pipe' });
console.log(JSON.stringify({ status: 'passed', negativeCases: assertions, goldenCapsules: 2,
  registeredSchemas: registry.schemas.length, attributionProofCells: proof.cells.length,
  sameCapsuleHtmlRoundTrip: true, completedWasmAndHistoricalReplay: true, noIoOrToolchainImports: true }));
