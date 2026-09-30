'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname, '../../..');
const helper = `export const lookup=async(ctx,input:string)=>{if(input==='early')return 'early';let value=input;for(let i=0;i<8;i++){value=value+':'+i;}const text=await ctx.fetch('https://helper.test/'+input).text();return value+'|'+text;};`;
const entry = body => `import {Pulse} from '@pulse-compute/pulse';import {lookup} from './helper';const app=new Pulse({auto:true});${body}export default app;`;
const route = call => `app.get('/',async(ctx)=>{${call}return ctx.text(result);});`;
const tc = acceptanceToolchain();
async function main() {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-source-helper-'));
 try {
  fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for (const name of ['pulse','runtime']) fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'}}));`);
  const compile = (helperSource, entrySource) => {
   fs.writeFileSync(path.join(cwd,'src/helper.ts'),helperSource);fs.writeFileSync(path.join(cwd,'src/index.ts'),entrySource);
   return buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));
  };
  const source = entry(`app.use(async(ctx,next)=>{const result=await lookup(ctx,'early');ctx.state.set('middleware',result);return next();});
   app.get('/',async(ctx)=>{const first=await lookup(ctx,'a');const second=await lookup(ctx,'b');return ctx.text(ctx.state.get('middleware')+'|'+first+'|'+second);});
   app.error(async(error,ctx,next)=>ctx.text('caught',{status:418}));`);
  const plan = compile(helper,source);
  assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,1);
  validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
  const negativeSources = [
   [helper.replace('input:string','input:string="x"'), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper.replace('const lookup','let lookup'), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper.replace("let value=input", "let value=captured"), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper.replace("let value=input", "input='other';let value=input"), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper.replace("return value+'|'+text", "const nested=await lookup(ctx,input);return nested"), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper.replace("return value+'|'+text", "return ctx.text(value)"), entry(route(`const result=await lookup(ctx,'a');`))],
   [helper,entry(route(`const result=lookup(ctx,'a');`))],
   [helper,entry(route(`const result=await lookup({},'a');`))],
   [helper,entry(route(`const result=await lookup(ctx,3);`))],
   [helper,entry(route(`const lookup=async(ctx,input)=>'shadow';const result=await lookup(ctx,'a');`))],
   [helper,entry(route(`let result='';for(let i=0;i<2;i++){const nested=await lookup(ctx,'a');result=nested;}`))]
  ];
  for (const [i,args] of negativeSources.entries()) assert.throws(()=>compile(...args),undefined,`source rejection ${i}`);
  const mutations = [
   p=>{p.helpers[0].frame.reset='never'}, p=>{p.helpers[0].localIds.pop()},
   p=>{p.helpers[0].parameters[0].localId=p.handlers[0].localIds[0]},
   p=>{p.helpers[0].body.push({kind:'helper-call',helperId:p.helpers[0].id,arguments:[],localId:p.helpers[0].localIds[0]})},
   p=>{p.effects[0].helperId='helper:foreign'},p=>{delete p.continuations[0].helperId},
   p=>{p.helpers[0].body.unshift({kind:'expression',expression:{kind:'local',id:p.handlers[0].localIds[0],valueKind:'string'}})},
   p=>{p.helpers[0].parameters[0].valueKind='object'},p=>{p.helpers.push(p.helpers[0])},p=>{p.helpers={}},
   p=>{p.handlers[0].body.find(s=>s.kind==='helper-call').callerEntryId='foreign'},
   p=>{p.entry.body.push({...p.handlers[0].body.find(s=>s.kind==='helper-call'),localId:p.entry.body[0].localId})}
  ];
  for(const [i,mutate] of mutations.entries()) {
   const changed=JSON.parse(JSON.stringify(plan));mutate(changed);const unsigned={...changed};delete unsigned.planHash;
   changed.planHash=createHash('sha256').update(stableStringify(unsigned)).digest('hex');
   assert.throws(()=>validateCanonicalNativePlan(changed),e=>e.name==='CanonicalNativePlanError',`plan rejection ${i}`);
  }
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
  const seen=[];
  const adapter={id:'helper-test',dispatchEffect(effect){seen.push(effect.parts.url);return {status:200,headers:{},body:'body:'+effect.parts.url.split('/').pop()}}};
  const result=await tc.executeCanonicalNativeModule(native,{providerAdapter:adapter,request:{method:'GET',path:'/',url:'https://app.test/'}});
  assert.equal(result.response.body,'early|a:0:1:2:3:4:5:6:7|body:a|b:0:1:2:3:4:5:6:7|body:b');
  assert.deepEqual(seen,['https://helper.test/a','https://helper.test/b']);
  let failedCalls=0;
  await assert.rejects(tc.executeCanonicalNativeModule(native,{providerAdapter:{id:'failure',dispatchEffect(){failedCalls++;throw Error('stop')}},request:{method:'GET',path:'/',url:'https://app.test/'}}),/stop/);
  assert.equal(failedCalls,1,'terminal host failure fences the next helper call');
  const handled=await tc.executeCanonicalNativeModule(native,{providerAdapter:{id:'application-error',dispatchEffect(){throw Object.assign(Error('invalid data'),{code:'PULSE_SCHEMA_DECODE'})}},request:{method:'GET',path:'/',url:'https://app.test/'}});
  assert.deepEqual([handled.response.status,handled.response.body],[418,'caught']);
  const fastly=require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,canonicalBuild:true,requirePlatformCapability:false,emitWat:false,bindings:{effectBackends:{[plan.effects[0].id]:'proof'}}});
  const fastlyResult=tc.executeFastlyNativePlatformCapabilities(fastly,{request:{method:'GET',path:'/',url:'https://app.test/'},fixtures:{proof:{'/a':{status:200,body:'body:a'},'/b':{status:200,body:'body:b'}}}});
  assert.equal(fastlyResult.response.body,result.response.body);
  const controller=tc.instantiateCanonicalNativeModule(native,{request:{method:'GET',path:'/',url:'https://app.test/'}});
  const foreign=tc.instantiateCanonicalNativeModule(native,{request:{method:'GET',path:'/',url:'https://app.test/'}});
  assert.equal(controller.start(),1);assert.equal(foreign.start(),1);
  const a=controller.pendingEffects()[0],b=foreign.pendingEffects()[0];
  assert.throws(()=>controller.setEffectResult(b.ticket,{status:200,body:'poison'}),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  controller.setEffectResult(a.ticket,{status:200,headers:{},body:'A'});
  assert.equal(controller.resume(),1);assert.throws(()=>controller.setEffectResult(a.ticket,{status:200,body:'stale'}),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  controller.close();foreign.close();
  console.log(JSON.stringify({status:'passed',sourceRejections:negativeSources.length,planRejections:mutations.length,nativeChecks:7,wasmBytes:native.wasm.length}));
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error,error.diagnostics);process.exitCode=1});
