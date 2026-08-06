#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const {
  buildReachableProjectGraph
} = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const managed = require('../../packages/compiler/src/spine/handler-ir-managed.js');

const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/entities-managed-handler');
const schemaIds = Object.freeze(['tools.LookupInput', 'tools.LookupOutput']);

function schemaBundle() {
  return Object.freeze({
    declaredSchemaIds: schemaIds,
    schemaIds,
    registry: Object.freeze({ schemas: Object.freeze(schemaIds.map((id) => Object.freeze({ id }))) })
  });
}

function descriptorFromEntry(entry) {
  const start = entry.loc && entry.loc.start || { line: 1, column: 1 };
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.router}:${entry.discriminator}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: entry.loc.file, line: start.line, column: start.column }),
    source: Object.freeze({
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName
    }),
    input: Object.freeze({
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema
    }),
    result: Object.freeze({
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema
    })
  });
}

function graphAndEntries(projectRoot) {
  const entryFile = path.join(projectRoot, 'src/index.ts');
  const graphBuild = buildReachableProjectGraph(entryFile, {
    rootDir: projectRoot,
    workspaceRoot: repoRoot,
    configFile: path.join(projectRoot, 'tsconfig.json')
  });
  const lowered = entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: projectRoot,
    sourcePath: entryFile,
    sourceText: fs.readFileSync(entryFile, 'utf8'),
    schemaBundle: schemaBundle()
  });
  assert.equal(lowered.hasErrors, false, lowered.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'));
  assert.equal(lowered.entries.length, 2);
  return Object.freeze({ graphBuild, entries: lowered.entries });
}

function compileProject(projectRoot) {
  const evidence = graphAndEntries(projectRoot);
  const descriptors = evidence.entries.map(descriptorFromEntry);
  return Object.freeze({
    ...evidence,
    descriptors,
    bundle: managed.compileManagedHandlerDescriptors({
      graphBuild: evidence.graphBuild,
      descriptors
    })
  });
}

function walkOperations(operation, out = []) {
  if (!operation || typeof operation !== 'object') return out;
  if (typeof operation.kind === 'string') out.push(operation.kind);
  if (operation.kind === 'block') for (const child of operation.statements || []) walkOperations(child, out);
  if (operation.kind === 'if') {
    walkOperations(operation.thenOperation, out);
    walkOperations(operation.elseOperation, out);
  }
  return out;
}

function walkExpressions(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value.kind === 'string') out.push(value.kind);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) for (const entry of child) walkExpressions(entry, out);
    else if (child && typeof child === 'object') walkExpressions(child, out);
  }
  return out;
}

const positive = compileProject(fixture);
assert.deepEqual(positive.entries.map((entry) => [entry.discriminator, entry.handler.file, entry.handler.exportName]), [
  ['customer.lookup', 'src/handlers.js', 'lookupCustomer'],
  ['system.notify', 'src/index.ts', 'notifySystem']
]);
assert.equal(positive.bundle.version, managed.MANAGED_HANDLER_IR_BUNDLE_VERSION);
assert.equal(positive.bundle.descriptorVersion, managed.MANAGED_HANDLER_DESCRIPTOR_VERSION);
assert.equal(positive.bundle.handlerIrVersion, managed.MANAGED_HANDLER_IR_VERSION);
assert.equal(positive.bundle.role, 'schema-operation');
assert.equal(positive.bundle.summary.handlers, 2);
assert.equal(positive.bundle.summary.schemaInputs, 1);
assert.equal(positive.bundle.summary.schemaResults, 1);
assert.equal(positive.bundle.summary.completions, 1);
assert.equal(positive.bundle.summary.effects, 0);
assert.equal(positive.bundle.summary.nativeEligible, 2);
assert.match(positive.bundle.bundleHash, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(positive.bundle), true);
const reordered = managed.compileManagedHandlerDescriptors({
  graphBuild: positive.graphBuild,
  descriptors: [...positive.descriptors].reverse()
});
assert.deepEqual(reordered, positive.bundle);

const lookup = positive.bundle.handlers.find((entry) => entry.id.endsWith(':customer.lookup'));
const notify = positive.bundle.handlers.find((entry) => entry.id.endsWith(':system.notify'));
assert.ok(lookup);
assert.ok(notify);
assert.equal(lookup.kind, 'managed-handler');
assert.equal(lookup.role, 'schema-operation');
assert.equal(lookup.source.file, 'src/handlers.ts');
assert.equal(lookup.source.exportName, 'lookupCustomer');
assert.ok(lookup.source.position.line > 0 && lookup.source.position.column > 0);
assert.deepEqual(lookup.parameters.context, { kind: 'managed-context', index: 0, name: '_ctx' });
assert.deepEqual(lookup.parameters.input, {
  kind: 'schema-value',
  schemaId: 'tools.LookupInput',
  index: 1,
  name: 'input',
  binding: 'pre-bound'
});
assert.deepEqual(lookup.result, {
  kind: 'schema-value',
  schemaId: 'tools.LookupOutput',
  adoption: 'schema-bound-value'
});
assert.equal(lookup.resultSites.length, 2);
assert.ok(lookup.resultSites.every((entry) => entry.kind === 'schema-result' && entry.adoption === 'schema-bound-value'));
assert.ok(lookup.resultSites.every((entry) => entry.position.line > 0 && entry.position.column > 0));
assert.ok(walkOperations(lookup.body).includes('if'));
assert.ok(walkOperations(lookup.body).includes('local'));
const lookupExpressions = walkExpressions(lookup.body);
for (const kind of ['object', 'property', 'input', 'local', 'template', 'binary']) assert.ok(lookupExpressions.includes(kind), `expected expression kind ${kind}`);
assert.equal(lookup.effects.count, 0);
assert.equal(lookup.eligibility.scope, 'handler-syntax');
assert.equal(lookup.eligibility.native.eligible, true);
assert.match(lookup.handlerHash, /^[a-f0-9]{64}$/);

assert.deepEqual(notify.parameters.input, {
  kind: 'empty-value',
  schemaId: null,
  index: 1,
  name: '_input',
  binding: 'pre-bound'
});
assert.equal(notify.source.file, 'src/index.ts');
assert.equal(notify.source.localName, 'notifySystem');
assert.deepEqual(notify.result, {
  kind: 'completion',
  schemaId: null,
  adoption: 'completion-only'
});
assert.deepEqual(notify.resultSites.map((entry) => entry.kind), ['completion']);

for (const handler of positive.bundle.handlers) {
  const canonical = managed.canonicalHandlerIrForManagedHandler(handler);
  assert.ok(canonical);
  assert.equal(canonical.kind, 'plain-handler');
  assert.equal(canonical.effectSites.length, 0);
  assert.equal(canonical.continuationSites.length, 0);
}

const genericSource = fs.readFileSync(path.join(repoRoot, 'wasm/packages/compiler/src/spine/handler-ir-managed.js'), 'utf8');
assert.doesNotMatch(genericSource, /@pulse-compute\/entities|EntityRouter|jsonRpc|entities\.handle|jsonrpc|discriminator/);
assert.doesNotMatch(JSON.stringify(positive.bundle), /jsonrpc|requestId|method|params/);

const checkoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-managed-handler-checkouts-'));
const checkoutA = path.join(checkoutRoot, 'checkout-a');
const checkoutB = path.join(checkoutRoot, 'checkout-b');
fs.cpSync(fixture, checkoutA, { recursive: true });
fs.cpSync(fixture, checkoutB, { recursive: true });
const rebuiltA = compileProject(checkoutA).bundle;
const rebuiltB = compileProject(checkoutB).bundle;
assert.deepEqual(rebuiltA, rebuiltB);
assert.equal(rebuiltA.bundleHash, positive.bundle.bundleHash);

const base = graphAndEntries(fixture);
const origin = Object.freeze({ file: 'src/index.ts', line: 1, column: 1 });
function descriptorFor(exportName, options = {}) {
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: options.id || `negative:${exportName}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin,
    source: Object.freeze({
      file: options.file || 'src/handlers.js',
      exportName,
      localName: options.localName || exportName
    }),
    input: Object.freeze({ kind: 'schema-value', schemaId: 'tools.LookupInput' }),
    result: Object.freeze({
      kind: options.completion ? 'completion' : 'schema-value',
      schemaId: options.completion ? null : 'tools.LookupOutput'
    })
  });
}

function expectCodes(descriptors, expected) {
  assert.throws(
    () => managed.compileManagedHandlerDescriptors({ graphBuild: base.graphBuild, descriptors }),
    (error) => {
      assert.equal(error.code, 'PULSE_MANAGED_HANDLER_COMPILE_FAILED');
      const codes = new Set(error.diagnostics.map((entry) => entry.code));
      for (const code of expected) assert.ok(codes.has(code), `expected ${code}; got ${[...codes].join(', ')}`);
      assert.ok(error.diagnostics.every((entry) => entry.kind === 'ManagedHandlerCompileDiagnostic' || entry.kind === 'CanonicalCompileDiagnostic'));
      return true;
    }
  );
}

expectCodes([descriptorFor('recursiveOperation')], ['PULSE_MANAGED_HANDLER_RECURSION_UNSUPPORTED']);
expectCodes([
  descriptorFor('crossOperationA'),
  descriptorFor('crossOperationB')
], ['PULSE_MANAGED_HANDLER_DIRECT_CALL_UNSUPPORTED']);
expectCodes([descriptorFor('callbackOperation')], [
  'PULSE_MANAGED_HANDLER_CALLBACK_UNSUPPORTED',
  'PULSE_MANAGED_HANDLER_INPUT_ESCAPE'
]);
expectCodes([descriptorFor('escapeOperation')], ['PULSE_MANAGED_HANDLER_INPUT_ESCAPE']);
expectCodes([descriptorFor('unsupportedResult')], ['PULSE_MANAGED_HANDLER_RESULT_REQUIRED']);
expectCodes([descriptorFor('valueForCompletion', { completion: true })], ['PULSE_MANAGED_HANDLER_RESULT_UNSUPPORTED']);
expectCodes([descriptorFor('unresolvedReference')], ['PULSE_MANAGED_HANDLER_REFERENCE_UNRESOLVED']);
expectCodes([descriptorFor('mutateInput')], ['PULSE_MANAGED_HANDLER_INPUT_ESCAPE']);
expectCodes([descriptorFor('badSignature')], ['PULSE_MANAGED_HANDLER_SIGNATURE_INVALID']);
expectCodes([descriptorFor('missingHandler', { file: 'src/missing.js' })], ['PULSE_MANAGED_HANDLER_SOURCE_UNREACHABLE']);

const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/entities/pulse.package.json'), 'utf8'));
assert.equal(product.targets.native.status, 'provider-dependent');
assert.equal(product.targets.javascript.status, 'supported');

console.log(JSON.stringify({
  version: positive.bundle.version,
  bundleHash: positive.bundle.bundleHash,
  handlers: positive.bundle.summary.handlers,
  schemaResults: positive.bundle.summary.schemaResults,
  effects: positive.bundle.summary.effects,
  negativeClasses: 10,
  targetStatus: product.targets.native.status
}));
console.log('ok - Entities I5 resolves I2 handler identities into generic pure managed-handler IR with schema-bound input/results and fail-closed diagnostics');
