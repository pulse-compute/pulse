'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { collectInventory } = require('../../packages/cli/src/internal/report/inventory');
const { addSizeEvidence } = require('../../packages/cli/src/internal/report/size');
const { serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');
const source = `import {Router} from '@pulse-compute/runtime'; const app=new Router();const shared=async ctx=>ctx.text('shared handler');
app.get('/shared-a',shared);app.get('/shared-b',shared);app.get('/duplicate-a',async ctx=>ctx.text('identical body'));
app.get('/duplicate-b',async ctx=>ctx.text('identical body'));app.get('/distinct',async ctx=>ctx.text('different body',{status:201}));export default app;`;
const router = compileCanonicalRouterSource(source, {fileName:'src/index.ts',rootDir:root});
const compiled = compileCanonicalSource(router.sourceText,{fileName:'src/index.ts',rootDir:root,strict:false,
  compilerPrelude:router.compilerPrelude,compilerOwnedCalls:router.compilerOwnedCalls,internalGeneratedHandler:true,metadataExtensions:{router:router.metadata}});
assert.equal(compiled.ok,true,JSON.stringify(compiled.diagnostics));
const plan=buildCanonicalNativePlan(compiled);
function build(target, capture, optimization) {
  const file=path.join(root,target==='portable'?'wasm/packages/compiler/src/canonical-native-compiler.js':'packages/provider-fastly/src/build/native-platform-capabilities.js');
  const owner=new Module(file,module);owner.filename=file;owner.paths=Module._nodeModulePaths(path.dirname(file));
  const original=owner.require.bind(owner);let ascCalls=0,generatorCalls=0;
  owner.require=name=>name==='node:child_process'?{...original(name),spawnSync(executable,args,options){
    assert.match(args[0],/asc\.js$/);assert.ok(!args.includes('--debug'));ascCalls++;return spawnSync(executable,args,options);
  }}:name==='@pulse-compute/wasm-runtime-core-as/compiler/canonical-native'?{...original(name),generateCanonicalNativeAssemblyScript(...args){generatorCalls++;return original(name).generateCanonicalNativeAssemblyScript(...args);}}:original(name);
  owner._compile(fs.readFileSync(file,'utf8'),file);
  const options={cwd:root,reportCapture:capture,nativeOptimization:optimization,emitWat:false,bindings:{},canonicalBuild:true,requirePlatformCapability:false};
  const start=Date.now();
  const artifact=target==='portable'?owner.exports.compileCanonicalNativePlan(plan,options):owner.exports.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  assert.equal(ascCalls,1);assert.equal(generatorCalls,1);
  return {artifact,ms:Date.now()-start};
}
async function main(){
  const cells=[];
  for(const [target,optimization] of [['portable',undefined],['fastly',undefined],['portable','experimental-native-size']]){
    const control=build(target,false,optimization), observed=build(target,true,optimization), a=observed.artifact;
    assert.deepEqual(a.wasm,control.artifact.wasm,'all executable bytes unchanged, including custom sections');
    assert.equal(a.source,control.artifact.source);assert.equal(control.artifact.reportAttribution,null);
    const capture=a.reportAttribution;assert.ok(capture,'passive capture available');
    const record={id:capture.artifactId,sha256:capture.artifactSha256,bytes:a.wasm.length,stage:'final',target};
    const seed=collectInventory({root,provider:target==='portable'?'node':'fastly'}, {compiled,plan,native:a},[record],record.id,optimization||'default');
    const before=process.memoryUsage().rss,start=Date.now();
    const capsule=addSizeEvidence(seed,new Map([[record.id,a.wasm]]),capture);
    const collectionMs=Date.now()-start, collectionRssDelta=process.memoryUsage().rss-before;
    const direct=capsule.measurements.filter(row=>row.metric==='handler-body');
    assert.equal(direct.length,5);assert.ok(direct.every(row=>row.fact.state==='available'&&row.fact.coverage==='exact'));
    assert.ok(capsule.measurements.filter(row=>row.metric==='reachable').every(row=>row.fact.state==='available'&&row.fact.coverage==='bounded'));
    assert.ok(capsule.measurements.filter(row=>['own','shared'].includes(row.metric)).every(row=>row.fact.value===null));
    assert.equal(8+capsule.artifacts[0].sections.reduce((n,row)=>n+row.bytes,0),a.wasm.length);
    assert.ok(!serializeCapsule(capsule).includes('__pulse_chunk_'));
    let executions=0;
    for(const [route,body,status] of [['/shared-a','shared handler',200],['/shared-b','shared handler',200],['/duplicate-a','identical body',200],['/duplicate-b','identical body',200],['/distinct','different body',201]]){
      const response=target==='fastly'?require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities(a,{request:{path:route}}).response:
        (await require('../../packages/host-runtime/src/runtime/canonical-native-host').executeCanonicalNativeModule(a,{providerAdapter:require('../../../packages/provider-node/src/runtime/canonical-api-runtime').createNodeProviderAdapter({}),request:{path:route}})).response;
      assert.equal(response.body,body);assert.equal(response.status,status);executions++;
    }
    cells.push({target,optimization:optimization||'default',bytes:a.wasm.length,sha256:capture.artifactSha256,unchanged:true,ascCalls:2,generatorCalls:2,
      controlMs:control.ms,captureMs:observed.ms,collectionMs,collectionRssDelta,processMaxRssKiB:process.resourceUsage().maxRSS,
      capsuleBytes:Buffer.byteLength(serializeCapsule(capsule)),sidecarBytes:Buffer.byteLength(JSON.stringify(capture)),mappedRoutes:direct.length,
      directUniqueBytes:[...new Set(direct.flatMap(row=>row.bodyIds))].reduce((n,id)=>n+capsule.bodies.find(row=>row.id===id).bytes,0),executions});
  }
  const result={status:'passed',cells,notes:'Paired builds are a test only. Report performs no compile or disassembly. RSS and timings are diagnostic, not a benchmark guarantee.'};
  if(process.env.PRPT03_PROOF_FILE)fs.writeFileSync(process.env.PRPT03_PROOF_FILE,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
