'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {execFileSync}=require('node:child_process');
const report=path.resolve(__dirname,'../../packages/cli/src/internal/report');
const {parseJson,sha256}=require(path.join(report,'data'));
const encoding=require(path.join(report,'encoding'));
const capsule=require(path.join(report,'capsule'));
const {validateHandlerTopology}=require(path.join(report,'handler-topology'));
const {create}=require(path.join(report,'relationship-queries'));
const {createReportViewModel}=require(path.join(report,'viewer/model'));
const {renderReport}=require(path.join(report,'viewer'));
const {qualify}=require('./vis06-qualification.cjs');
function run(input,send=()=>{}) {
  const result={version:'pulse.vis07-measurement.v1',status:'running',node:process.version,stages:{},memory:{}};
  function stage(name,fn){send({stage:name,state:'started'});const at=performance.now();try{return fn();}finally{
    result.stages[name]=performance.now()-at;result.memory[name]=process.memoryUsage();send({stage:name,state:'finished',elapsedMs:result.stages[name]});}}
  const bytes=fs.readFileSync(input);result.inputSha256=sha256(bytes);
  const root=path.resolve(__dirname,'../../..');
  result.pulseSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  result.dirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
  result.files=Object.fromEntries(['relationship-queries.js','handler-topology.js','schema.js','capsule.js','validate.js','viewer/model.js','viewer/sha256.js','viewer.js'].map(f=>[f,sha256(fs.readFileSync(path.join(report,f)))]));
  const before=stage('decode',()=>encoding.decode(parseJson(bytes)));
  const isCapsule=before.kind==='pulse.application-report';
  stage('validateInput',()=>isCapsule?capsule.validateCapsule(before):validateHandlerTopology(before));
  result.context=before.context||null;result.provenance=before.provenance;
  result.baseline={rawBytes:bytes.length,analyticsRawBytes:Buffer.byteLength(JSON.stringify(before.analytics)),
    storedBytes:stage('baselineEncoding',()=>Buffer.byteLength(encoding.store(before))),
    normalizedCandidateBytes:Buffer.byteLength(encoding.stringify(encoding.encode(before))),coverage:before.analytics.coverage};
  const compact=stage('factorFacts',()=>{
    const {associations,...facts}=before.analytics,{associations:associationCoverage,...coverage}=facts.coverage;
    return {...before,analytics:{...facts,version:'pulse.report-analytics.v2',coverage}};
  });
  // This is a newly identified report derived from identical pinned capture
  // facts. Never mutate/rewrite the input capsule or reuse its evidence hash.
  const after=stage('createAndValidate',()=>isCapsule?capsule.createCapsule(compact):(validateHandlerTopology(compact),compact));
  const encoded=stage('compactEncoding',()=>encoding.store(after));
  result.compact={rawBytes:Buffer.byteLength(JSON.stringify(after)),storedBytes:Buffer.byteLength(encoded),storedRepresentation:JSON.parse(encoded).kind,
    normalizedCandidateBytes:Buffer.byteLength(encoding.stringify(encoding.encode(after))),
    analyticsRawBytes:Buffer.byteLength(JSON.stringify(after.analytics)),analyticsNormalizedBytes:Buffer.byteLength(encoding.stringify(encoding.encode(after.analytics))),
    evidenceHash:after.evidenceHash||null,coverage:after.analytics.coverage};
  if(isCapsule){
    stage('replay',()=>assert.equal(capsule.serializeCapsule(capsule.parseCapsule(encoded)),capsule.serializeCapsule(after)));
    result.compact.htmlBytes=stage('html',()=>Buffer.byteLength(renderReport(after)));
  }
  const q=stage('queryIndex',()=>create(after.analytics));
  result.entryQueries=[];
  stage('allEntryQueries',()=>{for(const r of after.analytics.registrations){const at=performance.now(),projection=q.route(r.id);
    result.entryQueries.push({id:r.id,ms:performance.now()-at,rows:projection.rows.length,work:q.entry(r.id).work,coverage:projection.coverage});}});
  result.bindingQueries=[];
  stage('allBindingQueries',()=>{for(const b of before.bindings){const at=performance.now(),projection=q.binding(b.id);
    result.bindingQueries.push({id:b.id,ms:performance.now()-at,rows:projection.rows.length,consumers:projection.consumerIds.length,coverage:projection.coverage});}});
  if(isCapsule){const model=stage('viewerIndex',()=>createReportViewModel(after));
    stage('allViewerBindingQueries',()=>{for(const b of before.bindings){const p=model.bindingProjection(b.id);assert.equal(p.consumerCount,q.binding(b.id).consumerIds.length);p.rows.slice(0,20);}});
    const id=after.analytics.registrations.find(r=>q.route(r.id).rows.length)?.id;
    if(id)stage('first20Explanations',()=>q.route(id).rows.slice(0,20));
  }
  result.qualification=stage('fullOracleParity',()=>qualify(before.analytics,{route:id=>[...q.route(id).rows].sort((a,b)=>a.id.localeCompare(b.id)),
    binding:id=>q.binding(id).consumerIds,bindingIds:q.bindingIds},before.bindings.map(b=>b.id),send));
  assert.ok(result.qualification.comparisonComplete&&result.qualification.oracleDerivationExhausted);
  assert.ok(result.entryQueries.every(r=>r.coverage.reason!=='graph-budget-exhausted'));
  result.peakRssKiB=process.resourceUsage().maxRSS;result.status='completed';return result;
}
module.exports={run};
if(require.main===module){try{const result=run(process.argv[2],m=>process.send?.(m));process.send?.({result});}
  catch(error){process.send?.({error:{name:error.name,code:error.code||null,message:error.message}});process.exitCode=1;}finally{process.disconnect?.();}}
