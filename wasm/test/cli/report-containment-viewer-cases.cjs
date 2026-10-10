'use strict';
const assert = require('node:assert/strict');
const { dispatcherFixture } = require('./report-dispatcher-viewer-cases.cjs');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');

module.exports = function containmentViewerCases({renderedTree}) {
  const capsule=dispatcherFixture(),before=serializeCapsule(capsule),model=createReportViewModel(capsule);
  const route=capsule.routes.find(row=>row.order===0),other=capsule.routes.find(row=>row.order===1);
  const view=model.routeContainment(route);
  assert.deepEqual([view.bytes,view.bodyIds.length,view.mapped,view.expected,view.partial],[4,1,2,3,true]);
  assert.equal(view.bodies[0].entryIds.length,4,'co-owners join physical chunks, including other implementation origins');
  assert.equal(view.bodies[0].routeIds.length,2,'links go to co-owner registrations');
  assert.equal(model.routeContainment(other).bytes,null,'sharing physical code does not invent a carrier');
  assert.equal(model.containingBodies([route,route]).bytes,4,'overlapping selections never sum containing bodies');
  assert.equal(model.containingBodies([]).bytes,null,'empty selection has no measured union');
  assert.equal(model.entryHelpers(route).length,0,'composition and physical overlap cannot donate helpers');
  assert.equal(model.entryHelpers(other).length,1);
  const tree=renderedTree(capsule);
  for(const tab of ['facts','size']) {
    Object.assign(tree.renderers.state,{selected:route.id,drawerTab:tab});tree.renderers.renderDrawer();
    const text=tree.get('drawer-content').textContent;
    assert.match(text,/This registration’s containing bodies/);
    assert.match(text,/Containing-body union4 bytes/);
    assert.match(text,/Mapped entry carrier chunks2 \/ 3/);
    assert.match(text,/Entry carrier chunk 2 · body unavailable/);
    assert.match(text,/cannot be added across routes/);
    const bodies=tree.nodes().filter(node=>node.attrs.class==='details-block containing-body');
    assert.equal(bodies.length,1);
    assert.doesNotMatch(bodies[0].textContent,/Entry 5 · startup/);
    assert.ok(tree.nodes().some(node=>node.attrs.href==='#routes/'+model.routeIndex.get(other.id)));
  }
  tree.renderers.renderRoutes();
  assert.match(tree.get('route-containment-summary').textContent,/1 with recorded carriers; 1 without carrier evidence/);
  assert.match(tree.get('route-containment-summary').textContent,/4 bytes · 1 distinct physical bodies · 2 \/ 3/);
  Object.assign(tree.renderers.state,{availability:'available'});tree.renderers.renderRoutes();
  assert.match(tree.get('route-containment-summary').textContent,/0 with recorded carriers; 1 without carrier evidence/);
  assert.match(tree.get('route-containment-summary').textContent,/union: Unavailable/);

  // Projection-only scenarios isolate entry ownership from broader composition.
  const scoped=structuredClone(capsule),foreignBody=scoped.bodies.find(row=>row.bytes===2);
  const carrier=scoped.implementations.find(row=>row.origin==='dispatcher'&&row.chunks[0].chunk===0);
  carrier.chunks[0].entryIds=carrier.chunks[0].entryIds.filter(id=>id!==route.entryId);
  carrier.chunks[0].bodyId=foreignBody.id;carrier.bodyIds=[foreignBody.id];
  const scopedModel=createReportViewModel(scoped);
  assert.equal(scopedModel.routeDispatchers(route).size.bytes,6,'bounded composition includes middleware carrier');
  assert.equal(scopedModel.routeContainment(route).bytes,4,'entry containment excludes middleware-only carrier');
  assert.equal(scopedModel.routeContainment(route).expected,2);
  // Shared carrier contributes once across distinct registrations.
  const shared=scoped.implementations.find(row=>row.origin==='dispatcher'&&row.chunks[0].chunk===1);
  shared.chunks[0].entryIds.push(other.entryId);
  const unionModel=createReportViewModel(scoped),union=unionModel.containingBodies(scoped.routes);
  assert.deepEqual([union.registrations,union.bytes,union.bodyIds.length,union.expected],[2,4,1,2]);
  const compositionOnly={...other,id:'composition-only',entryId:capsule.entries.find(e=>e.kind==='startup').id,composition:[route.entryId]};
  scoped.routes.push(compositionOnly);
  assert.ok(!createReportViewModel(scoped).routeContainment(route).bodies[0].routeIds.includes(compositionOnly.id),
    'co-owner links exclude registrations that only include the entry in composition');
  const single=structuredClone(capsule);
  single.implementations.forEach(row=>row.chunks.forEach(chunk=>{chunk.entryIds=chunk.entryIds.filter(id=>id===route.entryId);}));
  const singleModel=createReportViewModel(single);
  assert.equal(singleModel.routeContainment(route).bodies[0].entryIds.length,1);
  assert.equal(singleModel.measurement(route,'handler-body').fact.value,null,'one observed owner never upgrades isolated bytes');
  single.routes[0].behavior={kind:'continuing',basis:'canonical-handler-ir'};
  assert.equal(createReportViewModel(single).routeContainment(route).bytes,view.bytes,'historical behavior absence does not block containment');
  const missing=structuredClone(capsule);missing.implementations=missing.implementations.filter(row=>row.origin!=='dispatcher'||!row.bodyIds.length);
  assert.equal(createReportViewModel(missing).routeContainment(route).bytes,null);
  assert.equal(createReportViewModel(missing).routeContainment(route).partial,true);
  const legacy=structuredClone(capsule);delete legacy.implementations;
  assert.equal(createReportViewModel(legacy).routeContainment(route).bytes,null);
  const prelink=structuredClone(capsule);prelink.implementations.forEach(row=>row.artifactId='prelink');
  assert.equal(createReportViewModel(prelink).routeContainment(route).expected,0);
  assert.equal(serializeCapsule(capsule),before,'filtering, union and drawer leave all evidence and metrics unchanged');
};
