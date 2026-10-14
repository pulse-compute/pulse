'use strict';
const assert=require('node:assert/strict');
const {createReportViewModel}=require('../../packages/cli/src/internal/report/viewer/model');
module.exports=({capsule,renderedTree})=>{
  const before=JSON.stringify(capsule),m=createReportViewModel(capsule),mount=m.registrations.find(r=>r.kind==='mount'),scoped=m.atlasLayout({scope:mount.id});
  assert.deepEqual(scoped.scoped.map(r=>r.id),m.registrations.filter(r=>r.id===mount.id||r.mountPath.includes(mount.id)).map(r=>r.id));
  const reused=m.definitions.find(h=>m.definitionRegistrations(h.id).length>1),instances=m.definitionRegistrations(reused.id),a=instances[0],b=instances[1];
  const open=new Set(),search=m.atlasLayout({query:a.id,expanded:open});
  assert.equal(open.size,0,'search expansion is temporary');assert.deepEqual(search.matches.map(r=>r.id),[a.id]);
  assert.ok(search.points.some(p=>p.id===a.id));assert.ok(!search.points.some(p=>p.id===b.id),'a reused definition never imports another instance');
  for(const id of a.mountPath)assert.ok(search.points.some(p=>p.id===id));
  const expanded=new Set(m.registrations.filter(r=>r.kind==='mount').map(r=>r.id));
  assert.deepEqual(m.atlasLayout({expanded}),m.atlasLayout({expanded:new Set([...expanded].reverse())}),'interaction order cannot affect placement');
  const tree=renderedTree(capsule);tree.location.hash='#atlas/'+m.registrationIndex.get(a.id);tree.renderers.onHash();
  assert.equal(tree.renderers.state.selectedRegistration,a.id,'atlas uses existing selected registration');
  assert.match(tree.get('view-atlas').textContent,/Static compiler evidence/);
  assert.ok(tree.nodes().some(n=>n.attrs.href==='#registrations/'+m.registrationIndex.get(a.id)));
  tree.get('atlas-toggle').events.click();
  assert.ok(tree.nodes().some(n=>n.tag==='svg'&&n.attrs.class==='atlas-svg'));
  assert.ok(tree.nodes().filter(n=>n.attrs['data-atlas-registration']).every(n=>n.tag==='g'&&n.attrs.role==='button'&&n.attrs.tabindex==='0'));
  assert.ok(tree.nodes().every(n=>!n.attrs.style),'strict CSP has no inline styles');
  tree.get('atlas-focus').events.click();assert.match(tree.get('atlas-count').textContent,/in scope/);
  const selectedScope=a.kind==='mount'?a.id:a.mountPath.at(-1);
  if(selectedScope)assert.equal(tree.get('atlas-rows').children.length,Math.min(50,m.atlasLayout({scope:selectedScope}).matches.length));
  tree.location.hash='#registrations/'+m.registrationIndex.get(a.id);tree.renderers.onHash();
  assert.ok(tree.nodes().some(n=>n.attrs.href==='#atlas/'+m.registrationIndex.get(a.id)),'existing details link back to the same instance');
  assert.equal(JSON.stringify(capsule),before);assert.deepEqual(JSON.parse(m.canonicalJson),capsule);
  // Binding consumers are exact retained joins, not inferred from inventory or
  // shared handler definitions. Scope includes descendants only for mounts.
  for(const binding of capsule.bindings){
    const p=m.bindingProjection(binding.id),expected=capsule.analytics.associations.filter(a=>m.useSiteById.get(a.useSiteId).binding.bindingId===binding.id);
    assert.deepEqual(p.rows.map(a=>a.id),expected.map(a=>a.id));
    assert.equal(p.consumerCount,new Set(expected.map(a=>a.consumerRegistrationId)).size);
    assert.equal(p.sites.length,m.bindingSites(binding.id).length);
    for(const r of m.registrations){
      const scoped=m.bindingProjection(binding.id,r.id);
      assert.ok(scoped.rows.every(a=>a.consumerRegistrationId===r.id||(r.kind==='mount'&&m.registrationById.get(a.consumerRegistrationId).mountPath.includes(r.id))));
      assert.ok(scoped.sites.every(s=>scoped.rows.some(a=>a.useSiteId===s.id)));
    }
    for(const g of p.consumers){assert.equal(new Set(g.registrations.map(r=>r.mountPath.at(-1)||null)).size,1);assert.equal(new Set(g.registrations.map(r=>r.handlerId||r.id)).size,1);}
    assert.equal(p.operations.reduce((n,o)=>n+o.sites.length,0),p.sites.length);
  }
  const absent=structuredClone(capsule);delete absent.analytics;
  const absentModel=createReportViewModel(absent);
  for(const binding of absent.bindings)assert.equal(absentModel.bindingProjection(binding.id).consumerCount,0);
  const noRows=structuredClone(capsule);noRows.analytics.associations=[];
  const noRowsModel=createReportViewModel(noRows);
  for(const binding of noRows.bindings){assert.equal(noRowsModel.bindingProjection(binding.id).consumers.length,0);assert.equal(noRowsModel.bindingProjection(binding.id).sites.length,m.bindingSites(binding.id).length);}
  tree.location.hash='#atlas/'+m.registrationIndex.get(a.id);tree.renderers.onHash();
  tree.get('atlas-bindings-tab').events.click();
  assert.match(tree.get('binding-coverage').textContent,/association data/i);
  assert.equal(tree.renderers.state.selectedRegistration,a.id,'view switches retain registration selection');
  assert.ok(tree.nodes().every(n=>!n.attrs.style));
  assert.equal(JSON.stringify(capsule),before,'binding projection and rendering never modify evidence');
  // A large retained inventory is bounded only in graph/table presentation.
  const large=structuredClone(capsule),template=large.analytics.registrations.find(r=>r.kind!=='mount');
  large.analytics.registrations=Array.from({length:700},(_,i)=>({...template,id:'large:'+i,order:i,mountPath:[],flow:{next:null,child:null,parentContinue:null}}));
  const big=createReportViewModel(large).atlasLayout();assert.equal(big.points.length,300);assert.equal(big.truncated,true);assert.equal(big.matches.length,700);
};
