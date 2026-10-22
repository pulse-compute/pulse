'use strict';
const assert = require('node:assert/strict');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');

// Use the compiled handler fixture, including repeated mounts and middleware.
module.exports = ({capsule, renderedTree}) => {
  const before=serializeCapsule(capsule), model=createReportViewModel(capsule);
  const {registrations,associations,useSites}=capsule.analytics;
  const siteById=new Map(useSites.map(s=>[s.id,s]));
  const binding=capsule.bindings.find(b=>associations.some(a=>siteById.get(a.useSiteId).binding.bindingId===b.id));
  assert.ok(binding, 'compiler fixture must exercise binding associations');
  const expected=associations.filter(a=>siteById.get(a.useSiteId).binding.bindingId===binding.id);
  const projection=model.bindingProjection(binding.id);
  assert.deepEqual(projection.rows.map(a=>a.id),expected.map(a=>a.id));
  assert.equal(projection.consumerCount,new Set(expected.map(a=>a.consumerRegistrationId)).size);
  assert.equal(projection.consumers.flatMap(g=>g.rows).length,expected.length);
  for(const group of projection.consumers) {
    assert.ok(group.registrations.every(r=>(r.mountPath.at(-1)||null)===group.mount));
    assert.ok(group.rows.every(a=>group.registrations.some(r=>r.id===a.consumerRegistrationId)));
  }
  const mount=registrations.find(r=>r.kind==='mount'), child=registrations.find(r=>r.mountPath.includes(mount.id));
  assert.ok(child);
  const scoped=model.bindingProjection(binding.id,mount.id);
  assert.deepEqual(scoped.rows.map(a=>a.id),expected.filter(a=>{
    const r=model.registrationById.get(a.consumerRegistrationId);return r.id===mount.id||r.mountPath.includes(mount.id);
  }).map(a=>a.id));
  assert.ok(scoped.sites.every(s=>scoped.rows.some(a=>a.useSiteId===s.id)));
  assert.deepEqual(model.atlasLayout({scope:mount.id}).scoped.map(r=>r.id),registrations.filter(r=>r.id===mount.id||r.mountPath.includes(mount.id)).sort((a,b)=>a.order-b.order).map(r=>r.id));
  const searched=model.atlasLayout({query:child.id});
  assert.deepEqual(searched.matches.map(r=>r.id),[child.id]);
  assert.ok(child.mountPath.every(id=>searched.points.some(p=>p.id===id)), 'search retains mount ancestry');
  assert.ok(searched.edges.every(([parent,p])=>parent.id===(p.r.mountPath.at(-1)||null)), 'edges mean immediate containment');

  const tree=renderedTree(capsule), visit=hash=>{tree.location.hash=hash;tree.renderers.onHash();};
  const click=label=>{const n=tree.nodes().find(n=>n.tag==='button'&&n.textContent===label);assert.ok(n,label);assert.ok(!n.disabled,label+' enabled');n.events.click();};
  const key=(node,k)=>node.events.keydown({key:k,preventDefault(){}});
  // Inventory -> binding graph must work before any routing layout exists.
  visit('#bindings/'+encodeURIComponent(binding.id));click('Explore consumers');tree.renderers.onHash();
  assert.ok(tree.get('binding-viewport'));
  assert.equal(tree.get('view-atlas').hidden,false);
  const consumer=tree.nodes().find(n=>n.attrs['data-binding-node']==='consumer');assert.ok(consumer);
  key(consumer,'Enter');assert.equal(tree.get('view-atlas').attrs['data-inspector'],'true');
  assert.match(tree.get('binding-inspector').textContent,/Exact registration instances/);
  assert.equal(tree.document.activeElement.id,'binding-inspector-title');
  assert.ok(tree.document.body.classList.contains('atlas-expanded'),'Explorer fills window immediately');
  click('Dismiss details');assert.equal(tree.get('view-atlas').attrs['data-inspector'],'false');
  assert.equal(tree.document.activeElement.id,'atlas-inspector-toggle');
  click('Routing');assert.ok(tree.get('atlas-viewport'),'routing graph opens on mobile too');
  const mountNode=tree.nodes().find(n=>n.attrs['data-atlas-registration']===mount.id);assert.ok(mountNode);
  const expansion=tree.nodes().find(n=>n.attrs['data-expand-registration']===mount.id);assert.ok(expansion,'separate expansion affordance');
  const selection=tree.renderers.state.selectedRegistration;key(expansion,'Enter');assert.equal(tree.renderers.state.selectedRegistration,selection,'expansion does not select');assert.ok(tree.nodes().some(n=>n.attrs['data-atlas-registration']===child.id));
  visit('#atlas/'+model.registrationIndex.get(child.id));
  assert.equal(tree.renderers.state.selectedRegistration,child.id);
  assert.match(tree.get('atlas-selected-title').textContent,new RegExp(child.kind==='route'?'HTTP':child.kind));
  click('Application');
  assert.equal(tree.renderers.state.selectedRegistration,child.id);
  assert.ok(!tree.nodes().some(n=>n.attrs['data-atlas-registration']===child.id),'collapsed ancestry stays collapsed despite selection');
  click('Center selection');
  assert.ok(tree.nodes().some(n=>n.attrs['data-atlas-registration']===child.id),'center explicitly reveals the selected ancestry');
  click('Focus subrouter');assert.match(tree.get('atlas-scope').textContent,/Application/);
  click('Explore bindings');assert.ok(tree.get('binding-viewport'));
  assert.match(tree.get('binding-workspace').textContent,/Scope:/);
  // A selected route is inspector state, not an implicit Bindings-tab filter.
  const allConsumers=model.bindingProjection(binding.id,null,true);
  const route=registrations.find(r=>r.kind==='route'&&
    model.bindingProjection(binding.id,r.id,true).consumerCount>0);
  assert.ok(route,'fixture has a route consuming the shared binding');
  assert.ok(allConsumers.consumerCount>1,'fixture exposes consumers outside the selected route');
  const chooseBinding=()=>tree.nodes().find(n=>n.attrs['data-binding-id']===binding.id).events.click();
  const assertApplicationConsumers=()=>{
    assert.ok(tree.get('binding-workspace').textContent.includes('Scope: Application'));
    assert.ok(tree.get('binding-summary').textContent.startsWith(allConsumers.consumerCount+' possible entry points'));
    assert.deepEqual(tree.nodes().filter(n=>n.attrs['data-binding-node']==='consumer')
      .map(n=>n.attrs['data-binding-key']),allConsumers.consumers.slice(0,12).map(g=>g.key));
    assert.equal(tree.renderers.state.selectedRegistration,route.id,'routing selection remains available');
  };
  visit('#atlas/'+model.registrationIndex.get(route.id));
  click('Bindings');chooseBinding();assertApplicationConsumers();
  assert.equal(tree.document.activeElement.id,'binding-summary');
  // Explicit contextual exploration still narrows to the exact route.
  click('Routing');click('Explore bindings');chooseBinding();
  assert.ok(tree.get('binding-workspace').textContent.includes('Scope: '+model.registrationLabel(route)));
  assert.ok(tree.get('binding-summary').textContent.startsWith('1 possible entry points'));
  click('All consumers');assertApplicationConsumers();
  click('Routing');click('Explore bindings');chooseBinding();
  click('Bindings');assertApplicationConsumers();
  assert.equal(tree.document.activeElement.id,'atlas-bindings-tab');
  // An unchanged route selection must not restore the old scope on a round trip.
  click('Routing');click('Bindings');assertApplicationConsumers();
  visit('#handlers');assert.ok(!tree.document.body.classList.contains('atlas-expanded'),'navigation restores page layout');
  const desktop=renderedTree(capsule,{narrow:false});desktop.location.hash='#atlas';desktop.renderers.onHash();
  assert.ok(desktop.get('atlas-viewport'),'desktop atlas builds graph on opening');
  assert.equal(tree.renderers.model.canonicalJson,before,'interactive state preserves full canonical export');
  assert.equal(serializeCapsule(capsule),before);

  const legacy=structuredClone(capsule);delete legacy.analytics;
  const old=renderedTree(legacy);old.location.hash='#atlas';old.renderers.onHash();
  assert.match(old.get('atlas-count').textContent,/unavailable.*not-recorded/);
  old.renderers.exploreBinding(binding.id);old.renderers.onHash();
  assert.match(old.get('binding-coverage').textContent,/unavailable/);
  assert.ok(!old.nodes().some(n=>n.attrs['data-binding-node']==='consumer'),'inventory never invents consumers');

  // Supplemental display-boundary fixture; compilation semantics come from above.
  const large=structuredClone(capsule), seed=registrations.find(r=>r.kind==='route');
  large.analytics.registrations=Array.from({length:650},(_,i)=>({...seed,id:'display-'+i,order:i,mountPath:[]}));
  const bounded=createReportViewModel(large).atlasLayout();
  assert.equal(bounded.points.length,300);assert.equal(bounded.truncated,true);assert.equal(bounded.matches.length,650);
  const pages=renderedTree(large);pages.location.hash='#atlas';pages.renderers.onHash();
  const seen=[];
  for(let page=0;page<13;page++) {
    seen.push(...pages.get('atlas-rows').children.map(n=>n.attrs['data-atlas-row']));
    const next=pages.nodes().find(n=>n.tag==='button'&&n.textContent==='Next page');
    assert.equal(next.disabled,page===12);if(!next.disabled)next.events.click();
  }
  assert.deepEqual(seen,large.analytics.registrations.map(r=>r.id),'pagination keeps every registration beyond graph cap');
};
