#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash,webcrypto}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {fixture,semantics}=require('./o25-history-helper.cjs');
const {inspect}=require('./o25-wasm-proof.cjs');
const {acceptanceToolchain}=require('../../s3/acceptance-toolchain.cjs');
const {buildCanonicalNativePlan}=require('../../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../../packages/compiler/src/canonical-native-compiler');
const root=path.resolve(__dirname,'../../../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function main(){
 const at=process.argv.indexOf('--output'),output=at<0?null:path.resolve(process.argv[at+1]);
 if(output)assert.ok(!fs.existsSync(output),'Refuse to overwrite evidence');
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 const report={version:'pulse.o25.history-helper-proof.v2',status:'running',sourceCommit:git(['rev-parse','HEAD']),sourceDirty:!!git(['status','--porcelain']),cells:[],
  trackedDiffSha256:hash(git(['diff','HEAD'])),node:process.version,nativeSharingQualified:false,nativeRuntimeQualified:false,nativeCompilerInvocations:0};
 const save=()=>{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n')};
 const tc=acceptanceToolchain(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-o25-qualified-'));
 const compile=cwd=>{const compiled=tc.compileProject(tc.resolveProject({cwd,profile:'node'}));return {compiled,plan:buildCanonicalNativePlan(compiled)}};
 try{
  for(const count of [1,2,16]){
   const cwd=path.join(tmp,'helper-'+count);fs.mkdirSync(cwd);const source=fixture(cwd,count);
   const started=performance.now(),{compiled,plan}=compile(cwd);
   assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,5);assert.equal(plan.continuations.length,5);
   assert.ok(plan.effects.every(e=>e.helperId===plan.helpers[0].id));
   const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});report.nativeCompilerInvocations++;
   const nativeBuildMs=performance.now()-started;
   const finalWasm=inspect(native,'node',cwd);
   const control=path.join(tmp,'expanded-'+count);fs.mkdirSync(control);fixture(control,count,'expanded');const expanded=compile(control);
   const cell={count,source,planHash:plan.planHash,helperBodies:plan.helpers.length,helperLocals:plan.helpers[0].localIds.length,
    effects:plan.effects.length,continuations:plan.continuations.length,callerLocals:plan.locals.length-plan.helpers[0].localIds.length,
    loweredSourceBytes:Buffer.byteLength(compiled.router.sourceText),generatedSourceBytes:Buffer.byteLength(native.source),wasmBytes:native.wasm.length,nativeBuildMs,finalWasm,
    expanded:{privateBodies:expanded.plan.handlers.length,effects:expanded.plan.effects.length,continuations:expanded.plan.continuations.length,loweredSourceBytes:Buffer.byteLength(expanded.compiled.router.sourceText)}};
   report.cells.push(cell);save();
   if(count===16){await semantics(tc,cwd,report,native);await semantics(tc,cwd,report);}
   console.error(`O-25 ${count} callers: one helper, ${native.wasm.length} Wasm bytes, ${finalWasm.sharedBodyPartitions} retained partitions`);
  }
  assert.ok(report.cells.every(c=>c.finalWasm.sharedBodyPartitions===report.cells[0].finalWasm.sharedBodyPartitions));
  assert.ok(report.cells.every(c=>c.finalWasm.rootBytes<=report.cells[0].finalWasm.rootBytes*1.1),'shared body must not scale with callers');
  const middleware=path.join(tmp,'middleware');fs.mkdirSync(middleware);fixture(middleware,16,'middleware');const mp=compile(middleware);
  const mn=compileCanonicalNativePlan(mp.plan,{cwd:root,emitWat:false});report.nativeCompilerInvocations++;
  const mr={};await semantics(tc,middleware,mr,mn);report.middleware=mr.native;
  const same=path.join(tmp,'same-file');fs.mkdirSync(same);fixture(same,1,'same-file');assert.equal(compile(same).plan.helpers.length,1);report.sameFile='planned';
  // Fault-inject exhaustion without fabricating a hash cycle or changing the
  // production fixture: reduce both traversal round caps in a separate build.
  const limited=path.join(tmp,'work-limit');fs.mkdirSync(limited);fixture(limited,1);
  const helperPath=path.join(limited,'src/lookup.ts'),original=fs.readFileSync(helperPath,'utf8');
  assert.equal((original.match(/ixRound<64/g)||[]).length,2);fs.writeFileSync(helperPath,original.replaceAll('ixRound<64','ixRound<0'));
  const lp=compile(limited),ln=compileCanonicalNativePlan(lp.plan,{cwd:root,emitWat:false});report.nativeCompilerInvocations++;
  const request={method:'GET',path:'/lookup/0',url:'https://proof.test/lookup/0',headers:{'x-root':'a'.repeat(64)}};
  let calls=0;
  const limitedResult=await tc.executeCanonicalNativeModule(ln,{request,strict:false,providerAdapter:{id:'work-limit',dispatchEffect(e){calls++;assert.equal(e.kind,'crypto.digestText');return {status:'ok',sha256:hash(e.payload.text),byteLength:Buffer.byteLength(e.payload.text)}}}});
  assert.deepEqual([limitedResult.response.status,limitedResult.response.body],[409,'HISTORY_INDEX_WORK_LIMIT']);assert.equal(calls,1);
  const prepared=tc.prepareJavascriptApplication(tc.resolveProject({cwd:limited,profile:'javascript'}));
  const jr=await tc.executeNodeJavascriptApplication(prepared.loaded.application,new Request(request.url,{headers:request.headers}),{strict:false,digestSubtle:webcrypto.subtle});
  assert.deepEqual([jr.status,await jr.text()],[409,'HISTORY_INDEX_WORK_LIMIT']);
  report.workLimit={status:'passed',nativeAndJavascript:true,mechanism:'Separate fixture reduces both traversal round caps from 64 to 0; original production bounds remain unchanged.',nativeEffects:calls};
  report.native.pending=['Full application bulk-result qualification'];
  report.middleware.pending=['Full application bulk-result qualification'];
  report.status='passed';report.nativeSharingQualified=true;report.nativeRuntimeQualified=true;
  report.scope='Portable compiled Native helper and injected host semantics. No deployed provider, full application bulk schema, production adoption or whole-application size claim.';
 }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack,diagnostics:error.diagnostics,detail:error.detail};process.exitCode=1;}
 finally{report.completedAt=new Date().toISOString();save();fs.rmSync(tmp,{recursive:true,force:true});}
 console.log(JSON.stringify(report));
}
const keep=setInterval(()=>{},1000);main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>clearInterval(keep));
