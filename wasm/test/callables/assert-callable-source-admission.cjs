'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'../../..');
const { buildReachableProjectGraph } = require('../../packages/compiler/src/project/reachable-graph-builder');
const { admitCallableSource } = require('../../packages/compiler/src/callable-source-admission');
const { validateCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-call-source-'));
const pair = "{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
const call = `ctx.call(query,input,${pair})`;
const target = 'export function query(ctx,input){return {value:input.value+1};}';
let accepted=0, rejected=0;
try {
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  const schemaFile=path.join(cwd,'schemas.ts');
  fs.writeFileSync(schemaFile,`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';interface Value {value:number} export default defineSchemaRegistry({schemas:{'proof.Input':schema<Value>(),'proof.Output':schema<Value>(),'proof.Other':schema<Value>()}});`);
  const {registry}=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(schemaFile,{projectRoot:cwd});
  const schemaBundle=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').buildCanonicalSchemaBundle(registry,{maxBytes:4096});
  fs.writeFileSync(path.join(cwd,'barrel.ts'),"export {query as lookup} from './query';");
  function graph(body=`const result=${call};`,imports="import {query} from './query';",source=target) {
    fs.writeFileSync(path.join(cwd,'query.ts'),source);
    fs.writeFileSync(path.join(cwd,'index.ts'),`${imports}\nexport default async function handler(ctx){const input={value:1};${body}return ctx.text('ok');}`);
    return buildReachableProjectGraph(path.join(cwd,'index.ts'),{rootDir:cwd,workspaceRoot:root,target:'native'});
  }
  function admit(body,imports,source){return admitCallableSource(graph(body,imports,source),{schemaBundle});}
  function reject(body,code,imports,source){assert.throws(()=>admit(body,imports,source),error=>error.code===code,code);rejected++;}
  const first=admit();
  assert.equal(first.runtimeWired,false);assert.equal(first.callerValidated,false);
  assert.equal(first.callSites.length,1);assert.equal(first.callees.length,1);
  assert.equal(first.callees[0].identity,'query.ts#query');
  assert.equal(first.callSites[0].argumentNode.getText(),'input');
  validateCanonicalNativePlan(first.callees[0].plan);accepted++;
  for(const [imports,name] of [["import {query as lookup} from './query';",'lookup'],["import {lookup} from './barrel';",'lookup']]) {
    const result=admit(`const result=ctx.call(${name},input,${pair});`,imports);
    assert.equal(result.callees[0].plan.planHash,first.callees[0].plan.planHash);accepted++;
  }
  const twice=admit(`const a=ctx.call(aQuery,input,${pair});const b=ctx.call(bQuery,input,${pair});`,"import {query as aQuery,query as bQuery} from './query';");
  assert.equal(twice.callees.length,1);assert.equal(twice.callSites.length,2);accepted++;
  const unused=admit('',undefined,"export function query(ctx,input){return ctx.fetch('https://invalid.test');}");
  assert.equal(unused.callees.length,0);accepted++;
  const ordinary=admit('const result=other.call(query,input);');
  assert.equal(ordinary.callSites.length,0);accepted++;
  const max=admit(Array.from({length:16},(_,i)=>`const r${i}=${call};`).join(''));
  assert.equal(max.callSites.length,16);accepted++;
  reject(Array.from({length:17},(_,i)=>`const r${i}=${call};`).join(''),'PULSE_CALL_SOURCE_LIMIT');
  for(const expression of ['ctx.call(query,input)',`ctx.call(query,input,options)`,`ctx.call(query,input,{...options})`,`ctx.call(query,input,{inputSchema:'proof.Input'})`,`ctx.call(query,input,{inputSchema:'proof.Input',outputSchema:'proof.Output',extra:'x'})`,`ctx.call(query,input,{inputSchema:'proof.Input',inputSchema:'proof.Input',outputSchema:'proof.Output'})`,`ctx.call(query,input,{inputSchema:name,outputSchema:'proof.Output'})`]) {
    reject(`const result=${expression};`,expression==='ctx.call(query,input)'?'PULSE_CALL_SOURCE_FORM':'PULSE_CALL_SOURCE_SCHEMAS');
  }
  reject(`const result=ctx.call(query,input,{inputSchema:'missing',outputSchema:'proof.Output'});`,'PULSE_CALL_SOURCE_SCHEMA_UNKNOWN');
  reject(`const a=${call};const b=ctx.call(query,input,{inputSchema:'proof.Other',outputSchema:'proof.Output'});`,'PULSE_CALL_SOURCE_SCHEMA_CONFLICT');
  for(const body of [`const result=await ${call};`,`const result=await (${call});`,`const result=ctx.call(query,${call},${pair});`,`for(let i=0;i<2;i++){const result=${call};}`,`while(false){const result=${call};}`,`function nested(){return ${call};}`])reject(body,'PULSE_CALL_SOURCE_PLACEMENT');
  for(const body of [`{const ctx=other;const result=${call};}`,`{const {query}=other;const result=${call};}`,`ctx=other;const result=${call};`,`query=other;const result=${call};`])reject(body,'PULSE_CALL_SOURCE_BINDING');
  for(const expression of [`ctx['call'](query,input,${pair})`,`ctx.call?.(query,input,${pair})`,`ctx.call(query,...input,${pair})`,`ctx.call(()=>query,input,${pair})`,`ctx.call(ns.query,input,${pair})`])reject(`const result=${expression};`,'PULSE_CALL_SOURCE_FORM');
  reject(`const result=${call};`,'PULSE_CALL_SOURCE_TARGET',undefined,'export async function query(ctx,input){return {value:input.value};}');
  reject(`const result=ctx.call(unknown,input,${pair});`,'PULSE_CALL_SOURCE_TARGET');
  fs.mkdirSync(path.join(cwd,'node_modules/call-target'),{recursive:true});
  fs.writeFileSync(path.join(cwd,'node_modules/call-target/package.json'),JSON.stringify({name:'call-target',version:'1.0.0',type:'module',exports:'./index.ts'}));
  fs.writeFileSync(path.join(cwd,'node_modules/call-target/index.ts'),target);
  reject(`const result=${call};`,'PULSE_CALL_SOURCE_TARGET',"import {query} from 'call-target';");
  reject(`const a=${call};const b=ctx.call(second,input,${pair});`,'PULSE_CALL_SOURCE_TARGET_LIMIT',"import {query,second} from './query';",target+'export function second(ctx,input){return {value:1};}');
  for(const source of ['export function query(ctx,input){input.value=2;return input;}','export function query(ctx,input){return {value:ctx.req.header("x")};}','export function query(ctx,input){return ctx.call(query,input);}'])reject(`const result=${call};`,'PULSE_CALL_SOURCE_CALLEE',undefined,source);
  // Ordinary project compilation is deliberately unchanged and still rejects
  // ctx.call. This experiment cannot accidentally become supported execution.
  graph();
  assert.throws(()=>compileCanonicalProject(path.join(cwd,'index.ts'),{rootDir:cwd,workspaceRoot:root,target:'native',schemaBundle}),error=>Boolean(error.diagnostics?.length));rejected++;
  console.log(JSON.stringify({status:'passed',accepted,rejected,runtimeWired:false,publicCallSyntax:false}));
} finally {fs.rmSync(cwd,{recursive:true,force:true});}
