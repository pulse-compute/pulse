'use strict';
const assert = require('node:assert/strict');
const { collectCanonicalReportReferences: collect } = require('../../packages/compiler/src/report-reference-provenance');
const { attachPackageOperationRecognition, PACKAGE_OPERATION_RECOGNITION_VERSION } = require('../../packages/compiler/src/spine/package-operation-seam');

module.exports = function schemaConsumerCases() {
  const reference = { id: 'app.Item', usage: 'text-decode', capability: 'schema.decode', position: { offset: 5 } };
  const compiled = { metadata: { file: 'generated.ts', schemaReferences: [reference] }, schema: { registry: { schemas: [{ id: 'app.Item' }] } } };
  const call = callerEntryId => ({ kind: 'helper-call', helperId: 'helper', callerEntryId });
  const plan = { entry: { body: [call('a'), call('b'), call('a')] }, routing: {
    entries: [{ stableId: 'a', generatedRange: { start: 10, end: 20 } }, { stableId: 'b', generatedRange: { start: 20, end: 30 } }],
    helpers: [{ id: 'helper', generatedRange: { start: 0, end: 10 } }]
  } };
  const result = (c = compiled, p = plan) => collect(c, p).references[0];
  assert.deepEqual(result().entryIds, ['a', 'b']);
  assert.equal(result().entriesComplete, true);
  assert.equal(result().externalPackages, undefined);
  for (const change of [
    p => { p.entry.body = []; },
    p => { p.entry.body.push(call('missing')); },
    p => { p.routing.helpers.push({ id: 'overlap', generatedRange: { start: 0, end: 10 } }); },
    p => { p.routing.entries[0].generatedRange.start = 0; }
  ]) {
    const p = structuredClone(plan); change(p);
    assert.equal(result(compiled, p).entriesComplete, false);
  }
  const staged = structuredClone(plan);
  staged.entry.body = [];
  staged.stages = [{ body: [call('a')], registrations: [{ entryId: 'a' }, { entryId: 'b' }] }];
  assert.deepEqual(result(compiled, staged).entryIds, ['a', 'b']);
  const foreign = { ...compiled, metadata: { ...compiled.metadata, schemaReferences: [{ ...reference, file: 'foreign.ts' }] } };
  assert.deepEqual(result(foreign).entryIds, []);
  assert.equal(result(foreign).externalPackages, undefined, 'foreign source alone does not prove external provenance');
  attachPackageOperationRecognition(foreign, { version: PACKAGE_OPERATION_RECOGNITION_VERSION, publicExtensions: { plans: [{
    package: '@example/codec', schemaReferences: foreign.metadata.schemaReferences, credentials: 'PRIVATE_CANARY'
  }] } });
  assert.deepEqual(result(foreign).externalPackages, ['@example/codec']);
  assert.equal(result(foreign).entriesComplete, false);
  assert.ok(!JSON.stringify(result(foreign)).includes('PRIVATE_CANARY'));
  foreign.metadata.schemaReferences = [...foreign.metadata.schemaReferences, reference];
  assert.deepEqual(result(foreign).entryIds, ['a', 'b']);
  assert.equal(result(foreign).entriesComplete, false, 'an unresolved external use cannot be hidden by resolved local uses');
  assert.deepEqual(result(foreign).externalPackages, ['@example/codec']);
  const changedOffset = { ...compiled, metadata: { ...compiled.metadata, schemaReferences: [{ ...reference, position: { offset: 6 } }] } };
  attachPackageOperationRecognition(changedOffset, { version: PACKAGE_OPERATION_RECOGNITION_VERSION, publicExtensions: { plans: [{
    package: '@example/codec', schemaReferences: [reference]
  }] } });
  assert.equal(result(changedOffset).externalPackages, undefined, 'package joins require the exact reference identity');
};
