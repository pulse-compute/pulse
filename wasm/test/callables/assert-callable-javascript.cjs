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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-call-js-'));
const write = (file, source) => fs.writeFileSync(path.join(cwd, file), source);
const pair = { inputSchema: 'proof.Input', outputSchema: 'proof.Output' };
const sourcePair = JSON.stringify(pair);
const target = `import {twice} from './helper';
export function query(ctx,input){const data=ctx.resources.map('data');const cells=ctx.workspace.numbers(2);
const initial=cells[0];cells[0]=twice(input.value);return {value:cells[0]+data.readU8(0),initial,nested:input.nested,word:data.readUtf8(1,7)};}`;
const body = `const input=ctx.decodeJson(ctx.req.header('input'),'proof.Input');const a=ctx.call(query,input,${sourcePair});const b=ctx.call(alias,input,${sourcePair});return ctx.json({a,b},{schema:'proof.Runs'});`;
const source = text => write('index.ts', `import {query} from './query';import {lookup as alias} from './barrel';export default async function handler(ctx){${text || body}}`);
const budgets = {files:1,bindings:1,fileBytes:128,totalBytes:128,serializedBytes:4096};
const bytes = Buffer.from('A雪😀');
const resources = R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([{path:'/data',bytes}],budgets)),[{id:'data',path:'/data'}],budgets);
let options, schemaCodecs, schemaBundle;
const jsPlan = extra => buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node',...extra});
const load = plan => loadJavascriptApplication(plan,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,bindCallables:runtime.bindCallableApplication}).application;
const binaryResources = runtime.createBinaryResourceStore([{id:'data',bytes}]);
const header = input => JSON.stringify(input).replace(/[^\x00-\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
async function execute(application, input={value:3,nested:{label:'雪😀'}}) {
  return node.executeNodeJavascriptApplication(application,new Request('https://call.test/',{headers:{input:header(input)}}),{schemaCodecs,binaryResources,strict:true});
}
async function main(){
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const [name,folder] of [['pulse','packages/pulse'],['runtime','packages/runtime'],['wasm-contracts','wasm/packages/contracts']])
    fs.symlinkSync(path.join(root,folder),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  write('schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
interface Nested {label:string;optional?:number} interface Input {value:number;nested:Nested}
interface Output {value:number;initial:number;nested:Nested;word:string} interface Runs {a:Output;b:Output}
export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>(),'proof.Runs':schema<Runs>()}});`);
  const registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'schemas.ts'),{projectRoot:cwd}).registry;
  options={rootDir:cwd,workspaceRoot:root,schemas:{registry,maxBytes:4096},binaryResources:resources,strict:true};
  write('helper.ts','export function twice(value:number):number {return value*2;}');
  write('query.ts',target);write('barrel.ts',"export {query as lookup} from './query';");source();
  const compiled=compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'});
  schemaBundle=compiled.schema.bundle;schemaCodecs=createCanonicalSchemaCodecs(schemaBundle.registry);
  // Explicit JavaScript inspection must retain its original-source target.
  assert.equal(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'javascript'}).target,'javascript');
  const native=compileCanonicalNativePlan(buildCanonicalNativePlan(compiled),{cwd:root,emitWat:false,reportCapture:false});
  const planned=jsPlan();assert.equal(planned.callables.bindings.length,1);assert.equal(planned.callables.bindings[0].maxCalls,2);
  assert.equal(jsPlan().planHash,planned.planHash);
  const application=load(planned);
  const prepared=require('../../packages/cli/src/project-execution').prepareJavascriptApplication({
    root:cwd,entryFile:path.join(cwd,'index.ts'),provider:'node',target:'javascript',schemas:options.schemas,binaryResources:resources
  },{schemaBundle});
  assert(prepared.loaded);
  const packaged=writeNodeJavascriptSourcePackage({plan:planned,projectRoot:cwd,outDir:path.join(cwd,'dist'),schemaBundle,binaryResources:resources});
  const built=require(packaged.entryFile);
  let executions=0;
  for(const input of [{value:3,nested:{label:'雪😀'}},{value:-2,nested:{label:'',optional:7}},{value:0,nested:{label:'é',optional:0}}]){
    const expectedValue={value:input.value*2+65,initial:0,nested:input.nested,word:'雪😀'};
    const expected={a:expectedValue,b:expectedValue};
    const response=(await executeCanonicalNativeModule(native,{request:{method:'GET',path:'/',headers:{input:JSON.stringify(input)}}})).response;
    assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),expected);executions++;
    for(const app of [application,built,prepared.loaded.application]){const result=await execute(app,input);const text=await result.text();assert.equal(result.status,200,text);assert.deepEqual(JSON.parse(text),expected);executions++;}
  }
  // A re-exported application root binds the defining source module's imports.
  write('handler.ts',fs.readFileSync(path.join(cwd,'index.ts'),'utf8'));
  write('index.ts',"export {default} from './handler';");
  const reexportPlan=jsPlan();assert.equal(reexportPlan.callables.modulePath,'handler.ts');
  const reexportPackage=writeNodeJavascriptSourcePackage({plan:reexportPlan,projectRoot:cwd,outDir:path.join(cwd,'alias-dist'),schemaBundle,binaryResources:resources});
  for(const app of [load(reexportPlan),require(reexportPackage.entryFile)]){assert.equal((await execute(app)).status,200);executions++;}
  source();
  // Full schema output validation executes on both targets, after an admitted body.
  for(const invalid of [target.replace('value:cells[0]+data.readU8(0)',"value:'wrong'"),target.replace('nested:input.nested','nested:{label:1}')]) {
    write('query.ts',invalid);
    assert((await execute(load(jsPlan()))).status>=400);
    const badNative=compileCanonicalNativePlan(buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'})),{cwd:root,emitWat:false,reportCapture:false});
    await assert.rejects(()=>executeCanonicalNativeModule(badNative,{request:{headers:{input:header({value:3,nested:{label:'x'}})}}}),error=>error.code==='PULSE_SCHEMA_ENCODE');
  }
  const rejected=[];
  for(const [name,bad] of [
    ['mutation',target.replace('const data=',"input.nested.label='changed';const data=")],
    ['HTTP',target.replace('const data=',"const method=ctx.req.method;const data=")],
    ['effect',target.replace('const data=',"ctx.fetch('https://invalid.test');const data=")],
    ['codec authority',target.replace('const data=',"const copy=ctx.decodeJson(ctx.encodeJson(input,'proof.Input'),'proof.Input');const data=")],
    ['async',target.replace('function query','async function query')],
    ['nested',target.replace('const data=',`ctx.call(query,input,${sourcePair});const data=`)]
  ]){write('query.ts',bad);assert.throws(()=>jsPlan());rejected.push(name);}
  write('query.ts',target);
  for(const [name,bad] of [['loop',`for(let i=0;i<2;i++){ctx.call(query,{value:1},${sourcePair});}return ctx.text('x');`],['indirect',`const call=ctx.call;return ctx.text('x');`],['context escape','const aliasContext=ctx;'+body],['await',body.replace('=ctx.call','=await ctx.call')]]){
    source(bad);assert.throws(()=>jsPlan());rejected.push(name);
  }
  source();assert.throws(()=>jsPlan({provider:'fastly'}),error=>error.code==='PULSE_CALL_SOURCE_PROVIDER');
  write('query.ts',target+'\n');assert.throws(()=>load(planned),error=>error.code==='PULSE_JAVASCRIPT_MODULE_SOURCE_CHANGED');
  write('query.ts',target);
  source("return ctx.text('ordinary JavaScript');");assert.equal(jsPlan().callables,undefined);
  // Adversarial trusted-host fixtures exercise the real ctx.call boundary even
  // for behaviors which authored source admission correctly prevents.
  const input={value:1,nested:{label:'unchanged'}};
  let retained, escaped, checks=0;
  const good=(ctx, value)=>{
    assert.deepEqual(Object.keys(ctx).sort(),['resources','workspace']);
    retained={ctx,value,view:ctx.resources.map('data'),cells:ctx.workspace.numbers(1)};
    return {value:value.value,initial:0,nested:value.nested,word:'ok'};
  };
  async function boundary(target, action, maxCalls=1){
    const app=async ctx=>{escaped=ctx.call;await action(ctx);return ctx.text('ok');};
    runtime.bindCallableApplication(app,[target],[{...pair,resources:['data'],maxCalls}]);
    const result=await execute(app);assert.equal(result.status,200);
  }
  await boundary(good,ctx=>{
    const output=ctx.call(good,input,pair);assert.notEqual(output.nested,input.nested);
    assert.equal(input.nested.label,'unchanged');
    for(const read of [()=>retained.value.nested,()=>retained.view.readU8(0),()=>retained.cells[0],()=>retained.ctx.workspace.numbers(1)]){assert.throws(read,/lifetime is closed/);checks++;}
    assert.throws(()=>ctx.call(good,input,pair),/site budget/);checks++;
  });
  assert.throws(()=>escaped(good,input,pair),/closed/);checks++;
  for(const bad of [(ctx,value)=>{value.nested.label='bad';return value;},()=>({value:1}),()=>Promise.reject(new Error('invalid async target')),ctx=>ctx.fetch('https://invalid.test')]){
    await boundary(bad,ctx=>{assert.throws(()=>ctx.call(bad,input,pair));checks++;});
  }
  await boundary(good,ctx=>{
    assert.throws(()=>ctx.call(()=>({}),input,pair),/not admitted/);
    assert.throws(()=>ctx.call(good,input,{...pair,outputSchema:'proof.Input'}),/schema pair/);
    assert.throws(()=>ctx.call(good,{value:'bad',nested:{label:'x'}},pair));checks+=3;
  });
  let attempt=0, failedView;
  const retry=(ctx,value)=>{
    const cells=ctx.workspace.numbers(1);assert.equal(cells[0],0);cells[0]=9;
    if(++attempt===1){failedView=ctx.resources.map('data');throw new Error('callee failure');}
    return {value:1,initial:0,nested:value.nested,word:'ok'};
  };
  await boundary(retry,ctx=>{
    assert.throws(()=>ctx.call(retry,input,pair),/callee failure/);
    assert.throws(()=>failedView.readU8(0),/lifetime is closed/);
    assert.equal(ctx.call(retry,input,pair).word,'ok');checks+=3;
  },2);
  let now=0, expiredView;
  const clock={now:()=>now,setTimeout:()=>0,clearTimeout:()=>{}};
  const budget=runtime.createRequestBudget({maxDurationMs:5,requestClock:clock});
  const expires=(ctx,value)=>{expiredView=ctx.resources.map('data');now=6;return {value:1,initial:0,nested:value.nested,word:'late'};};
  const timed=async ctx=>{ctx.call(expires,input,pair);return ctx.text('unreachable');};
  runtime.bindCallableApplication(timed,[expires],[{...pair,resources:['data'],maxCalls:1}]);
  try {
    await assert.rejects(()=>node.executeNodeJavascriptApplication(timed,new Request('https://call.test/'),{schemaCodecs,binaryResources,requestBudget:budget}),error=>error.code==='PULSE_REQUEST_DEADLINE_EXCEEDED');
    assert.throws(()=>expiredView.readU8(0));checks+=2;
  } finally {budget.close();}
  console.log(JSON.stringify({status:'passed',executions,schemaOutputRejections:4,sourceRejections:rejected,ownershipChecks:checks,packaged:true}));
}
main().catch(error=>{console.error(error,error.diagnostics,error.cause?.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
