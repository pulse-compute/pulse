#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { Pulse } = require('../../../packages/pulse/src');
const { executeEvent, executeApplication } = require('../../../packages/runtime/src/host');
const events = require('../../packages/contracts/src/events/contracts');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const native = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const repoRoot = path.resolve(__dirname, '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-event-results-'));
function write(file, text) { const p=path.join(root,file); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,text); return p; }
const source = `import { Pulse } from '@pulse-compute/pulse'
const app = new Pulse({auto:true})
app.get('/result', async ctx => ctx.json({ label: 'sensor-7', accepted: true }, {schema:'shared.Result'}))
app.on('immediate', {schema:'shared.Result', resultSchema:'shared.Result'}, async ctx => {
  return { label: ctx.event.payload.label, accepted: ctx.event.payload.accepted }
})
app.on('suspended', {schema:'shared.Result', resultSchema:'shared.Result'}, async ctx => {
  const mode = await ctx.config.get('mode')
  return { label: ctx.event.payload.label, accepted: mode === 'yes' }
})
app.on('invalid', {schema:null, resultSchema:'shared.Result'}, async ctx => { return { label: 12, accepted: true } })
app.on('output.bound', {schema:null, resultSchema:'shared.Result'}, async ctx => {
  const label = await ctx.config.get('mode')
  return { label: label ?? '', accepted: true }
})
app.on('void', {schema:null}, async ctx => {})
export default app
`;
const frame = (type, label='sensor-7') => ['invalid','void'].includes(type)
  ? {version:'pulse.event-frame.v1', type, schemaId:null}
  : {version:'pulse.event-frame.v1',type,schemaId:'shared.Result',payload:{label,accepted:true}};
const expected = label => ({version:'pulse.event-execution-result.v2',status:'completed',result:{label,accepted:true}});
function assertFailed(result) { assert.equal(result.status,'failed'); assert.equal(Object.hasOwn(result,'result'),false); }
async function main() {
  write('tsconfig.json','{"compilerOptions":{"baseUrl":"."}}');
  write('src/models.ts','export interface Result { label: string; accepted: boolean }');
  const schemaFile=write('src/schema.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'
import type {Result} from './models.js'
export default defineSchemaRegistry({schemas:{'shared.Result':schema<Result>()}})`);
  const extracted=extractSchemaRegistry(schemaFile,{projectRoot:root});
  const schemas={registry:extracted.registry,dependencies:extracted.dependencies,codecInputs:extracted.codecInputs};
  const entry=write('src/index.ts',source);
  const compile=()=>compileCanonicalProject(entry,{rootDir:root,workspaceRoot:repoRoot,tsconfigFile:path.join(root,'tsconfig.json'),schemas,strict:true,requireAsync:true,requireEffectAwait:true,
    applicationProjectMetadata:{selectedProfile:{name:'test',source:'events-results'},strict:true,target:'native',host:'node',projectHash:'1'.repeat(64),configPlanHash:'2'.repeat(64),bindings:{config:[],secret:[]},fragments:{}}});
  const project=compile();
  const compiled=compileCanonicalNativePlan(buildCanonicalNativePlan(project),{cwd:repoRoot,timeoutMs:180000});
  const schemaCodecs=native.createSchemaCodecs(extracted.registry);
  const mod={exports:{}};
  new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({Pulse}),mod,mod.exports);
  const app=mod.exports.default;
  const providerAdapter={id:'event-results',dispatchEffect:async effect=>{assert.equal(effect.kind,'config.get');return 'yes';},disposeExecution(){}};
  const jsOptions={schemaCodecs,capabilities:{config:()=> 'yes'}};
  for(const type of ['immediate','suspended']) {
    assert.deepEqual(await executeEvent(app,frame(type),jsOptions),expected('sensor-7'));
    assert.deepEqual(await native.executeCanonicalNativeEvent(compiled,frame(type),{providerAdapter}),expected('sensor-7'));
  }
  const jsHttp = await executeApplication(app, new Request('https://test/result'), jsOptions);
  assert.deepEqual(await jsHttp.json(), expected('sensor-7').result);
  // A single registered schema is consumed by HTTP and both event directions.
  const http=await native.executeCanonicalNativeModule(compiled,{request:{method:'GET',url:'https://test/result'}});
  assert.deepEqual(JSON.parse(http.response.body),expected('sensor-7').result);
  for(const type of ['invalid','void']) {
    const js=await executeEvent(app,frame(type),jsOptions);
    const wasm=await native.executeCanonicalNativeEvent(compiled,frame(type),{providerAdapter});
    if(type==='invalid') { assertFailed(js);assertFailed(wasm); assert.equal(js.error.category,wasm.error.category); }
    else assert.deepEqual(js,wasm);
  }
  const controller=native.instantiateCanonicalNativeModule(compiled,{executionPlane:'event'});
  assert.equal(controller.startEvent(frame('immediate','A')),0);
  const resultA=controller.resultValue();
  assert.equal(Object.isFrozen(resultA),true);
  assert.equal(controller.startEvent(frame('suspended','B')),1);
  assert.equal(controller.resultValue(),undefined);
  const [pending]=controller.pendingEffects();
  controller.setEffectResult(pending.ticket,'yes');
  assert.equal(controller.resume(),0);
  assert.deepEqual(controller.resultValue(),expected('B').result);
  assert.deepEqual(resultA,expected('A').result);
  assert.equal(controller.startEvent(frame('void')),0);
  assert.equal(controller.resultValue(),undefined);
  assert.deepEqual(resultA,expected('A').result);
  controller.close();
  // A failed result or lifecycle cannot expose success or become reusable.
  const invalid=native.instantiateCanonicalNativeModule(compiled,{executionPlane:'event'});
  assert.throws(()=>invalid.startEvent(frame('invalid')),{code:'PULSE_CANONICAL_NATIVE_EVENT_RESULT_INVALID'});
  assert.equal(invalid.resultValue(),undefined);
  assert.throws(()=>invalid.startEvent(frame('void')),{code:'PULSE_EFFECT_INVOCATION_INVALID'});
  for(const point of ['invocation.end','invocation.close','invocation.closed']) {
    const failure=new Error('cleanup failed');
    const result=await native.executeCanonicalNativeEvent(compiled,frame('immediate'),{lifecycleServices:[{point,owner:'event-results',order:0,run(){throw failure;}}]});
    assertFailed(result);
  }
  const suspendedFailure=await native.executeCanonicalNativeEvent(compiled,frame('suspended'),{providerAdapter:{...providerAdapter,dispatchEffect(){throw new Error('effect failed');}}});
  assertFailed(suspendedFailure);
  const outputFrame={version:'pulse.event-frame.v1',type:'output.bound',schemaId:null};
  const outputOptions={eventLimits:{maxPayloadBytes:40}};
  const jsBound=await executeEvent(app,outputFrame,{...jsOptions,...outputOptions,capabilities:{config:()=> 'x'.repeat(80)}});
  const nativeBound=await native.executeCanonicalNativeEvent(compiled,outputFrame,{...outputOptions,providerAdapter:{...providerAdapter,dispatchEffect:()=> 'x'.repeat(80)}});
  for(const result of [jsBound,nativeBound]) {assertFailed(result);assert.equal(result.error.category,'completion-invalid');}
  const disposeFailure=await native.executeCanonicalNativeEvent(compiled,frame('immediate'),{providerAdapter:{...providerAdapter,async disposeExecution(){throw new Error('private disposal detail');}}});
  assertFailed(disposeFailure); assert.equal(disposeFailure.error.category,'disposal-failed');
  assert.ok(!JSON.stringify(disposeFailure).includes('private disposal detail'));
  const abort=new AbortController();
  const cancelled=await native.executeCanonicalNativeEvent(compiled,frame('immediate'),{signal:abort.signal,providerAdapter:{...providerAdapter,async disposeExecution(){abort.abort();}}});
  assertFailed(cancelled);assert.equal(cancelled.error.category,'cancelled');
  // Runtime JS still checks dynamically obtained missing/non-JSON/oversized values.
  for(const output of [undefined,{label:12,accepted:true},{label:'x'.repeat(65536),accepted:true}, {get label(){throw new Error('getter executed');},accepted:true}]) {
    const dynamic=new Pulse({auto:true}); dynamic.on('value',{schema:null,resultSchema:'shared.Result'},async()=>output);
    const result=await executeEvent(dynamic,{version:'pulse.event-frame.v1',type:'value',schemaId:null},jsOptions);
    assertFailed(result); assert.equal(result.error.category,'completion-invalid');
  }
  const throwing=new Pulse({auto:true});
  throwing.on('throw.undefined',{schema:null,resultSchema:'shared.Result'},async()=>{throw undefined;});
  assertFailed(await executeEvent(throwing,{version:'pulse.event-frame.v1',type:'throw.undefined',schemaId:null},jsOptions));
  assert.throws(()=>events.normalizeEventExecutionResult({...expected('x'),status:'failed',error:{}}));
  for(const body of ['return;', 'if (ctx.event.payload.accepted) return {label:"x",accepted:true};']) {
    write('src/index.ts',source.replace('return { label: ctx.event.payload.label, accepted: ctx.event.payload.accepted }',body));
    assert.throws(compile);
  }
  write('src/index.ts',source.replace("resultSchema:'shared.Result'","resultSchema:'shared.Missing'"));
  assert.throws(compile);
  console.log('ok - shared route/event schema, JS/Native result parity, suspension, detached reuse, invalid/missing/bounded results and failure containment');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(error=>{console.error(error); if(error.diagnostics) console.error(JSON.stringify(error.diagnostics,null,2)); process.exitCode=1;});
