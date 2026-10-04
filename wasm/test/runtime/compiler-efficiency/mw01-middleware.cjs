#!/usr/bin/env node
'use strict';
// Tiny middleware proof; deliberately not a full application or release matrix.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {acceptanceToolchain}=require('../../s3/acceptance-toolchain.cjs');
const {compileProject}=require('../../../packages/cli/src/project-execution');
const {buildCanonicalNativePlan,validateCanonicalNativePlan,stableStringify}=require('../../../packages/compiler/src/canonical-native-plan');
const {lowerSharedStages}=require('../../../packages/compiler/src/shared-stage-plan');
const {compileFastlyNativePlatformCapabilitiesPlan}=require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {inspect}=require('./o18-wasm-proof.cjs');
const Retention=require('../../../packages/build-support/src/native-retention-transform.cjs');
const root=path.resolve(__dirname,'../../../..');
const suffix=Array.from({length:16},(_,i)=>':'+i).join('');
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(cwd,count,repeated=false,helper){
 for(const dir of ['src','.pulse','node_modules/@pulse-compute'])fs.mkdirSync(path.join(cwd,dir),{recursive:true});
 for(const name of ['pulse','runtime'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
 const stage=`import type {PulseContext,RouterNext} from '@pulse-compute/runtime';
${helper?"import {decorate} from './helper';":''}
const stage=async(ctx:PulseContext,next:RouterNext)=>{
 const input=ctx.req.header('x-input')||'';const mode=ctx.req.header('x-mode')||'';
 let value=input;${Array.from({length:16},(_,i)=>`value=value+':${i}';`).join('\n')}
 const visits=ctx.state.get('visits')||'';ctx.state.set('visits',visits+'x');ctx.state.set('value',value);
 if(mode==='early')return ctx.text('early:'+value,{status:409});
 const first=await ctx.fetch('https://proof.test/first').text();
 ${helper==='pure'?"const decorated=decorate('literal');ctx.state.set('decorated',decorated);":helper==='effectful'?"const decorated=await decorate(ctx,'literal');ctx.state.set('decorated',decorated);":''}
 if(mode==='stop')return ctx.text('stop:'+value+':'+first,{status:409});
 if(mode==='error')return next({code:'STAGE_ERROR',message:'stage rejected'});
 ctx.state.set('value',value+':'+first);return next();
};export default stage;`;
 const entry=`import {Pulse} from '@pulse-compute/pulse';import {Router} from '@pulse-compute/runtime';import stage from './stage';
const app=new Pulse({auto:true});
${Array.from({length:count},(_,i)=>`const child${i}=new Router();child${i}.use('/item',stage);
${repeated&&i===0?"child0.use('/item',stage);":''}
child${i}.get('/item',async(ctx)=>ctx.text('${i}|'+ctx.state.get('visits')+'|'+ctx.state.get('value')));
app.mount('/chain/${i}',child${i});`).join('\n')}
app.error(async(error,ctx,next)=>ctx.text(error.code+'|'+ctx.state.get('value'),{status:418}));export default app;`;
 if(helper)fs.writeFileSync(path.join(cwd,'src/helper.ts'),helper==='pure'?"export function decorate(value:string):string{return value+':decorated'}":"import type {PulseContext} from '@pulse-compute/runtime';export async function decorate(ctx:PulseContext,value:string):Promise<string>{const text=await ctx.fetch('https://proof.test/helper').text();return value+text}");
 fs.writeFileSync(path.join(cwd,'src/stage.ts'),stage);fs.writeFileSync(path.join(cwd,'src/index.ts'),entry);
 fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),"import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},native:{host:'node',target:'native'}}));");
 return {sourceSha256:hash(stage+'\n'+entry)};
}
function retentionCheck(){
 const yes=['__pulse_shared_stage_0','__pulse_stage_prepare','__pulse_stage_clear','__pulse_stage_ready','__pulse_stage_result','__pulse_chunk_0'];
 const no=['__pulse_shared_helper_0','__pulse_pure_helper_0','__pulse_stage_unknown','__pulse_shared_stage_fake'];
 const d=(name,mark=true)=>({name:{text:name},decorators:mark?[{name:{text:'noinline'}}]:[]});
 const t=new Retention();t.afterParse({sources:[{internalPath:'canonical-native.as',statements:[...yes,...no].map(n=>d(n)).concat(d('__pulse_shared_stage_1',false))},{internalPath:'user',statements:yes.map(n=>d(n))}]});
 assert.deepEqual(t.retainedNames,yes.map(n=>'canonical-native.as/'+n));return {selected:yes.length,negativeControls:no.length+yes.length+1};
}
function negative(plan){
 const p=JSON.parse(JSON.stringify(plan));p.stages[0].registrations[1].continuationIds[0]=p.stages[0].registrations[0].continuationIds[0];
 const unsigned={...p};delete unsigned.planHash;p.planHash=hash(stableStringify(unsigned));
 assert.throws(()=>validateCanonicalNativePlan(p),e=>e.name==='CanonicalNativePlanError');
}
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-mw01-')),tc=acceptanceToolchain();
 const sourceFiles=['wasm/packages/compiler/src/shared-stage-plan.js','wasm/packages/contracts/src/handler/canonical-native-plan.js','wasm/packages/build-support/src/native-retention-transform.cjs','wasm/packages/runtime-core-as/src/compiler/canonical-native.js','wasm/test/runtime/compiler-efficiency/mw01-middleware.cjs','wasm/test/runtime/compiler-efficiency/o18-wasm-proof.cjs'];
 const report={status:'running',sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))])),scope:'focused middleware Native plan, Fastly ABI-fixture runtime and optimized Wasm; no deployed or application-size claim',retention:retentionCheck(),cells:[],fallback:[]};
 const output=process.argv[2]&&path.resolve(process.argv[2]);const save=()=>{if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}};
 const planFor=cwd=>buildCanonicalNativePlan(compileProject(tc.resolveProject({cwd,profile:'native'}),{target:'native'}));
 const build=(plan,optimization)=>compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,canonicalBuild:true,requirePlatformCapability:false,emitWat:false,nativeOptimization:optimization,bindings:{effectBackends:Object.fromEntries(plan.effects.map(e=>[e.id,'proof']))}});
 const run=(built,index,input,mode='',pathname,cycles=1)=>{
  const url='https://app.test'+(pathname||`/chain/${index}/item`),seen=[];
  const result=tc.executeFastlyNativePlatformCapabilities(built,{request:{method:'GET',path:new URL(url).pathname,url,headers:[['x-input',input],['x-mode',mode]]},fixtures:{proof:{'/first':{status:200,body:'one'}}},onOutboundRequest:r=>seen.push(new URL(r.url).pathname)});
  const value=input+suffix;
  const expected=pathname?[404,'Not Found',[]]:mode==='early'?[409,'early:'+value,[]]:mode==='stop'?[409,'stop:'+value+':one',['/first']]:mode==='error'?[418,'STAGE_ERROR|'+value,['/first']]:[200,`${index}|${'x'.repeat(cycles)}|${value}:one`,Array(cycles).fill('/first')];
  assert.deepEqual([result.response.status,result.response.body,seen],expected);
 };
 try{

  for(const count of [1,2]){
   const cwd=path.join(dir,'fixture-'+count),source=fixture(cwd,count),plan=planFor(cwd);
   assert.equal(plan.stages.length,1);assert.equal(plan.stages[0].registrations.length,count);assert.equal(plan.effects.length,count);assert.equal(new Set(plan.continuations.map(c=>c.id)).size,count);
   validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));assert.equal(plan.planHash,planFor(cwd).planHash);if(count===2)negative(plan);
   for(const optimization of [undefined,'experimental-native-bounded-size']){
    const start=performance.now(),built=build(plan,optimization),inspectionDir=path.join(dir,`inspect-${count}-${optimization||'normal'}`);fs.mkdirSync(inspectionDir);
    const retained=inspect(built,'fastly',inspectionDir,optimization);let requests=0;
    for(let i=0;i<count;i++){run(built,i,'input-'+i);requests++;}
    if(count===2){run(built,0,'fresh');run(built,1,'early','early');run(built,1,'stop','stop');run(built,1,'err','error');run(built,0,'','', '/miss');run(built,0,'','', '/chain/0/miss');requests+=6;}
    report.cells.push({registrations:count,optimization:optimization||'normal',planHash:plan.planHash,...source,wasmBytes:built.wasm.length,requests,retained,elapsedMs:Math.round(performance.now()-start)});save();console.log('passed',count,optimization||'normal',built.wasm.length,'bytes');
   }
  }
  for(const mode of ['normal','experimental-native-bounded-size']){
   const cells=report.cells.filter(c=>c.optimization===mode);
   assert.equal(cells[0].retained.sharedBodyPartitions,cells[1].retained.sharedBodyPartitions);
  }
  const repeated=path.join(dir,'repeated');fixture(repeated,1,true);const repeatedPlan=planFor(repeated);assert.equal(repeatedPlan.stages[0].registrations.length,2);run(build(repeatedPlan),0,'twice','',undefined,2);report.sameRequestReentry=true;
  for(const helper of ['pure','effectful']){
   const cwd=path.join(dir,'helper-'+helper);fixture(cwd,2,false,helper);
   const compiled=compileProject(tc.resolveProject({cwd,profile:'native'}),{target:'native'}),expanded=buildCanonicalNativePlan(compiled,{sharedStages:false}),reasons=[];
   assert.equal(lowerSharedStages(expanded,{onExcluded:r=>reasons.push(r)}),expanded);assert.ok(reasons.some(r=>r.reason==='nested-helper-call'));
   const plan=buildCanonicalNativePlan(compiled);assert.equal(plan.stages?.length||0,0);validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));report.fallback.push({helper,reason:'nested-helper-call',nativePlanValid:true});
  }
  report.status='passed';report.crossedContinuationRejected=true;save();console.log(JSON.stringify(report));
 }catch(error){report.status='failed';report.failure={name:error.name,message:error.message};save();throw error;}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);if(e.diagnostics)console.error(e.diagnostics);process.exitCode=1;});
