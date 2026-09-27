#!/usr/bin/env node
'use strict';

// Source-only, opt-in evidence. This task never invokes AssemblyScript/Binaryen.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const { fixture, attribution } = require('./gen01-census.cjs');
const { extractSchemaRegistry } = require('../../../packages/schema-json/src/compiler/schema-registry');
const { buildCanonicalSchemaBundle } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalRouterSource } = require('../../../packages/compiler/src/canonical-router-compiler');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const provider = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');

const cells = [
  { id: 'sites-1', schemas: 1, diverse: false, routes: 1, effects: 1 },
  { id: 'sites-8', schemas: 1, diverse: false, routes: 1, effects: 8 },
  { id: 'sites-32', schemas: 1, diverse: false, routes: 1, effects: 32 },
  { id: 'routes-8-sites-3', schemas: 1, diverse: false, routes: 8, effects: 3 },
  { id: 'schemas-16-repeat', schemas: 16, diverse: false, routes: 1, effects: 1 },
  { id: 'schemas-16-diverse', schemas: 16, diverse: true, routes: 1, effects: 1 },
  { id: 'schemas-32-repeat', schemas: 32, diverse: false, routes: 1, effects: 1 }
];
const declaration = /^(?:@[^\n]+\n)*(?:export )?(?:function|class|const|let) (\w+)/gm;
const bytes = value => Buffer.byteLength(value);
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

// These buckets are lexical source families, not a claim about retained Wasm.
function family(name) {
  if (/^__pulse_expr_\d+$/.test(name)) return 'expression helpers';
  if (/^(?:__pulse_schema_(?:encode|decode)_\d+|pulse_schema_(?:encode|decode|string_id)|__Pulse_gen_)/.test(name)) return 'portable schema codecs';
  if (/^__pulse_fastly_schema_(?:\d+_\d+|scalar|flat_object|object|array|apply|nullable|enum)/.test(name)) return 'provider schema projectors';
  if (/^__pulse_chunk_\d+$/.test(name)) return 'handler chunks';
  if (/^__pulse_effect_(?:result|ready|pending)_\d+$/.test(name)) return 'effect-site state';
  if (/^__pulse_fastly_(?:resolve_|effect_kind|wait_|config_begin|ready_effect)/.test(name)) return 'Fastly effect dispatch';
  if (/^(?:__pulse_fastly_(?:run_invocation|start_request|abort)|__pulse_invocation_)/.test(name)) return 'Fastly driver and invocation';
  return 'other declarations';
}

function declarationCensus(source) {
  const matches = [...source.matchAll(declaration)], families = new Map(), exact = new Map();
  for (let index = 0; index < matches.length; index++) {
    const name = matches[index][1];
    const text = source.slice(matches[index].index, matches[index + 1]?.index ?? source.length);
    const bucket = family(name), row = families.get(bucket) || { declarations: 0, bytes: 0 };
    row.declarations++; row.bytes += bytes(text); families.set(bucket, row);
    const digest = hash(text), group = exact.get(digest) || { names: [], bytes: bytes(text) };
    assert.equal(group.bytes, bytes(text));
    group.names.push(name); exact.set(digest, group);
  }
  const preambleBytes = bytes(source.slice(0, matches[0]?.index ?? source.length));
  assert.equal([...families.values()].reduce((sum, row) => sum + row.bytes, preambleBytes), bytes(source));
  const repeated = [...exact.values()].filter(group => group.names.length > 1)
    .sort((a, b) => b.bytes * (b.names.length - 1) - a.bytes * (a.names.length - 1));
  return {
    totalDeclarations: matches.length, preambleBytes,
    families: Object.fromEntries([...families].sort((a, b) => b[1].bytes - a[1].bytes)),
    exactRepeatedDeclarations: { groups: repeated.length,
      redundantBytes: repeated.reduce((sum, group) => sum + group.bytes * (group.names.length - 1), 0),
      largest: repeated.slice(0, 8) },
    controls: {
      flatObjectProjectors: matches.filter(match => /^__pulse_fastly_schema_flat_object_\d+$/.test(match[1])).length,
      configGetResolvers: matches.filter(match => match[1] === '__pulse_fastly_resolve_config_get').length,
      assetsHelpers: matches.filter(match => /^__pulse_fastly_(?:assets_|wait_assets|asset_)/.test(match[1])).length,
      effectSiteStateDeclarations: matches.filter(match => /^__pulse_effect_(?:result|ready|pending)_\d+$/.test(match[1])).length
    }
  };
}

function generate(cell, project) {
  const source = fixture(cell), routerFile = path.join(project, 'src/index.ts'), schemaFile = path.join(project, 'schemas.ts');
  fs.mkdirSync(path.dirname(routerFile), { recursive: true });
  fs.writeFileSync(routerFile, source.router); fs.writeFileSync(schemaFile, source.schema);
  const registry = extractSchemaRegistry(schemaFile, { projectRoot: project }).registry;
  const bundle = buildCanonicalSchemaBundle(registry);
  const router = compileCanonicalRouterSource(source.router, { fileName: 'src/index.ts', rootDir: project });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'src/index.ts', rootDir: project, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }, schemaBundle: bundle
  });
  assert.equal(compiled.ok, true);
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.effects.length, cell.routes * cell.effects);
  assert.equal(plan.routing.entries.length, cell.routes);
  assert.equal(plan.schemas.registry.schemas.length, cell.schemas);
  assert.ok(plan.effects.every(effect => effect.kind === 'config.get'));
  const generated = provider.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, {
    cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false,
    bindings: { configStore: 'o07' }
  });
  const partition = attribution(generated.source, plan, generated);
  const census = declarationCensus(generated.source);
  assert.equal(census.totalDeclarations, partition.totalDeclarations);
  assert.equal(census.controls.configGetResolvers, plan.effects.length > 1 ? 1 : 0);
  assert.equal(census.controls.assetsHelpers, 0);
  assert.equal(census.controls.effectSiteStateDeclarations, 3 * plan.effects.length);
  if (!cell.diverse) assert.equal(census.controls.flatObjectProjectors, 1);
  assert.equal(Object.values(partition.categories).reduce((sum, row) => sum + row.bytes, 0), partition.bytes);
  return { cell, fixtureSha256: { router: hash(source.router), schema: hash(source.schema) },
    plan: { routes: plan.routing.entries.length, staticEffectSites: plan.effects.length, schemaIds: plan.schemas.registry.schemas.length },
    sourceSha256: hash(generated.source), sourceBytes: partition.bytes, ownerBytes: Object.fromEntries(
      Object.entries(partition.categories).map(([owner, row]) => [owner, { bytes: row.bytes, declarations: row.declarations }])),
    namedDeclarationCoverage: partition.namedDeclarationCoverage,
    exactRepeatedFunctionBodies: partition.exactRepeatedFunctionBodies,
    ...census };
}

function main() {
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/o07');
  fs.mkdirSync(output, { recursive: true });
  const reportFile = path.join(output, 'measurements.json');
  const temporary = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o07-'));
  const report = { version: 'pulse.o07.generated-source.v1', status: 'running',
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--porcelain']),
    harnessSha256: hash(fs.readFileSync(__filename)), gen01HarnessSha256: hash(fs.readFileSync(path.join(__dirname, 'gen01-census.cjs'))),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), node: process.version,
    productionOwnerSha256: Object.fromEntries([
      'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
      'packages/provider-fastly/src/build/native-platform-capabilities.js'
    ].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    cells: [], limitations: [
      'Synthetic Fastly Native canonical Router fixtures use config.get only; registered schemas include unused IDs.',
      'Source owner buckets use GEN01 byte-exact stage matching and assign unmatched text to runtime support.',
      'Lexical declaration slices include trailing space and comments up to the next top-level declaration.',
      'Exact repeated declarations and function bodies are source-text comparisons, not semantic clone or retained optimized-Wasm counts.',
      'No AssemblyScript compile, final-Wasm attribution, runtime measurement or broad consumer cost is inferred.'
    ] };
  try {
    for (const cell of cells) {
      const result = generate(cell, path.join(temporary, cell.id));
      report.cells.push(result); write(reportFile, report);
      console.log(JSON.stringify({ cell: cell.id, sites: result.plan.staticEffectSites, sourceBytes: result.sourceBytes }));
    }
    const byId = Object.fromEntries(report.cells.map(row => [row.cell.id, row]));
    const base = byId['sites-1'];
    report.deltasFromSites1 = Object.fromEntries(report.cells.filter(row => row !== base).map(row => [row.cell.id, {
      sourceBytes: row.sourceBytes - base.sourceBytes,
      owners: Object.fromEntries(Object.keys(base.ownerBytes).map(owner => [owner, row.ownerBytes[owner].bytes - base.ownerBytes[owner].bytes])),
      families: Object.fromEntries(Object.keys(base.families).concat(Object.keys(row.families))
        .filter((name, index, all) => all.indexOf(name) === index)
        .map(name => [name, (row.families[name]?.bytes || 0) - (base.families[name]?.bytes || 0)]))
    }]));
    for (const delta of Object.values(report.deltasFromSites1)) assert.equal(
      Object.values(delta.owners).reduce((sum, n) => sum + n, 0), delta.sourceBytes);
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: report.cells.length, report: path.relative(root, reportFile) }));
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); write(reportFile, report); throw error; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) { try { main(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { declarationCensus, family, main };
