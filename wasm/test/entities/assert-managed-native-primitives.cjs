#!/usr/bin/env node
'use strict';
// Combined managed Native proof; internal evidence pending full qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { resolveProject } = require(path.join(root, 'wasm/packages/cli/src/project-config.js'));
const { compileProject, compileNativeProjectInMemory } = require(path.join(root, 'wasm/packages/cli/src/project-execution.js'));
const { executeCanonicalNativeModule } = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host.js'));
const { createResourceManifest } = require(path.join(root, 'wasm/packages/contracts/src/resources/embedded.js'));
const output = process.argv[2] && path.resolve(process.argv[2]);
function sourceIdentity() {
  const git = args => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
  const changed = new Set([...git(['diff','HEAD','--name-only']).split('\n'), ...git(['ls-files','--others','--exclude-standard']).split('\n')].filter(Boolean));
  return {head:git(['rev-parse','HEAD']), files:[...changed].sort().filter(file=>path.join(root,file)!==output && fs.statSync(path.join(root,file)).isFile()).map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}))};
}
const scratch = path.join(root, 'wasm/.test-results');
fs.mkdirSync(scratch, { recursive: true });
const temp = fs.mkdtempSync(path.join(scratch, 'managed-primitives-'));
const budgets = { files: 3, fileBytes: 128, totalBytes: 384, serializedBytes: 4096, bindings: 3 };
const bytes = Buffer.from('ABCD雪😀\0');
const resource = JSON.stringify(createResourceManifest([{ path: '/data', bytes }, { path:'/alias', bytes }, { path:'/unused', bytes:Buffer.from('unreachable-payload') }], budgets));
function write(file, text) { fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.writeFileSync(path.join(temp, file), text); }
async function main() {
  const modules = path.join(temp, 'node_modules/@pulse-compute'); fs.mkdirSync(modules, { recursive: true });
  for (const name of ['pulse','runtime','entities','mcp','provider-node','provider-fastly']) fs.symlinkSync(path.join(root, 'packages', name), path.join(modules, name), 'dir');
  write('package.json', '{"private":true,"type":"module"}');
  write('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify({ pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', tests: null, strict: true, defaultProfile: 'node-native', binaryResources: { manifest: resource, bindings: { data: '/data', alias:'/alias', unused:'/unused' }, budgets } }, 'node-native': { host: 'node', target: 'native' }, 'node-javascript': { host: 'node', target: 'javascript' }, 'fastly-native': { host: 'fastly', target: 'native', fastly: { maxDurationMs: 5000 } } })}));`);

  const source = `export function operation(ctx, input) {
    const data=ctx.resources.map('data');
    const alias=ctx.resources.map('alias');
    const word=data.readUtf8(input.offset,input.length);
    const cells=ctx.workspace.numbers(4);
    const initial=cells[0];
    cells[input.index]=input.value;
    let sum=0; for(let i=0;i<4;i++){ cells[i]=data.readU8(i); sum+=cells[i]; }
    let extra=0;
    if(input.mode==='loop') { for(let outer=0;outer<64;outer++){for(let inner=0;inner<1024;inner++){extra+=1;}} }
    if(input.mode==='control') { for(let i=0;i<10;i++){if(i===2)continue;if(i===5)break;extra+=i;} }
    let grown='';
    if(input.mode==='growth') { for(let i=0;i<1024;i++){grown+=input.text;} }
    const decoded=ctx.decodeJson(input.json,'proof.Result');
    const value=sum+decoded.value+input.value+extra;
    const encoded=ctx.encodeJson({value},'proof.Result');
    if (input.mode==='undefined') return {value, text:encoded, word, initial, alias:alias.readU8(0), optional:undefined, nested:[]};
    return {value, text:encoded, word, initial, alias:alias.readU8(0), ...(input.mode==='optional' ? {optional:word} : {}), nested:[{label:word,values:[value,initial]}]};
  }`;
  write('src/handlers.ts', source);
  write('src/schemas.ts', "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'; interface Result { value: number }; interface Input { value:number; mode:string; offset:number; length:number; index:number; json:string; text:string }; interface Output {value:number; text:string; word:string; initial:number; alias:number; optional?:string; nested:{label:string; values:number[]}[]}; export default defineSchemaRegistry({schemas:{'proof.Result':schema<Result>(),'proof.Input':schema<Input>(),'proof.Output':schema<Output>()}});");
  write('src/index.ts', `import {EntityRouter,jsonRpc,mcp} from '@pulse-compute/mcp/pulse'; import {operation} from './handlers.js'; const rpc = new EntityRouter({adapter:jsonRpc({namedParamsOnly:true})}); rpc.on('proof.run',{input:'proof.Input',output:'proof.Output'},operation); const server=mcp({router:rpc}); export default async function handler(ctx) { return server.handle(ctx); }`);
  compileProject(resolveProject({cwd:temp,profile:'fastly-native'}));
  const native = compileNativeProjectInMemory(resolveProject({ cwd: temp, profile: 'node-native' }), { emitWat: false, reportCapture: false });

  const fastly = require(path.join(root,'packages/provider-fastly/src/build/native-platform-capabilities.js')).compileFastlyNativePlatformCapabilitiesPlan(native.native.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
  const fastlyExecute = require(path.join(root,'packages/provider-fastly/src/testing/native-platform-capabilities-host.js')).executeFastlyNativePlatformCapabilities;
  const jsProject=resolveProject({cwd:temp,profile:'node-javascript'}), jsCompiled=compileProject(jsProject);
  const loaded=require(path.join(root,'wasm/packages/cli/src/project-execution.js')).prepareJavascriptApplication(jsProject,{schemaBundle:jsCompiled.schema.bundle,allowedPackages:{'@pulse-compute/mcp/pulse':require(path.join(root,'packages/mcp/src/pulse.js'))}});
  assert.ok(loaded.loaded);
  const codecs=require(path.join(root,'wasm/packages/schema-json/src/compiler/canonical-schema-codecs.js')).createCanonicalSchemaCodecs(jsCompiled.schema.bundle.registry);
  const store=require(path.join(root,'packages/runtime/src/host.js')).createBinaryResourceStore([{id:'data',bytes},{id:'alias',bytes}]);
  const executeJs=require(path.join(root,'packages/provider-node/src/javascript/runtime-host.js')).executeNodeJavascriptApplication;
  const baseInput={value:2,mode:'combined',offset:0,length:4,index:0,json:'{"value":7}',text:''};
  function requestFor(change={}) { return { method:'POST', path:'/mcp', headers: {'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'proof.run'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'proof.run',arguments:{...baseInput,...change}}}) }; }
  let cases=0;
  for (const change of [{},{},{mode:'optional',offset:4,length:7},{mode:'control'},{mode:'loop'},{length:bytes.length},{length:0,offset:bytes.length}]) {
    const request=requestFor(change), nr=await executeCanonicalNativeModule(native.native,{request}), fr=fastlyExecute(fastly,{request});
    const jr=await executeJs(loaded.loaded.application,new Request('https://proof.test/mcp',{method:'POST',headers:request.headers,body:request.body}),{schemaCodecs:codecs,binaryResources:store,strict:true,maxDurationMs:5000});
    const expected=await jr.json();
    assert.deepEqual(JSON.parse(nr.response.body),expected,'Node parity '+JSON.stringify(change));
    assert.deepEqual(JSON.parse(fr.response.body),expected,'Fastly parity '+JSON.stringify(change));
    assert.equal(expected.result.isError,false);
    const value=275+(change.mode==='control'?8:change.mode==='loop'?65536:0);
    const word=bytes.subarray(change.offset??0,(change.offset??0)+(change.length??4)).toString('utf8');
    assert.deepEqual(expected.result.structuredContent,{value,text:JSON.stringify({value}),word,initial:0,alias:65,...(change.mode==='optional'?{optional:word}:{}),nested:[{label:word,values:[value,0]}]});
    cases++;
  }
  const failures=[];
  for (const change of [{offset:-1},{offset:5,length:1},{offset:7,length:3},{index:4},{index:0.5},{json:'{'},{json:'{"value":"wrong"}'},{mode:'growth',text:'x'.repeat(512)}]) {
    let nodeFailed=false,fastlyFailed=false;
    try { const result=await executeCanonicalNativeModule(native.native,{request:requestFor(change)}); nodeFailed=result.response.status!==200||JSON.parse(result.response.body).result?.isError!==false; } catch {nodeFailed=true;}
    try { const result=fastlyExecute(fastly,{request:requestFor(change)}); fastlyFailed=result.response.status!==200||JSON.parse(result.response.body).result?.isError!==false; } catch {fastlyFailed=true;}
    assert.ok(nodeFailed&&fastlyFailed,'terminal failure '+JSON.stringify(change)); failures.push(Object.keys(change)[0]);
  }
  const undefinedRequest=requestFor({mode:'undefined'});
  for(const result of [await executeCanonicalNativeModule(native.native,{request:undefinedRequest}),fastlyExecute(fastly,{request:undefinedRequest})]) assert.equal(JSON.parse(result.response.body).result.isError,true);
  const undefinedJs=await executeJs(loaded.loaded.application,new Request('https://proof.test/mcp',{method:'POST',headers:undefinedRequest.headers,body:undefinedRequest.body}),{schemaCodecs:codecs,binaryResources:store,strict:true});
  assert.equal((await undefinedJs.json()).result.isError,true);
  let ticks=0;
  const within=await executeCanonicalNativeModule(native.native,{request:requestFor(),maxDurationMs:100,requestClock:{now:()=>++ticks,setTimeout:()=>0,clearTimeout(){}}});
  assert.equal(within.response.status,200); ticks=0;
  const deadline=await executeCanonicalNativeModule(native.native,{request:requestFor({mode:'loop'}),maxDurationMs:100,requestClock:{now:()=>++ticks,setTimeout:()=>0,clearTimeout(){}}});
  assert.equal(deadline.response.status,408); assert.ok(ticks<1000);
  ticks=0;
  const withinFastly=fastlyExecute(fastly,{request:requestFor(),monotonicClock:()=>({nanoseconds:BigInt(++ticks)*50000000n})});
  assert.equal(withinFastly.response.status,200); ticks=0;
  const expired=fastlyExecute(fastly,{request:requestFor({mode:'loop'}),monotonicClock:()=>({nanoseconds:BigInt(++ticks)*50000000n})});
  assert.equal(expired.response.status,408); assert.ok(ticks<1000);
  assert.deepEqual(native.native.plan.binaryResources.records.map(r=>r.id),['alias','data']);
  assert.equal(native.native.plan.binaryResources.blobs.length,1);
  assert.ok(!native.native.plan.packages.application.source.includes('unreachable-payload'));
  const negatives=[
    "const data=ctx.resources.map('unknown');return {value:data.readU8(0)};",
    "const data=ctx.resources.map('data');const alias=data;return {value:1};",
    "const data=ctx.resources.map('data');return {value:data};",
    "const cells=ctx.workspace.numbers(4);const alias=cells;return {value:1};",
    "const cells=ctx.workspace.numbers(4);cells[0]+=1;return {value:1};",
    "const cells=ctx.workspace.numbers(1025);return {value:1};",
    "for(let i=0;i<4;i++){const cells=ctx.workspace.numbers(4);}return {value:1};",
    "input.value=4;return {value:1};",
    "const alias=input;alias.value=4;return {value:1};",
    "for(let i=0;i<1025;i++){}return {value:1};",
    "for(let i=0;i<1024;i++){for(let j=0;j<1024;j++){}}return {value:1};",
    "for(let i=0;i<4;i++){i=0;}return {value:1};",
    "return ctx.decodeJson('{}','unknown');",
    "return unknown(input);"
  ];
  for(const body of negatives){
    write('src/handlers.ts',`export function operation(ctx,input){${body}}`);
    assert.throws(()=>compileProject(resolveProject({cwd:temp,profile:'node-native'})),undefined,body);
  }
  write('src/handlers.ts',source);
  const validate=require(path.join(root,'wasm/packages/compiler/src/canonical-native-plan.js'));
  function find(node,predicate){if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const value of Object.values(node)){const result=find(value,predicate);if(result)return result;}}
  for(const mutate of [p=>p.packages.application.primitivePlan.handlers[0].primitives.resourceIds.push('foreign'),p=>find(p.packages.application.primitivePlan,n=>n.kind==='resource-read').resourceId='foreign',p=>find(p.packages.application.primitivePlan,n=>n.kind==='workspace-read').workspaceId='foreign',p=>find(p.packages.application.primitivePlan,n=>n.kind==='pure-loop').maxIterations=1025,p=>p.numericWorkspaces[0].capacity=5,p=>find(p.packages.application.primitivePlan,n=>n.kind==='workspace-init').kind='undefined']){
    const plan=JSON.parse(JSON.stringify(native.native.plan));mutate(plan);delete plan.planHash;plan.planHash=crypto.createHash('sha256').update(validate.stableStringify(plan)).digest('hex');assert.throws(()=>validate.validateCanonicalNativePlan(plan));
  }
  const report = { status:'passed', scope:'combined-managed-native-proof', featureComplete:false, node:process.version, source:sourceIdentity(), artifacts:{planHash:native.native.plan.planHash,nodeWasmSha256:crypto.createHash('sha256').update(native.native.wasm).digest('hex'),fastlyWasmSha256:crypto.createHash('sha256').update(fastly.wasm).digest('hex')},cases,failures:failures.length,negativeSources:negatives.length,forgedPlans:6,deadlines:2,nativeBytes:native.native.wasm.length,fastlyBytes:fastly.wasm.length, resources:native.native.plan.binaryResources.records.map(r=>r.id), workspace:native.native.plan.numericWorkspaces };
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
module.exports={main:async()=>{try{return await main();}finally{fs.rmSync(temp,{recursive:true,force:true});}}};
if(require.main===module)main().catch(error=>{console.error(error,error.diagnostics,error.detail);process.exitCode=1}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
