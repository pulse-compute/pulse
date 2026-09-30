'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname, '../../..'), tc = acceptanceToolchain();
const fixtures = path.join(__dirname, '../fixtures/pure-helpers');
const original = fs.readFileSync(path.join(fixtures, 'partition.ts'), 'utf8');
const fresh = partition => ({subjectKind:'item',subjectId:'abc',partition,revision:1,root:{hash:'hash',node:0},counters:Array(10).fill(0)});
const body = `let result='';for(let i=0;i<16;i++){
 const row=await ctx.kv('records').getVersioned(''+i);
 if(row.status!=='found')return ctx.text('missing:'+i);
 const head=ctx.decodeJson(row.value.text,'app.Head');
 if(!validPartition(head,'item','abc',i))return ctx.text('invalid:'+i);
 const again=validPartition(head,'item','abc',i);
 if(again)result=result+i+',';
}return ctx.text(result);`;
const find = (v, predicate) => {
 if(!v || typeof v!=='object')return;
 if(predicate(v))return v;
 for(const child of Object.values(v)){const result=find(child,predicate);if(result)return result;}
};
const rehash = p => {delete p.planHash;p.planHash=createHash('sha256').update(stableStringify(p)).digest('hex');return p;};
async function main(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-pf04-'));
 try{
  fs.mkdirSync(cwd+'/src');fs.mkdirSync(cwd+'/.pulse');fs.mkdirSync(cwd+'/node_modules/@pulse-compute',{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(root+'/packages/'+name,cwd+'/node_modules/@pulse-compute/'+name,'dir');
  fs.copyFileSync(fixtures+'/types.ts',cwd+'/src/types.ts');
  fs.writeFileSync(cwd+'/src/schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {PartitionHead} from './types';export default defineSchemaRegistry({schemas:{'app.Head':schema<PartitionHead>()}});`);
  fs.writeFileSync(cwd+'/.pulse/config.ts',`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);
  const write=(helper=original,source=body)=>{
   fs.writeFileSync(cwd+'/src/partition.ts',helper);
   fs.writeFileSync(cwd+'/src/index.ts',`import {Pulse} from '@pulse-compute/pulse';import {validPartition} from './partition';const app=new Pulse({auto:true});app.get('/',async(ctx)=>{${source}});export default app;`);
  };
  const compile=(helper=original,source=body)=>{write(helper,source);return buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));};
  const plan=compile();
  validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
  assert.equal(plan.planHash,compile().planHash);
  assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,1);assert.equal(plan.continuations.length,1);
  assert.ok(plan.effects.every(e=>!e.helperId));assert.ok(plan.continuations.every(c=>!c.helperId));
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
  tc.compileProject(tc.resolveProject({cwd,profile:'js'}));
  const js=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));
  const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(plan.schemas.registry);
  const {createNodeKvReference}=require('../../../packages/provider-node/src/runtime/conditional-kv');
  const all=Array.from({length:16},(_,i)=>i+',').join('');
  const cases=[{expected:all,reads:16}];
  for(const partition of [0,15]){
   for(const counter of [0,9])cases.push({partition,counter,expected:'invalid:'+partition,reads:partition+1});
   for(const change of [{subjectId:'other'},{root:{hash:'',node:0}},{revision:-1},{counters:[]},{partition:16}])cases.push({partition,change,expected:'invalid:'+partition,reads:partition+1});
   cases.push({partition,missing:true,expected:'missing:'+partition,reads:partition+1});
  }
  cases.push({expected:all,reads:16});
  const value=(key,vector)=>{
   const i=Number(key),head=fresh(i);
   if(i===vector.partition){if(vector.missing)return {status:'not-found'};Object.assign(head,vector.change);if(vector.counter!==undefined)head.counters[vector.counter]=-1;}
   return {status:'found',generation:'g'+i,value:{text:JSON.stringify(head)}};
  };
  const request={method:'GET',path:'/',url:'https://pf04.test/'};
  for(const vector of cases){
   const keys=[];
   const result=await tc.executeCanonicalNativeModule(native,{request,strict:false,providerAdapter:{id:'pf04',dispatchEffect:e=>{keys.push(e.key);return value(e.key,vector);}}});
   assert.equal(result.response.body,vector.expected);assert.equal(result.effectCount,vector.reads);
   assert.deepEqual(keys,Array.from({length:vector.reads},(_,i)=>''+i),'callee counters must not alter caller progress');
   const kv=createNodeKvReference({kvInstanceId:'pf04'});
   for(let i=0;i<16;i++){const row=value(''+i,vector);if(row.status==='found')kv.kv('records').put(''+i,row.value);}
   const response=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url),{strict:false,kvReference:kv,schemaCodecs});
   assert.equal(await response.text(),vector.expected);
  }
  // Interleave requests at every caller suspension. Helpers finish synchronously;
  // stale tickets cannot write either invocation and early returns cannot leak.
  const a=tc.instantiateCanonicalNativeModule(native,{request,strict:false}),b=tc.instantiateCanonicalNativeModule(native,{request,strict:false});
  assert.equal(a.start(),1);assert.equal(b.start(),1);
  const foreign=b.pendingEffects()[0].ticket;
  assert.throws(()=>a.setEffectResult(foreign,value('0',{})),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  b.setEffectResult(foreign,value('0',{partition:0,counter:0}));assert.equal(b.resume(),0);assert.equal(b.response().body,'invalid:0');
  let previous;
  for(let i=0;i<16;i++){
   const effect=a.pendingEffects()[0];assert.equal(effect.payload.key,''+i);
   if(previous)assert.throws(()=>a.setEffectResult(previous,value(''+i,{})),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
   a.setEffectResult(effect.ticket,value(''+i,{}));previous=effect.ticket;
   assert.equal(a.resume(),i===15?0:1);
  }
  assert.equal(a.response().body,all);a.close();b.close();
  // Pure caller loops need no read site; exercise mutable callee locals, early
  // return, short circuits, break/continue and resetting nested loop counters.
  const scalar=`export function validPartition(n:number):number{let total=0;for(let j=0;j<4;j++){if(j===n)return total;total+=1;}return total;}`;
  const pureBody=`let sum=0;for(let i=0;i<16;i++){if(i===15)break;if(i===1)continue;const skipped=false&&validPartition(i)>0;const n=validPartition(i%4);sum+=n;}return ctx.text(''+sum);`;
  const pure=compile(scalar,pureBody);assert.equal(pure.effects.length,0);assert.equal(pure.continuations.length,0);
  const pureNative=compileCanonicalNativePlan(pure,{cwd:root,emitWat:false});
  tc.compileProject(tc.resolveProject({cwd,profile:'js'}));const pureJs=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));
  assert.equal((await tc.executeCanonicalNativeModule(pureNative,{request})).response.body,'20');
  assert.equal(await(await tc.executeNodeJavascriptApplication(pureJs.loaded.application,new Request(request.url),{strict:false})).text(),'20');
  const bounded=cap=>`export function validPartition(n:number):number{let total=0;for(let j=0;j<${cap};j++){total+=1;}return total;}`;
  const readBound=`let sum=0;for(let i=0;i<64;i++){const row=await ctx.kv('records').getVersioned(''+i);const n=validPartition(i);sum+=n;}return ctx.text(''+sum);`;
  compile(bounded(1024),readBound);
  const pureLimit=compile(bounded(1024),`let sum=0;for(let i=0;i<64;i++){const n=validPartition(i);sum+=n;}return ctx.text(''+sum);`); // 64 * 1024 == 65,536
  compile(bounded(1024),`let sum=0;for(let i=0;i<8;i++){for(let k=0;k<8;k++){const n=validPartition(i);sum+=n;}}return ctx.text(''+sum);`);
  compile(bounded(1024),readBound.replace('i<64','i<0'));
  const negatives=[
   [bounded(1024),readBound.replace('i<64','i<65')],
   [bounded(1024),pureBody.replace('i<16','i<65')],
   [bounded(1024),pureBody.replace('i<16','i<8').replace('const n=validPartition(i%4);','for(let k=0;k<9;k++){const n=validPartition(i%4);}const n=0;')],
   [bounded(1025),readBound],
   [scalar,pureBody.replace('validPartition(i%4)','validPartition(i++)')],
   [scalar,pureBody.replace('i<16','i<16 && validPartition(i)>0')],
   [scalar,pureBody.replace('validPartition(i%4)','validPartition(validPartition(i))')],
   [scalar.replace('let total=0;','const nested=validPartition(n);let total=0;'),pureBody],
   [scalar.replace('let total=0;',"const row=ctx.kv('records');let total=0;"),pureBody],
   [original,body.replace("'item','abc',i)","'item','abc',i++)")],
  ];
  for(const [i,args] of negatives.entries())assert.throws(()=>compile(...args),e=>Boolean(e.diagnostics?.length),`source ${i}`);
  write(bounded(1024),pureBody.replace('i<16','i<65'));
  assert.throws(()=>tc.compileProject(tc.resolveProject({cwd,profile:'js'})),e=>Boolean(e.diagnostics?.length),'JavaScript shared loop budget');
  write(original+`
export function ordinary(){for(let k=0;k<2;k++){const x=unrestricted();}return 0;}function unrestricted(){return Date.now();}`);
  tc.compileProject(tc.resolveProject({cwd,profile:'js'})); // Ordinary dependency internals remain original-source JavaScript.
  const call=p=>find(p.handlers,e=>e.kind==='pure-helper-call');
  const loop=p=>find(p.handlers,e=>e.kind==='read-loop');
  const mutations=[
   p=>delete call(p).loopContract,
   p=>call(p).loopContract='future',
   p=>call(p).loopContract='pulse.bounded-read-loop-helper.v1',
   p=>loop(p).maxIterations=65,
   p=>{const l=find(p.helpers,e=>e.kind==='pure-loop');l.maxIterations=1025;l.test.right.value=1025;},
   p=>{loop(p).maxIterations=64;loop(p).test.right.value=64;const l=find(p.helpers,e=>e.kind==='pure-loop');l.maxIterations=1024;l.test.right.value=1024;loop(p).body.unshift({kind:'pure-loop',localId:l.localId,maxIterations:2,test:{...l.test,right:{kind:'literal',value:2,valueKind:'number'}},body:[{kind:'expression',expression:structuredClone(call(p))}]});},
   p=>{const c=structuredClone(call(p));p.handlers[0].body.push({kind:'expression',expression:c});},
   p=>{const c=structuredClone(call(p));loop(p).test={kind:'binary',operator:'&&',left:loop(p).test,right:c,valueKind:'boolean'};},
   p=>{const c=call(p);c.arguments[3]={kind:'update',operator:'++',prefix:false,target:c.arguments[3],valueKind:'number'};},
   p=>p.helpers[0].body.unshift({kind:'expression',expression:structuredClone(call(p))}),
   p=>p.helpers[0].body.unshift({kind:'effect',effectId:p.effects[0].id,continuationId:p.continuations[0].id,result:p.effects[0].result}),
  ];
  for(const [i,mutate] of mutations.entries()){const p=structuredClone(plan);mutate(p);assert.throws(()=>validateCanonicalNativePlan(rehash(p)),e=>e.name==='CanonicalNativePlanError',`plan ${i}`);}
  // A valid serialized plan at the exact limit cannot raise the callee cap.
  const over=structuredClone(pureLimit),outer=find(over.handlers,e=>e.kind==='pure-loop');outer.maxIterations=65;outer.test.right.value=65;
  assert.throws(()=>validateCanonicalNativePlan(rehash(over)),e=>e.name==='CanonicalNativePlanError' && e.diagnostics.some(d=>d.message.includes('combined iteration bound')));
  console.log(JSON.stringify({status:'passed',parityCases:cases.length+1,sourceRejections:negatives.length,planRejections:mutations.length+1,readSites:plan.effects.length,pureHelperReadSites:0,combinedLimit:65536}));
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
const keep=setInterval(()=>{},1000);main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1;}).finally(()=>clearInterval(keep));
