'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const root=path.resolve(__dirname,'../../..');
const fixture=path.join(root,'wasm/test/fixtures/projects/callable-public');
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-call-public-'));
const {compileCanonicalProject}=require('../../packages/compiler/src/canonical-project-compiler');
const {buildCanonicalNativePlan,validateCanonicalNativePlan,stableStringify}=require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-compiler');
const {executeCanonicalNativeModule}=require('../../packages/host-runtime/src/runtime/canonical-native-host');
const {buildJavascriptApplicationPlan}=require('../../packages/compiler/src/javascript-application-plan');
const {normalizeJavascriptApplicationPlan,javascriptCallableSource}=require('../../packages/contracts/src/project/javascript-application');
const {CALLABLE_COMPUTATION_VERSION}=require('../../packages/contracts/src/handler/surface-contract');
const {DIAGNOSTIC_CATALOG,describeDiagnostic}=require('../../packages/cli/src/diagnostics');
const {loadJavascriptApplication}=require('../../packages/cli/src/typescript-module-loader');
const node=require('../../../packages/provider-node/src/javascript/runtime-host');
const runtime=require('../../../packages/runtime/src/host');
const {createCanonicalSchemaCodecs}=require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const {compileFastlyNativePlatformCapabilitiesPlan}=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities}=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function rehash(plan){delete plan.planHash;plan.planHash=sha(stableStringify(plan));return plan;}
async function main(){
  const packed=[];
  fs.cpSync(fixture,cwd,{recursive:true});
  // Real tarballs and normal package exports, with no workspace TS path aliases.
  for(const name of ['runtime','pulse']){
    const folder=path.join(root,'packages',name);
    const data=JSON.parse(execFileSync('npm',['pack',folder,'--ignore-scripts','--json','--pack-destination',cwd],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
    const target=path.join(cwd,'node_modules/@pulse-compute',name);fs.mkdirSync(target,{recursive:true});
    execFileSync('tar',['-xzf',path.join(cwd,data.filename),'--strip-components=1','-C',target]);
    const actual=fs.readFileSync(path.join(target,'src/index.d.ts'));
    assert.deepEqual(actual,fs.readFileSync(path.join(folder,'src/index.d.ts')));
    packed.push({name,sha256:sha(fs.readFileSync(path.join(cwd,data.filename))),typesSha256:sha(actual)});
    for(const file of ['canon-types.ts','canon-types-negative.ts']){
      const text=fs.readFileSync(path.join(folder,'test',file),'utf8').replaceAll("'../src/index.js'","'@pulse-compute/"+name+"'").replaceAll("'../src/schema.js'","'@pulse-compute/pulse/schema'");
      fs.writeFileSync(path.join(cwd,name+'-'+file),text);
    }
  }
  const types=ts.createProgram({rootNames:['src/index.ts','src/compute.ts','.pulse/schema.ts','runtime-canon-types.ts','runtime-canon-types-negative.ts','pulse-canon-types.ts','pulse-canon-types-negative.ts'].map(p=>path.join(cwd,p)),options:{strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:false,types:[]}});
  assert.deepEqual(ts.getPreEmitDiagnostics(types).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],'packed public declarations and positive/negative authoring fixtures');
  const registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(fixture,'.pulse/schema.ts'),{projectRoot:fixture}).registry;
  const options={rootDir:fixture,workspaceRoot:root,strict:true,schemas:{registry,maxBytes:4096}};
  const compiled=compileCanonicalProject(path.join(fixture,'src/index.ts'),{...options,target:'native'});
  const plan=buildCanonicalNativePlan(compiled);
  assert.equal(plan.callables[0].callable.version,CALLABLE_COMPUTATION_VERSION);
  const stale=JSON.parse(JSON.stringify(plan));stale.callables[0].callable.version='pulse.callable-proof.v1';rehash(stale.callables[0]);rehash(stale);
  assert.throws(()=>validateCanonicalNativePlan(stale),error=>error.diagnostics?.some(d=>/callable/.test(d.message)));
  const js=buildJavascriptApplicationPlan(path.join(fixture,'src/index.ts'),{...options,provider:'node'});
  assert.equal(js.callables.version,CALLABLE_COMPUTATION_VERSION);
  const normalize = plan => normalizeJavascriptApplicationPlan({...plan,...plan.graph,
    entryModuleId:plan.graph.entryModuleId,entryPath:plan.workspace.entry,
    graphVersion:plan.graph.version});
  assert.equal(normalize(js).callables.version,CALLABLE_COMPUTATION_VERSION);
  for(const version of [undefined,'pulse.callable-proof.v1']){
    const oldJs=JSON.parse(JSON.stringify(js));oldJs.callables.version=version;rehash(oldJs);
    assert.throws(()=>normalize(oldJs),/callable version/);
    assert.throws(()=>loadJavascriptApplication(oldJs,{workspaceRoot:fixture}),{code:'PULSE_JAVASCRIPT_APPLICATION_PLAN_INVALID'});
    assert.throws(()=>javascriptCallableSource(oldJs,'src/index.ts',''),/callable version/);
  }
  assert.throws(()=>buildJavascriptApplicationPlan(path.join(fixture,'src/index.ts'),{...options,provider:'fastly'}),{code:'PULSE_CALL_SOURCE_PROVIDER'});
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
  const fastly=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true});
  const application=loadJavascriptApplication(js,{workspaceRoot:fixture,validateApplication:node.assertNodeJavascriptApplication,bindCallables:runtime.bindCallableApplication}).application;
  const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  for(const value of [0,3,-2]){
    const request={method:'GET',path:'/',headers:{input:JSON.stringify({value})}};
    const responses=[(await executeCanonicalNativeModule(native,{request})).response,executeFastlyNativePlatformCapabilities(fastly,{request}).response];
    const response=await node.executeNodeJavascriptApplication(application,new Request('https://call.test/',{headers:request.headers}),{schemaCodecs,strict:true});responses.push({status:response.status,body:await response.text()});
    for(const r of responses){assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{value:value*2});}
  }
  // Verify the caller-location error still survives both target pipelines.
  const badRoot=path.join(cwd,'bad');fs.cpSync(fixture,badRoot,{recursive:true});
  const entry=path.join(badRoot,'src/index.ts');fs.writeFileSync(entry,fs.readFileSync(entry,'utf8').replace('= ctx.call','= await ctx.call'));
  for(const target of ['native','javascript'])assert.throws(()=>target==='native'?compileCanonicalProject(entry,{...options,rootDir:badRoot,target}):buildJavascriptApplicationPlan(entry,{...options,rootDir:badRoot,provider:'node'}),error=>{
    const diagnostic=error.diagnostics?.find(d=>d.code==='PULSE_CALL_SOURCE_PLACEMENT');
    assert(diagnostic?.position?.line>0);assert.equal(path.resolve(badRoot,diagnostic.file),entry);
    const described=describeDiagnostic(diagnostic.code);assert.equal(described.exitCode,3);assert(described.remediation.length);assert(described.docs.includes('#pulse-call-source-placement'));return true;
  });
  const codes=Object.keys(DIAGNOSTIC_CATALOG).filter(k=>k.startsWith('PULSE_CALL_'));
  assert.equal(codes.length,14);
  for(const code of codes){const d=describeDiagnostic(code);assert(d.summary&&d.title&&d.remediation.length);assert.equal(d.exitCode,code==='PULSE_CALL_BOUNDARY_INVALID'?4:3);}
  console.log(JSON.stringify({status:'passed',packed,executions:9,stalePlansRejected:7,targetAndPlacementRejections:3,diagnostics:codes.length,artifacts:{node:{bytes:native.wasm.length,sha256:sha(native.wasm)},fastly:{bytes:fastly.wasm.length,sha256:sha(fastly.wasm)}}}));
}
main().catch(error=>{console.error(error.message,error.code,error.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
