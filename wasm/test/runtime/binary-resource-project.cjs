'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const R=require('../../packages/contracts/src/resources/embedded');
const {resolveProject,projectSnapshot}=require('../../packages/cli/src/project-config');
const {compileNativeProjectInMemory,prepareJavascriptApplication,buildProject}=require('../../packages/cli/src/project-execution');
const host=require('../../packages/host-runtime/src/runtime/canonical-native-host');
const runtime=require('../../../packages/runtime/src/host');
const node=require('../../../packages/provider-node/src/javascript/runtime-host');
const fastly=require('../../../packages/provider-fastly/src/javascript/test-runtime');
const root=path.resolve(__dirname,'../../..');
async function main(){
 const parent=path.join(root,'wasm/.test-results');fs.mkdirSync(parent,{recursive:true});
 const cwd=fs.mkdtempSync(path.join(parent,'binary-resource-project-'));
 try {
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const name of ['pulse','runtime']) fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  fs.mkdirSync(path.join(cwd,'.pulse'));fs.mkdirSync(path.join(cwd,'src'));
  const budgets={files:1,fileBytes:32,totalBytes:32,serializedBytes:2048,bindings:1};
  const manifest=JSON.stringify(R.createResourceManifest([{path:'/data',bytes:Uint8Array.of(42,0,0,0)}],budgets));
  const config={pulse:{entry:'src/index.ts',schema:'src/schemas.ts',tests:null,strict:false,binaryResources:{manifest,bindings:{data:'/data'},budgets}},n:{host:'node',target:'native'},j:{host:'node',target:'javascript'},f:{host:'fastly',target:'javascript'}};
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import { defineConfig } from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
  fs.writeFileSync(path.join(cwd,'src/schemas.ts'),`import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';export interface Value { value: number };export default defineSchemaRegistry({schemas:{'resource.Value':schema<Value>()}});`);
  fs.writeFileSync(path.join(cwd,'src/index.ts'),`import { Pulse } from '@pulse-compute/pulse';function bump(value:number):number{return value+1;}const app=new Pulse({auto:true});app.use(async (ctx,next)=>{ctx.state.set('resource','yes');return next();});app.get('/',async ctx=>{const data=ctx.resources.map('data');const decoded=ctx.decodeJson('{\"value\":0}','resource.Value');return ctx.text(ctx.encodeJson({value:bump(data.readU32LE(0))+decoded.value-1},'resource.Value'));});app.error(async (error,ctx,next)=>ctx.text('unexpected',{status:500}));export default app;`);
  const native=compileNativeProjectInMemory(resolveProject({cwd,profile:'n'}),{emitWat:false,reportCapture:false});
  assert.equal((await host.executeCanonicalNativeModule(native.native,{strict:false})).response.body,'{"value":42}');
  const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(native.compiled.schema.bundle.registry);
  const fastlyNative=require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(native.plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true});
  assert.equal(require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities(fastlyNative,{}).response.body,'{"value":42}');
  const allowedPackages={'@pulse-compute/pulse':require('../../../packages/pulse/src/index'),'@pulse-compute/runtime':require('../../../packages/runtime/src/index')};
  for(const profile of ['j','f']){
   const project=resolveProject({cwd,profile}), prepared=prepareJavascriptApplication(project,{allowedPackages,localEmulation:true,schemaBundle:native.compiled.schema.bundle});
   const result=profile==='j'?await node.executeNodeJavascriptApplication(prepared.loaded.application,new Request('http://localhost/'),{strict:false,schemaCodecs}):(await fastly.executeFastlyJavascriptLocalRequest(prepared.loaded.application,new Request('http://localhost/'),{strict:false,schemaCodecs})).response;
   assert.equal(await result.text(),'{"value":42}',profile+' loaded project');
   const built=buildProject(project,{reportCapture:false});assert.equal(built.status,'built');
   if(profile==='j'){
    const app=require(path.join(built.outDir,'index.cjs'));
    assert.equal(await (await runtime.executeApplication(app,new Request('http://localhost/'),{schemaCodecs})).text(),'{"value":42}','built source package');
   }else{
    const source=fs.readFileSync(path.join(built.outDir,'src/application.js'),'utf8');assert(source.includes('bindBinaryResources'));
    const ts=require('typescript'), Module=require('node:module');
    const file=path.join(built.outDir,'packaged-local.cjs'), loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;
    loaded._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
    const packaged=loaded.exports;
    assert.equal(await (await packaged.createFastlyJavascriptHandler(packaged.application,{schemaCodecs:packaged.schemaCodecs})(new Request('http://localhost/'))).text(),'{"value":42}','built Fastly source package, injected local execution');
   }
  }
  fs.writeFileSync(path.join(cwd,'src/index.ts'),`import { Pulse } from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.on('resource.read',{schema:null},async ctx=>{const data=ctx.resources.map('data');if(data.readU8(0)!==42){ctx.state.set('bad',''+data.readU8(-1));}});export default app;`);
  const eventBuild=compileNativeProjectInMemory(resolveProject({cwd,profile:'n'}),{emitWat:false,reportCapture:false});
  const eventApp=prepareJavascriptApplication(resolveProject({cwd,profile:'j'}),{allowedPackages,schemaBundle:eventBuild.compiled.schema.bundle}).loaded.application;
  const frame={version:'pulse.event-frame.v1',type:'resource.read',schemaId:null};
  for(const execute of [options=>host.executeCanonicalNativeEvent(eventBuild.native,frame,options),options=>node.executeNodeJavascriptEvent(eventApp,frame,options)]){
    assert.equal((await execute({})).status,'completed');
    const controller=new AbortController();controller.abort();assert.equal((await execute({signal:controller.signal})).status,'failed');
  }
  console.log('ok - conventional configuration, source packaging, composed schema/middleware/error handling, and Node event reads');
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e.message,e.diagnostics||e.detail||e.stack);process.exitCode=1;});
