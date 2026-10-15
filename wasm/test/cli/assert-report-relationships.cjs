'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create}=require('../../packages/cli/src/internal/report/relationship-queries');
const {instrument}=require('../diagnostics/vis06-derivation.cjs');
const {capture}=require('../diagnostics/vis06-inputs.cjs');
const {qualify}=require('../diagnostics/vis06-qualification.cjs');
const {reportSha256}=require('../../packages/cli/src/internal/report/viewer/sha256');
const {sha256}=require('../../packages/cli/src/internal/report/data');
const {graphFixture,fixture}=require('./report-handler-viewer-cases.cjs');
const {createCapsule,parseCapsule,serializeCapsule,validateCapsule}=require('../../packages/cli/src/internal/report/capsule');
const {renderReport}=require('../../packages/cli/src/internal/report/viewer');
const {compareCapsules}=require('../../packages/cli/src/internal/report/comparison');
const {createReportViewModel}=require('../../packages/cli/src/internal/report/viewer/model');
const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const adapter=q=>({route:id=>sorted(q.route(id).rows),binding:id=>q.binding(id).consumerIds,bindingIds:q.bindingIds});
const directory=fs.mkdtempSync(path.join(__dirname,'../../.test-results/vis07-'));
try {
  for(const small of [true,false]) {
    const value=capture(path.join(directory,small?'small':'mixed'),small), a=value.analytics, q=create(a);
    const result=qualify(a,adapter(q),value.bindings.map(b=>b.id));
    assert.ok(result.comparisonComplete&&result.oracleDerivationExhausted);
    for(const r of a.registrations)assert.notEqual(q.route(r.id).coverage.reason,'graph-budget-exhausted');
    const reordered=structuredClone(a);reordered.useSites.reverse();reordered.helperCalls.reverse();
    for(const r of a.registrations)assert.deepEqual(sorted(create(reordered).route(r.id).rows),sorted(q.route(r.id).rows));
    const noSites=structuredClone(a);noSites.useSites=[];noSites.helperCalls=[];
    for(const k of ['useSites','helperCalls'])noSites.coverage[k]={status:'complete',observed:0,expected:0,reason:null};
    const independent=create(noSites);
    for(const r of a.registrations)assert.deepEqual(independent.upstream(r.id).relations,q.upstream(r.id).relations,'admission independent of binding/use sites');
    if(!small)assert.ok(a.registrations.some(r=>independent.upstream(r.id).relations.length));
    noSites.coverage.useSites={status:'unavailable',observed:0,expected:null,reason:'not-recorded'};
    assert.equal(create(noSites).route(a.registrations[0].id).coverage.status,'unavailable');
    if(!small)assert.ok(a.registrations.some(r=>create(noSites).upstream(r.id).relations.length),'missing operations do not erase admission');
    const missing=structuredClone(a);missing.registrations.forEach(r=>delete r.control);
    assert.equal(create(missing).route(a.registrations[0].id).coverage.status,'unavailable');
    assert.equal(create(missing).binding('missing').coverage.status,'unavailable');
    const partial=structuredClone(a);delete partial.registrations[0].control;
    for(const r of a.registrations)assert.deepEqual(sorted(create(partial).route(r.id).rows),instrument({unrestricted:true,focus:r.id}).derive(partial).rows);
  }
  // Reader-admissible graph cardinality can still exhaust traversal work.
  // Scope the reverse query to one entry so this checks the bound, not brute force.
  {
    const count=90000, complete=n=>({status:'complete',observed:n,expected:n,reason:null});
    const large={handlers:[{id:'handler'}],useSites:[],helperCalls:[],
      coverage:{handlers:complete(1),registrations:{status:'partial',observed:count,expected:null,reason:'not-recorded'},useSites:complete(0),helperCalls:complete(0)},
      registrations:Array.from({length:count},(_,i)=>({id:'entry-'+i,handlerId:'handler',kind:'middleware',mountPath:[],
        control:{state:'available',value:{pattern:null,normal:true,error:false,terminal:false,eligibility:false}},
        match:{state:'available',value:{method:null}},flow:{next:i+1<count?'entry-'+(i+1):null,child:null}}))};
    const bounded=create(large),result=bounded.entry('entry-0');
    assert.equal(result.coverage.status,'partial');assert.equal(result.coverage.reason,'graph-budget-exhausted');
    assert.equal(bounded.binding('unused',r=>r.id==='entry-0').coverage.reason,'graph-budget-exhausted','exhaustion takes precedence over upstream partial');
    assert.equal(bounded.route('unknown').coverage.status,'unavailable');
    assert.equal(bounded.route(undefined).coverage.status,'unavailable');
  }
  const graph=graphFixture(),a=graph.analytics,q=create(a),model=createReportViewModel(graph);
  assert.equal(a.version,'pulse.report-analytics.v2');assert.ok(!('associations' in a));assert.ok(!('associations' in a.coverage));
  const saved=serializeCapsule(graph);assert.equal(serializeCapsule(parseCapsule(saved)),saved);
  assert.equal(model.canonicalJson,saved);
  const html=renderReport(graph), script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(renderReport(graph),html);
  const context={TextEncoder};
  // Run the exact shipped offline query assets without Node, DOM or network.
  vm.runInNewContext(script.slice(0,script.indexOf('function createBindingExplorer'))+'\nglobalThis.graphQueries=reportRelationships;',context);
  const browser=context.graphQueries.create(JSON.parse(JSON.stringify(a)));
  for(const r of a.registrations)assert.deepEqual(JSON.parse(JSON.stringify(sorted(browser.route(r.id).rows))),sorted(q.route(r.id).rows));
  for(const b of graph.bindings){
    const projection=model.bindingProjection(b.id), expected=q.binding(b.id);
    assert.deepEqual(sorted(projection.rows),sorted(expected.rows));
    assert.equal(projection.consumerCount,expected.consumerIds.length);
    assert.deepEqual(JSON.parse(JSON.stringify(sorted(browser.binding(b.id).rows))),sorted(expected.rows));
    for(const g of projection.consumers)assert.ok([...g.rows].every(r=>g.registrations.some(c=>c.id===r.consumerRegistrationId)));
  }
  for(const r of a.registrations){const sequence=q.route(r.id).rows,pages=[];for(let i=0;i<sequence.length;i+=3)pages.push(...sequence.slice(i,i+3));assert.deepEqual(pages,[...sequence]);}
  for(const text of ['', 'abc', '🌊'.repeat(200), 'x'.repeat(1000000)])assert.equal(reportSha256(text),sha256(text));
  const legacy=fixture(),historical=serializeCapsule(legacy);
  assert.equal(serializeCapsule(parseCapsule(historical)),historical,'v1 bytes and hashes stay exact');
  for(const [left,right] of [[legacy,graph],[graph,legacy],[graph,graph]]) {
    const c=compareCapsules(left,right);
    for(const name of ['handlers','registrations','useSites','helperCalls'])assert.ok(!c.sections.some(s=>s.collection===name));
    const associations=c.summary.inventories.find(i=>i.collection==='associations');
    assert.equal(associations.counts.added+associations.counts.removed,0,'format transition is not a semantic deletion');
  }
  for(const edit of [v=>v.analytics.version='pulse.report-analytics.v3',v=>v.analytics.registrations[0].flow.next=v.analytics.registrations[0].id,
    v=>v.analytics.registrations[0].handlerId='wrong',v=>v.analytics.registrations[0].control.value.pattern='/forged',
    v=>v.analytics.coverage.useSites.observed++,v=>v.analytics.helperCalls[0].calleeId='missing',
    v=>v.analytics.associations=[],v=>v.analytics.coverage.associations={status:'complete',observed:0,expected:0,reason:null}]) {
    const bad=structuredClone(graph);edit(bad);assert.throws(()=>validateCapsule(bad));
  }
  const tamper=structuredClone(graph);tamper.analytics.useSites[0].binding.value='SECRET';assert.throws(()=>validateCapsule(tamper));
  assert.equal(serializeCapsule(createCapsule(tamper)),saved,'projection strips unapproved values');
  const changed=structuredClone(graph);changed.analytics.registrations[0].control.value.normal=false;
  changed.analytics.registrations[0].control.value.terminal=true;
  assert.ok(compareCapsules(graph,createCapsule(changed)).sections.some(s=>s.collection==='registrations'),'control changes remain semantic changes');
  console.log('ok - VIS-07 oracle equivalence, admission without operations, v2/v1 validation/replay/comparison, browser parity, paging and privacy');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
