'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { collectResponsePayloads } = require('../../packages/compiler/src/report-response-payloads');
const { addResourceInventory } = require('../../packages/cli/src/internal/report/resource-inventory');
const { createCapsule, serializeCapsule, parseCapsule } = require('../../packages/cli/src/internal/report/capsule');
const lit = value => ({kind:'literal',value});
const text = value => ({kind:'return',value:{kind:'intrinsic',name:'response.text',arguments:[value]}});
function responseFixture() {
  const plan={entry:{kind:'router',body:[text(lit('GENERATED_BODY_CANARY'))]},handlers:[
    {id:'entry-0',body:[text(lit('PAYLOAD_BODY_CANARY 😀é')),text(lit('')),
      {kind:'local',localId:'constant',declaration:'const',value:lit('CONST_BODY_CANARY')},text({kind:'local',id:'constant'}),
      {kind:'local',localId:'variable',declaration:'let',value:lit('MUTABLE_BODY_CANARY')},text({kind:'local',id:'variable'}),
      text({kind:'binary',operator:'+',left:lit('PRIVATE_DYNAMIC_CANARY'),right:{kind:'context-read',path:['req','path']}})]}],
    stages:[{id:'stage',registrations:[{entryId:'entry-0'},{entryId:'entry-1'}],body:[text(lit('SHARED_BODY_CANARY'))]}],
    helpers:[{id:'helper',body:[text(lit('HELPER_BODY_CANARY'))]}]};
  const snapshot=JSON.stringify(plan), projection=collectResponsePayloads(plan,new Set(['entry-0','entry-1']),new Map([['helper',new Set(['entry-1'])]]));
  assert.equal(JSON.stringify(plan),snapshot,'collector cannot change the executable plan');
  const seed=f.fixture();
  addResourceInventory(seed,{native:{manifest:{}},reportReferences:{version:'pulse.compiler-report-references.v1',references:[{kind:'resource',state:'resolved',canonicalId:'asset',resource:{encodedBytes:16}}],responsePayloads:projection}},[f.buildId]);
  for(const row of seed.resources)row.routeIds=seed.routes.filter(route=>route.composition.some(id=>row.entryIds.includes(id))).map(route=>route.id);
  seed.coverage.resources={status:'partial',observed:seed.resources.length,expected:null,reason:'incomplete-mapping'};
  return {capsule:createCapsule(seed),projection};
}
module.exports = function responsePayloadCases() {
  const unknowns=collectResponsePayloads({entry:{body:[text(lit(42)),text({kind:'undefined'})]}},new Set(['default']),new Map());
  assert.ok(unknowns.sites.every(row=>row.state==='unknown'&&row.inputBytes===null),'non-string inputs cannot claim payload bytes');
  assert.deepEqual(unknowns.sites.map(row=>row.canonicalId),[...unknowns.sites.map(row=>row.canonicalId)].sort(),'site order is stable');
  const {capsule,projection}=responseFixture(), rows=capsule.resources.filter(row=>row.kind==='response-payload');
  assert.equal(rows.length,8);
  assert.equal(rows.filter(row=>row.inputBytes.state==='unavailable').length,2);
  assert.ok(rows.some(row=>row.inputBytes.value===Buffer.byteLength('PAYLOAD_BODY_CANARY 😀é','utf8')));
  assert.ok(rows.some(row=>row.inputBytes.value===0&&row.inputBytes.state==='available'),'empty is known zero');
  assert.ok(rows.some(row=>row.entryIds.length===2),'stage retains distinct registrations');
  assert.ok(rows.some(row=>!row.entryIds.length&&row.generator.entryCoverage.expected===null),'generated dispatcher responses remain unowned');
  assert.ok(rows.every(row=>row.generator.representationBytes.value===null&&row.retainedPayloadBytes.value===null));
  const producer=capsule.resourceProducers.find(row=>row.scope==='canonical-text-responses');
  assert.equal(producer.coverage.expected,8,'site coverage includes unresolved payloads');
  const serialized=serializeCapsule(capsule);
  assert.ok(!/BODY_CANARY|DYNAMIC_CANARY/.test(serialized+JSON.stringify(projection)),'no body contents or expressions retained');
  assert.equal(serializeCapsule(parseCapsule(serialized)),serialized);
  const legacy=structuredClone(capsule);legacy.resources=legacy.resources.filter(row=>row.kind!=='response-payload');
  legacy.resourceProducers=legacy.resourceProducers.filter(row=>row.scope!=='canonical-text-responses');legacy.coverage.resources.observed=legacy.resources.length;
  const old=serializeCapsule(createCapsule(legacy));assert.equal(serializeCapsule(parseCapsule(old)),old,'historical five-scope bytes unchanged');
  let negatives=0;
  for(const mutate of [
    c=>c.resources.find(row=>row.kind==='response-payload').generator.representationBytes=f.fact(4),
    c=>c.resources.find(row=>row.kind==='response-payload').retainedPayloadBytes=f.fact(4),
    c=>c.resources.find(row=>row.kind==='response-payload').artifactId=f.aid,
    c=>delete c.resources.find(row=>row.kind==='response-payload').generator,
    c=>c.resources.find(row=>row.kind==='response-payload').inputBytes=f.unavailable('not-recorded'),
    c=>c.resourceProducers.push(c.resourceProducers.find(row=>row.scope==='canonical-text-responses')),
    c=>c.resourceProducers=c.resourceProducers.filter(row=>row.scope!=='canonical-text-responses'),
    c=>c.resources.find(row=>row.kind==='response-payload').generator.scope='package-guest-units'
  ]) {const invalid=structuredClone(capsule);mutate(invalid);assert.throws(()=>createCapsule(invalid));negatives++;}
  return {capsule,negatives};
};
module.exports.responseFixture=responseFixture;
