'use strict';
const assert = require('node:assert/strict');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { createCapsule, serializeCapsule, parseCapsule } = require('../../packages/cli/src/internal/report/capsule');
module.exports = function({ renderedTree }) {
  const original = require('./report-dispatcher-viewer-cases.cjs').dispatcherFixture();
  const seed = structuredClone(original);
  seed.routes[0].behavior = {kind:'continuing', basis:'canonical-handler-ir'};
  seed.routes[1].behavior = {kind:'terminal', basis:'canonical-handler-ir'};
  const capsule = createCapsule(seed), model = createReportViewModel(capsule);
  assert.deepEqual(model.routeCounts, { registrations:2, distinctMethodPaths:1, terminal:1, continuing:1, unknown:0 });
  assert.equal(model.handlerAttribution(capsule.routes[0]).code, 'mixed-dispatcher');
  assert.match(model.handlerAttribution(capsule.routes[0]).detail, /Some containing symbols/);
  assert.equal(model.handlerAttribution(capsule.routes[1]).code, 'exact');
  assert.equal(createReportViewModel(original).routeBehavior(original.routes[0]), 'Behavior not recorded');
  const tree = renderedTree(capsule);
  assert.match(tree.get('summary-strip').textContent, /1 distinct method\/path pairs/);
  assert.match(tree.get('route-behavior-summary').textContent, /1 terminal · 1 continuing · 0 behavior not recorded/);
  for (const tab of ['facts', 'size']) {
    Object.assign(tree.renderers.state,{selected:capsule.routes[0].id,drawerTab:tab});tree.renderers.renderDrawer();
    assert.match(tree.get('drawer-content').textContent, /Mixed dispatcher ownership/);
  }
  const missing = structuredClone(capsule);
  missing.implementations = missing.implementations.filter(row => row.origin !== 'dispatcher' || !row.bodyIds.length);
  assert.equal(createReportViewModel(missing).handlerAttribution(missing.routes[0]).code, 'missing-final-symbol');
  const legacy = structuredClone(capsule);delete legacy.implementations;delete legacy.coverage.implementations;
  assert.equal(createReportViewModel(legacy).handlerAttribution(legacy.routes[0]).code, 'dispatcher-unresolved');
  // Projection-only case: a composition carrier from middleware cannot be used
  // to diagnose the route's own body as mixed. Do not infer from route links.
  const middlewareOnly = structuredClone(capsule);
  for (const row of middlewareOnly.implementations.filter(row => row.origin === 'dispatcher'))
    for (const chunk of row.chunks) chunk.entryIds = chunk.entryIds.filter(id => id !== capsule.routes[0].entryId);
  assert.equal(createReportViewModel(middlewareOnly).handlerAttribution(middlewareOnly.routes[0]).code, 'dispatcher-unresolved');
  assert.deepEqual(capsule.measurements, original.measurements);
  assert.deepEqual(capsule.artifacts, original.artifacts);
  assert.equal(serializeCapsule(parseCapsule(serializeCapsule(capsule))), serializeCapsule(capsule));
  const saved = serializeCapsule(original);createReportViewModel(original);
  assert.equal(serializeCapsule(original), saved, 'historical projection preserves bytes and hash');
  assert.throws(() => createCapsule({...seed,routes:seed.routes.map(row => ({...row,behavior:{kind:'selector',basis:'source-name'}}))}));
};
