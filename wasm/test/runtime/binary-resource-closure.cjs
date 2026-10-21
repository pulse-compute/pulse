'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixture,writeProject,physical}=require('./binary-resource-closure-fixture.cjs');
const R=require('../../packages/contracts/src/resources/embedded');
const root=path.resolve(__dirname,'../../..');
async function main(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-resource-closure-')),data=fixture();
 try{
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const [name,dir] of [['pulse','packages/pulse'],['runtime','packages/runtime'],['wasm-contracts','wasm/packages/contracts']])fs.symlinkSync(path.join(root,dir),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({name:'resource-closure',version:'1.0.0',private:true,dependencies:Object.fromEntries(['pulse','runtime','wasm-contracts'].map(name=>['@pulse-compute/'+name,require(path.join(cwd,'node_modules/@pulse-compute',name,'package.json')).version]))}));writeProject(cwd,data);
  // Cross-check the independently constructed manifest, including exact budgets.
  assert.equal(JSON.stringify(R.createResourceManifest(data.inputs.map(([path,bytes])=>({path,bytes})),data.budgets)),data.serialized);
  const resources=R.admitResourceCatalogue(data.serialized,Object.entries(data.bindings).map(([id,path])=>({id,path})),data.budgets);
  const registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'src/schemas.ts'),{projectRoot:cwd}).registry;
  const options={rootDir:cwd,workspaceRoot:root,target:'native',strict:true,schemas:{registry,maxBytes:4096},binaryResources:resources};
  const compiled=require('../../packages/compiler/src/canonical-project-compiler').compileCanonicalProject(path.join(cwd,'src/index.ts'),options);
  const plan=require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(compiled);
  assert.equal(plan.callables.length,2);assert.deepEqual(plan.binaryResources.records.map(r=>r.id),['alias','copy','distinct','empty','shared']);
  assert.equal(plan.binaryResources.blobs.length,3);assert.equal(plan.binaryResources.backingBytes,data.shared.length+data.distinct.length);
  assert.equal(plan.binaryResources.source.recordCount,5);assert.equal(resources.records.length,6);
  const native=require('../../packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
  const fastly=require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true});
  const jsPlan=require('../../packages/compiler/src/javascript-application-plan').buildJavascriptApplicationPlan(path.join(cwd,'src/index.ts'),{...options,provider:'node'});
  const packed=require('../../../packages/provider-node/src/javascript/source-package').writeNodeJavascriptSourcePackage({plan:jsPlan,projectRoot:cwd,outDir:path.join(cwd,'js'),schemaBundle:compiled.schema.bundle,binaryResources:resources});
  // Delete the complete authored graph and original binaries before loading any executable.
  for(const name of ['src','.pulse','inputs'])fs.rmSync(path.join(cwd,name),{recursive:true});
  const app=require(packed.entryFile);
  const packageSource=fs.readFileSync(packed.entryFile,'utf8');
  for(const bytes of [data.shared,data.distinct,data.unused])assert.equal(packageSource.split(bytes.toString('base64')).length-1,1,'one encoded JS backing per equal byte identity');
  const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(registry);
  const report={version:'pulse.generic-resource-closure.v1',status:'passed',providerReality:false,sourceInputsRemoved:true,declaredBindings:resources.records.length,selectedBindings:plan.binaryResources.records.length,selectedUniqueBackingCount:plan.binaryResources.blobs.length,rawManifestBytes:data.manifest.byteLength,serializedManifestBytes:Buffer.byteLength(data.serialized),selectedBackingBytes:plan.binaryResources.backingBytes,serializedNativePlanBytes:Buffer.byteLength(JSON.stringify(plan)),targets:{}};
  for(const [target,artifact] of [['node-native',native],['fastly-native-injected',fastly]]){
   const measured=physical(artifact.wasm,data);assert.deepEqual(measured.physicalCopies,{shared:1,distinct:1,unused:0});report.targets[target]=measured;
   let previous;
   for(let i=0;i<3;i++){
    const r=target==='node-native'?await require('../../packages/host-runtime/src/runtime/canonical-native-host').executeCanonicalNativeModule(artifact,{}):require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities(artifact,{});
    assert.equal(r.response.status,200);assert.deepEqual(JSON.parse(r.response.body),data.expected);
    const memory={linearMemoryBytes:r.guestMemoryBytes,retainedBudget:r.memory};if(previous)assert.deepEqual(memory,previous);previous=memory;
   }
   measured.execution=previous;measured.requests=3;
  }
  for(let i=0;i<3;i++){const r=await require('../../../packages/provider-node/src/javascript/runtime-host').executeNodeJavascriptApplication(app,new Request('https://resource.test/'),{schemaCodecs});assert.equal(r.status,200);assert.deepEqual(await r.json(),data.expected);}
  report.targets['node-javascript']={requests:3,originalSourcesRemoved:true,declaredBindings:resources.records.length,declaredUniqueBackingCount:resources.blobs.length,declaredBackingBytes:resources.backingBytes,entryArtifactBytes:Buffer.byteLength(packageSource),unusedConfiguredBackingRetained:true,physicalBackingMemoryBytes:null,note:'Private JS store backing is not directly observable; catalogue deduplication is not a heap measurement.'};
  console.log(JSON.stringify(report));return report;
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e,e.diagnostics,e.detail?.stderr);process.exitCode=1;});
