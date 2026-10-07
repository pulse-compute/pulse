'use strict';

// Repository-only PRPT-00 evidence. Reads a completed fixture; never builds it.
// This is deliberately not the Report command, validator, or public schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const { binary } = require(path.join(root, 'wasm/test/runtime/compiler-efficiency/o08-wasm-census.cjs'));
const { extractSchemaRegistry } = require(path.join(root, 'wasm/packages/schema-json/src/compiler/schema-registry.js'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(stable(value));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function uint(bytes, cursor) {
  let value = 0, shift = 0, byte;
  do {
    assert.ok(cursor.at < bytes.length && shift <= 28);
    byte = bytes[cursor.at++]; value += (byte & 127) * 2 ** shift; shift += 7;
  } while (byte & 128);
  return value;
}
function exportsWithBodies(bytes, parsed, importedFunctions) {
  const section = parsed.sections.find(section => section.id === 7);
  if (!section) return [];
  const cursor = { at: section.offset + section.bytes - section.payloadBytes };
  const count = uint(bytes, cursor), result = [];
  for (let i = 0; i < count; i++) {
    const length = uint(bytes, cursor);
    const name = bytes.subarray(cursor.at, cursor.at + length).toString('utf8'); cursor.at += length;
    const kind = bytes[cursor.at++], index = uint(bytes, cursor);
    if (kind === 0) result.push({ name, index, bodyBytes: index < importedFunctions ? null : parsed.bodies[index - importedFunctions] });
  }
  assert.equal(cursor.at, section.offset + section.bytes);
  return result;
}

const [manifestArgument, fixtureDirectory] = process.argv.slice(2);
assert.ok(manifestArgument && fixtureDirectory, 'Usage: node docs/internal/prpt00/proof.cjs <pulse-compile.json> <ARC fixture directory>');
const manifestFile = path.resolve(manifestArgument), directory = path.dirname(manifestFile);
const manifest = JSON.parse(fs.readFileSync(manifestFile));
assert.equal(manifest.version, 'pulse.project-execution.v10');
assert.equal(manifest.status, 'compiled');
assert.equal(manifest.target, 'portable-native-wasm');
const wasm = fs.readFileSync(path.join(directory, manifest.native.wasm.file));
assert.equal(hash(wasm), manifest.native.wasm.sha256);
assert.equal(wasm.length, manifest.native.wasm.bytes);
const parsed = binary(wasm), moduleValue = new WebAssembly.Module(wasm);
const importedFunctions = WebAssembly.Module.imports(moduleValue).filter(item => item.kind === 'function').length;
const nativeManifest = JSON.parse(fs.readFileSync(path.join(directory, manifest.native.manifest)));
const plan = JSON.parse(fs.readFileSync(path.join(directory, manifest.native.plan)));
assert.equal(nativeManifest.wasm.sha256, hash(wasm));
assert.equal(plan.planHash, nativeManifest.planHash);
const routes = manifest.program.routing.routes;
const handlerBodies = nativeManifest.handlerBodies;
assert.equal(routes.length, 3);
assert.equal(handlerBodies.length, 3);
assert.equal(WebAssembly.Module.customSections(moduleValue, 'name').length, 0);
const sourceFiles = ['examples/01-hello-json/src/index.ts', 'examples/01-hello-json/.pulse/config.ts', 'pnpm-lock.yaml'];
const fixtureNames = ['Pulse-Report-ARC-Design.html', 'Pulse-Report-ARC-Fixture.json', 'Pulse-Report-ARC-Preview.png', 'Pulse-Report-ARC-Schemas-Preview.png'];
const fixtureFiles = fixtureNames.map(name => ({ name, sha256: hash(fs.readFileSync(path.join(fixtureDirectory, name))) }));
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, fixtureNames[1])));
const html = fs.readFileSync(path.join(fixtureDirectory, fixtureNames[0]), 'utf8');
const embedded = JSON.parse(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
assert.deepEqual(embedded, fixture);
const { evidenceHash, ...evidence } = fixture;
assert.equal(hash(canonical(evidence)), evidenceHash.value);
for (const schema of fixture.schemas) {
  assert.equal(Buffer.byteLength(canonical(schema.structure.descriptor)), schema.structure.descriptorBytes.value);
  assert.equal(Object.keys(schema.structure.descriptor.properties).length, schema.structure.topLevelKeys);
  assert.equal(schema.structure.descriptor.required.length, schema.structure.requiredKeys);
}
const schemaProject = path.join(root, 'examples/02-request-schema');
const registry = extractSchemaRegistry(path.join(schemaProject, 'src/schemas.ts'), { projectRoot: schemaProject }).registry;
const report = {
  kind: 'pulse.prpt00-feasibility-proof', version: 1, status: 'passed',
  sourceCommit: git(['rev-parse', 'HEAD']),
  sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  trackedWorkingTreeDirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0,
  scope: 'Development evidence on unchanged product sources; not a Pulse Report or release qualification.',
  environment: { node: process.version, platform: process.platform, arch: process.arch, assemblyScript: nativeManifest.assemblyScript },
  sourceFiles: sourceFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  artifact: { ...manifest.native.wasm, validated: true, manifestHashMatched: true, configuredHost: manifest.configuredProvider, configuredTarget: manifest.configuredTarget },
  ledger: { headerBytes: 8, sections: parsed.sections.map(({ id, bytes, payloadBytes, sha256 }) => ({ id, bytes, payloadBytes, sha256 })),
    fileBytes: wasm.length, codeBodyBytes: parsed.bodies.reduce((a, b) => a + b, 0), definedFunctions: parsed.bodies.length,
    importedFunctions, initializedDataPayloadBytes: parsed.dataPayloadBytes, reconciles: true },
  exportedFunctionBodies: exportsWithBodies(wasm, parsed, importedFunctions),
  routing: routes.map(route => ({ method: route.method, path: route.path, order: route.order, stableId: route.stableId,
    handlerId: route.handlerId, generatedChunks: handlerBodies.find(body => body.id === route.routerEntryStableId)?.chunks,
    handlerBodyBytes: null, reason: 'no-final-function-index-map' })),
  mapping: { nameSections: 0, routeMappedCount: 0, routeTotal: routes.length,
    generatorChunkIdsAreFinalFunctionIndices: false, ownReachableShared: 'unavailable',
    defaultOptimizationRecordPresent: Object.hasOwn(nativeManifest, 'optimization') },
  schemaProducer: { fixture: 'examples/02-request-schema/src/schemas.ts', version: registry.version,
    schemas: registry.schemas.map(schema => ({ id: schema.id, kind: schema.root.kind, topLevelKeys: schema.root.fields.length,
      requiredKeys: schema.root.fields.filter(field => field.required).length, source: schema.source })),
    descriptorBytes: 'Deferred to PRPT-01 normalization contract; no second schema grammar.' },
  design: { files: fixtureFiles, embeddedPayloadEqualsJson: true, capsuleHashValid: true, schemaMetricsChecked: fixture.schemas.length,
    interactiveBrowserStatus: 'not-run-browser-unavailable', synthetic: true },
  limits: ['No provider deployment proof.', 'No request or test execution in this proof script.',
    'Fixture compilation occurred separately once.', 'Exported ABI body measurements do not establish route ownership.',
    'O-08 binary parser supports bounded data offsets; reuse requires guarded unsupported-input behavior.']
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
