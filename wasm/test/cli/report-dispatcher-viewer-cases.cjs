'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { addSizeEvidence, census } = require('../../packages/cli/src/internal/report/size');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { serializeCapsule, parseCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { renderReport } = require('../../packages/cli/src/internal/report/viewer');

function dispatcherFixture() {
  const seed=f.fixture();
  for(const [index,kind] of [[2,'middleware'],[3,'error'],[4,'startup']]) seed.entries.push({...seed.entries[0],
    id:f.id('entry','entry-'+index),canonicalId:'entry-'+index,kind,order:index,
    schemaIds:[],bindingIds:[],declarationIds:[]});
  seed.coverage.entries=f.coverage(5);
  seed.routes[0].composition.unshift(seed.entries[2].id);seed.routes[0].compositionCoverage='bounded';
  const specs=[
    [0,'dispatcher-carrier',null,0], [1,'dispatcher-carrier',null,0],
    [2,'dispatcher-carrier',null,null], [3,'terminal-body','entry-1',0],
    [4,'shared-helper-body','helper:multi',0], [5,'shared-helper-body','helper:multi',1]
  ];
  const chunkMappings=specs.map(([chunk,kind,implementationId,functionIndex])=>({chunk,kind,implementationId,functionIndex,
    reason:functionIndex===null?'final-symbol-not-surviving':null}));
  const capture={kind:'pulse.report-attribution',attributionVersion:2,artifactId:f.aid,artifactSha256:f.hash,
    stage:'final',importedFunctions:0,functions:census(f.wasm).functions,chunkMappings,
    entries:[[0,[0,1,2]],[1,[3,4]],[2,[0]],[3,[1]],[4,[5]]].map(([index,chunks])=>({
      entryId:'entry-'+index,handlerId:'shared',reason:index===4?'entry-ownership-not-retained':null,
      bodies:chunks.map(chunk=>({chunk,relation:chunkMappings[chunk].kind}))})),
    graph:{state:'unavailable',reason:'unsupported-call-graph',method:'static-direct-calls-v1',edges:[]}};
  return addSizeEvidence(f.createCapsule(seed),new Map([[f.aid,f.wasm]]),capture);
}

module.exports = function dispatcherViewerCases({renderedTree}) {
  const capsule=dispatcherFixture(),before=serializeCapsule(capsule),model=createReportViewModel(capsule);
  const route=capsule.routes.find(row=>row.order===0),other=capsule.routes.find(row=>row.order===1);
  const view=model.routeDispatchers(route);
  assert.equal(view.records.length,3);
  assert.equal(view.bodies.length,1,'aliased carrier chunks share a single physical row');
  assert.deepEqual([view.size.bytes,view.size.mapped,view.size.expected,view.size.overlappingBodies],[4,2,3,1]);
  assert.equal(view.missing.length,1,'missing body retains its entry association');
  assert.deepEqual(view.bodies[0].entryIds,[0,1,2,3].map(i=>f.id('entry','entry-'+i)).sort());
  assert.ok(!view.bodies[0].entryIds.includes(f.id('entry','entry-4')),'another chunk of a logical helper cannot donate consumers');
  assert.deepEqual(new Set(view.bodies[0].routeIds),new Set([route.id,other.id]));
  assert.equal(model.routeDispatchers(other).records.length,0,'body overlap alone does not invent a dispatcher association');
  assert.equal(model.measurement(route,'handler-body').fact.value,null);
  assert.equal(model.measurement(route,'handler-body').fact.reason,'dispatcher-carrier');
  const tree=renderedTree(capsule);
  for(const tab of ['facts','size']) {
    Object.assign(tree.renderers.state,{selected:route.id,drawerTab:tab});tree.renderers.renderDrawer();
    const text=tree.get('drawer-content').textContent;
    assert.match(text,/Associated dispatcher bodies/);
    assert.match(text,/Distinct mapped dispatcher code4 bytes/);
    assert.match(text,/Mapped carrier chunks2 \/ 3/);
    assert.match(text,/Function 0 · 4 B · whole dispatcher body/);
    assert.match(text,/whole-body size is not this route’s size/);
    assert.match(text,/Carrier chunk 2 · body unavailable/);
    assert.match(text,/final-symbol-not-surviving/);
    assert.match(text,/Entry 4 · error/);
    assert.ok(tree.nodes().some(node=>node.attrs.href==='#routes/'+model.routeIndex.get(other.id)));
    const bodies=tree.nodes().filter(node=>node.attrs.class==='details-block dispatcher-body');
    assert.equal(bodies.length,2,'one physical body and one unavailable chunk');
    assert.equal(bodies[0].attrs.open,undefined,'native disclosure starts collapsed');
    assert.doesNotMatch(bodies[0].textContent,/Entry 5 · startup/);
  }
  const noMapping=structuredClone(capsule);
  noMapping.implementations=noMapping.implementations.filter(row=>row.origin!=='dispatcher'||!row.bodyIds.length);
  noMapping.coverage.implementations.observed=noMapping.implementations.length;
  const missingTree=renderedTree(f.createCapsule(noMapping));
  assert.match(missingTree.get('drawer-content').textContent,/Distinct mapped dispatcher codeUnavailable/);
  assert.equal(createReportViewModel(noMapping).routeDispatchers(route).size.bytes,null);
  const legacy=structuredClone(capsule);delete legacy.implementations;delete legacy.coverage.implementations;
  assert.match(renderedTree(f.createCapsule(legacy)).get('drawer-content').textContent,/Dispatcher inventory was not recorded/);
  // Projection-only foreign artifact scenario; no relabeling prelink bodies as final.
  const prelink=structuredClone(capsule);prelink.implementations.forEach(row=>row.artifactId='prelink');
  assert.equal(createReportViewModel(prelink).routeDispatchers(route).records.length,0);
  assert.match(renderedTree(prelink).get('drawer-content').textContent,/Prelink dispatcher records cannot establish final body sizes/);
  Object.assign(tree.renderers.state,{selected:other.id});tree.renderers.renderDrawer();
  assert.match(tree.get('drawer-content').textContent,/No dispatcher associations recorded/);
  assert.equal(serializeCapsule(capsule),before,'projections never modify evidence or route metrics');
  const html=renderReport(capsule),payload=html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(serializeCapsule(parseCapsule(payload)),before,'complete export round-trips unchanged');
};
module.exports.dispatcherFixture=dispatcherFixture;
