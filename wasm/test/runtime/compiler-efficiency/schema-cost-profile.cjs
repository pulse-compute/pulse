'use strict';

// Diagnostic-only attribution. No reachability decision or production hook.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(value);
const codecs = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const portablePath = 'wasm/packages/runtime-core-as/src/compiler/canonical-native.js';
const fastlyPath = 'packages/provider-fastly/src/build/native-platform-capabilities.js';

// Expose the existing private stage in a separate diagnostic module. The file
// body is unchanged; complete production generators below verify exact output.
function stage(file, name) {
  const filename = path.join(root, file), source = fs.readFileSync(filename, 'utf8');
  assert.match(source, new RegExp(`^function ${name}\\(`, 'm'));
  const diagnostic = new Module(filename, module);
  diagnostic.filename = filename;
  diagnostic.paths = Module._nodeModulePaths(path.dirname(filename));
  diagnostic._compile(source + `\nmodule.exports = ${name};\n`, filename);
  return diagnostic.exports;
}

function semanticNode(node) {
  if (Array.isArray(node)) return node.map(semanticNode);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'source').map(([key, value]) => [key, semanticNode(value)]));
}

function shape(node) {
  const kinds = {}, fingerprints = new Map(); let fields = 0, optional = 0;
  function visit(value) {
    kinds[value.kind] = (kinds[value.kind] || 0) + 1;
    const fingerprint = hash(JSON.stringify(semanticNode(value)));
    fingerprints.set(fingerprint, (fingerprints.get(fingerprint) || 0) + 1);
    if (value.kind === 'object') for (const field of value.fields) { fields++; if (!field.required) optional++; visit(field.value); }
    if (value.kind === 'array') visit(value.element);
    if (value.kind === 'nullable') visit(value.value);
    if (value.additionalProperties) visit(value.additionalProperties);
  }
  visit(node);
  return { nodes: Object.values(kinds).reduce((a, b) => a + b, 0), fields, optional, kinds,
    uniqueNodeShapes: fingerprints.size, rootShapeSha256: hash(JSON.stringify(semanticNode(node))) };
}

function attribute(source, registry, target) {
  const entries = registry.schemas.map(schema => ({ id: schema.id, bytes: 0, declarations: 0, families: {} }));
  const shared = { bytes: 0, declarations: 0, families: {} };
  // Only unindented top-level declarations; this is source attribution, not a
  // Wasm call-graph claim. Include decorators in the following declaration.
  const declarations = [...source.matchAll(/^(?:@[^\n]+\n)*(?:export )?(?:function|class|const|let) (\w+)/gm)];
  shared.bytes = bytes(source.slice(0, declarations[0]?.index ?? source.length));
  for (let index = 0; index < declarations.length; index++) {
    const name = declarations[index][1], text = source.slice(declarations[index].index, declarations[index + 1]?.index ?? source.length);
    let owner, family;
    const matched = target === 'portable'
      ? name.match(/^__pulse_schema_(presence|record_text|json_limits|json_scan|decode|encode)_(\d+)(?:_|$)/)
      : name.match(/^__pulse_fastly_schema_(\d+)_\d+$/);
    if (matched) { owner = Number(matched[target === 'portable' ? 2 : 1]); family = target === 'portable' ? matched[1] : 'value-projection'; }
    else if (target === 'portable') {
      owner = registry.codecs.findIndex(codec => name === codec.native.symbol || name.startsWith(codec.native.symbol + '_'));
      if (owner >= 0) family = 'typed-class'; else owner = undefined;
    }
    const row = owner === undefined ? shared : entries[owner];
    assert.ok(row, `unknown schema owner for ${name}`);
    family ||= /^__pulse_fastly_schema_scalar_\d+$/.test(name) ? 'scalar-projector'
      : /^__pulse_fastly_schema_flat_object_\d+$/.test(name) ? 'flat-object-projector'
      : /(?:schema_apply|pulse_schema_(?:encode|decode))$/.test(name) ? 'dispatch' : 'shared-runtime';
    row.bytes += bytes(text); row.declarations++;
    row.families[family] = (row.families[family] || 0) + bytes(text);
  }
  assert.equal(shared.bytes + entries.reduce((sum, item) => sum + item.bytes, 0), bytes(source), 'every source byte has exactly one bucket');
  // Fastly schemas may consist entirely of shared helpers; their IDs and
  // dispatch stay in the shared bucket even when per-ID source is zero.
  for (const row of entries) if (row.bytes === 0) {
    assert.equal(target, 'fastly', `missing attribution for ${row.id}`);
    const branch = source.split(`schemaId == ${JSON.stringify(row.id)}) {`)[1]?.split('\n  }')[0];
    assert.match(branch || '', /const projected = __pulse_fastly_schema_flat_object_\d+\(/,
      `zero per-ID bytes require an explicit shared root for ${row.id}`);
  }
  return { bytes: bytes(source), sha256: hash(source), entries, shared };
}

function makePlan(registry, options) {
  const bundle = codecs.buildCanonicalSchemaBundle(registry, options);
  const compiled = compileCanonicalSource("export default async function handler(ctx) { return ctx.text('ok'); }", {
    fileName: 'schema-cost.ts', schemaBundle: bundle, strict: true, target: 'native', requireAsync: true
  });
  return { plan: buildCanonicalNativePlan(compiled), compiled, bundle };
}

function profileRegistry(input, references = [], options = {}) {
  // Only the attribution worker loads these diagnostic modules. In particular,
  // compiling and executing a measured artifact must not load duplicate owners.
  const portableStage = stage(portablePath, 'nativeSchemaCodecSource');
  const fastlyStage = stage(fastlyPath, 'generateSchemaRuntime');
  const stages = {};
  const measure = (name, fn) => { const start = performance.now(); const value = fn(); stages[name] = performance.now() - start; return value; };
  const registry = measure('registryNormalizationAndIdentityMs', () => codecs.canonicalRegistry(input, options));
  const javascript = measure('javascriptDeclarationMs', () => codecs.renderCanonicalSchemaCodecDeclaration(registry));
  const { plan: actual } = makePlan(input, options);
  assert.equal(JSON.stringify(actual.schemas.registry), JSON.stringify(registry), 'plan serialization preserves registry identity and semantics');
  const portable = measure('portableSchemaEmissionMs', () => portableStage(actual));
  const portableSource = [...portable.imports, '', ...portable.declarations, ...portable.exports].join('\n');
  const fastlySource = measure('fastlySchemaEmissionMs', () => fastlyStage(actual));
  const native = require(path.join(root, portablePath)).generateCanonicalNativeAssemblyScript(actual);
  const fastly = require(path.join(root, fastlyPath)).generateFastlyNativePlatformCapabilitiesAssemblyScript(actual, { cwd: root, requirePlatformCapability: false, canonicalBuild: true });
  assert.ok(native.source.includes(portable.declarations.join('\n')) && native.source.includes(portable.exports.join('\n')));
  assert.ok(fastly.source.includes(portable.declarations.join('\n')) && fastly.source.includes(fastlySource), 'diagnostic stages match complete production generation byte-for-byte');
  const known = new Set(registry.schemas.map(schema => schema.id));
  for (const ref of references) assert.ok(known.has(ref.id), `unknown reference ${ref.id}`);
  const portableCosts = attribute(portableSource, registry, 'portable'), fastlyCosts = attribute(fastlySource, registry, 'fastly');
  return { registryHash: registry.registryHash, codecTableHash: registry.codecTableHash, maxBytes: registry.maxBytes,
    stages, compilerReferenceCount: references.length, fullCodecRealization: true, productionFragmentsByteExact: true,
    javascript: { bytes: bytes(javascript), sha256: hash(javascript) }, portable: portableCosts, fastly: fastlyCosts,
    entries: registry.schemas.map((schema, index) => ({ id: schema.id, index, ...shape(schema.root),
      validationShapeSha256: hash(JSON.stringify({ root: semanticNode(schema.root), jsonLimits: schema.jsonLimits || null, maxBytes: registry.maxBytes })),
      jsonLimits: schema.jsonLimits || null, compilerReferences: references.filter(ref => ref.id === schema.id).length,
      responseCases: registry.responses.filter(response => response.schemaId === schema.id).map(response => response.id),
      portableBytes: portableCosts.entries[index].bytes, fastlyBytes: fastlyCosts.entries[index].bytes,
      nativeRepresentation: portable.codecs[index].rootClass === 'JSON.Value' ? 'value-projection' : 'typed-class' })),
    sourceOwners: Object.fromEntries([portablePath, fastlyPath,
      'wasm/packages/schema-json/src/compiler/canonical-schema-codecs.js',
      'wasm/packages/schema-json/src/compiler/schema-registry.js'].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) };
}

module.exports = { root, hash, shape, attribute, profileRegistry, makePlan };
