'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { dispatcherFixture } = require('./report-dispatcher-viewer-cases.cjs');
// Model native disclosure visibility: closed details expose only their summary.
const visibleText = node => typeof node === 'string' ? node : node.hidden || node.attrs.hidden !== undefined ? ''
  : (node.tag === 'details' && node.attrs.open === undefined ? node.children.filter(child=>child.tag==='summary') : node.children).map(visibleText).join('');
module.exports = ({renderedTree}) => {
  const capsule=dispatcherFixture(), before=serializeCapsule(capsule), model=createReportViewModel(capsule), tree=renderedTree(capsule);
  tree.renderers.renderRoutes();
  const rows=tree.get('route-body').children;
  assert.ok(rows.every(row=>row.children.length===8), 'compact table keeps eight corresponding columns');
  const first=rows[0], cells=first.children;
  assert.equal(cells[2].children[0].attrs.title,capsule.routes[0].path, 'full path remains available');
  assert.equal(cells[2].children[1].children[0].attrs.href,'#entries/'+model.entryIndex.get(capsule.routes[0].entryId));
  assert.equal(cells[2].children[1].textContent,model.entryLabel(model.entries.get(capsule.routes[0].entryId),true));
  assert.ok(!cells[2].children[1].textContent.includes(capsule.routes[0].path), 'compact identity does not repeat the route path');
  assert.match(visibleText(cells[3]),/Behavior not recorded/);
  assert.match(visibleText(cells[4]),/schemas.*bindings/);
  assert.match(visibleText(cells[5]),/Unavailable.*dispatcher-carrier/);
  assert.match(visibleText(cells[6]),/4 B.*Partial mapping.*Whole bodies · non-additive/);
  assert.match(visibleText(rows[1].children[6]),/Unavailable.*No carrier evidence.*non-additive/);
  assert.notEqual(model.entryLabel(capsule.entries[0],true),model.entryLabel(capsule.entries[1],true), 'compact reused names still resolve collisions');
  Object.assign(tree.renderers.state,{sort:'path',dir:'desc',search:capsule.routes[0].path});tree.renderers.renderRoutes();
  for (const row of tree.get('route-body').children) {
    const i=Number(row.attrs['data-route-index']);assert.equal(row.children[7].children[0].attrs.href,'#routes/'+i);
  }
  for (const tab of ['facts','size']) {
    Object.assign(tree.renderers.state,{selected:capsule.routes[0].id,drawerTab:tab});tree.renderers.renderDrawer();
    const visible=visibleText(tree.get('drawer-content'));
    assert.match(visible,/Mixed dispatcher ownership/);
    assert.match(visible,/Partial mapping/);
    assert.match(visible,/cannot be added across routes/);
    assert.match(visible,/Mapped entry carrier chunks2 \/ 3/);
    const groups=tree.nodes().filter(n=>n.attrs.class==='details-block evidence-group');
    assert.ok(groups.length);assert.ok(groups.every(n=>n.attrs.open===undefined));
  }
  assert.equal(serializeCapsule(capsule),before);

  const input=f.fixture(true), seed=input.evidence[0];
  input.evidence.push({...structuredClone(seed),id:f.id('evidence','failed-peer'),result:'failed',scope:{...seed.scope,cases:['failed-case']}});
  input.evidence.push({...structuredClone(seed),id:f.id('evidence','new-producer-version'),producer:{...seed.producer,version:'2'}});
  input.evidence.push({...structuredClone(seed),id:f.id('evidence','other-kind'),kind:'test',scope:{corpus:'synthetic',cases:['test-case'],targets:['native']}});
  const grouped=f.createCapsule(input), saved=serializeCapsule(grouped), evidenceTree=renderedTree(grouped);
  evidenceTree.renderers.renderEvidence();
  const root=evidenceTree.get('view-evidence'), groups=root.children.filter(n=>n.attrs?.class==='details-block evidence-group');
  assert.equal(groups.length,3,'kind and exact producer identity group records without merging claims');
  const mixed=groups.find(n=>n.children[0].textContent.includes('2 records'));
  assert.ok(mixed);assert.match(visibleText(mixed),/1 passed/);assert.match(visibleText(mixed),/1 failed/);
  assert.ok(!visibleText(root).includes('failed-case'),'record details start collapsed');
  mixed.setAttribute('open','');
  const records=mixed.children[1].children;
  assert.equal(records.length,2);assert.ok(records.every(n=>n.attrs.open===undefined));
  const failed=records.find(n=>n.children[0].textContent.startsWith('failed'));
  failed.setAttribute('open','');
  assert.match(visibleText(failed),/failed-case/);
  assert.ok(visibleText(failed).includes(input.evidence[1].id),'full record identity stays in the disclosure');
  for (const e of grouped.evidence) assert.ok(root.textContent.includes(e.id));
  assert.equal(serializeCapsule(grouped),saved,'grouping never changes capsule evidence or export');
};
