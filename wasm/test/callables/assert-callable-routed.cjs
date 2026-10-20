'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { buildJavascriptApplicationPlan } = require('../../packages/compiler/src/javascript-application-plan');
const { loadJavascriptApplication } = require('../../packages/cli/src/typescript-module-loader');
const { writeNodeJavascriptSourcePackage } = require('../../../packages/provider-node/src/javascript/source-package');
const node = require('../../../packages/provider-node/src/javascript/runtime-host');
const runtime = require('../../../packages/runtime/src/host');
const { createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const R = require('../../packages/contracts/src/resources/embedded');
const { compileFastlyNativePlatformCapabilitiesPlan: fastlyCompile } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: fastlyExecute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const baseline = process.argv[2] && path.resolve(process.argv[2]);
const output = process.argv[3] && path.resolve(process.argv[3]);
const report = {status:'running',measurements:[],rejections:[],baseline:[]};
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const save = () => { if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n'); };
const measure = artifact => ({bytes:artifact.wasm.length,sha256:sha(artifact.wasm),imports:WebAssembly.Module.imports(new WebAssembly.Module(artifact.wasm))});
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-call-routed-'));
const write = (file, source) => fs.writeFileSync(path.join(cwd,file),source);
const pair = "{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
const bytes = Buffer.from('ABCD雪😀');
const budgets = {files:1,bindings:1,fileBytes:128,totalBytes:128,serializedBytes:4096};
const resources = R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{path:'/data',bytes}],budgets)),[{id:'data',path:'/data'}],budgets);
async function main() {
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for (const [name,folder] of [['pulse','packages/pulse'],['runtime','packages/runtime'],['mcp','packages/mcp'],['entities','packages/entities'],['wasm-contracts','wasm/packages/contracts']])
    fs.symlinkSync(path.join(root,folder),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  write('schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
interface Input {value:number} interface Output {value:number;word:string}
export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>()}});`);
  const registry = require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'schemas.ts'),{projectRoot:cwd}).registry;
  const options = {rootDir:cwd,workspaceRoot:root,strict:true,schemas:{registry,maxBytes:4096},binaryResources:resources};
  write('helper.ts',`export function twice(value:number):number{return value*2;}`);
  write('query.ts',`import {twice} from './helper';
export function query(ctx,input){const data=ctx.resources.map('data');const cells=ctx.workspace.numbers(4);let sum=0;
for(let i=0;i<4;i++){cells[i]=data.readU8(i);sum+=cells[i];}return {value:sum+twice(input.value),word:data.readUtf8(4,7)};}`);
  write('barrel.ts',"export {query as lookup} from './query';");
  const route = `import {lookup} from './barrel';export async function route(ctx){
const input=ctx.decodeJson(ctx.req.header('input'),'proof.Input');const result=ctx.call(lookup,input,${pair});return ctx.json(result,{schema:'proof.Output'});}`;
  write('route.ts',route);
  const operation = `import {lookup} from './barrel';export async function operation(ctx,input){return ctx.call(lookup,input,${pair});}
export async function unused(ctx,input){return ctx.call(lookup,missing(),{inputSchema:'missing',outputSchema:'missing'});}`;
  write('operation.ts',operation);
  const sources = {
    router:`import {Router} from '@pulse-compute/runtime';import {route} from './route';const app=new Router();app.get('/compute',route);export default app;`,
    mcp:`import {EntityRouter,jsonRpc,mcp} from '@pulse-compute/mcp/pulse';import {operation} from './operation';
const rpc=new EntityRouter({adapter:jsonRpc({namedParamsOnly:true})});rpc.on('proof.run',{input:'proof.Input',output:'proof.Output'},operation);
const server=mcp({router:rpc});export default async function handler(ctx){return server.handle(ctx);}`
  };
  let executions=0;
  for(const [kind,source] of Object.entries(sources)) {
    write('index.ts',source);
    const compiled=compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'});
    const plan=buildCanonicalNativePlan(compiled);
    assert.equal(plan.callables.length,1);
    assert.equal(compiled.callableSource.sites.length,1);
    const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
    const fastly=fastlyCompile(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
    report.measurements.push({kind,name:'authored',node:measure(native),fastly:measure(fastly)});save();
    if(kind==='mcp'){assert.deepEqual(plan.packages.application.callableIndices,[0]);assert(!plan.packages.application.source.includes('missing'));}
    const js=buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node'});
    assert.equal(js.callables.bindings.length,1);
    const application=loadJavascriptApplication(js,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,
      bindCallables:runtime.bindCallableApplication,allowedPackages:{'@pulse-compute/mcp/pulse':require('../../../packages/mcp/src/pulse.js')}}).application;
    const packaged=writeNodeJavascriptSourcePackage({plan:js,projectRoot:cwd,outDir:path.join(cwd,kind+'-dist'),schemaBundle:compiled.schema.bundle,binaryResources:resources});
    const apps=[application,require(packaged.entryFile)];
    const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
    for(const value of [0,3,-2]) {
      const input={value};
      const request=kind==='router'?{method:'GET',path:'/compute',headers:{input:JSON.stringify(input)}}:{method:'POST',path:'/mcp',
        headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'proof.run'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name:'proof.run',arguments:input}})};
      const responses=[(await executeCanonicalNativeModule(native,{request,providerAdapter:createNodeProviderAdapter({}),maxDurationMs:5000})).response,
        fastlyExecute(fastly,{request}).response];
      for(const app of apps){const response=await node.executeNodeJavascriptApplication(app,new Request('https://call.test'+request.path,{method:request.method,headers:request.headers,...(request.body?{body:request.body}:{})}),
        {schemaCodecs,binaryResources:runtime.createBinaryResourceStore([{id:'data',bytes}]),strict:true});responses.push({status:response.status,body:await response.text()});}
      for(const response of responses){assert.equal(response.status,200,response.body);const body=JSON.parse(response.body);
        assert.deepEqual(kind==='router'?body:body.result.structuredContent,{value:266+value*2,word:'雪😀'});executions++;}
    }
    console.log(JSON.stringify({kind,executions,nodeBytes:native.wasm.length,fastlyBytes:fastly.wasm.length}));
  }
  // Each selected caller retains full source admission. Dormant operations do
  // not contribute invalid calls, schema IDs, or emitted computation bodies.
  for(const kind of ['router','mcp']) {
    const file=kind==='router'?'route.ts':'operation.ts', original=kind==='router'?route:operation;
    write('index.ts',sources[kind]);
    for(const [name,bad] of [
      ['await',original.replace('ctx.call(lookup,input,','await ctx.call(lookup,input,')],
      ['dynamic target',original.replace('ctx.call(lookup,input,','ctx.call(choose(),input,')],
      ['unknown schema',original.replace("inputSchema:'proof.Input'","inputSchema:'unknown'")],
      ['context escape',original.replace('ctx.call(lookup,input,','ctx.call(lookup,{value:escape(ctx)},')],
      ['indirect',original.replace('ctx.call(lookup,input,','ctx["call"](lookup,input,')]
    ]) {
      write(file,bad);
      for(const target of ['native','javascript']) assert.throws(()=>compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target}),error=>Boolean(error.diagnostics?.length),kind+' '+name+' '+target);
      report.rejections.push(kind+': '+name);
    }
    write(file,original);
  }
  // No-call JavaScript keeps its ordinary source contract, including computed
  // context access. Non-simple contexts still cannot opt into callable execution.
  write('index.ts',"export default async function handler(ctx){return ctx['text']('ordinary');}");
  assert.equal(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'javascript'}).callableSource,undefined);
  for(const parameter of ['ctx = {}','ctx?']) {
    write('index.ts',`import {lookup} from './barrel';export default async function handler(${parameter}){const result=ctx.call(lookup,{value:1},${pair});return ctx.json(result,{schema:'proof.Output'});}`);
    for(const target of ['native','javascript']) assert.throws(()=>compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target}),error=>error.code==='PULSE_CALL_SOURCE_CONTEXT');
  }
  // Reusing a reachable route must not require duplicate callable bodies.
  write('index.ts',sources.router.replace("export default app;","app.get('/again',route);export default app;"));
  const reused=buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'}));
  assert.equal(reused.callables.length,1);
  assert.equal(buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node'}).callables.bindings[0].maxCalls,2);
  write('index.ts',sources.router.replace('export default app;',Array.from({length:16},(_,i)=>`app.get('/repeat-${i}',route);`).join('')+'export default app;'));
  for(const target of ['native','javascript']) assert.throws(()=>compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target}),error=>error.code==='PULSE_CALL_SOURCE_LIMIT');
  report.rejections.push('reused Router occurrence limit');
  write('conflict.ts',route.replace('function route','function conflict').replace("outputSchema:'proof.Output'","outputSchema:'proof.Input'"));
  write('index.ts',sources.router.replace("import {route}","import {conflict} from './conflict';import {route}").replace('export default app;',"app.get('/conflict',conflict);export default app;"));
  for(const target of ['native','javascript']) assert.throws(()=>compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target}),error=>error.code==='PULSE_CALL_SOURCE_SCHEMA_CONFLICT');
  report.rejections.push('cross-caller schema conflict');
  write('index.ts',`import {Router} from '@pulse-compute/runtime';import {lookup} from './barrel';const app=new Router();
app.get('/inline',async (ctx)=>{const result=ctx.call(lookup,{value:3},${pair});return ctx.json(result,{schema:'proof.Output'});});export default app;`);
  assert.equal(buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'})).callables.length,1);
  // Distinct source modules bind distinct targets to the same Router object.
  write('other-query.ts',`export function other(ctx,input){return {value:input.value,word:'other'};}`);
  write('other-route.ts',route.replace("import {lookup} from './barrel'","import {other as lookup} from './other-query'").replace('function route','function otherRoute'));
  write('index.ts',sources.router.replace("import {route}","import {otherRoute} from './other-route';import {route}").replace('export default app;',"app.get('/other',otherRoute);export default app;"));
  const multiple=buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node'});
  assert.equal(new Set(multiple.callables.bindings.map(binding=>binding.modulePath)).size,2);
  const multiCompiled=compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'});
  assert.equal(buildCanonicalNativePlan(multiCompiled).callables.length,2);
  const multiPackage=writeNodeJavascriptSourcePackage({plan:multiple,projectRoot:cwd,outDir:path.join(cwd,'multi-dist'),schemaBundle:multiCompiled.schema.bundle,binaryResources:resources});
  const multiApps=[loadJavascriptApplication(multiple,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,bindCallables:runtime.bindCallableApplication}).application,require(multiPackage.entryFile)];
  for(const app of multiApps)for(const routePath of ['/compute','/other']) {
    const response=await node.executeNodeJavascriptApplication(app,new Request('https://call.test'+routePath,{headers:{input:'{"value":3}'}}),
      {schemaCodecs:createCanonicalSchemaCodecs(multiCompiled.schema.bundle.registry),binaryResources:runtime.createBinaryResourceStore([{id:'data',bytes}]),strict:true});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),routePath==='/compute'?{value:272,word:'雪😀'}:{value:3,word:'other'});executions++;
  }
  // Same-source no-call builds and imported-unused call-free plans must remain
  // byte-identical to the untouched compiler/backend, including plan hashes.
  for(const kind of ['router','mcp']) {
    write('index.ts',sources[kind]);
    const file=kind==='router'?'route.ts':'operation.ts';
    const noCall=kind==='router'?`export async function route(ctx){return ctx.json({value:1,word:'plain'},{schema:'proof.Output'});}`
      :`export async function operation(ctx,input){return {value:input.value,word:'plain'};}`;
    let zero;
    for(const unused of [false,true]) {
      write(file,(unused?"import {unused} from './unused';":"")+noCall);
      write('unused.ts',`export function unused(ctx,input){return ctx.fetch('https://never.test');}`);
      const plan=buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'}));
      assert.equal(plan.callables,undefined);assert.equal(plan.binaryResources,undefined);
      assert.equal(buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node'}).callables,undefined);
      const artifacts={node:compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false}),fastly:fastlyCompile(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000})};
      const record={kind,name:unused?'imported-unused':'no-call',node:measure(artifacts.node),fastly:measure(artifacts.fastly)};
      report.measurements.push(record);
      if(unused)for(const target of ['node','fastly']){assert.equal(record[target].bytes,zero[target].bytes);assert.deepEqual(record[target].imports,zero[target].imports);}else zero=record;
      if(baseline) {
        write('options.json',JSON.stringify({...options,workspaceRoot:baseline,target:'native'}));write('plan.json',JSON.stringify(plan));
        const expression=unused?"JSON.parse(fs.readFileSync(process.argv[1]))":"require('./wasm/packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(require('./wasm/packages/compiler/src/canonical-project-compiler').compileCanonicalProject(process.argv[1],options))";
        const script=`const fs=require('fs'),crypto=require('crypto');const root=process.cwd(),options=JSON.parse(fs.readFileSync(process.argv[2]));const p=${expression};
const artifacts={node:require('./wasm/packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(p,{cwd:root,emitWat:false,reportCapture:false}),fastly:require('./packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(p,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000})};const result={};
for(const [target,a]of Object.entries(artifacts))result[target]={bytes:a.wasm.length,sha256:crypto.createHash('sha256').update(a.wasm).digest('hex'),imports:WebAssembly.Module.imports(new WebAssembly.Module(a.wasm))};fs.writeFileSync(process.argv[3],JSON.stringify(result));`;
        execFileSync(process.execPath,['-e',script,path.join(cwd,unused?'plan.json':'index.ts'),path.join(cwd,'options.json'),path.join(cwd,'baseline.json')],{cwd:baseline,stdio:'pipe',timeout:180000});
        const original=JSON.parse(fs.readFileSync(path.join(cwd,'baseline.json')));
        for(const target of ['node','fastly'])assert.deepEqual(record[target],original[target]);
        report.baseline.push({kind,name:record.name,mode:unused?'same call-free plan, untouched backend':'same source, untouched project compiler',...original});
      }
      save();
    }
  }
  report.status='passed';report.executions=executions;
  report.source={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim()};
  report.baselineRevision=baseline?execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim():null;save();
  console.log(JSON.stringify({status:report.status,executions,rejections:report.rejections.length,baseline:report.baselineRevision}));
}
main().catch(error=>{report.status='failed';report.error={message:error.message,diagnostics:error.diagnostics};save();console.error(error,error.diagnostics,error.cause);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
