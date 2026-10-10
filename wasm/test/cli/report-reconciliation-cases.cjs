'use strict';

// Combined synthetic reader/viewer regression. Producer noninterference belongs
// to the existing paired build tasks, not to this constructed capsule.
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { createCapsule, parseCapsule, serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { addResourceInventory } = require('../../packages/cli/src/internal/report/resource-inventory');
const { applyReferenceProvenance } = require('../../packages/cli/src/internal/report/reference-provenance');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { renderReport } = require('../../packages/cli/src/internal/report/viewer');

function reconciliationFixture() {
  const seed = structuredClone(require('./report-helper-viewer-cases.cjs').helperFixture());
  // Associate the error carrier with one bounded route composition. Its physical
  // body also belongs to a dedicated implementation; neither view owns it.
  seed.routes[0].composition.push(seed.entries.find(row => row.kind === 'error').id);
  for (const row of seed.implementations)
    row.routeIds = seed.routes.filter(route => route.composition.some(id => row.entryIds.includes(id))).map(route => route.id);
  for (const schemaId of ['app.External', 'app.Unobserved']) seed.schemas.push({
    ...structuredClone(seed.schemas[0]), id: f.id('schema', schemaId), schemaId, entryIds: [], routeIds: []
  });
  seed.coverage.schemas = f.coverage(seed.schemas.length);
  applyReferenceProvenance(seed, { references: [
    { kind: 'schema', bindingKind: null, canonicalId: 'app.UpdateInput', state: 'resolved',
      entryIds: ['entry-0', 'entry-1'], entriesComplete: true },
    { kind: 'schema', bindingKind: null, canonicalId: 'app.External', state: 'resolved',
      entryIds: [], entriesComplete: false, externalPackages: ['@example/codec'] }
  ] }, { evidenceIds: [f.buildId], observe() {} });
  for (const entry of seed.entries) entry.schemaIds = [...new Set(entry.schemaIds)];
  const responsePayloads = require('./report-response-payload-cases.cjs').responseFixture().projection;
  addResourceInventory(seed, {
    native: { manifest: { schemaCodecs: { codecs: [{ id: 'app.UpdateInput' }] } }, guestUnits: [] },
    reportReferences: { version: 'pulse.compiler-report-references.v1', responsePayloads,
      references: [{ kind: 'resource', state: 'resolved', canonicalId: 'asset', resource: { encodedBytes: 16 } }] }
  }, [f.buildId]);
  for (const row of seed.resources)
    row.routeIds = seed.routes.filter(route => route.composition.some(id => row.entryIds.includes(id))).map(route => route.id);
  seed.coverage.resources = { status: 'partial', observed: seed.resources.length, expected: null, reason: 'incomplete-mapping' };
  return createCapsule(seed);
}

module.exports = function reconciliationCases({ renderedTree }) {
  const capsule = reconciliationFixture(), saved = serializeCapsule(capsule);
  const before = { artifacts: capsule.artifacts, bodies: capsule.bodies, measurements: capsule.measurements };
  const model = createReportViewModel(capsule), tree = renderedTree(capsule);
  const helpers = model.helperSize(model.helpers);
  assert.equal(helpers.bytes, 6);
  assert.equal(model.helpers.reduce((sum, row) => sum + (model.helperSize([row]).bytes || 0), 0), 10,
    'logical row totals overlap; only the body union is a physical total');
  assert.equal(helpers.overlappingBodies, 1);
  assert.ok(model.helpers.some(row => row.origin === 'consolidated-stage' && row.roles.includes('middleware')));
  assert.ok(model.helpers.some(row => row.origin === 'authored-helper' && row.roles.includes('helper')));
  const route = capsule.routes[0], dispatchers = model.routeDispatchers(route);
  assert.equal(dispatchers.size.bytes, 4);
  assert.equal(dispatchers.bodies.length, 1);
  assert.ok(capsule.implementations.some(row => row.origin === 'dedicated' && row.bodyIds.includes(dispatchers.bodies[0].id)));
  assert.ok(capsule.measurements.filter(row => ['own', 'shared', 'reachable'].includes(row.metric))
    .every(row => row.fact.state === 'unavailable'), 'associated code does not complete execution roots');
  assert.equal(model.A.ledger.codeBodyBytes, 10);
  assert.equal(capsule.bodies.reduce((sum, row) => sum + row.bytes, 0), 10);
  assert.equal(model.composition(model.A).reduce((sum, row) => sum + row.bytes, 0), 36);

  const schema = id => capsule.schemas.find(row => row.schemaId === id);
  assert.equal(model.schemaUsage(schema('app.UpdateInput')).label, 'Used');
  assert.deepEqual(model.schemaUsage(schema('app.External')), {
    label: 'Referenced · consumer unresolved', externalPackages: ['@example/codec']
  });
  assert.equal(model.schemaUsage(schema('app.Unobserved')).label, 'No observed use · not proven unused');
  const responses = capsule.resources.filter(row => row.kind === 'response-payload');
  assert.equal(responses.length, 8);
  assert.equal(responses.filter(row => row.inputBytes.state === 'available').length, 6);
  assert.equal(responses.filter(row => row.inputBytes.reason === 'dynamic-reference').length, 2);
  assert.ok(responses.some(row => row.inputBytes.state === 'available' && row.inputBytes.value === 0));
  assert.ok(responses.every(row => row.generator.representationBytes.state === 'unavailable'));
  const asset = capsule.resources.find(row => row.kind === 'embedded-asset');
  assert.deepEqual([asset.inputBytes.value, asset.generator.representationBytes.value], [12, 16]);
  const codec = capsule.resources.find(row => row.kind === 'schema-validator');
  assert.equal(codec.generator.schemaId, schema('app.UpdateInput').id);
  assert.equal(codec.generator.representationBytes.value, schema('app.UpdateInput').structure.descriptorBytes);
  assert.ok(capsule.resources.every(row => row.retainedPayloadBytes.state === 'unavailable'));

  tree.renderers.renderHelpers(); tree.renderers.renderSchemas();
  assert.match(tree.get('view-helpers').textContent, /Distinct mapped code6 B/);
  assert.match(tree.get('schema-body').textContent, /External dependency · @example\/codec/);
  assert.match(tree.get('schema-body').textContent, /No observed use · not proven unused/);
  assert.match(tree.get('view-resources').textContent, /Canonical text-response sites · complete8 recorded \/ 8 expected/);
  for (const tab of ['facts', 'size']) {
    Object.assign(tree.renderers.state, { selected: route.id, drawerTab: tab }); tree.renderers.renderDrawer();
    assert.match(tree.get('drawer-content').textContent, /whole-body size is not this route’s size/);
    assert.ok(tree.nodes().some(node => node.attrs.href?.startsWith('#helpers/')));
  }
  assert.equal(model.canonicalJson, saved);
  const html = renderReport(capsule), payload = html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(serializeCapsule(parseCapsule(payload)), saved);
  assert.equal(serializeCapsule(capsule), saved);
  assert.deepEqual({ artifacts: capsule.artifacts, bodies: capsule.bodies, measurements: capsule.measurements }, before);
  assert.ok(!/BODY_CANARY|DYNAMIC_CANARY|SECRET_DEFAULT_CANARY/.test(html));

  // One historical capsule has none of the new optional inventories. Replay
  // cannot silently backfill evidence from this newer reporter's capabilities.
  const historical = createCapsule(f.fixture()), old = serializeCapsule(historical);
  const replay = parseCapsule(old), oldModel = createReportViewModel(replay), oldTree = renderedTree(replay);
  oldTree.renderers.renderHelpers();
  assert.equal(oldModel.helperState, 'not-recorded');
  assert.equal(oldModel.routeDispatchers(replay.routes[0]).records.length, 0);
  assert.equal(replay.resourceProducers, undefined);
  assert.match(oldTree.get('view-resources').textContent, /Producer coverage was not recorded/);
  assert.match(oldTree.get('drawer-content').textContent, /Dispatcher inventory was not recorded/);
  assert.equal(serializeCapsule(replay), old);
  return { routes: capsule.routes.length, schemas: capsule.schemas.length, helperRows: model.helpers.length,
    distinctHelperBytes: helpers.bytes, dispatcherBytes: dispatchers.size.bytes,
    responseSites: responses.length, resolvedResponseSizes: 6, physicalBytes: model.A.bytes };
};
module.exports.reconciliationFixture = reconciliationFixture;
