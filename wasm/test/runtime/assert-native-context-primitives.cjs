'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const R = require('../../packages/contracts/src/resources/embedded');
const runtime = require('../../../packages/runtime/src/host');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const nodeJs = require('../../../packages/provider-node/src/javascript/runtime-host').executeNodeJavascriptApplication;
const fastlyJs = require('../../../packages/provider-fastly/src/javascript/runtime-host').executeFastlyJavascriptApplication;
const root = path.resolve(__dirname, '../../..');
const budgets = { files: 1, bindings: 1, fileBytes: 65536, totalBytes: 65536, serializedBytes: 131072 };
function plan(source, bytes = Buffer.alloc(0)) {
  const binaryResources = R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{ path: '/data', bytes }], budgets)), [{ id: 'data', path: '/data' }], budgets);
  return buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'context-primitives.ts', strict: false, target: 'native' }), { binaryResources });
}
const compile = p => compileCanonicalNativePlan(p, { emitWat: false, reportCapture: false });
const fastly = p => compileFastlyNativePlatformCapabilitiesPlan(p, { cwd: root, requirePlatformCapability: false, canonicalBuild: true });
const handler = source => new Function(source.replace('export default', 'return'))();
const request = headers => ({ method: 'GET', path: '/', url: 'https://proof.test/', headers: Object.entries(headers || {}), body: '' });
function rehash(p) { delete p.planHash; p.planHash = createHash('sha256').update(stableStringify(p)).digest('hex'); return p; }
function find(value, predicate) { if (!value || typeof value !== 'object') return; if (predicate(value)) return value; for (const v of Object.values(value)) { const result = find(v, predicate); if (result) return result; } }
function clock() { let n = 0; return { now: () => ++n, setTimeout: () => 0, clearTimeout() {} }; }
async function main() {
  // Valid slices include BOM, NUL, supplementary scalars and the maximum length.
  const text = '\ufeffA雪😀\0', prefix = Buffer.from(text), bytes = Buffer.concat([prefix, Buffer.alloc(12288, 97), Buffer.from([0xc0, 0x80, 0xed, 0xa0, 0x80, 0xf4, 0x90, 0x80, 0x80])]);
  const source = `export default async function handler(ctx){const data=ctx.resources.map('data');const offset=+(ctx.req.header('offset')??'0');const length=+(ctx.req.header('length')??'0');return ctx.text(data.readUtf8(offset,length));}`;
  const p = plan(source, bytes), native = compile(p), wasm = fastly(p);
  const store = runtime.createBinaryResourceStore([{ id: 'data', bytes }]);
  let parity = 0;
  for (const [offset, length, expected] of [[0,prefix.length,text],[0,0,''],[bytes.length,0,''],[prefix.length,12288,'a'.repeat(12288)],[4,3,'雪'],[7,4,'😀']]) {
    const headers = { offset: String(offset), length: String(length) };
    assert.equal((await executeCanonicalNativeModule(native, { strict: false, request: request(headers) })).response.body, expected);
    assert.equal(executeFastlyNativePlatformCapabilities(wasm, { request: request(headers) }).response.body, expected);
    for (const execute of [nodeJs, fastlyJs]) assert.equal(Buffer.from(await (await execute(handler(source), new Request('https://proof.test/', { headers }), { binaryResources: store, strict: false })).arrayBuffer()).toString('utf8'), expected);
    parity += 4;
  }
  const badRanges = [[-1,1],[0,12289],[0,-1],[0,0.5],[0.5,1],[5,0],[7,3],[bytes.length+1,0],[prefix.length+12288,2],[prefix.length+12290,3],[prefix.length+12293,4]];
  for (const [offset,length] of badRanges) {
    const headers = { offset: String(offset), length: String(length) };
    await assert.rejects(executeCanonicalNativeModule(native, { strict:false, request:request(headers) }), {code:'PULSE_BINARY_RESOURCE_INVALID'});
    assert.throws(()=>executeFastlyNativePlatformCapabilities(wasm,{request:request(headers)}));
    await runtime.executeApplication(async ctx=>{assert.throws(()=>ctx.resources.map('data').readUtf8(offset,length),{code:'PULSE_BINARY_RESOURCE_INVALID'});return ctx.text('ok');},new Request('https://proof.test/'),{binaryResources:store});
  }
  await assert.rejects(executeCanonicalNativeModule(native,{strict:false,request:request({offset:String(prefix.length),length:'12288'}),maxDurationMs:20,requestClock:clock()}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
  await assert.rejects(runtime.executeApplication(handler(source),new Request('https://proof.test/',{headers:{offset:String(prefix.length),length:'12288'}}),{binaryResources:store,maxDurationMs:20,requestClock:clock()}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
  const shortFastly = compileFastlyNativePlatformCapabilitiesPlan(p,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:20});let ticks=0;
  assert.equal(executeFastlyNativePlatformCapabilities(shortFastly,{request:request({offset:String(prefix.length),length:'12288'}),monotonicClock:()=>({nanoseconds:BigInt(++ticks)*1000000n})}).response.status,504);
  assert(ticks<100);
  const workspace = `export default async function handler(ctx){const cells=ctx.workspace.numbers(1024);const initial=cells[0];const index=+(ctx.req.header('index')??'1023');const value=+(ctx.req.header('value')??'7');let sum=0;for(let i=0;i<1024;i++){cells[i]=i;sum+=cells[i];}cells[index]=value;cells[0]=-0;return ctx.json({initial,negativeZero:1/cells[0]<0,sum,length:cells.length,value:cells[index]});}`;
  const wp=plan(workspace), wn=compile(wp), wf=fastly(wp);
  for(let repeat=0;repeat<3;repeat++) {
    const expected={initial:0,negativeZero:true,sum:523776,length:1024,value:7};
    assert.deepEqual(JSON.parse((await executeCanonicalNativeModule(wn,{strict:false,request:request()})).response.body),expected);
    assert.deepEqual(JSON.parse(executeFastlyNativePlatformCapabilities(wf,{request:request()}).response.body),expected);
    for(const execute of [nodeJs,fastlyJs]) assert.deepEqual(await (await execute(handler(workspace),new Request('https://proof.test/'),{strict:false})).json(),expected);
  }
  for(const headers of [{index:'-1'},{index:'1024'},{index:'0.5'},{value:'Infinity'},{value:'NaN'}]) {
    await assert.rejects(executeCanonicalNativeModule(wn,{strict:false,request:request(headers)}),{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});
    assert.throws(()=>executeFastlyNativePlatformCapabilities(wf,{request:request(headers)}),e=>e.detail?.errorStage===280);
    await runtime.executeApplication(async ctx=>{await assert.rejects(handler(workspace)(ctx),{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});return ctx.text('ok');},new Request('https://proof.test/',{headers}),{strict:false});
  }
  let stale;
  await runtime.executeApplication(async ctx=>{stale=ctx.workspace.numbers(2);assert.equal(stale[0],0);assert.throws(()=>JSON.stringify(stale),{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});assert.throws(()=>{stale[0]='bad';},{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});assert.throws(()=>{stale.length=3;},{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});return ctx.text('ok');},new Request('https://proof.test/'));
  await runtime.executeApplication(async ctx=>{for(let i=0;i<4;i++)ctx.workspace.numbers(1);assert.throws(()=>ctx.workspace.numbers(1),{code:'PULSE_NUMERIC_WORKSPACE_INVALID'});return ctx.text('ok');},new Request('https://proof.test/'));
  assert.throws(()=>stale[0],{code:'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED'});
  await assert.rejects(executeCanonicalNativeModule(wn,{strict:false,request:request(),maxDurationMs:20,requestClock:clock()}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
  const shortWorkspace = compileFastlyNativePlatformCapabilitiesPlan(wp,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:20});ticks=0;
  assert.equal(executeFastlyNativePlatformCapabilities(shortWorkspace,{request:request(),monotonicClock:()=>({nanoseconds:BigInt(++ticks)*1000000n})}).response.status,504);
  for(const bad of ["const alias=cells;",'return ctx.json(cells);','return ctx.json({cells});','cells.length=2;','cells[0]++;',"cells['0']=1;","const index='0';cells[index]=1;",'cells[0]+=1;',"const f=()=>cells[0];",'const alias={cells};']) for(const target of ['native','javascript']) assert.throws(()=>compileCanonicalSource(`export default async function handler(ctx){const cells=ctx.workspace.numbers(2);${bad}return ctx.text('x');}`,{strict:false,target}));
  for(const capacity of ['0','1025','1.5','ctx.req.path']) assert.throws(()=>plan(`export default async function handler(ctx){const cells=ctx.workspace.numbers(${capacity});return ctx.text('x');}`));
  assert.throws(()=>plan(`export default async function handler(ctx){for(let i=0;i<2;i++){const cells=ctx.workspace.numbers(2);}return ctx.text('x');}`));
  for(const mutate of [p=>{const write=find(p,x=>x.kind==='workspace-write');const target={...write,kind:'workspace-read'};delete target.value;Object.assign(write,{kind:'assignment',target,operator:'='});},p=>{const init=find(p,x=>x.kind==='expression'&&x.expression?.kind==='workspace-init');const body={...init};Object.assign(init,{kind:'if',test:{kind:'literal',value:true,valueKind:'boolean'},then:[body],else:[]});delete init.expression;},p=>p.numericWorkspaces[0].capacity=1025,p=>p.numericWorkspaces[0].id='foreign',p=>find(p,x=>x.kind==='workspace-read').workspaceId='foreign',p=>find(p,x=>x.kind==='workspace-init').kind='undefined']) {
    const forged=JSON.parse(JSON.stringify(wp));mutate(forged);assert.throws(()=>validateCanonicalNativePlan(rehash(forged)));
  }
  for(const mutate of [p=>find(p,x=>x.operation==='readUtf8').valueKind='number',p=>delete find(p,x=>x.operation==='readUtf8').length,p=>find(p,x=>x.operation==='readUtf8').length={kind:'local',id:'foreign',valueKind:'number'}]) {
    const forged=JSON.parse(JSON.stringify(p));mutate(forged);assert.throws(()=>validateCanonicalNativePlan(rehash(forged)));
  }
  console.log(JSON.stringify({status:'passed',utf8Parity:parity,invalidUtf8Ranges:badRanges.length,workspaceParity:12,nativeBytes:native.wasm.length,fastlyBytes:wasm.wasm.length,workspaceBytes:wn.wasm.length}));
}
module.exports={main,plan,compile,fastly,request};
if(require.main===module)main().catch(e=>{console.error(e.message,e.diagnostics||e.detail||e.stack);process.exitCode=1;});
