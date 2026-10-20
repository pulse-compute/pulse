'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const {compileCanonicalProject} = require('../../packages/compiler/src/canonical-project-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-compiler');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const {buildJavascriptApplicationPlan} = require('../../packages/compiler/src/javascript-application-plan');
const {loadJavascriptApplication} = require('../../packages/cli/src/typescript-module-loader');
const node = require('../../../packages/provider-node/src/javascript/runtime-host');
const runtime = require('../../../packages/runtime/src/host');
const {createCanonicalSchemaCodecs} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const {compileFastlyNativePlatformCapabilitiesPlan:fastlyCompile} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities:fastlyExecute} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-call-lifetime-'));
const output = process.argv[2] || process.env.PULSE_CALLABLE_LIFETIME_RECEIPT;
const git = (...args) => require('node:child_process').execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const report = {source:{revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--short')},status:'running',providerReality:false,artifacts:[],requests:[],faults:[],budgets:[]};
const save = () => {if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
const write = (name,text) => fs.writeFileSync(path.join(cwd,name),text);
const pair = "{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
const query = `export function query(ctx,input){const cells=ctx.workspace.numbers(4);const initial=cells[0];cells[0]=input.value;
if(input.value===0)return {value:0,initial};
if(input.value===-2){cells[input.value]=1;}
if(input.value===-3)return {value:'invalid',initial};
return {value:cells[0]+1,initial};}`;
let options;
function request(kind,value) {
  return kind==='router'?{method:'GET',path:'/compute',headers:{input:JSON.stringify({value})}}:
    {method:'POST',path:'/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',
      'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'proof.run'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientCapabilities':{}},name:'proof.run',arguments:{value}}})};
}
function build(kind,count,body=query) {
  write('query.ts',body);
  const calls=Array.from({length:count},(_,i)=>`const result${i}=ctx.call(query,{value:${body===query?"input.value===-1?'invalid':input.value":'input.value+'+i}},${pair});`).join('\n');
  write('operation.ts',`import {query} from './query';export async function operation(ctx,input){${calls}return result${count-1};}`);
  write('index.ts',kind==='router'?`import {Router} from '@pulse-compute/runtime';import {query} from './query';
const app=new Router();app.get('/compute',async(ctx)=>{const input=ctx.decodeJson(ctx.req.header('input'),'proof.Input');${calls}return ctx.json(result${count-1},{schema:'proof.Output'});});export default app;`:
    `import {EntityRouter,jsonRpc,mcp} from '@pulse-compute/mcp/pulse';import {operation} from './operation';
const rpc=new EntityRouter({adapter:jsonRpc({namedParamsOnly:true})});rpc.on('proof.run',{input:'proof.Input',output:'proof.Output'},operation);
const server=mcp({router:rpc});export default async function handler(ctx){return server.handle(ctx);}`);
  const compiled=compileCanonicalProject(path.join(cwd,'index.ts'),{...options,target:'native'});
  const plan=buildCanonicalNativePlan(compiled);
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
  const fastly=fastlyCompile(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
  const js=buildJavascriptApplicationPlan(path.join(cwd,'index.ts'),{...options,provider:'node'});
  const application=loadJavascriptApplication(js,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,
    bindCallables:runtime.bindCallableApplication,allowedPackages:{'@pulse-compute/mcp/pulse':require('../../../packages/mcp/src/pulse.js')}}).application;
  const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const name=kind+'-'+count+(body===query?'':'-allocation');
  report.artifacts.push({name,planHash:plan.planHash,...Object.fromEntries(Object.entries({native,fastly}).map(([k,v])=>[k,{bytes:v.wasm.length,sha256:crypto.createHash('sha256').update(v.wasm).digest('hex')}]))});save();
  return {name,kind,count,native,fastly,application,schemaCodecs};
}
async function execute(a,target,value,extra={}) {
  const req=request(a.kind,value);
  if(target==='node')return host.executeCanonicalNativeModule(a.native,{request:req,maxDurationMs:5000,...extra});
  if(target==='fastly')return fastlyExecute(a.fastly,{request:req,...extra});
  const response=await node.executeNodeJavascriptApplication(a.application,new Request('https://call.test'+req.path,{method:req.method,headers:req.headers,...(req.body?{body:req.body}:{})}),{schemaCodecs:a.schemaCodecs,strict:true,...extra});
  return {response:{status:response.status,body:await response.text()}};
}
function evidence(result) {return {memory:result.memory,guestMemoryBytes:result.guestMemoryBytes,valueHandleCount:result.valueHandleCount};}
async function success(a,target,value=2) {
  const result=await execute(a,target,value);assert.equal(result.response.status,200,result.response.body);
  const body=JSON.parse(result.response.body);
  assert.deepEqual(a.kind==='mcp'?body.result.structuredContent:body,{value:value===0?0:value+1,initial:0});
  const item={artifact:a.name,target,value,...evidence(result)};report.requests.push(item);save();return item;
}
async function faults(a) {
  for(const [phase,value] of [['input',-1],['computation',-2],['output',-3]])for(const target of ['node','fastly','javascript']) {
    let failure;
    try {
      const result=await execute(a,target,value);
      assert.equal(target,'javascript','Native must terminate, not return a successful partial result');
      if(a.kind==='mcp') {assert.equal(result.response.status,200);const body=JSON.parse(result.response.body);assert.equal(body.result.isError,true);assert.equal(body.result.structuredContent,undefined);assert.equal(body.result.content[0].text,'Tool execution or output validation failed');}
      else assert.equal(result.response.status,500);
      failure={status:result.response.status,body:result.response.body};
    }catch(error){
      if(error.code==='ERR_ASSERTION')throw error;
      assert.notEqual(target,'javascript');
      if(target==='node')assert.equal(error.code,phase==='computation'?'PULSE_NUMERIC_WORKSPACE_INVALID':phase==='input'&&a.kind==='mcp'?'PULSE_SCHEMA_DECODE':'PULSE_SCHEMA_ENCODE');
      const detail=error.execution||error.detail;
      assert(detail?.guestMemoryBytes>0);assert(detail.memory.bytes>0);assert.notEqual(detail.responseStatus,200);
      failure={code:error.code,name:error.name,...evidence(detail),lastError:detail.lastError,errorStage:detail.errorStage};
    }
    report.faults.push({artifact:a.name,target,phase,...failure});save();
    // Recovery is always a fresh request/instance, never a retry of the trapped guest.
    await success(a,target);
  }
  for(const value of [-1,-2,-3]) {
    const controller=host.instantiateCanonicalNativeModule(a.native,{request:request(a.kind,value)});
    assert.throws(()=>controller.start());assert.deepEqual(controller.pendingEffects(),[]);
    assert.throws(()=>controller.start(),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
    assert.throws(()=>controller.resume(),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  }
}
async function deadlines(cells) {
  for(const target of ['node','fastly','javascript']) {
    let samples=0, limit=Infinity;
    const now=()=>++samples>limit?5001:samples;
    const extra=target==='fastly'?{monotonicClock:()=>({nanoseconds:BigInt(now())*1000000n})}:
      {maxDurationMs:5000,requestClock:{now,setTimeout:()=>0,clearTimeout:()=>{}}};
    await execute(cells[0],target,2,extra);
    limit=samples; samples=0;
    assert.equal((await execute(cells[0],target,2,extra)).response.status,200);
    samples=0;
    let failure;
    try {
      const result=await execute(cells[1],target,2,extra);
      assert.equal(result.response.status,target==='fastly'&&cells[1].kind==='router'?504:408,result.response.body);
      if(cells[1].kind==='mcp')assert.equal(JSON.parse(result.response.body).error.message,'Request interrupted');
      failure={status:result.response.status,...evidence(result)};
    } catch(error) {
      if(error.code==='ERR_ASSERTION')throw error;
      assert.equal(error.code,'PULSE_REQUEST_DEADLINE_EXCEEDED');
      failure={code:error.code,...evidence(error.execution||{})};
    }
    report.budgets.push({kind:cells[1].kind,target,type:'deadline',oneCallClockSamples:limit,failingClockSamples:samples,...failure});save();
    await success(cells[1],target);
  }
}
async function allocations() {
  // Each computation fits; repeating it exhausts the existing cumulative budget.
  // Return only a scalar: output schema size cannot be the limiting factor.
  const heavy=`export function query(ctx,input){let text='x'+input.value;for(let i=0;i<20;i++){text=text+text;}return {value:text.length,initial:0};}`;
  const one=build('router',1,heavy), many=build('router',16,heavy);
  for(const target of ['node','fastly']) {
    const first=await execute(one,target,2);assert.equal(first.response.status,200);assert.equal(JSON.parse(first.response.body).value,2097152);
    let failure;
    try {await execute(many,target,2);assert.fail('sixteen calls must exhaust cumulative allocation');}
    catch(error){assert.equal(error.code,'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED');failure=error.execution||error.detail;}
    assert.notEqual(failure.responseStatus,200);
    if(target==='node') {
      const controller=host.instantiateCanonicalNativeModule(many.native,{request:request('router',2)});
      assert.throws(()=>controller.start(),{code:'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED'});
      assert.deepEqual(controller.pendingEffects(),[]);
      assert.throws(()=>controller.resume(),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
      assert.throws(()=>controller.exports.memory.grow(4097),RangeError);
    } else assert.throws(()=>first.instance.exports.memory.grow(4097),RangeError);
    assert(failure.memory.bytes>first.memory.bytes);
    assert(failure.memory.bytes<=64*1024*1024);
    report.budgets.push({target,type:'allocation',oneCall:evidence(first),sixteenCalls:evidence(failure)});save();
    const fresh=await execute(one,target,2);assert.deepEqual(evidence(fresh),evidence(first));
  }
}
async function main() {
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const [name,folder] of [['pulse','packages/pulse'],['runtime','packages/runtime'],['mcp','packages/mcp'],['entities','packages/entities'],['wasm-contracts','wasm/packages/contracts']])fs.symlinkSync(path.join(root,folder),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  write('schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';interface Input{value:number}interface Output{value:number;initial:number}export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>()}});`);
  const registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'schemas.ts'),{projectRoot:cwd}).registry;
  options={rootDir:cwd,workspaceRoot:root,strict:true,schemas:{registry,maxBytes:4096}};
  for(const kind of ['router','mcp']) {
    const cells=[];
    for(const count of [1,2,16]) {
      const a=build(kind,count);cells.push(a);
      for(const target of ['node','fastly','javascript']) {
        const first=await success(a,target);
        for(let i=0;i<3;i++)assert.deepEqual(await success(a,target),first,'new requests must not accumulate handles/budget/linear-memory capacity');
        await success(a,target,0);
      }
      if(count===2)await faults(a);
    }
    await deadlines(cells);
    for(const target of ['node','fastly']){
      const measurements=cells.map(a=>report.requests.find(r=>r.artifact===a.name&&r.target===target));
      assert(measurements[0].memory.bytes<measurements[1].memory.bytes);assert(measurements[1].memory.bytes<measurements[2].memory.bytes);
      assert(measurements[2].memory.bytes<64*1024*1024);assert(measurements[2].guestMemoryBytes<4096*65536);
    }
  }
  await allocations();
  report.status='passed';save();console.log(JSON.stringify({status:report.status,requests:report.requests.length,faults:report.faults.length,artifacts:report.artifacts.length}));
}
main().catch(error=>{report.status='failed';report.error={message:error.message,code:error.code,diagnostics:error.diagnostics};save();console.error(error.message,error.code,error.diagnostics,error.detail?.stderr);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
