'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const VERSION = 'hex.ra08.resource-evidence.v1';
const STATES = ['free','prepared','owned','released','uncertain-or-fenced','consumed','transferred','in-flight'];
const ROOT_STATES = ['inactive','captured','admitted','stopped','logically-finished'];
const num = v => Number.isSafeInteger(v) && v >= 0 && v <= 1000000000;
const bool = v => typeof v === 'boolean';
const enumeration = values => v => values.includes(v);
const hex = n => v => typeof v === 'string' && new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const binding = v => typeof v === 'string' && /^binding-[a-f0-9]{16}$/.test(v);
const nullable = spec => ({nullable:spec});
const array = (spec,max) => ({array:spec,max});
const vector = {handles:num,backingBytes:num,records:num};
const state = enumeration(STATES), coverage = enumeration(['complete','partial']);
const spec = {
  version:enumeration([VERSION]),target:enumeration(['fastly-native-injected-host']),
  artifact:{sha256:hex(64),execution:hex(64),canonicalPlan:hex(64),expandedPlan:hex(64),profile:hex(64)},
  static:{bindings:array({id:binding,useSite:hex(64),capability:enumeration(['cache.compose','cache.read','cache.write','fetch.text']),
    service:enumeration(['core.fetch','investigation-bounded-composition.v0']),implementation:hex(64),root:binding,parent:nullable(binding),
    phase:enumeration(['parent','core','lookup','loader','insert']),resources:array(enumeration(['cache-entry','body-reader','body-writer','backing','request','request-body','pending-fetch','response','response-body']),9),actions:array(enumeration(['compose','lookup','read','close','insert','write','commit','abandon','allocate','transfer','consume']),11),conditional:bool,accounting:enumeration(['root-envelope','included-in-root']),demand:vector},128),
    rootIds:array(binding,32),profile:{work:vector,cleanup:vector,exit:vector,effectsPerRoot:num},graph:enumeration(['experimental-expanded']),canonicalChildGraph:enumeration([false])},
  runtime:nullable({scope:hex(32),termination:enumeration(['closed','trapped','incomplete']),
    coverage:{aggregates:coverage,records:coverage,samples:coverage,saturated:bool,containment:bool,lost:bool},
    collection:{total:num,kept:num,sampledOut:num,dropped:num,capacity:enumeration([0,8,64,256,4096]),sampleEvery:enumeration([1,4]),storageBytes:num},
    admission:{status:enumeration(['admitted','rejected']),bindings:array(binding,32),dimensions:array({name:enumeration(['handles','backingBytes','records','effects']),requested:num,limit:num,shortfall:num},4)},
    totals:{charged:vector,committed:vector,retainedBackingBytes:num,uncertainHostClaims:num,retired:{released:num,consumed:num,transferred:num}},
    roots:array({binding,logicalState:enumeration(ROOT_STATES),charge:vector,promisedChildren:num,pendingChildren:num},32),
    records:array({id:num,root:binding,binding:nullable(binding),state,kind:enumeration(['backing','host-claim']),charge:vector},512),
    transitions:array({from:state,to:state,count:num},64),
    samples:array({sequence:num,root:binding,binding:nullable(binding),record:num,from:state,to:state,afterClosure:bool},4096)})
};
function check(value, shape, location = '$') {
  if (typeof shape === 'function') {assert(shape(value),'REPORT_VALUE '+location); return;}
  if (Object.hasOwn(shape,'nullable')) {if(value !== null)check(value,shape.nullable,location);return;}
  if (Object.hasOwn(shape,'array')) {assert(Array.isArray(value) && value.length <= shape.max,'REPORT_BOUND '+location);value.forEach((v,i)=>check(v,shape.array,location+'['+i+']'));return;}
  assert(value && typeof value === 'object' && !Array.isArray(value),'REPORT_OBJECT '+location);
  assert.deepEqual(Object.keys(value).sort(),Object.keys(shape).sort(),'REPORT_FIELDS '+location);
  for (const key of Object.keys(shape)) check(value[key],shape[key],location+'.'+key);
}
function validate(report) {
  check(report,spec);
  assert(Buffer.byteLength(JSON.stringify(report))<=2*1024*1024,'REPORT_SIZE');
  assert.equal(report.artifact.profile,crypto.createHash('sha256').update(canonical(report.static.profile)).digest('hex'),'REPORT_PROFILE_IDENTITY');
  const s=report.static,r=report.runtime, byId=new Map(s.bindings.map(b=>[b.id,b]));
  assert.equal(byId.size,s.bindings.length,'REPORT_DUPLICATE');
  assert.equal(new Set(s.rootIds).size,s.rootIds.length,'REPORT_DUPLICATE');
  for(const b of s.bindings){
    assert.equal(b.id,'binding-'+b.useSite.slice(0,16),'REPORT_USE_SITE');
    assert(s.rootIds.includes(b.root),'REPORT_ROOT');
    assert.equal(b.capability,({parent:'cache.compose',core:'fetch.text',lookup:'cache.read',loader:'fetch.text',insert:'cache.write'})[b.phase],'REPORT_CAPABILITY');
    if(b.parent===null)assert.deepEqual(b.demand,s.profile.work,'REPORT_PROFILE');
    assert.equal(b.accounting,b.parent===null?'root-envelope':'included-in-root','REPORT_ACCOUNTING');
    if(b.parent!==null)assert.equal(b.parent,b.root,'REPORT_PARENT');
    else assert.equal(b.id,b.root,'REPORT_ROOT');
    assert.equal(b.conditional,['loader','insert'].includes(b.phase),'REPORT_CONDITIONAL');
  }
  for(const id of s.rootIds)assert(byId.has(id)&&byId.get(id).parent===null,'REPORT_ROOT');
  if(!r)return report;
  assert.deepEqual(r.admission.bindings,s.rootIds,'REPORT_ADMISSION_BINDINGS');
  assert.deepEqual(r.roots.map(x=>x.binding),s.rootIds,'REPORT_ROOTS');
  assert.deepEqual(r.admission.dimensions.map(x=>x.name),['handles','backingBytes','records','effects'],'REPORT_DIMENSIONS');
  const expected=[...Object.keys(vector).map(k=>s.rootIds.length*(s.profile.work[k]+s.profile.cleanup[k])+s.profile.exit[k]),s.rootIds.length*s.profile.effectsPerRoot];
  assert.deepEqual(r.admission.dimensions.map(d=>d.requested),expected,'REPORT_DEMAND');
  for(const d of r.admission.dimensions)assert.equal(d.shortfall,Math.max(0,d.requested-d.limit),'REPORT_SHORTFALL');
  if(r.admission.status==='admitted')assert(r.admission.dimensions.every(d=>d.shortfall===0),'REPORT_ADMISSION');
  const partial=r.termination!=='closed'||r.coverage.saturated||r.coverage.containment||r.coverage.lost;
  if(partial)assert.equal(r.coverage.aggregates,'partial','REPORT_COMPLETENESS');
  if(r.termination!=='closed'||r.coverage.containment||r.coverage.lost)assert.equal(r.coverage.records,'partial','REPORT_COMPLETENESS');
  const c=r.collection;
  assert.equal(c.kept,r.samples.length,'REPORT_SAMPLES');assert(c.kept<=c.capacity,'REPORT_BOUND');
  assert.equal(c.total,c.kept+c.sampledOut+c.dropped,'REPORT_COLLECTION');
  assert.equal(c.total,r.transitions.reduce((n,x)=>n+x.count,0),'REPORT_COUNTERS');
  if(partial||c.sampledOut||c.dropped)assert.equal(r.coverage.samples,'partial','REPORT_COMPLETENESS');
  assert.equal(new Set(r.transitions.map(x=>x.from+':'+x.to)).size,r.transitions.length,'REPORT_DUPLICATE');
  const count=(from,to)=>r.transitions.find(x=>x.from===from&&x.to===to)?.count??0;
  for(const k of ['released','consumed','transferred'])assert.equal(r.totals.retired[k],count(k,'free'),'REPORT_DISPOSITION');
  assert.equal(new Set(r.records.map(x=>x.id)).size,r.records.length,'REPORT_DUPLICATE');
  function provenance(row){assert(s.rootIds.includes(row.root),'REPORT_ROOT');assert(row.binding!==null&&byId.get(row.binding)?.root===row.root,'REPORT_BINDING');}
  for(const row of r.records){provenance(row);assert(row.id>0&&row.state!=='free','REPORT_RECORD');assert.equal(row.kind,row.charge.backingBytes>0?'backing':'host-claim','REPORT_KIND');}
  let previous=0;for(const row of r.samples){provenance(row);assert(row.record>0&&row.sequence>previous&&row.sequence<=c.total&&(row.sequence-1)%c.sampleEvery===0,'REPORT_SEQUENCE');previous=row.sequence;}
  for(const row of r.transitions)assert(r.samples.filter(x=>x.from===row.from&&x.to===row.to).length<=row.count,'REPORT_SAMPLE_COUNTER');
  if(r.coverage.samples==='complete'){
    const seen=new Map();let closed=false;
    for(const row of r.samples){
      const prior=seen.get(row.record);
      if(prior)assert(prior.to!=='free'&&prior.to===row.from&&prior.binding===row.binding&&prior.root===row.root,'REPORT_RECORD_LIFETIME');
      else assert.equal(row.from,'free','REPORT_RECORD_LIFETIME');
      if(closed)assert(row.afterClosure,'REPORT_CLOSURE_ORDER');
      closed=closed||row.afterClosure;seen.set(row.record,row);
    }
    for(const row of r.records){const last=seen.get(row.id);assert(last&&last.to===row.state&&last.binding===row.binding,'REPORT_FINAL_STATE');}
    assert.equal([...seen.values()].filter(x=>x.to!=='free').length,r.records.length,'REPORT_FINAL_STATE');
  }
  for(const key of Object.keys(vector)){
    assert.equal(r.records.reduce((n,row)=>n+row.charge[key],0),r.totals.charged[key],'REPORT_CONSERVATION');
    assert.equal(r.roots.reduce((n,row)=>n+row.charge[key],0),r.totals.charged[key],'REPORT_CONSERVATION');
    for(const root of r.roots)assert.equal(r.records.filter(x=>x.root===root.binding).reduce((n,x)=>n+x.charge[key],0),root.charge[key],'REPORT_ROOT_CONSERVATION');
    assert(r.totals.committed[key]>=r.totals.charged[key],'REPORT_RESERVATION');
  }
  assert.equal(r.totals.retainedBackingBytes,r.totals.charged.backingBytes,'REPORT_BACKING');
  assert.equal(r.totals.uncertainHostClaims,r.records.filter(x=>x.kind==='host-claim'&&x.state==='uncertain-or-fenced').reduce((n,x)=>n+x.charge.handles,0),'REPORT_UNCERTAINTY');
  return report;
}
module.exports={VERSION,STATES,ROOT_STATES,validate};
