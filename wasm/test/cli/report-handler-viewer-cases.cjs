'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const f = require('./report-fixtures.cjs');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { renderReport } = require('../../packages/cli/src/internal/report/viewer');
const { serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { projectHandlerTopology } = require('../../packages/cli/src/internal/report/handler-topology');
const { setup } = require('../../../docs/internal/an9-00/fixture.cjs');
function fixture(variant='http') {
  const root=path.resolve(__dirname,'../../.test-results');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'an9-05-viewer-'));
  try {
    setup(directory,variant);
    const project=require('../../packages/cli/src/project-config').resolveProject({cwd:directory,metadataOnly:true});
    const prepared=require('../../packages/cli/src/project-execution').compileNativeProjectInMemory(project,{emitWat:false});
    const wasm=prepared.native.manifest.wasm;
    const artifact={id:'artifact:'+wasm.sha256,...wasm,stage:'final',target:'portable-native-wasm'};
    return require('../../packages/cli/src/internal/report/inventory').collectInventory(project,prepared,[artifact],artifact.id,'default');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
module.exports = ({renderedTree}) => {
  const capsule=fixture(), before=serializeCapsule(capsule), a=capsule.analytics, model=createReportViewModel(capsule), tree=renderedTree(capsule);
  require('./report-atlas-viewer-cases.cjs')({capsule,renderedTree});
  const visit=hash=>{tree.location.hash=hash;tree.renderers.onHash();return tree.get('view-handlers').textContent;};
  tree.renderers.buildNavigation();
  assert.ok(tree.get('desktop-nav').textContent.includes('Handlers'));
  assert.ok(tree.get('desktop-nav').textContent.includes('Compiled helpers'));
  visit('#handlers');
  assert.equal(tree.get('handler-list').children[0].children.length,a.handlers.length,'one list row per definition');
  const reused=a.handlers.find(h=>h.name==='reused'), helper=a.handlers.find(h=>h.kind==='helper'), imported=a.handlers.find(h=>h.name==='packageHandler');
  assert.equal(model.definitionRegistrations(reused.id).length,2);
  let text=visit('#handlers/'+model.definitionIndex.get(reused.id));
  assert.equal(tree.document.activeElement.id,'definition-title');
  assert.ok(text.includes('Registration instances'));
  for(const registration of model.definitionRegistrations(reused.id)) assert.ok(tree.nodes().some(n=>n.attrs.href==='#registrations/'+model.registrationIndex.get(registration.id)));
  assert.equal(model.definitionSites(reused.id).filter(s=>s.surfaceId==='ctx.config.get').length,3,'repeated reads remain distinct');
  tree.get('handler-search').events.input({target:{value:'HELPER_TOKEN'}});
  assert.ok(tree.get('handler-list').textContent.includes(model.definitionLabel(helper)));
  assert.ok(!tree.get('handler-list').textContent.includes(model.definitionLabel(reused)));
  tree.get('handler-search').events.input({target:{value:''}});
  tree.get('handler-kind').events.change({target:{value:'helper'}});
  assert.equal(tree.get('handler-list').children[0].children.length,1);
  tree.get('handler-kind').events.change({target:{value:'all'}});
  tree.get('handler-role').events.change({target:{value:'middleware'}});
  assert.equal(tree.get('handler-list').children[0].children.length,a.handlers.filter(h=>model.definitionRegistrations(h.id).some(r=>r.kind==='middleware')).length);
  text=visit('#handlers/'+model.definitionIndex.get(helper.id));
  assert.ok(text.includes('Helper callers'));assert.equal(model.helperCallers(helper.id).length,2);
  for(const call of model.helperCallers(helper.id)) assert.ok(text.includes(model.authoredSource(call.source)));
  text=visit('#handlers/'+model.definitionIndex.get(imported.id));
  assert.ok(text.includes('@fixture/analytics'));assert.ok(text.includes(imported.source.value.sha256));
  const mounted=a.registrations.filter(r=>r.kind==='route'&&r.mountPath.length);
  assert.ok(new Set(mounted.flatMap(r=>r.mountPath)).size>=2);
  for(const registration of mounted) {
    text=visit('#registrations/'+model.registrationIndex.get(registration.id));
    assert.equal(tree.document.activeElement.id,'registration-title');
    assert.match(text,/Ordered mount instances/);
    for(const id of registration.mountPath) assert.ok(tree.nodes().some(n=>n.attrs.href==='#registrations/'+model.registrationIndex.get(id)));
  }
  const inherited=a.associations.find(row=>row.via.some(h=>h.kind==='middleware'));
  text=visit('#registrations/'+model.registrationIndex.get(inherited.consumerRegistrationId));
  assert.match(text,/Conditional static candidate/);assert.match(text,/Direct ownership · not execution/);assert.match(text,/middleware · /);
  const error=a.associations.find(row=>row.lane==='error');
  assert.ok(visit('#registrations/'+model.registrationIndex.get(error.consumerRegistrationId)).includes('error · Conditional static candidate'));
  for(const site of [a.useSites.find(s=>s.binding.state==='dynamic'),a.useSites.find(s=>s.binding.state==='not-applicable'),a.useSites.find(s=>s.binding.state==='resolved')]) {
    text=visit('#use-sites/'+model.useSiteIndex.get(site.id));
    assert.equal(tree.document.activeElement.id,'use-site-title');assert.ok(text.includes(site.binding.state));assert.ok(text.includes(model.authoredSource(site.source)));
    if(site.binding.bindingId) {
      const b=capsule.bindings.findIndex(b=>b.id===site.binding.bindingId);
      assert.ok(tree.nodes().some(n=>n.attrs.href==='#bindings/'+b));
      visit('#bindings/'+b);assert.equal(tree.document.activeElement.id,'binding-title-'+b);
      assert.ok(tree.get('view-bindings').textContent.includes('Authored use sites'));
    }
  }
  visit('#routes/0');Object.assign(tree.renderers.state,{drawerTab:'facts'});tree.renderers.renderDrawer();
  assert.match(tree.get('drawer-content').textContent,/Authored handler and associations/);
  visit('#entries/'+model.entryIndex.get(mounted[0].id));
  assert.match(tree.get('view-entries').textContent,/Authored analytics/);
  for(const hash of ['#handlers/999999','#registrations/999999','#use-sites/999999']) {
    visit(hash);assert.equal(tree.get('view-handlers').hidden,false);assert.equal(tree.get('definition-title'),undefined);assert.equal(tree.get('registration-title'),undefined);assert.equal(tree.get('use-site-title'),undefined);
  }
  assert.equal(serializeCapsule(capsule),before);assert.equal(model.canonicalJson,before);
  assert.equal(renderReport(capsule),renderReport(capsule),'analytics HTML deterministic');
  assert.deepEqual(JSON.parse(renderReport(capsule).match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]),capsule,'full evidence retained in export payload');

  for(const analytics of [undefined,projectHandlerTopology()]) {
    const old=f.fixture(true);if(analytics)old.analytics=analytics;
    const absent=renderedTree(f.createCapsule(old));absent.renderers.buildNavigation();assert.match(absent.get('desktop-nav').textContent,/Handlers—/);absent.location.hash='#handlers';absent.renderers.onHash();
    assert.match(absent.get('view-handlers').textContent,/Handler definitions unavailable · not-recorded/);
    assert.match(absent.get('view-handlers').textContent,/All registration instances · Unavailable/);
    absent.location.hash='#atlas';absent.renderers.onHash();
    assert.match(absent.get('view-atlas').textContent,/Registration analytics unavailable/);
    assert.equal(absent.nodes().filter(n=>n.attrs['data-atlas-registration']).length,0);
  }
  const eventCapsule=fixture('event'), eventModel=createReportViewModel(eventCapsule), eventTree=renderedTree(eventCapsule);
  const event=eventCapsule.analytics.registrations.find(r=>r.kind==='event');
  eventTree.location.hash='#registrations/'+eventModel.registrationIndex.get(event.id);eventTree.renderers.onHash();
  assert.match(eventTree.get('view-handlers').textContent,/event · Direct ownership/);
  assert.ok(!eventModel.registrationAssociations(event.id).some(row=>row.via.some(hop=>hop.kind==='middleware')));
  eventTree.location.hash='#atlas/'+eventModel.registrationIndex.get(event.id);eventTree.renderers.onHash();
  assert.equal(eventTree.renderers.state.selectedRegistration,event.id);
  assert.match(eventTree.get('atlas-selected-title').textContent,/event/);

  // Presentation-only degraded/hostile facts: the viewer must never invent a
  // location from registrations, read source, or interpret text as markup.
  const missing=structuredClone(capsule), selected=missing.analytics.handlers[0];
  selected.source={state:'unavailable',value:null,reason:'not-recorded'};
  selected.name='<img src=x onerror=alert(1)>';
  missing.analytics.coverage.useSites={status:'partial',observed:a.useSites.length,expected:null,reason:'not-recorded'};
  const degraded=renderedTree(missing);degraded.location.hash='#handlers/0';degraded.renderers.onHash();
  assert.match(degraded.get('view-handlers').textContent,/Definition sourceunavailable · not-recorded/);
  assert.match(degraded.get('view-handlers').textContent,/partial · \d+ observed \/ unknown expected · not-recorded/);
  assert.ok(degraded.get('definition-title').textContent.includes(selected.name));
  assert.ok(!degraded.nodes().some(n=>n.tag==='img'));
  const partial=missing.analytics.associations.find(row=>row.conditional===true);
  partial.conditional=null;partial.coverage={status:'partial',observed:1,expected:null,reason:'not-recorded'};
  const unknownSite=missing.analytics.useSites.find(row=>row.id===partial.useSiteId);
  unknownSite.binding={state:'unknown',kind:null,bindingId:null,referenceId:null,reason:'unresolved-reference'};
  unknownSite.capability={state:'unavailable',value:null,reason:'not-recorded'};
  const unknown=renderedTree(missing);unknown.location.hash='#use-sites/'+model.useSiteIndex.get(unknownSite.id);unknown.renderers.onHash();
  assert.match(unknown.get('view-handlers').textContent,/Conditionality unknown/);
  assert.match(unknown.get('view-handlers').textContent,/Capabilityunavailable · not-recorded/);
  assert.match(unknown.get('view-handlers').textContent,/Binding stateunknown · unresolved-reference/);
};
