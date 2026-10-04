'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const {buildCanonicalNativePlan,validateCanonicalNativePlan,stableStringify} = require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname,'../../..');
const helper = `export const lookup=async(ctx,key:string,early:boolean)=>{
 let fresh='';if(early)return {value:'early',found:false};
 const seen=await ctx.kv('records').getVersioned(key);
 if(seen.status==='failed')return {value:'failed',found:false};
 if(seen.status==='found')fresh=seen.value.text;
 return {value:fresh,found:seen.status==='found'};
};`;
const entry = body => `import {Pulse} from '@pulse-compute/pulse';import {lookup} from './helper';const app=new Pulse({auto:true});
 app.get('/',async(ctx)=>{const mode=ctx.req.header('x-mode')||'';let result='';let count=0;${body}return ctx.text(result+'|'+count);});
 app.error(async(error,ctx,next)=>ctx.text('caught',{status:418}));export default app;`;
const body = `for(let i=0;i<64;i++){
 if(mode==='zero')break;if(mode==='before'&&i===0)continue;
 const row=await lookup(ctx,''+i,mode==='early');count+=1;
 if(row.value==='failed')return ctx.text('failed',{status:503});
 if(mode==='return'&&i===1)return ctx.text('returned:'+row.value);
 if(mode==='break'&&i===2)break;if(mode==='continue'&&i===1)continue;
 for(let j=0;j<2;j++){if(j===0)continue;result=result+row.value;}
 if(mode!=='early'&&i===3)break;
}`;
const tc=acceptanceToolchain();
const rehash=p=>{delete p.planHash;p.planHash=createHash('sha256').update(stableStringify(p)).digest('hex');return p};
async function main(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-loop-helper-'));
 try{
  fs.mkdirSync(cwd+'/src');fs.mkdirSync(cwd+'/.pulse');fs.mkdirSync(cwd+'/node_modules/@pulse-compute',{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(root+'/packages/'+name,cwd+'/node_modules/@pulse-compute/'+name,'dir');
  fs.writeFileSync(cwd+'/.pulse/config.ts',`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'},javascript:{host:'node',target:'javascript'}}));`);
  const compile=(h=helper,b=body)=>{
   fs.writeFileSync(cwd+'/src/helper.ts',h);fs.writeFileSync(cwd+'/src/index.ts',entry(b));
   return buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));
  };
  const plan=compile();assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,1);assert.equal(plan.continuations.length,1);
  assert.equal(plan.planHash,compile().planHash);validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
  compile(helper,body.replace('i<64','i<0'));
  compile(helper.replace("let fresh='';", "let fresh='';for(let k=0;k<1024;k++){fresh=fresh+'';}"));
  const negativeSources = [
   [helper.replace("let fresh='';", "let fresh='';for(let k=0;k<1024;k++){for(let l=0;l<2;l++){fresh=fresh+'';}}"),body],
   [helper,body.replace('i<64','i<65')],
   [helper,body.replace('i<64','i<count')],
   [helper,body.replace('let i=0','let i=1')],
   [helper,body.replace('i++','i+=2')],
   [helper,body.replace("''+i,mode", "''+i++,mode")],
   [helper,body.replace('const row=await lookup', 'const row=lookup')],
   [helper,`for(let i=0;i<2;i++){await lookup(ctx,'x',false);}`],
   [helper,`for(let i=0;i<2;i++){for(let j=0;j<2;j++){const row=await lookup(ctx,'x',false);}}`],
   [helper,body.replace("''+i,mode", 'i,mode')],
   [helper.replace("const seen=await ctx.kv('records').getVersioned(key);", "const seen=await ctx.kv('records').insertIfAbsent(key,'x');"),body],
   [helper.replace("let fresh='';", "let fresh=ctx.state.get('x');"),body],
   [helper.replace("let fresh='';", "let fresh='';for(let j=0;j<2;j++){const v=await ctx.kv('records').getVersioned(key);}"),body],
   [helper.replace("let fresh='';", "const nested=await lookup(ctx,key,early);let fresh='';"),body],
   ["export const lookup=async(ctx,key:string,early:boolean)=>{return {value:key,found:early};};",body],
  ];
  for(const [i,args] of negativeSources.entries()) assert.throws(()=>compile(...args),undefined,`source rejection ${i}`);
  const loop=p=>p.handlers.flatMap(h=>h.body).find(s=>s.kind==='read-loop');
  const call=p=>loop(p).body.find(s=>s.kind==='helper-call');
  const mutations=[
   p=>{delete call(p).loopContract},p=>{call(p).loopContract='future'},
   p=>{call(p).localId=loop(p).localId},p=>{call(p).callerEntryId='foreign'},
   p=>{loop(p).maxIterations=65},p=>{p.effects[0].kind='kv.insertIfAbsent'},
   p=>{p.helpers[0].body.push(JSON.parse(JSON.stringify(loop(p))))},
   p=>{p.handlers[0].body.push(JSON.parse(JSON.stringify(call(p))))},
  ];
  for(const [i,mutate] of mutations.entries()) {
   const changed=JSON.parse(JSON.stringify(plan));mutate(changed);
   assert.throws(()=>validateCanonicalNativePlan(rehash(changed)),e=>e.name==='CanonicalNativePlanError',`plan rejection ${i}`);
  }
  fs.writeFileSync(cwd+'/src/helper.ts',helper);
  fs.writeFileSync(cwd+'/src/index.ts',entry("for(let i=0;i<2;i++){const row=await lookup();}"));
  assert.throws(()=>tc.compileProject(tc.resolveProject({cwd,profile:'javascript'})),
   error=>error.code==='PULSE_CANONICAL_COMPILE_FAILED','zero-argument source calls produce a diagnostic, not a compiler crash');
  compile(); // Restore the authored graph after negative-source probes.
  if(process.argv.includes('--plan-only')){console.log('loop helper plan passed');return;}
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
  const rows=[['zero','|0',0],['normal','v0v2v3|4',4],['before','v2v3|3',3],['break','v0|3',3],['continue','v0v2v3|4',4],['return','returned:',2],['early','early'.repeat(64)+'|64',0]];
  const value=key=>key==='1'?{status:'not-found'}:{status:'found',generation:'g'+key,value:{text:'v'+key}};
  tc.compileProject(tc.resolveProject({cwd,profile:'javascript'}));
  const js=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'javascript'}));
  const {createNodeKvReference}=require('../../../packages/provider-node/src/runtime/conditional-kv');
  const kv=createNodeKvReference({kvInstanceId:'loop'});for(let i=0;i<64;i++)if(i!==1)kv.kv('records').put(''+i,{text:'v'+i});
  for(const [mode,expected,effects] of rows){
   const request={method:'GET',path:'/',url:'https://loop.test/',headers:[['x-mode',mode]]};
   const result=await tc.executeCanonicalNativeModule(native,{request,strict:false,providerAdapter:{id:'loop',dispatchEffect:e=>value(e.key||e.payload?.key)}});
   assert.equal(result.response.body,expected,mode);assert.equal(result.effectCount,effects,mode);
   const response=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{headers:request.headers}),{strict:false,kvReference:kv});assert.equal(await response.text(),expected,mode+'/js');
  }
  let count=0;
  const failed=await tc.executeCanonicalNativeModule(native,{strict:false,providerAdapter:{id:'failed',dispatchEffect:()=>{count++;return {status:'failed'}}}});
  assert.equal(failed.response.status,503);assert.equal(count,1);
  count=0;const thrown=await tc.executeCanonicalNativeModule(native,{strict:false,providerAdapter:{id:'throw',dispatchEffect:()=>{count++;throw Error('unavailable')}}});
  assert.equal(thrown.response.status,503);assert.equal(count,1,'KV provider errors retain their failed-read normalization');
  count=0;await assert.rejects(tc.executeCanonicalNativeModule(native,{strict:false,maxEffects:1,providerAdapter:{id:'limit',dispatchEffect:()=>{count++;return value('0')}}}),{code:'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED'});assert.equal(count,1);
  const caught=tc.instantiateCanonicalNativeModule(native,{strict:false});caught.start();
  assert.equal(caught.captureApplicationError(Object.assign(Error('decode'),{code:'PULSE_SCHEMA_DECODE'})),true);
  caught.setEffectResult(caught.pendingEffects()[0].ticket,undefined);assert.equal(caught.resume(),0);assert.equal(caught.response().status,418);caught.close();
  const abort=new AbortController(),cancelled=tc.instantiateCanonicalNativeModule(native,{strict:false,signal:abort.signal});
  cancelled.start();const ticket=cancelled.pendingEffects()[0].ticket;abort.abort();
  assert.throws(()=>cancelled.setEffectResult(ticket,value('0')),{code:'PULSE_EFFECT_INVOCATION_INVALID'});assert.deepEqual(cancelled.pendingEffects(),[]);
  const fastly=require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,canonicalBuild:true,emitWat:false,bindings:{kv:{records:'records'}}});
  const authority=require('../../../packages/provider-fastly/src/testing/conditional-kv-host').createConditionalKvAuthority();authority.stores.set('records',new Map());
  const codec=require('../../../packages/runtime/src/host');
  for(let i=0;i<64;i++)if(i!==1)authority.seed('records',''+i,codec.encodeConditionalKvValue({text:'v'+i}));
  for(const [mode,expected,effects] of rows){
   let reads=0;
   const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request:{method:'GET',path:'/',url:'https://loop.test/',headers:[['x-mode',mode]]},conditionalKv:{authority,onCall:stage=>{if(stage==='lookup')reads++;}}});
   assert.equal(result.response.body,expected,mode+'/fastly');assert.equal(reads,effects);assert.equal(result.kvEvidence.bodyFixtures.size,0);
  }
  const a=tc.instantiateCanonicalNativeModule(native,{strict:false}),b=tc.instantiateCanonicalNativeModule(native,{strict:false});
  assert.equal(a.start(),1);assert.equal(b.start(),1);const first=a.pendingEffects()[0],foreign=b.pendingEffects()[0];
  assert.throws(()=>a.setEffectResult(foreign.ticket,value('0')),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  a.setEffectResult(first.ticket,value('0'));assert.equal(a.resume(),1);const second=a.pendingEffects()[0];
  assert.equal(second.id,first.id);assert.notEqual(second.ticket,first.ticket);
  assert.throws(()=>a.setEffectResult(first.ticket,value('1')),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  b.setEffectResult(foreign.ticket,{status:'failed'});assert.equal(b.resume(),0);
  a.setEffectResult(second.ticket,value('1'));assert.equal(a.resume(),1);a.close();b.close();
  console.log(JSON.stringify({status:'passed',helperBodies:1,effectSites:1,parityVectors:rows.length,sourceRejections:negativeSources.length,planRejections:mutations.length,wasmBytes:native.wasm.length}));
 }finally{fs.rmSync(cwd,{recursive:true,force:true})}
}
const keep=setInterval(()=>{},1000);main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1}).finally(()=>clearInterval(keep));
