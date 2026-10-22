'use strict';
const assert=require('node:assert/strict');
const runtime=require('../../../packages/runtime/src/host');
const node=require('../../../packages/provider-node/src/javascript/runtime-host').executeNodeJavascriptApplication;
const fastly=require('../../../packages/provider-fastly/src/javascript/runtime-host').executeFastlyJavascriptApplication;
const invalid={code:'PULSE_BINARY_RESOURCE_INVALID'},closed={code:'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED'};
async function main(){
 await nativeRanges();
 const source=Uint8Array.of(65,66,67,68,69),store=runtime.createBinaryResourceStore([{id:'data',bytes:source},{id:'empty',bytes:new Uint8Array()}]);source.fill(0);
 for(const [name,execute] of [['node-javascript',node],['fastly-javascript-injected',fastly]]){
  const run=(handler,extra={})=>execute(handler,new Request('https://resource.test/'),{binaryResources:store,...extra});
  let stale,read;
  await run(async ctx=>{
   const data=ctx.resources.map('data'),empty=ctx.resources.map('empty');stale=data;read=data.readU8;
   assert.equal(data.readU8(0),65);assert.equal(data,ctx.resources.map('data'));assert.equal(empty.byteLength,0);assert.equal(empty.readUtf8(0,0),'');assert.equal(data.readUtf8(5,0),'');
   for(const f of [()=>empty.readU8(0),()=>empty.readU32LE(0),()=>empty.readF32LE(0),()=>data.readU32LE(2),()=>data.readUtf8(4,2),()=>ctx.resources.map('missing'),()=>read.call({},0),()=>JSON.stringify(data)])assert.throws(f,invalid);
   return ctx.text('ok');
  });
  for(const f of [()=>stale.byteLength,()=>stale.readU8(0),()=>stale.readUtf8(0,0),()=>read.call(stale,0)])assert.throws(f,closed);
  let foreign,release,ready;const started=new Promise(r=>ready=r);
  const pending=run(async ctx=>{foreign=ctx.resources.map('data');ready();await new Promise(r=>release=r);return ctx.text('ok');});
  await started;
  try{await run(async ctx=>{const local=ctx.resources.map('data');assert.throws(()=>local.readU8.call(foreign,0),invalid);assert.throws(()=>local.readUtf8.call(foreign,0,1),invalid);return ctx.text('ok');});}finally{release();await pending;}
  let failed;
  assert.equal((await run(async ctx=>{failed=ctx.resources.map('data');throw Error('resource failure');})).status,500);
  assert.throws(()=>failed.readU8(0),closed);
  const controller=new AbortController();let aborted;
  await assert.rejects(run(async ctx=>{aborted=ctx.resources.map('data');controller.abort();aborted.readU8(0);return ctx.text('unreachable');},{signal:controller.signal}),{name:'AbortError'});
  assert.throws(()=>aborted.readU8(0));
  assert.equal(await (await run(async ctx=>ctx.text(''+ctx.resources.map('data').readU8(0)))).text(),'65');
  console.log('ok - '+name+': empty/range, snapshot, unavailable/foreign/forged/stale, failure/abort and fresh recovery');
 }
}
async function nativeRanges(){
 const R=require('../../packages/contracts/src/resources/embedded'),path=require('node:path'),root=path.resolve(__dirname,'../../..');
 const budgets={files:2,fileBytes:3,totalBytes:3,serializedBytes:2048,bindings:2};
 const resources=R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{path:'/data',bytes:Buffer.from('ABC')},{path:'/empty',bytes:Buffer.alloc(0)}],budgets)),[{id:'data',path:'/data'},{id:'empty',path:'/empty'}],budgets);
 const compile=expression=>{const source=`export default async function handler(ctx){const data=ctx.resources.map('data');const empty=ctx.resources.map('empty');return ctx.text(${expression});}`;const compiled=require('../../packages/compiler/src/canonical-api-compiler').compileCanonicalSource(source,{fileName:'ranges.ts',target:'native',strict:false});const plan=require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(compiled,{binaryResources:resources});return {node:require('../../packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false}),fastly:require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true})};};
 const host=require('../../packages/host-runtime/src/runtime/canonical-native-host'),fastly=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities;
 const valid=compile("empty.readUtf8(0,0)+data.readUtf8(3,0)+data.readUtf8(0,3)");
 assert.equal((await host.executeCanonicalNativeModule(valid.node,{})).response.body,'ABC');assert.equal(fastly(valid.fastly,{}).response.body,'ABC');
 for(const expression of ["''+empty.readU8(0)","''+data.readU32LE(0)","data.readUtf8(2,2)"]){const bad=compile(expression);await assert.rejects(host.executeCanonicalNativeModule(bad.node,{}),invalid);assert.throws(()=>fastly(bad.fastly,{}),e=>e.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');}
 const controller=host.instantiateCanonicalNativeModule(valid.node,{});controller.start();controller.close();assert.throws(()=>controller.start(),{code:'PULSE_EFFECT_INVOCATION_INVALID'});assert.throws(()=>controller.resume(),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
 console.log('ok - Node/Fastly Native zero-length, terminal ranges, truncated scalar, UTF-8 range and closed execution');
}
module.exports={main};
