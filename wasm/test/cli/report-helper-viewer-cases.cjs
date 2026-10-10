'use strict';
const assert = require('node:assert/strict');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { createCapsule, serializeCapsule, parseCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { implementationId } = require('../../packages/cli/src/internal/report/implementations');
const { renderReport } = require('../../packages/cli/src/internal/report/viewer');
const f = require('./report-fixtures.cjs');
function helperFixture() {
  const input=structuredClone(require('./report-implementation-cases.cjs')());
  const stage=input.implementations.find(row=>row.origin==='consolidated-stage');
  // One physical function shared across distinct logical records is counted once.
  const alias={...structuredClone(stage),canonicalId:'stage:alias'};
  alias.id=implementationId(alias.artifactId,alias.origin,alias.canonicalId);
  alias.chunks[0].chunk=20;
  input.implementations.push(alias);input.coverage.implementations.observed++;
  return createCapsule(input);
}
module.exports = function helperViewerCases({renderedTree}) {
  const capsule=helperFixture(),model=createReportViewModel(capsule);
  assert.equal(model.helpers.length,4,'only authored helpers and consolidated stages');
  assert.ok(model.helpers.every(row=>row.artifactId===model.A.id));
  const size=model.helperSize(model.helpers);
  assert.deepEqual([size.bytes,size.bodyIds.length,size.overlappingBodies,size.mapped,size.expected],[6,2,1,4,6]);
  const unknown=model.helpers.find(row=>!row.bodyIds.length);
  assert.equal(model.helperSize([unknown]).bytes,null,'missing mappings are not zero');
  for(const dir of ['asc','desc']) {
    Object.assign(model.state,{helperSort:'size',helperDir:dir});
    assert.equal(model.filteredHelpers().at(-1).id,unknown.id);
  }
  model.state.helperOrigin='authored-helper';assert.equal(model.filteredHelpers().length,2);
  model.state.helperRole='middleware';assert.equal(model.filteredHelpers().length,0);
  model.state.helperOrigin='all';assert.equal(model.filteredHelpers().length,2);
  Object.assign(model.state,{helperRole:'all',helperSearch:'stage:alias'});assert.equal(model.filteredHelpers().length,1);
  model.state.helperSearch='nothing matches';assert.equal(model.filteredHelpers().length,0);
  assert.equal(model.canonicalJson,serializeCapsule(capsule),'filters do not narrow export');
  assert.equal(model.routeHelpers(capsule.routes[0]).length,3,'composition links include middleware consumers');
  const tree=renderedTree(capsule);tree.renderers.renderHelpers();
  assert.match(tree.get('helper-summary').textContent,/Distinct mapped code6 B/);
  assert.match(tree.get('helper-summary').textContent,/Bodies in multiple rows1/);
  assert.match(tree.get('view-helpers').textContent,/Middleware is a role; consolidation is an origin/);
  const helper=model.helpers.find(row=>row.canonicalId==='helper:authored'),i=model.helperIndex.get(helper.id);
  tree.get('helper-expand-'+i).events.click();
  assert.equal(tree.get('helper-expand-'+i).attrs['aria-expanded'],'true');
  assert.match(tree.get('helper-detail-'+i).textContent,/Partial · expected count unknown/);
  assert.match(tree.get('helper-detail-'+i).textContent,/Mapping coverage2 \/ 3 chunks · partial/);
  assert.ok(tree.nodes().some(node=>node.attrs.href==='#routes/0'));
  assert.ok(tree.nodes().some(node=>node.attrs.href==='#helpers/'+i));
  assert.match(tree.get('drawer-content').textContent,/Associated mapped code: 6 bytes/);
  assert.match(tree.get('drawer-content').textContent,/do not add them to Handler body or Reachable/);
  tree.get('helper-search').events.input({target:{value:'nothing matches'}});
  assert.match(tree.get('helper-body').textContent,/No matching helpers/);
  assert.match(tree.get('helper-summary').textContent,/No mapped total available/);
  tree.get('helper-search').events.input({target:{value:''}});
  tree.get('helper-sort-size').events.click();assert.equal(tree.renderers.state.helperSort,'size');
  tree.get('helper-order').events.change({target:{value:'consumers:asc'}});
  assert.equal(tree.renderers.state.helperSort,'consumers');assert.equal(tree.renderers.state.helperDir,'asc');
  tree.get('helper-role').events.change({target:{value:'middleware'}});
  assert.match(tree.get('helper-count').textContent,/2 of 4/);
  const legacy=createCapsule(f.fixture()),legacyTree=renderedTree(legacy);legacyTree.renderers.renderHelpers();
  assert.equal(createReportViewModel(legacy).helperState,'not-recorded');
  assert.match(legacyTree.get('view-helpers').textContent,/not recorded in this historical capsule/);
  assert.doesNotMatch(legacyTree.get('helper-summary').textContent,/0 B/);
  // Projection-only prelink scenario: no promotion of old indices to final.
  const prelink=structuredClone(capsule);prelink.implementations.forEach(row=>row.artifactId='prelink');
  assert.equal(createReportViewModel(prelink).helpers.length,0);
  assert.equal(createReportViewModel(prelink).helperState,'no-primary-records');
  const empty=structuredClone(capsule);empty.implementations=empty.implementations.filter(row=>row.origin==='dedicated');
  empty.coverage.implementations.observed=empty.implementations.length;
  const emptyTree=renderedTree(createCapsule(empty));emptyTree.renderers.renderHelpers();
  assert.match(emptyTree.get('helper-body').textContent,/No authored helper or consolidated stage records/);
  const html=renderReport(capsule),payload=html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(serializeCapsule(parseCapsule(payload)),serializeCapsule(capsule));
};
module.exports.helperFixture=helperFixture;
