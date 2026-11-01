'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {compileCanonicalSource,loadCanonicalModule}=require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-compiler');
const {executeCanonicalNativeModule}=require('../../packages/host-runtime/src/runtime/canonical-native-host');
const node=require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const fastly=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities:run}=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root=path.resolve(__dirname,'../../..'),origin='https://timing.test';
const options={cwd:root,emitWat:false,requirePlatformCapability:false,bindings:{backends:{[origin]:'origin'}}};
const planFor=body=>buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){${body}}`,{strict:false}));
const outcome=(value,elapsedMs)=>({status:'fulfilled',value,elapsedMs});
async function main(){
 let checks=0;
 for(const init of ["{timing:ctx.req.path}","{timing:1}","{['timing']:true}","{...{timing:true}}"]){assert.throws(()=>planFor(`const r=await ctx.fetch('${origin}',${init}).text();return ctx.json(r)`));checks++;}
 const shapes={
  raw:`const r=await ctx.parallel({slow:ctx.fetch('${origin}/slow',{timing:true,errors:'collect',timeoutMs:30}),fast:ctx.fetch('${origin}/fast',{timing:true})});return ctx.json({slow:r.slow.elapsedMs,fast:r.fast.elapsedMs})`,
  text:`const r=await ctx.parallel({slow:ctx.fetch('${origin}/slow',{timing:true,errors:'collect',timeoutMs:30}).text(),fast:ctx.fetch('${origin}/fast',{timing:true}).text()});return ctx.json(r)`,
  json:`const r=await ctx.parallel({slow:ctx.fetch('${origin}/slow',{timing:true,errors:'collect',timeoutMs:30}).json(),fast:ctx.fetch('${origin}/fast',{timing:true}).json()});return ctx.json(r)`,
  collection:`const urls=['${origin}/slow','${origin}/fast'];const effects=ctx.effects({max:2});for(const url of urls){effects.add(ctx.fetch(url,{timing:true,errors:'collect',timeoutMs:30}).text());}const r=await ctx.parallel(effects);return ctx.json(r)`,
  only:`const r=await ctx.fetch('${origin}/slow',{timing:true,timeoutMs:30}).text();return ctx.json(r)`
 };
 for(const [shape,body]of Object.entries(shapes)){
  const plan=planFor(body),edge=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const fixtures={[origin+'/slow']:{body:shape==='json'?'1':'slow',delayMs:10,bodyDelayMs:90,headers:[['content-type','application/json']]},[origin+'/fast']:{body:shape==='json'?'2':'fast',delayMs:5,bodyDelayMs:5,headers:[['content-type','application/json']]}};
  const expected=shape==='raw'?{slow:10,fast:5}:shape==='only'?outcome('slow',100):shape==='collection'?[outcome('slow',100),outcome('fast',10)]:{slow:outcome(shape==='json'?1:'slow',100),fast:outcome(shape==='json'?2:'fast',10)};
  const result=run(edge,{fixtures});assert.deepEqual(JSON.parse(result.response.body),expected,shape);checks++;
  if(shape==='raw')assert(!result.trace.some(t=>t.module==='fastly_http_body'&&t.name==='read'));
  if(shape==='text'){
   for(const [fault,code,elapsed]of [[{transportStatus:1},'PULSE_FETCH_NETWORK',10],[{bodyReadStatus:1},'PULSE_FETCH_NETWORK',100],[{neverHeaders:true},'PULSE_FETCH_TIMEOUT',30],[{sendStatus:1},'PULSE_FETCH_NETWORK',0]]){
    const r=run(edge,{fixtures:{...fixtures,[origin+'/slow']:{...fixtures[origin+'/slow'],...fault}}});assert.deepEqual(JSON.parse(r.response.body),{slow:{status:'rejected',error:{code},elapsedMs:elapsed},fast:outcome('fast',10)});checks++;
   }
   const prep=run(edge,{fixtures,hostcallDelayMs:{'fastly_http_req.uri_set':30}});
   const value=JSON.parse(prep.response.body);assert.equal(value.slow.elapsedMs,null);assert.equal(value.slow.error.code,'PULSE_FETCH_TIMEOUT');checks++;
   const budget=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,maxDurationMs:40});
   const expired=run(budget,{fixtures});assert.equal(expired.response.status,504);checks++;
   for(const fault of [{bodyReadStatus:2},{body:'{'.repeat(70000)}])assert.throws(()=>run(edge,{fixtures:{...fixtures,[origin+'/slow']:{...fixtures[origin+'/slow'],...fault}}}));checks+=2;
  }
  if(shape==='only'){
   assert.throws(()=>run(edge,{fixtures:{[origin+'/slow']:{transportStatus:1}}}));checks++;
   // Optional clock sample failure -> explicit null; driver clock faults stay fatal.
   let clocks=0;
   const unavailable=run(edge,{fixtures,monotonicClock:ms=>++clocks===3?{status:1}:{nanoseconds:BigInt(Math.round(ms*1000000))}});
   assert.equal(JSON.parse(unavailable.response.body).elapsedMs,null);checks++;
  }
  console.log(`ok Fastly ${shape}; ${edge.wasm.length} bytes`);
 }
 // Both Node execution paths record bytes before TextDecoder and caller work.
 for(const collect of [false,true])for(const projection of ['text','json']){
  const src=`export default async function handler(ctx){const r=await ctx.fetch('${origin}/slow',{timing:true${collect?",errors:'collect'":''}}).${projection}();return ctx.json(r)}`;
  const compiled=compileCanonicalSource(src,{strict:false}),wasm=compileCanonicalNativePlan(buildCanonicalNativePlan(compiled),{cwd:root,emitWat:false});
  for(const target of ['generator','native']){
   let t=0;
   const fetchImplementation=async()=>{t=5;let n=0;return new Response(new ReadableStream({pull(c){if(n++===0){t=12;c.enqueue(new TextEncoder().encode('42'));}else{t=90;c.close();}}},{highWaterMark:0}),{headers:{'content-type':'application/json'}})};
   const opts={fetchClock:{now:()=>t},fetchImplementation};
   const result=target==='generator'?await node.executeCanonicalProgram(loadCanonicalModule(compiled),opts):await executeCanonicalNativeModule(wasm,{...opts,providerAdapter:node.createNodeProviderAdapter(opts)});
   assert.deepEqual(JSON.parse(result.response.body),outcome(projection==='json'?42:'42',12));checks++;
  }
 }
 const no=fastly.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(`const r=await ctx.fetch('${origin}/slow',{timing:false}).text();return ctx.text(r)`),options);
 assert(!no.source.includes('const __pulse_timing_starts'));checks++;
 console.log(`ok - transport timing: ${checks} focused cases`);
}
module.exports=main;
if(require.main===module)main().catch(e=>{console.error(e,e.detail);process.exitCode=1});
