'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { addSizeEvidence, census } = require('../../packages/cli/src/internal/report/size');
const { createCapsule, parseCapsule, serializeCapsule, bodyId } = require('../../packages/cli/src/internal/report/capsule');

module.exports = function implementationCases() {
  const seed = f.fixture();
  for (const [index, kind] of [[2, 'middleware'], [3, 'error']]) seed.entries.push({ ...seed.entries[0],
    id: f.id('entry', 'entry-' + index), canonicalId: 'entry-' + index, order: index, kind,
    schemaIds: [], bindingIds: [], declarationIds: [] });
  seed.coverage.entries = f.coverage(4);
  for (const route of seed.routes) { route.composition.unshift(seed.entries[2].id); route.compositionCoverage = 'bounded'; }
  const mappings = [
    [0, 'terminal-body', 'entry-0', 0], [1, 'shared-stage-body', 'stage:mixed', 1],
    [2, 'shared-helper-body', 'helper:authored', 2], [3, 'dispatcher-carrier', null, 0],
    [4, 'shared-helper-body', 'helper:authored', 2], [5, 'shared-helper-body', 'helper:unobserved', null],
    [6, 'shared-helper-body', 'helper:authored', null]
  ].map(([chunk, kind, implementationId, functionIndex]) => ({ chunk, kind, implementationId, functionIndex,
    reason: functionIndex === null ? 'final-symbol-not-surviving' : null }));
  const capture = { kind: 'pulse.report-attribution', attributionVersion: 2,
    artifactId: f.aid, artifactSha256: f.hash, stage: 'final', importedFunctions: 0, functions: census(f.wasm).functions,
    chunkMappings: mappings,
    entries: [[0, [0, 2, 4, 6]], [1, [1]], [2, [1, 2, 4, 6]], [3, [3]]].map(([index, chunks]) => ({
      entryId: 'entry-' + index, handlerId: 'shared', reason: null,
      bodies: chunks.map(chunk => ({ chunk, relation: mappings[chunk].kind })) })),
    graph: { state: 'unavailable', reason: 'unsupported-call-graph', method: 'static-direct-calls-v1', edges: [] } };
  const files = new Map([[f.aid, f.wasm]]), input = createCapsule(seed);
  const result = addSizeEvidence(input, files, capture);
  const helper = result.implementations.find(row => row.canonicalId === 'helper:authored');
  const stage = result.implementations.find(row => row.origin === 'consolidated-stage');
  const dispatcher = result.implementations.find(row => row.origin === 'dispatcher');
  assert.equal(result.implementations.length, 5);
  assert.deepEqual(stage.roles, ['middleware', 'route']);
  assert.deepEqual(helper.roles, ['helper']);
  assert.deepEqual(dispatcher.roles, ['error']);
  assert.deepEqual(helper.entryIds, [seed.entries[0].id, seed.entries[2].id].sort());
  assert.deepEqual(helper.routeIds, seed.routes.map(row => row.id).sort());
  assert.equal(helper.entryCoverage.status, 'partial');
  assert.equal(helper.entryCoverage.expected, null, 'association is not a complete invocation/root census');
  assert.equal(helper.consumerBasis, 'compiler-entry-association');
  assert.deepEqual(helper.bodyIds, [bodyId(f.hash, 2)], 'two chunks can alias one physical body');
  assert.deepEqual(helper.bodyCoverage, { status: 'partial', observed: 2, expected: 3, reason: 'final-symbol-not-surviving' });
  const unobserved = result.implementations.find(row => row.canonicalId === 'helper:unobserved');
  assert.deepEqual(unobserved.entryIds, []); assert.deepEqual(unobserved.bodyIds, []);
  assert.equal(unobserved.bodyCoverage.observed, 0); assert.equal(unobserved.entryCoverage.expected, null);
  assert.deepEqual(dispatcher.bodyIds, [bodyId(f.hash, 0)]);
  assert.deepEqual(dispatcher.routeIds, []);
  assert.equal(result.measurements.find(row => row.subjectId === seed.entries[3].id && row.metric === 'handler-body').fact.value, null);
  assert.equal(result.artifacts[0].ledger.codeBodyBytes, 10);
  assert.equal(result.bodies.reduce((sum, row) => sum + row.bytes, 0), 10, 'implementation aliases never add ledger bytes');
  assert.ok(result.measurements.filter(row => ['reachable', 'own', 'shared'].includes(row.metric)).every(row => row.fact.value === null));
  const serialized = serializeCapsule(result);
  assert.equal(serializeCapsule(parseCapsule(serialized)), serialized);
  const reordered = structuredClone(capture); reordered.entries.reverse(); reordered.chunkMappings.reverse();
  reordered.entries.forEach(row => row.bodies.reverse());
  assert.equal(serializeCapsule(addSizeEvidence(input, files, reordered)), serialized, 'producer record order is irrelevant');
  function invalid(change) { const value = structuredClone(result); change(value); assert.throws(() => createCapsule(value)); }
  const find = value => value.implementations.find(row => row.canonicalId === helper.canonicalId);
  invalid(value => find(value).roles = ['middleware']);
  invalid(value => find(value).origin = 'dedicated');
  invalid(value => find(value).entryIds = []);
  invalid(value => find(value).routeIds = []);
  invalid(value => find(value).bodyIds = [bodyId(f.hash, 0)]);
  invalid(value => find(value).chunks[0].bodyId = 'body:foreign');
  invalid(value => find(value).artifactId = 'artifact:foreign');
  invalid(value => find(value).chunks[0].entryIds = ['entry:foreign']);
  invalid(value => find(value).chunks.push(find(value).chunks[0]));
  invalid(value => find(value).chunks[0].reason = 'final-symbol-not-surviving');
  invalid(value => find(value).bodyCoverage.status = 'complete');
  invalid(value => find(value).entryCoverage.expected = 2);
  invalid(value => find(value).evidenceIds = []);
  invalid(value => value.coverage.implementations.status = 'complete');
  invalid(value => delete value.coverage.implementations);
  const wrongKind = structuredClone(capture); wrongKind.chunkMappings[6].kind = 'shared-stage-body';
  assert.throws(() => addSizeEvidence(input, files, wrongKind));
  const absent = addSizeEvidence({ ...input, implementations: result.implementations,
    coverage: { ...input.coverage, implementations: result.coverage.implementations } }, files);
  assert.equal(absent.implementations, undefined, 'recollection cannot reuse an unbound old inventory');
  assert.equal(absent.coverage.implementations, undefined);
  // New optional fields are never synthesized while replaying old capsules.
  const old = serializeCapsule(input); assert.equal(serializeCapsule(parseCapsule(old)), old);
  assert.equal(parseCapsule(old).implementations, undefined);
  return result;
};
