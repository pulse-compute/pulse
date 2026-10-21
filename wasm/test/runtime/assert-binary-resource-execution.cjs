'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const R = require('../../packages/contracts/src/resources/embedded');
const runtime = require('../../../packages/runtime/src/host');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host');
const { compileFastlyNativePlatformCapabilitiesPlan: fastlyCompile } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: fastlyExecute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root = path.resolve(__dirname, '../../..');
const budgets = { files: 4, fileBytes: 2097152, totalBytes: 4194304, serializedBytes: 6291456, bindings: 4 };
function catalogue(bytes) {
  return R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{path:'/data',bytes}], budgets)), [{id:'data',path:'/data'}], budgets);
}
function plan(source, resources) {
  return buildCanonicalNativePlan(compileCanonicalSource(source, {fileName:'binary-resource.ts', target:'native', strict:false}), {binaryResources:resources});
}
function compile(source, resources) {return compileCanonicalNativePlan(plan(source, resources), {emitWat:false,reportCapture:false});}
const handler = source => new Function(source.replace('export default', 'return'))();
const request = () => new Request('http://localhost/');
const invalid = {code:'PULSE_BINARY_RESOURCE_INVALID'};
function clock() { let tick=0; return { now:()=>++tick, setTimeout:()=>0, clearTimeout(){} }; }
async function main() {
  const bytes=Buffer.alloc(1048577); let seed=12345; for(let i=0;i<bytes.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;bytes[i]=seed&255;} bytes[0]=255;bytes.writeUInt32LE(0xfedcba98,1);bytes.writeFloatLE(-0,5);bytes.writeFloatLE(1.5,9);bytes.writeFloatLE(NaN,13);
  const resources=catalogue(bytes), store=runtime.createBinaryResourceStore([{id:'data',bytes}]);
  const source=`export default async function handler(ctx) { const data=ctx.resources.map('data'); return ctx.json({length:data.byteLength,u8:data.readU8(0),u32:data.readU32LE(1),negativeZero:1/data.readF32LE(5)<0,f32:data.readF32LE(9)}); }`;
  const expected={length:bytes.length,u8:255,u32:0xfedcba98,negativeZero:true,f32:1.5};
  const compiled=compile(source,resources);
  assert.deepEqual(JSON.parse((await nativeHost.executeCanonicalNativeModule(compiled,{strict:false})).response.body),expected);
  assert(compiled.wasm.length < bytes.length+12000, 'raw resource payload stays near its decoded length');
  for(const execute of [executeNodeJavascriptApplication,executeFastlyJavascriptApplication]) {
    assert.deepEqual(await (await execute(handler(source),request(),{binaryResources:store,strict:false})).json(),expected);
  }
  const fastly=fastlyCompile(compiled.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true});
  assert.deepEqual(JSON.parse(fastlyExecute(fastly,{}).response.body),expected);
  console.log('ok - Node/Fastly JS and Native: >1 MiB raw payload, unaligned LE, unsigned range and signed zero');

  for(const expression of ['data.readU8(-1)','data.readU8(0.5)','data.readU8(data.byteLength)','data.readU32LE(data.byteLength-3)',"data.readU8('0')",'data.readU8(9007199254740992)','data.readF32LE(13)']) {
    const input=`export default async function handler(ctx) {const data=ctx.resources.map('data');return ctx.text(''+${expression});}`;
    const small=catalogue(bytes.subarray(0,32)), smallStore=runtime.createBinaryResourceStore([{id:'data',bytes:bytes.subarray(0,32)}]);
    const bad=compile(input,small);
    await assert.rejects(nativeHost.executeCanonicalNativeModule(bad,{strict:false}),invalid);
    assert.throws(()=>fastlyExecute(fastlyCompile(bad.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true}),{}), error=>error.detail?.lastError!==undefined);
    for(const execute of [executeNodeJavascriptApplication,executeFastlyJavascriptApplication]) {
      let caught;
      const response=await execute(async ctx=>{try{await handler(input)(ctx);}catch(error){caught=error;}return ctx.text('checked');},request(),{binaryResources:smallStore});
      assert.equal(response.status,200);assert.equal(caught?.code,invalid.code,expression);
    }
    // Plain runtime lets the bounded error reach the assertion through a text read outside Router error handling.
    let caught;
    await runtime.executeApplication(async ctx=>{try { await handler(input)(ctx); } catch(e) {caught=e;} return ctx.text('checked');},request(),{binaryResources:smallStore});
    assert.equal(caught?.code,invalid.code,expression);
  }
  console.log('ok - offset type, fraction, negative, safe-integer, bounds and nonfinite checks');

  const scan=`export default async function handler(ctx) {const data=ctx.resources.map('data');let sum=0;for(let i=0;i<256;i++){for(let j=0;j<256;j++){sum+=data.readF32LE(9);}}return ctx.text(''+sum);}`;
  const scanModule=compile(scan,catalogue(bytes.subarray(0,32)));
  for(let pass=0;pass<17;pass++) {
    const result=await nativeHost.executeCanonicalNativeModule(scanModule,{strict:false});
    assert.equal(result.response.body,'98304');assert(result.valueHandleCount<=8);
  }
  const repeated=scan.replace('for(let i=0;i<256;i++){for(let j=0;j<256;j++){sum+=data.readF32LE(9);}}',Array(17).fill('for(let i=0;i<256;i++){for(let j=0;j<256;j++){sum+=data.readF32LE(9);}}').join(''));
  const repeatedModule=compile(repeated,catalogue(bytes.subarray(0,32)));
  const repeatedResult=await nativeHost.executeCanonicalNativeModule(repeatedModule,{strict:false});
  assert.equal(fastlyExecute(fastlyCompile(repeatedModule.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true}),{}).response.body,String(98304*17));
  for(const execute of [executeNodeJavascriptApplication,executeFastlyJavascriptApplication])assert.equal(await (await execute(handler(repeated),request(),{binaryResources:store})).text(),String(98304*17));
  assert.equal(repeatedResult.response.body,String(98304*17));assert(repeatedResult.valueHandleCount<=40);
  // Same execution exceeds the former 4 MiB proposal; runtime has no cumulative quota.
  let scans=0;
  await runtime.executeApplication(async ctx=>{const view=ctx.resources.map('data');for(let i=0;i<1048577;i++) scans+=view.readF32LE(9);return ctx.text('ok');},request(),{binaryResources:store});
  assert.equal(scans,1572865.5);
  await assert.rejects(nativeHost.executeCanonicalNativeModule(scanModule,{strict:false,maxDurationMs:20,requestClock:clock()}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
  await assert.rejects(runtime.executeApplication(handler(scan),request(),{binaryResources:store,maxDurationMs:20,requestClock:clock()}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
  const fastlyScan=fastlyCompile(scanModule.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:20});
  let ticks=0;
  const expired=fastlyExecute(fastlyScan,{monotonicClock:()=>({nanoseconds:BigInt(++ticks)*1000000n})});
  assert.equal(expired.response.status,504);
  assert(ticks<100,'synchronous reads observe expiration without waiting for a timer');
  console.log('ok - repeated reads, bounded Native handles and Node/Fastly synchronous deadlines');

  let stale, other, method, foreignError;
  await runtime.executeApplication(async ctx=>{stale=ctx.resources.map('data');method=stale.readU8;assert.equal(stale,ctx.resources.map('data'));assert.throws(()=>JSON.stringify(stale),invalid);assert.throws(()=>method.call({},0),invalid);return ctx.text('ok');},request(),{binaryResources:store});
  assert.throws(()=>stale.readU8(0),{code:'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED'});
  // A method from one still-live execution cannot operate on another execution's view.
  let release, ready; const started=new Promise(r=>ready=r);
  const first=runtime.executeApplication(async ctx=>{other=ctx.resources.map('data');ready();await new Promise(r=>release=r);return ctx.text('ok');},request(),{binaryResources:store});
  await started;
  await runtime.executeApplication(async ctx=>{try {ctx.resources.map('data').readU8.call(other,0);}catch(e){foreignError=e;}return ctx.text('ok');},request(),{binaryResources:store});
  release();await first;assert.equal(foreignError.code,invalid.code);
  console.log('ok - forged, foreign, serialized and stale views fail');

  for(const bad of ["return ctx.json(data)","const alias=data;return ctx.text('bad')","return ctx.json({data})","const read=()=>data.readU8(0);return ctx.text('bad')","data.readU8=()=>0;return ctx.text('bad')"]) {
    assert.throws(()=>plan(`export default async function handler(ctx){const data=ctx.resources.map('data');${bad};}`,resources));
  }
  for(const id of ["'missing'",'ctx.req.path']) assert.throws(()=>plan(`export default async function handler(ctx){const data=ctx.resources.map(${id});return ctx.text('bad');}`,resources));
  const forged=JSON.parse(JSON.stringify(compiled.plan));forged.binaryResources.blobs[0].data='AAAA';
  delete forged.planHash;forged.planHash=createHash('sha256').update(stableStringify(forged)).digest('hex');
  assert.throws(()=>validateCanonicalNativePlan(forged));
  const unused=compile(`export default async function handler(ctx){return ctx.text('ok');}`,resources);
  const absent=compile(`export default async function handler(ctx){return ctx.text('ok');}`);
  assert.deepEqual(unused.wasm,absent.wasm);assert.equal(unused.plan.binaryResources,undefined);
  console.log('ok - source escapes and corrupt plans rejected; unused Native resources add zero bytes');
  await require('./binary-resource-project.cjs').main();
  await require('./binary-resource-matrix.cjs').main();
  await require('./binary-resource-closure.cjs').main();
  console.log(JSON.stringify({version:'pulse.binary-resource-execution-proof.v1',fixture:'generated, not the real MCP vector.bin',payloadBytes:bytes.length,nativeBytes:compiled.wasm.length,fastlyBytes:fastly.wasm.length,scanReadsPerExecution:65536,scanExecutions:17,nativeHandleUpperBound:8}));
}
main().catch(error=>{console.error(error.message,error.diagnostics||error.detail?.stderr||error.stack);process.exitCode=1;});
