#!/usr/bin/env node
'use strict';
// Internal composition proof. Call sites are compiler facts, not yet ctx.call
// source admission. This deliberately tests that boundary before public syntax.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const baseline = process.argv[2] && path.resolve(process.argv[2]);
const output = process.argv[3] && path.resolve(process.argv[3]);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const { compileCallable, seal } = require('../../packages/compiler/src/canonical-callable-proof');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const fastlyCompile = require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan;
const fastlyExecute = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities;
const { generateCallableSources } = require('../../packages/runtime-core-as/src/compiler/canonical-native-callable');
const scratch = path.join(root,'wasm/.test-results'); fs.mkdirSync(scratch,{recursive:true});
const temp = fs.mkdtempSync(path.join(scratch,'callable-proof-'));
const clone = x => JSON.parse(JSON.stringify(x));
const report = { version:'pulse.callable-proof-evidence.v1', status:'running', publicCallSyntax:false, providerReality:false, measurements:[], negativeSources:0, forgedPlans:0 };
function save() { if(output) fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n'); }
function write(file, text) { const p=path.join(temp,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p; }
function replace(n, fn) { if(!n || typeof n!=='object')return;fn(n);for(const v of Object.values(n))if(v&&typeof v==='object')replace(v,fn); }
async function main() {
  const schemaFile = write('schemas.ts', `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
interface Input {value:number; offset:number; length:number; index:number}
interface Output {value:number;initial:number;word:string}
interface Runs {runs:Output[]}
export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>(),'proof.Runs':schema<Runs>()}});`);
  const registry = require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(schemaFile,{projectRoot:temp}).registry;
  const {buildCanonicalSchemaBundle,createCanonicalSchemaCodecs} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
  const schemaBundle = buildCanonicalSchemaBundle(registry,{maxBytes:24576});
  const bytes=Buffer.from('ABCD雪😀');
  const R=require('../../packages/contracts/src/resources/embedded');
  const budgets={files:3,fileBytes:128,totalBytes:384,serializedBytes:4096,bindings:3};
  const resources=R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{path:'/data',bytes},{path:'/unused',bytes:Buffer.from('UNREACHABLE_CALLABLE_DATA')}],budgets)),[{id:'data',path:'/data'},{id:'unused',path:'/unused'}],budgets);
  const source=`export function query(ctx,input){const data=ctx.resources.map('data');const cells=ctx.workspace.numbers(4);const initial=cells[0];cells[input.index]=input.value;let sum=0;for(let i=0;i<4;i++){cells[i]=data.readU8(i);sum+=cells[i];}return {value:sum+input.value,initial,word:data.readUtf8(input.offset,input.length)};}`;
  const options={inputSchema:'proof.Input',outputSchema:'proof.Output',schemaBundle,binaryResources:resources};
  const callee=compileCallable(source,options);
  assert.equal(callee.binaryResources.records.length,1);
  assert.equal(callee.binaryResources.records[0].id,'data');
  const baseInput={value:2,offset:0,length:4,index:0};
  const expected={value:268,initial:0,word:'ABCD'};
  const modules=path.join(temp,'node_modules/@pulse-compute');fs.mkdirSync(modules,{recursive:true});
  for(const name of ['pulse','runtime','entities','mcp','provider-node'])fs.symlinkSync(path.join(root,'packages',name),path.join(modules,name),'dir');
  write('package.json','{"private":true,"type":"module"}');
  write('src/handlers.ts','export function operation(ctx,input){return {value:input.value,initial:0,word:""};}');
  const mcpSource=`import {EntityRouter,jsonRpc,mcp} from '@pulse-compute/mcp/pulse';import {operation} from './handlers.js';const rpc=new EntityRouter({adapter:jsonRpc({namedParamsOnly:true})});rpc.on('proof.run',{input:'proof.Input',output:'proof.Output'},operation);const server=mcp({router:rpc});export default async function handler(ctx){return server.handle(ctx);}`;
  const entry=write('src/index.ts',mcpSource);
  const lower=require('../../../packages/mcp/pulsewasm.compiler.cjs').createMcpPackageCompilerBuilder({cwd:temp,sourcePath:entry,sourceText:mcpSource,schemaBundle});
  assert.equal(lower.hasErrors,false,JSON.stringify(lower.diagnostics));
  const managed=require('../../packages/compiler/src/spine/handler-ir-managed');
  const graphBuild=require('../../packages/compiler/src/project/reachable-graph-builder').buildReachableProjectGraph(entry,{rootDir:temp,workspaceRoot:root});
  const descriptors=lower.entries.map(e=>({version:managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,id:`${e.router}:${e.discriminator}`,role:managed.MANAGED_HANDLER_ROLE,origin:{file:e.loc.file,line:1,column:1},source:{file:e.handler.file,exportName:e.handler.exportName,localName:e.handler.localName},input:{kind:'schema-value',schemaId:e.inputSchema},result:{kind:'schema-value',schemaId:e.outputSchema}}));
  const bundle=managed.compileManagedHandlerNativeBundle(managed.compileManagedHandlerDescriptors({graphBuild,descriptors}));
  const project=require('../../packages/compiler/src/canonical-project-compiler').compileCanonicalProject(entry,{rootDir:temp,workspaceRoot:root,target:'native',schemas:{registry,maxBytes:24576}});
  const mcpBase=buildCanonicalNativePlan(project);
  function routePlan(count) {
    const declarations=Array.from({length:count},(_,i)=>`const result${i}=undefined;`).join('');
    const body=`export default async function handler(ctx){const input=ctx.decodeJson(ctx.req.header('input')??'${JSON.stringify(baseInput)}','proof.Input');${declarations}return ctx.json({runs:[${Array.from({length:count},(_,i)=>`result${i}`).join(',')}]},{schema:'proof.Runs'});}`;
    const plan=clone(buildCanonicalNativePlan(compileCanonicalSource(body,{target:'native',strict:true,schemaBundle,fileName:'route.ts'})));
    if(count){plan.callables=[callee];plan.binaryResources=callee.binaryResources;
      const input=plan.locals.find(l=>l.name==='input');
      for(const statement of plan.entry.body)if(statement.name?.startsWith('result')){statement.value={kind:'callable-call',index:0,argument:{kind:'local',id:input.id,valueKind:input.valueKind},valueKind:'object'};plan.summary.expressionCount++;}
    }
    return seal(plan);
  }
  function mcpPlan(count) {
    if(!count)return clone(mcpBase);
    const facts=clone(bundle), handler=facts.handlers[0]; handler.callableCount=1;
    const result=handler.body.statements.find(s=>s.kind==='schema-result');
    // Multiple bindings invoke one compiled body; no nested execution or new evaluator.
    handler.locals=Array.from({length:count-1},(_,i)=>({id:`proof-call-${i}`,name:`proofCall${i}`,binding:'value'}));
    handler.body.statements=Array.from({length:count-1},(_,i)=>({kind:'local',id:`proof-call-${i}`,initializer:{kind:'callable-call',index:0,argument:{kind:'input'}}})).concat({...result,expression:{kind:'callable-call',index:0,argument:{kind:'input'}}});
    const application=require('../../../packages/mcp/pulsewasm.native.cjs').buildMcpNativeApplication({plan:lower.artifact.plan,managedHandlerNativeBundle:facts,schemaBundle});
    application.source+='\n'+generateCallableSources([callee],{packageApplication:true});
    application.sourceHash=sha(application.source);application.callableIndices=[0];
    const plan=clone(mcpBase);plan.packages.application=application;plan.callables=[callee];plan.binaryResources=callee.binaryResources;
    return seal(plan);
  }
  function mcpRequest(input=baseInput){return {method:'POST',path:'/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'proof.run'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'proof.run',arguments:input}})};}
  const artifacts={};
  for(const kind of ['route','mcp'])for(const count of [0,1,2,16]){
    const plan=kind==='route'?routePlan(count):mcpPlan(count);
    const begin=performance.now(), native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
    const nodeMs=performance.now()-begin, fastBegin=performance.now();
    const fastly=fastlyCompile(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
    const fastlyMs=performance.now()-fastBegin;
    const request=kind==='mcp'?mcpRequest():{method:'GET',path:'/'};
    const n=await executeCanonicalNativeModule(native,{request}),f=fastlyExecute(fastly,{request});
    assert.equal(n.response.status,200);assert.equal(f.response.status,200);
    assert.deepEqual(JSON.parse(n.response.body),JSON.parse(f.response.body));
    const value=JSON.parse(n.response.body);
    if(kind==='route')assert.deepEqual(value,{runs:Array.from({length:count},()=>expected)});
    else assert.deepEqual(value.result.structuredContent,count?expected:{value:2,initial:0,word:''});
    const m={kind,callSites:count,calleeBodies:count?1:0,nodeBytes:native.wasm.length,fastlyBytes:fastly.wasm.length,nodeCompileMs:Math.round(nodeMs),fastlyCompileMs:Math.round(fastlyMs),nodeSha:sha(native.wasm),fastlySha:sha(fastly.wasm),nodeImports:WebAssembly.Module.imports(new WebAssembly.Module(native.wasm)),fastlyImports:WebAssembly.Module.imports(new WebAssembly.Module(fastly.wasm))};
    report.measurements.push(m);artifacts[kind+count]={plan,native,fastly};save();console.log(JSON.stringify({kind,callSites:count,nodeBytes:m.nodeBytes,fastlyBytes:m.fastlyBytes}));
    assert.equal((kind==='route'?native.source:plan.packages.application.source).includes('UNREACHABLE_CALLABLE_DATA'),false);
    if(!count && baseline){
      const file=write(`${kind}-zero-plan.json`,JSON.stringify(plan)),receipt=path.join(temp,`${kind}-baseline.json`);
      const script=`const fs=require('node:fs'),crypto=require('node:crypto');const p=JSON.parse(fs.readFileSync(process.argv[1]));const n=require('./wasm/packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(p,{cwd:process.cwd(),emitWat:false,reportCapture:false});const f=require('./packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(p,{cwd:process.cwd(),requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});const sha=b=>crypto.createHash('sha256').update(b).digest('hex');fs.writeFileSync(process.argv[2],JSON.stringify({nodeSha:sha(n.wasm),fastlySha:sha(f.wasm),nodeBytes:n.wasm.length,fastlyBytes:f.wasm.length}));`;
      execFileSync(process.execPath,['-e',script,file,receipt],{cwd:baseline,stdio:'pipe',timeout:120000});
      const b=JSON.parse(fs.readFileSync(receipt));assert.equal(m.nodeSha,b.nodeSha);assert.equal(m.fastlySha,b.fastlySha);m.baseline=b;m.zeroCost='byte-identical';save();
    }
  }
  // Independent JavaScript execution of the same authored computation.
  const fn=new Function(source.replace('export function query','return function query'))();
  const runtime=require('../../../packages/runtime/src/host');
  const codecs=createCanonicalSchemaCodecs(schemaBundle.registry),store=runtime.createBinaryResourceStore([{id:'data',bytes}]);
  for(const input of [baseInput,{...baseInput,value:7,offset:4,length:7},{...baseInput,length:0,offset:bytes.length}]){
    let js;
    await runtime.executeApplication(async ctx=>{js=fn(ctx,input);return ctx.text('ok');},new Request('https://proof.test/'),{schemaCodecs:codecs,binaryResources:store});
    for(const kind of ['route','mcp']){
      const request=kind==='route'?{method:'GET',path:'/',headers:{input:JSON.stringify(input)}}:mcpRequest(input);
      const a=artifacts[kind+'1'];
      for(const response of [(await executeCanonicalNativeModule(a.native,{request})).response,fastlyExecute(a.fastly,{request}).response]){
        const parsed=JSON.parse(response.body);assert.deepEqual(kind==='route'?parsed.runs[0]:parsed.result.structuredContent,js);
      }
    }
  }
  report.parityInputs=3;
  // Reuse helper borrow ownership: schema-bound input is immutable on all targets.
  for (const mutation of ['input.value+=1;', 'const alias=input;alias.value=3;', 'const box={input};box.input.value=3;']) assert.throws(()=>compileCallable(source.replace('const data=',mutation+'const data='),options));
  report.inputMutationRejections=3;
  const invalidCallee=compileCallable("export function query(ctx,input){return {value:'wrong',initial:0,word:''};}",options);
  const invalidPlan=routePlan(1);invalidPlan.callables=[invalidCallee];seal(invalidPlan);
  const invalidNative=compileCanonicalNativePlan(invalidPlan,{cwd:root,emitWat:false,reportCapture:false});
  const invalidFastly=fastlyCompile(invalidPlan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true});
  for(const run of [()=>executeCanonicalNativeModule(invalidNative,{}),()=>fastlyExecute(invalidFastly,{})]){let failed=false;try{failed=(await run()).response.status>=400;}catch{failed=true}assert.ok(failed);}
  report.outputSchemaRejections=2;
  for(const kind of ['route','mcp']){
    let ticks=0;const request=kind==='route'?{method:'GET',path:'/'}:mcpRequest();
    assert.equal(fastlyExecute(artifacts[kind+'1'].fastly,{request,monotonicClock:()=>({nanoseconds:BigInt(++ticks)*1000000n})}).response.status,200);
    const oneTicks=ticks,step=BigInt(Math.floor(5000000000/(oneTicks+5)));ticks=0;
    const expired=fastlyExecute(artifacts[kind+'16'].fastly,{request,monotonicClock:()=>({nanoseconds:BigInt(++ticks)*step})});
    assert.ok([408,504].includes(expired.response.status),'Fastly cumulative deadline '+kind);
  }
  report.fastlyDeadlines=2;

  for(const change of [{index:4},{index:0.5},{offset:-1},{offset:5,length:1},{offset:7,length:3},{value:'wrong'}]){
    const input={...baseInput,...change};
    for(const kind of ['route','mcp']){
      const request=kind==='route'?{method:'GET',path:'/',headers:{input:JSON.stringify(input)}}:mcpRequest(input),a=artifacts[kind+'1'];
      for(const run of [()=>executeCanonicalNativeModule(a.native,{request}),()=>fastlyExecute(a.fastly,{request})]){
        let rejected=false;try{const r=await run();rejected=r.response.status!==200 || JSON.parse(r.response.body).result?.isError===true;}catch{rejected=true}assert.ok(rejected,JSON.stringify({kind,change}));
      }
    }
  }
  report.runtimeRejections=24;
  for(const body of ["return ctx.text('bad');","return {value:ctx.req.path};","const x=await ctx.fetch('https://example.test').text();return {value:x};","return query(ctx,input);","for(let i=0;i<1025;i++){}return {};","const cells=ctx.workspace.numbers(1025);return {};","const data=ctx.resources.map('missing');return {value:data.readU8(0)};"]){assert.throws(()=>compileCallable(`export async function query(ctx,input){${body}}`,options));report.negativeSources++;}
  for(const mutate of [p=>p.callables[0].callable.inputSchema='unknown',p=>p.callables[0].callable.inputLocalId='missing',p=>p.callables[0].callable.version='wrong',p=>p.callables.push(clone(callee)),p=>replace(p.entry,e=>{if(e.kind==='callable-call')e.index=42}),p=>p.callables[0].callables=[clone(callee)],p=>p.callables[0].effects.push({kind:'fetch'}),p=>p.binaryResources.records[0].id='foreign']){
    const plan=clone(artifacts.route1.plan);mutate(plan);
    if(plan.callables[0] && !plan.callables[0].callables){const c=plan.callables[0];delete c.planHash;c.planHash=sha(require('../../packages/compiler/src/canonical-native-plan').stableStringify(c));}
    assert.throws(()=>seal(plan));report.forgedPlans++;
  }
  let ticks=0;const clock=()=>({now:()=>++ticks,setTimeout:()=>0,clearTimeout(){}});
  await executeCanonicalNativeModule(artifacts.route1.native,{request:{method:'GET',path:'/'},requestClock:clock(),maxDurationMs:10000});
  const oneCallTicks=ticks;ticks=0;
  let expired=false;try{const r=await executeCanonicalNativeModule(artifacts.route16.native,{request:{method:'GET',path:'/'},requestClock:clock(),maxDurationMs:oneCallTicks+5});expired=r.response.status>=400;}catch(e){expired=/DEADLINE|TIMEOUT/.test(e.code||'')}
  assert.ok(expired,'multiple calls must share the request deadline');report.deadline={oneCallTicks,expiredAfterTicks:ticks};
  const repeated=compileCanonicalNativePlan(artifacts.route1.plan,{cwd:root,emitWat:false,reportCapture:false});assert.equal(sha(repeated.wasm),sha(artifacts.route1.native.wasm));report.deterministicReplay=true;
  report.baseline=baseline?execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim():null;
  report.source={head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),modified:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim(),files:execFileSync('git',['ls-files','--modified','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(root,file)))}))};
  report.status='passed';save();console.log(JSON.stringify({status:report.status,negativeSources:report.negativeSources,forgedPlans:report.forgedPlans,deadline:report.deadline}));
}
main().catch(e=>{report.status='failed';report.error={message:e.message,diagnostics:e.diagnostics,detail:e.detail};save();console.error(e,e.diagnostics,e.detail);process.exitCode=1}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
