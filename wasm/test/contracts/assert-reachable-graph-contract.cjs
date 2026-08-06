#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const graphPath = path.join(repoRoot, 'wasm', 'packages', 'contracts', 'src', 'project', 'reachable-graph.js');
const schemaPath = path.join(repoRoot, 'wasm', 'packages', 'contracts', 'src', 'project', 'reachable-graph-v2.schema.json');
const fixturePath = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'reachable-graph-v2', 'graph-input.json');

const graph = require(graphPath);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveRef(root, ref) {
  assert.match(ref, /^#\//, `unsupported schema ref ${ref}`);
  return ref.slice(2).split('/').reduce((value, segment) => value[segment.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function validateSchema(value, node, root = schema, at = '$') {
  if (node.$ref) return validateSchema(value, resolveRef(root, node.$ref), root, at);
  if (node.oneOf) {
    const matches = node.oneOf.filter((candidate) => {
      try { validateSchema(value, candidate, root, at); return true; } catch { return false; }
    });
    assert.equal(matches.length, 1, `${at} must match exactly one schema branch`);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'const')) assert.deepEqual(value, node.const, `${at} const`);
  if (node.enum) assert.ok(node.enum.includes(value), `${at} enum`);
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    assert.ok(types.some((type) => matchesType(value, type)), `${at} type ${types.join('|')}`);
  }
  if (typeof value === 'string') {
    if (node.minLength != null) assert.ok(value.length >= node.minLength, `${at} minLength`);
    if (node.pattern) assert.match(value, new RegExp(node.pattern), `${at} pattern`);
  }
  if (typeof value === 'number' && node.minimum != null) assert.ok(value >= node.minimum, `${at} minimum`);
  if (Array.isArray(value)) {
    if (node.minItems != null) assert.ok(value.length >= node.minItems, `${at} minItems`);
    if (node.uniqueItems) assert.equal(new Set(value.map((entry) => JSON.stringify(entry))).size, value.length, `${at} uniqueItems`);
    if (node.items) value.forEach((entry, index) => validateSchema(entry, node.items, root, `${at}[${index}]`));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required || []) assert.ok(Object.prototype.hasOwnProperty.call(value, key), `${at}.${key} required`);
    for (const [key, child] of Object.entries(node.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateSchema(value[key], child, root, `${at}.${key}`);
    }
    if (node.additionalProperties === false) {
      const allowed = new Set(Object.keys(node.properties || {}));
      for (const key of Object.keys(value)) assert.ok(allowed.has(key), `${at}.${key} additional property`);
    }
  }
}

function expectError(fn, pattern) {
  assert.throws(fn, pattern);
}

const resolverContract = graph.defaultModuleResolverContract();
assert.equal(resolverContract.version, 'pulse.module-resolver.v1');
assert.equal(resolverContract.policies.staticEsmOnly, true);
assert.equal(resolverContract.policies.ambiguousSuccessfulCandidatesAreErrors, true);
assert.equal(resolverContract.policies.packageExportsAreAuthoritativeWhenPresent, true);
assert.equal(resolverContract.policies.unexportedDeepImportsAllowedWhenExportsPresent, false);
assert.equal(resolverContract.policies.hostPlatformAffectsIdentity, false);
assert.deepEqual(resolverContract.policies.supportedTsconfigResolutionInputs, ['baseUrl', 'paths']);
assert.deepEqual(resolverContract.runtimePackageConditions, ['pulse', 'import', 'default']);
assert.deepEqual(resolverContract.typePackageConditions, ['types', 'pulse', 'import', 'default']);

const resolverA = graph.normalizeModuleResolverInput(fixture.resolver);
const resolverBInput = clone(fixture.resolver);
resolverBInput.pathAliases.reverse();
const resolverB = graph.normalizeModuleResolverInput(resolverBInput);
assert.equal(resolverA.resolverHash, resolverB.resolverHash, 'alias declaration order must not affect resolver identity');
assert.equal(graph.classifyModuleSpecifier('./helper', resolverA).kind, 'project-relative');
assert.equal(graph.classifyModuleSpecifier('@app/helper', resolverA).kind, 'tsconfig-path');
assert.equal(graph.classifyModuleSpecifier('@pulse-compute/assets', resolverA).kind, 'package-root');
assert.equal(graph.classifyModuleSpecifier('@pulse-compute/assets/pulsewasm', resolverA).kind, 'package-subpath');
assert.equal(graph.classifyModuleSpecifier('node:fs', resolverA).kind, 'external');
assert.deepEqual(graph.projectResolutionCandidates('src/index.ts', './helper.js', resolverA), [
  'src/helper.js', 'src/helper.ts', 'src/helper.tsx'
]);
assert.deepEqual(graph.projectResolutionCandidates('src/index.ts', '@pkg/exact', resolverA), ['src/exact.ts']);
assert.deepEqual(graph.projectResolutionCandidates('src/index.ts', '@app/routes/users', resolverA).slice(0, 4), [
  'src/routes/users', 'src/routes/users.ts', 'src/routes/users.tsx', 'src/routes/users.mts'
]);
expectError(() => graph.normalizePortablePath('/private/app.ts', 'file'), /workspace-relative/);
expectError(() => graph.normalizePortablePath('../outside.ts', 'file'), /must not escape/);
expectError(() => graph.normalizeModuleResolverInput({ pathAliases: [{ pattern: '@app/**', targets: ['src/**'] }] }), /at most one wildcard/);
expectError(() => graph.normalizeModuleResolverInput({ pathAliases: [{ pattern: '@app/*', targets: ['src/exact.ts'] }] }), /wildcard usage must match/);
expectError(() => graph.normalizeModuleResolverInput({ baseUrl: '.', customConditions: ['browser'] }), /unsupported field customConditions/);
const tamperedResolver = { ...resolverA, resolverHash: '0'.repeat(64) };
assert.equal(graph.normalizeModuleResolverInput(tamperedResolver).resolverHash, resolverA.resolverHash, 'normalized resolver input must recompute rather than trust its hash');

const manifest = graph.normalizeReachableGraphManifestV2(fixture);
validateSchema(manifest, schema);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.modules), true);
assert.equal(Object.isFrozen(graph.REACHABLE_GRAPH_MANIFEST_V2_SCHEMA), true);
assert.equal(manifest.version, 'pulse.reachable-graph-manifest.v2');
assert.equal(manifest.identityVersion, 'pulse.reachable-graph-identity.v1');
assert.equal(manifest.handlerReferenceVersion, 'pulse.handler-reference.v2');
assert.equal(manifest.modules.length, 5);
assert.equal(manifest.edges.length, 5);
assert.equal(manifest.handlers.length, 1);
assert.equal(manifest.cycles.length, 1);
assert.equal(manifest.unsupportedBoundaries.length, 2);
assert.equal(manifest.firstUnsupportedBoundary.kind, 'dynamic-import');
assert.equal(manifest.edges.find((edge) => edge.kind === 'type-import').runtime, false);
assert.ok(manifest.modules.every((entry) => !JSON.stringify(entry).includes(repoRoot)), 'manifest must not contain checkout paths');
assert.match(manifest.graphHash, /^[0-9a-f]{64}$/);

const reordered = clone(fixture);
reordered.modules.reverse();
reordered.edges.reverse();
reordered.handlers.reverse();
reordered.unsupportedBoundaries.reverse();
reordered.resolver.pathAliases.reverse();
const reorderedManifest = graph.normalizeReachableGraphManifestV2(reordered);
assert.equal(manifest.graphHash, reorderedManifest.graphHash, 'input ordering must not change graph identity');
assert.deepEqual(manifest, reorderedManifest);

const contentChanged = clone(fixture);
contentChanged.modules.find((entry) => entry.key === 'helper').contentHash = '7777777777777777777777777777777777777777777777777777777777777777';
const contentChangedManifest = graph.normalizeReachableGraphManifestV2(contentChanged);
const helperId = manifest.modules.find((entry) => entry.canonical === 'project:src/helper.ts').id;
const changedHelperId = contentChangedManifest.modules.find((entry) => entry.canonical === 'project:src/helper.ts').id;
assert.equal(helperId, changedHelperId, 'logical module identity must survive content edits');
assert.notEqual(manifest.graphHash, contentChangedManifest.graphHash, 'content edits must change graph identity');

const resolverChanged = clone(fixture);
resolverChanged.resolver.pathAliases[1].targets = ['app/*'];
assert.notEqual(manifest.graphHash, graph.normalizeReachableGraphManifestV2(resolverChanged).graphHash, 'resolver inputs must participate in graph identity');

const packageIdentityChanged = clone(fixture);
packageIdentityChanged.modules.find((entry) => entry.key === 'assets').packageManifestHash = '8888888888888888888888888888888888888888888888888888888888888888';
assert.notEqual(
  manifest.modules.find((entry) => entry.kind === 'package').id,
  graph.normalizeReachableGraphManifestV2(packageIdentityChanged).modules.find((entry) => entry.kind === 'package').id,
  'package manifest identity must disambiguate package instances'
);

const duplicateModule = clone(fixture);
duplicateModule.modules.push({ ...clone(duplicateModule.modules.find((entry) => entry.key === 'entry')), key: 'entry-copy' });
expectError(() => graph.normalizeReachableGraphManifestV2(duplicateModule), /Duplicate graph module identity/);
const absoluteSource = clone(fixture);
absoluteSource.modules.find((entry) => entry.key === 'entry').source.file = '/tmp/checkout/src/index.ts';
expectError(() => graph.normalizeReachableGraphManifestV2(absoluteSource), /workspace-relative/);
const badPackageEdge = clone(fixture);
badPackageEdge.edges.find((edge) => edge.kind === 'package-contract').packageContract = 'pulse.assets.v2';
expectError(() => graph.normalizeReachableGraphManifestV2(badPackageEdge), /must match its target module/);
const callerId = clone(fixture);
callerId.modules[0].id = 'module:caller-owned';
expectError(() => graph.normalizeReachableGraphManifestV2(callerId), /unsupported field id/);
const callerGraphHash = { ...clone(fixture), graphHash: '0'.repeat(64) };
expectError(() => graph.normalizeReachableGraphManifestV2(callerGraphHash), /unsupported field graphHash/);

const implementationContract = graph.defaultReachableGraphImplementationContract();
assert.equal(implementationContract.version, 'pulse.reachable-graph-implementation-contract.v1');
assert.equal(implementationContract.policies.callerProvidedStableIdsAccepted, false);
assert.equal(implementationContract.policies.absoluteFilesystemPathsInManifest, false);
assert.equal(implementationContract.policies.recursiveWalkerImplemented, false);
assert.equal(implementationContract.policies.javascriptBundlerImplemented, false);

assert.equal(schema.$id, 'https://pulsecompute.io/contracts/pulse.reachable-graph-manifest.v2.schema.json');
assert.equal(schema.properties.version.const, graph.REACHABLE_GRAPH_MANIFEST_V2_VERSION);
assert.deepEqual(schema.properties.resolver.$ref, '#/$defs/resolver');
assert.equal(schema.$defs.edge.properties.resolutionKind.enum.length, 6);

const compilerPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wasm', 'packages', 'compiler', 'package.json'), 'utf8'));
assert.equal(Object.keys(compilerPackage.exports).some((key) => key.includes('reachable-graph')), false, 'compiler graph projection remains package-internal');

console.log(`ok - reachable graph locks resolver ${resolverA.resolverHash}, graph ${manifest.graphHash}, and ${manifest.modules.length} path-independent module identities`);
