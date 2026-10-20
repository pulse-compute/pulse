'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { compileFastlyNativePlatformCapabilitiesPlan: fastlyCompile } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: fastlyExecute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const R = require('../../packages/contracts/src/resources/embedded');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-call-authored-'));
const baseline = process.argv[2] && path.resolve(process.argv[2]);
const output = process.argv[3] && path.resolve(process.argv[3]);
const report = { version: 'pulse.callable-authored-evidence.v1', status: 'running', providerReality: false, measurements: [], rejections: [] };
const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
const write = (name, source) => fs.writeFileSync(path.join(cwd, name), source);
const pair = "{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
const target = `export function query(ctx,input){
  const data=ctx.resources.map('data');
  const cells=ctx.workspace.numbers(4);
  let sum=0;
  for(let i=0;i<4;i++){cells[i]=data.readU8(i);sum+=cells[i];}
  return {value:sum+input.value,word:data.readUtf8(4,7)};
}`;
const schemaText = `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
interface Input {value:number} interface Output {value:number;word:string}
export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>()}});`;
const budgets = {files:2,bindings:2,fileBytes:128,totalBytes:256,serializedBytes:4096};
const resources = R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([
  {path:'/data',bytes:Buffer.from('ABCD雪😀')},
  {path:'/unused',bytes:Buffer.from('UNUSED_AUTHORED_CALL_RESOURCE')}
],budgets)),[{id:'data',path:'/data'},{id:'unused',path:'/unused'}],budgets);
let registry;
function source(body, imports = "import {query} from './query';") {
  write('index.ts', `${imports}\nexport default async function handler(ctx){${body}}`);
}
function plan() {
  return buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{
    rootDir:cwd,workspaceRoot:root,target:'native',strict:true,
    schemas:{registry,maxBytes:4096},binaryResources:resources
  }));
}
function compile(p) {
  return {
    node:compileCanonicalNativePlan(p,{cwd:root,emitWat:false,reportCapture:false}),
    fastly:fastlyCompile(p,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000})
  };
}
function measure(name,p,artifacts) {
  const record={name,planHash:p.planHash,callees:p.callables?.length||0,resources:p.binaryResources?.records.map(r=>r.id)||[]};
  for(const [target,artifact] of Object.entries(artifacts)){
    record[target]={bytes:artifact.wasm.length,sha256:sha(artifact.wasm),imports:WebAssembly.Module.imports(new WebAssembly.Module(artifact.wasm))};
  }
  report.measurements.push(record);save();return record;
}
async function main(){
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  write('schemas.ts',schemaText);write('query.ts',target);write('barrel.ts',"export {query as lookup} from './query';");
  registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'schemas.ts'),{projectRoot:cwd}).registry;
  const body=`const input=ctx.decodeJson(ctx.req.header('input')??'{"value":2}','proof.Input');const result=ctx.call(query,input,${pair});return ctx.json(result,{schema:'proof.Output'});`;
  source(body);
  const p=plan();assert.equal(p.callables.length,1);assert.deepEqual(p.binaryResources.records.map(r=>r.id),['data']);
  assert.equal(p.entry.body[1].value.kind,'callable-call');
  assert.deepEqual(p.entry.body[1].value.source,{file:'index.ts',line:2,column:138});
  const artifacts=compile(p);measure('authored',p,artifacts);
  for(const value of [2,7,-3]){
    const request={method:'GET',path:'/',headers:{input:JSON.stringify({value})}};
    for(const response of [(await executeCanonicalNativeModule(artifacts.node,{request})).response,fastlyExecute(artifacts.fastly,{request}).response]){
      assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{value:266+value,word:'雪😀'});
    }
  }
  report.parityExecutions=6;
  // Aliases/re-exports preserve the resolved target and execute through authored source.
  source(body.replace('ctx.call(query,','ctx.call(lookup,'),"import {lookup} from './barrel';");
  const alias=plan();assert.equal(alias.callables[0].planHash,p.callables[0].planHash);
  const aliasArtifacts=compile(alias);
  for(const response of [(await executeCanonicalNativeModule(aliasArtifacts.node,{})).response,fastlyExecute(aliasArtifacts.fastly,{}).response]){
    assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),{value:268,word:'雪😀'});
  }
  report.parityExecutions+=2;measure('re-export-alias',alias,aliasArtifacts);
  // Full caller validation must survive the boundary; admission alone is insufficient.
  for(const [name,bad] of [
    ['unresolved caller',body.replace('const input=','missing();const input=')],
    ['unresolved input',body.replace('query,input,','query,missing,')],
    ['scalar input',body.replace('query,input,','query,3,')],
    ['ambient input',body.replace('query,input,','query,process.env,')],
    ['dynamic target',body.replace('ctx.call(query,','ctx.call(choose(),')],
    ['unknown schema',body.replace("inputSchema:'proof.Input'","inputSchema:'missing'")],
    ['call in loop',body.replace(`const result=ctx.call(query,input,${pair});`,`let result=input;for(let i=0;i<2;i++){result=ctx.call(query,input,${pair});}`)],
    ['awaited call',body.replace('=ctx.call','=await ctx.call')],
    ['shadowed target',body.replace('const input=','const query=other;const input=')],
    ['unresolved caller result',body.replace('ctx.json(result,','ctx.json(missing,')]
  ]){
    source(bad);assert.throws(()=>plan(),error=>Boolean(error.diagnostics?.length),name);report.rejections.push(name);
  }
  for(const badTarget of ["export function query(ctx,input){input.value=2;return input;}","export function query(ctx,input){return ctx.fetch('https://invalid.test');}"]){
    write('query.ts',badTarget);source(body);assert.throws(()=>plan(),error=>error.code==='PULSE_CALL_SOURCE_CALLEE');report.rejections.push('invalid callee');
  }
  const noCall=`return ctx.json({value:1,word:'plain'},{schema:'proof.Output'});`;
  source(noCall,'');const zeroPlan=plan(),zeroArtifacts=compile(zeroPlan),zero=measure('no-call',zeroPlan,zeroArtifacts);
  // The imported body is intentionally unsupported. It must never be compiled.
  write('query.ts',"export function query(ctx,input){return ctx.fetch('https://unused.invalid');}");
  source(noCall);const unusedPlan=plan(),unusedArtifacts=compile(unusedPlan),unused=measure('imported-unused',unusedPlan,unusedArtifacts);
  assert.equal(unusedPlan.callables,undefined);assert.equal(unusedPlan.binaryResources,undefined);
  for(const target of ['node','fastly']){
    assert.equal(unused[target].bytes,zero[target].bytes);
    assert.deepEqual(unused[target].imports,zero[target].imports);
    // Source identity is embedded in the exported plan hash. Adding an import
    // changes that identity, even though the executable source is identical.
    assert.equal(unusedArtifacts[target].source.replaceAll(unusedPlan.planHash,'PLAN_HASH'),
      zeroArtifacts[target].source.replaceAll(zeroPlan.planHash,'PLAN_HASH'));
  }
  if(baseline){
    // Compile the identical no-call source with the untouched pre-call compiler.
    // That frontend rejects unused runtime imports. Its untouched backend must
    // still emit the imported-unused call-free plan byte-for-byte identically.
    source(noCall,'');
    const script=`const fs=require('fs'),crypto=require('crypto');const root=process.cwd();const options=JSON.parse(fs.readFileSync(process.argv[2]));const p=require('./wasm/packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(require('./wasm/packages/compiler/src/canonical-project-compiler').compileCanonicalProject(process.argv[1],options));const artifacts={node:require('./wasm/packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(p,{cwd:root,emitWat:false,reportCapture:false}),fastly:require('./packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(p,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000})};const result={};for(const [target,a]of Object.entries(artifacts))result[target]={bytes:a.wasm.length,sha256:crypto.createHash('sha256').update(a.wasm).digest('hex'),imports:WebAssembly.Module.imports(new WebAssembly.Module(a.wasm))};fs.writeFileSync(process.argv[3],JSON.stringify(result));`;
    write('options.json',JSON.stringify({rootDir:cwd,workspaceRoot:baseline,target:'native',strict:true,schemas:{registry,maxBytes:4096},binaryResources:resources}));
    execFileSync(process.execPath,['-e',script,path.join(cwd,'index.ts'),path.join(cwd,'options.json'),path.join(cwd,'baseline.json')],{cwd:baseline,stdio:'pipe',timeout:180000});
    const original=JSON.parse(fs.readFileSync(path.join(cwd,'baseline.json')));
    write('unused-plan.json',JSON.stringify(unusedPlan));
    const unusedScript=script.replace("require('./wasm/packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(require('./wasm/packages/compiler/src/canonical-project-compiler').compileCanonicalProject(process.argv[1],options))","JSON.parse(fs.readFileSync(process.argv[1]))");
    execFileSync(process.execPath,['-e',unusedScript,path.join(cwd,'unused-plan.json'),path.join(cwd,'options.json'),path.join(cwd,'unused-baseline.json')],{cwd:baseline,stdio:'pipe',timeout:180000});
    const originalUnused=JSON.parse(fs.readFileSync(path.join(cwd,'unused-baseline.json')));
    for(const target of ['node','fastly']){
      assert.deepEqual(zero[target],original[target]);assert.deepEqual(unused[target],originalUnused[target]);
    }
    report.baseline={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),noCall:original,importedUnused:originalUnused,comparison:'no-call: same-source project compile; imported-unused: same call-free plan through untouched backend. Adding unused import changes only embedded plan identity, with equal bytes/imports.'};
  }
  const modified=execFileSync('git',['ls-files','--modified','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  report.source={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim(),files:modified.map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(root,file)))}))};
  report.status='passed';save();console.log(JSON.stringify({status:report.status,parityExecutions:report.parityExecutions,rejections:report.rejections.length,baseline:report.baseline?.revision||null,measurements:report.measurements.map(m=>({name:m.name,nodeBytes:m.node.bytes,fastlyBytes:m.fastly.bytes}))}));
}
main().catch(error=>{report.status='failed';report.error={message:error.message,diagnostics:error.diagnostics};save();console.error(error,error.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
