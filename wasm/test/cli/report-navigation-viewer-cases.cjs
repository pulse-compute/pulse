'use strict';
const assert=require('node:assert/strict');
const {graphFixture}=require('./report-handler-viewer-cases.cjs');
const {createReportViewModel}=require('../../packages/cli/src/internal/report/viewer/model');
const {serializeCapsule,createCapsule}=require('../../packages/cli/src/internal/report/capsule');
module.exports=({renderedTree})=>{
  // This compiled fixture contains HTTP routes, repeated mounted definitions,
  // middleware, validated helper operations, dynamic bindings and an event.
  const capsule=graphFixture('event'),saved=serializeCapsule(capsule),tree=renderedTree(capsule),m=tree.renderers.model;
  const visit=hash=>{tree.location.hash=hash;tree.renderers.onHash();};
  const click=(root,label)=>{const n=(root||tree.get('view-atlas')).querySelectorAll('button').find(n=>n.textContent===label);assert.ok(n,label);assert.ok(!n.disabled);n.events.click();return n;};
  tree.renderers.buildNavigation();
  for(const name of ['desktop-nav','mobile-nav']){
    const root=tree.get(name),primary=root.children.filter(n=>n.tag==='a');
    assert.deepEqual(primary.map(n=>n.attrs.href),['#entry-points','#bindings']);
    assert.ok(root.children.some(n=>n.tag==='details'&&n.children[0].textContent==='More report sections'));
    assert.ok(!root.querySelectorAll('a').some(n=>n.attrs.href==='#atlas'));
  }
  visit('');assert.equal(m.state.view,'entry-points');
  assert.equal(tree.get('entry-point-list').querySelectorAll('li').length,m.entryPoints.length);
  const event=m.entryPoints.find(p=>p.type==='event'),http=m.entryPoints.find(p=>p.type==='http'&&p.registration.mountPath.length);
  assert.ok(event&&http);assert.equal(event.eventType,'analytics.tick');
  tree.get('entry-point-type').events.change({target:{value:'event'}});
  assert.equal(tree.get('entry-point-list').querySelectorAll('li').length,1);
  assert.equal(tree.get('entry-point-list').querySelectorAll('li')[0].attrs['data-entry-point-id'],event.id);
  assert.ok(tree.get('entry-point-event'));
  tree.get('entry-point-type').events.change({target:{value:'http'}});assert.ok(tree.get('entry-point-method'));
  tree.get('entry-point-method').events.change({target:{value:'GET'}});
  assert.ok(m.filteredEntryPoints().every(p=>p.type==='http'&&p.method==='GET'));
  tree.get('entry-point-type').events.change({target:{value:'all'}});
  tree.get('entry-point-search').events.input({target:{value:event.eventType}});assert.equal(m.filteredEntryPoints().length,1);
  tree.get('entry-point-search').events.input({target:{value:''}});

  // Entry -> Explorer -> exact handler/source -> return: retain the live graph,
  // expanded mounts, scope, selected record, zoom, pan and keyboard focus.
  visit(m.detailHash('entry-points',http.id));assert.equal(tree.document.activeElement.id,'entry-point-title');
  assert.match(tree.get('view-entry-points').textContent,/Possible preceding handlers/);
  assert.match(tree.get('view-entry-points').textContent,/Possible bindings/);
  click(tree.get('view-entry-points'),'Explore execution');tree.renderers.onHash();
  assert.equal(m.state.selectedRegistration,http.id);assert.ok(tree.get('atlas-viewport'));
  const selectedNode=tree.get('view-atlas').querySelectorAll('g').find(n=>n.attrs['data-atlas-registration']===http.id);selectedNode.events.keydown({key:'Enter',preventDefault(){}});
  assert.equal(tree.get('view-atlas').attrs['data-inspector'],'true');
  click(null,'Expand workspace');click(null,'+');
  const viewport=tree.get('atlas-viewport'),graph=viewport.children[0];viewport.scrollLeft=123;viewport.scrollTop=47;
  const width=graph.attrs.width,nodeIds=tree.get('view-atlas').querySelectorAll('g').map(n=>n.attrs['data-atlas-registration']).filter(Boolean);
  const link=tree.get('view-atlas').querySelectorAll('a').find(n=>n.attrs.href===m.detailHash('handlers',http.registration.handlerId));assert.ok(link);link.focus();
  const explorerHash=tree.location.hash;visit(link.attrs.href);
  assert.equal(tree.document.activeElement.id,'definition-title');assert.ok(!tree.document.body.classList.contains('atlas-expanded'));
  const back=tree.get('explorer-return').querySelector('a');assert.equal(back.textContent,'Back to Explorer');assert.equal(back.attrs.href,explorerHash);
  visit(back.attrs.href);assert.equal(tree.get('atlas-viewport'),viewport);assert.equal(graph.attrs.width,width);
  assert.equal(viewport.scrollLeft,123);assert.equal(viewport.scrollTop,47);assert.equal(tree.document.activeElement,link);
  assert.equal(m.state.selectedRegistration,http.id);assert.ok(tree.document.body.classList.contains('atlas-expanded'));
  assert.deepEqual(tree.get('view-atlas').querySelectorAll('g').map(n=>n.attrs['data-atlas-registration']).filter(Boolean),nodeIds);

  // Binding -> candidate entry -> exact details -> return to binding pin/camera.
  const binding=capsule.bindings.find(b=>m.bindingProjection(b.id,null,true).consumerCount);
  visit(m.detailHash('bindings',binding.id));assert.match(tree.get('view-bindings').textContent,/Possible entry-point consumers/);
  assert.ok(tree.get('view-bindings').querySelectorAll('a').some(n=>n.attrs.href.startsWith('#entry-points/')));
  click(tree.get('view-bindings'),'Explore consumers');tree.renderers.onHash();assert.equal(tree.document.activeElement.id,'binding-summary');
  const consumer=tree.get('view-atlas').querySelectorAll('g').find(n=>n.attrs['data-binding-node']==='consumer');assert.ok(consumer);consumer.events.keydown({key:'Enter',preventDefault(){}});
  click(null,'Zoom in');const bindingViewport=tree.get('binding-viewport');bindingViewport.scrollLeft=87;bindingViewport.scrollTop=31;
  const bindingGraph=bindingViewport.children[0],bindingWidth=bindingGraph.attrs.width;
  const destination=tree.get('binding-inspector').querySelectorAll('a').find(n=>n.attrs.href.startsWith('#entry-points/'));assert.ok(destination);destination.focus();
  const bindingHash=tree.location.hash;visit(destination.attrs.href);assert.equal(tree.document.activeElement.id,'entry-point-title');
  visit(tree.get('explorer-return').querySelector('a').attrs.href);assert.equal(tree.location.hash,bindingHash);
  assert.equal(tree.get('binding-viewport'),bindingViewport);assert.equal(bindingViewport.scrollLeft,87);assert.equal(bindingViewport.scrollTop,31);assert.equal(bindingGraph.attrs.width,bindingWidth);assert.equal(tree.document.activeElement,destination);
  assert.ok(tree.get('binding-inspector').textContent.includes('Exact registration instances'));

  // Source and unresolved identities are reachable without graph expansion.
  visit(m.detailHash('entry-points',event.id));assert.match(tree.get('view-entry-points').textContent,/Event type \/ triggeranalytics.tick/);
  const source=tree.get('view-entry-points').querySelectorAll('a').find(n=>n.attrs.href.startsWith('#use-sites/'));assert.ok(source);visit(source.attrs.href);
  assert.match(tree.get('view-handlers').textContent,/Authored use source/);
  visit('#bindings');assert.match(tree.get('view-bindings').textContent,/Unresolved binding identities/);
  assert.ok(tree.get('view-bindings').querySelectorAll('a').some(n=>n.attrs.href.startsWith('#use-sites/')));
  for(const p of m.entryPoints.filter(p=>p.type==='event'))assert.ok(m.entryPointContext(p.id).relations.every(r=>r.direction==='direct'));

  // Stable IDs survive presentation reordering. Legacy ordinal route and binding
  // links remain interpreted against their original capsule array.
  const reversed=structuredClone(capsule);reversed.analytics.registrations.reverse();reversed.routes.reverse();reversed.bindings.reverse();
  const other=renderedTree(reversed);other.location.hash=m.detailHash('entry-points',http.id);other.renderers.onHash();assert.equal(other.renderers.state.selectedEntryPoint,http.id);
  for(const hash of ['#routes/0','#bindings/0']){visit(hash);assert.equal(hash.startsWith('#routes')?m.state.selected:m.state.selectedBinding,hash.startsWith('#routes')?capsule.routes[0].id:capsule.bindings[0].id);}
  for(const hash of ['#explorer/binding/missing','#explorer/entry/missing','#explorer/entry/%invalid']){visit(hash);assert.match(tree.get('navigation-status').textContent,/unavailable/);assert.notEqual(m.state.view,'atlas');}
  visit('#atlas/'+m.registrationIndex.get(http.id));assert.ok(tree.get('atlas-count'),'legacy atlas link selects routing even after binding exploration');
  assert.equal(m.canonicalJson,saved);assert.equal(serializeCapsule(capsule),saved);

  // Historical absence retains route inventory but cannot manufacture consumers.
  const old=structuredClone(capsule);delete old.analytics;const legacy=renderedTree(createCapsule(old));
  legacy.location.hash='#entry-points';legacy.renderers.onHash();assert.ok(legacy.renderers.model.entryPoints.some(p=>p.type==='http'));
  legacy.location.hash=m.detailHash('bindings',binding.id);legacy.renderers.onHash();assert.match(legacy.get('binding-consumer-coverage').textContent,/unavailable/);
  assert.match(legacy.get('view-bindings').textContent,/does not establish no use/);
  const unnamed=structuredClone(capsule),definition=unnamed.analytics.handlers.find(h=>m.definitionRegistrations(h.id).length>1);definition.name=null;
  const names=createReportViewModel(unnamed);for(const registration of names.definitionRegistrations(definition.id)){
    const label=names.registrationLabel(registration);assert.ok(label.includes(definition.source.value.file+':'+definition.source.value.start.line));assert.ok(label.includes(registration.kind+' '+(registration.order+1)));assert.match(label,/application root|mount /);
  }
  // Display pages retain all exact IDs and expose a stable keyboard status.
  const large=structuredClone(capsule),seed=large.routes[0];delete large.analytics;
  large.routes=Array.from({length:115},(_,i)=>({...seed,id:'route:page-'+i,entryId:'entry:page-'+i,order:i}));
  const paged=renderedTree(large);paged.location.hash='#entry-points';paged.renderers.onHash();const observed=[];
  for(let page=0;page<3;page++){
    observed.push(...paged.get('entry-point-list').querySelectorAll('li').map(n=>n.attrs['data-entry-point-id']));
    const next=paged.get('view-entry-points').querySelectorAll('button').find(n=>n.textContent==='Next entry points');
    assert.equal(next.disabled,page===2);if(!next.disabled){next.events.click();assert.equal(paged.document.activeElement.id,'entry-point-count');}
  }
  assert.equal(new Set(observed).size,paged.renderers.model.entryPoints.length);
  const uncertain=structuredClone(capsule),dynamic=uncertain.analytics.useSites.find(s=>s.binding.state==='dynamic');assert.ok(dynamic);
  dynamic.binding={state:'unknown',kind:null,bindingId:null,referenceId:null,reason:'unresolved-reference'};
  uncertain.analytics.coverage.useSites={status:'partial',observed:uncertain.analytics.useSites.length,expected:null,reason:'not-recorded'};
  const unknown=renderedTree(uncertain);unknown.location.hash='#bindings';unknown.renderers.onHash();assert.match(unknown.get('view-bindings').textContent,/unknown · unresolved-reference/);assert.match(unknown.get('view-bindings').textContent,/partial/);
  console.log('ok - VIS-08 six journeys: mixed entry points, binding consumers, exact details and Explorer return, source/unknown evidence, identity and historical compatibility');
};
