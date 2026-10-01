'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {gzipSync}=require('node:zlib');
const {acceptanceToolchain}=require('../../s3/acceptance-toolchain.cjs');
const {buildCanonicalNativePlan}=require('../../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../../packages/compiler/src/canonical-native-compiler');
const {compileFastlyNativePlatformCapabilitiesPlan}=require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {createCanonicalSchemaCodecs}=require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const {createConditionalKvAuthority}=require('../../../../packages/provider-fastly/src/testing/conditional-kv-host');
const {createNodeKvReference}=require('../../../../packages/provider-node/src/runtime/conditional-kv');
const {inspect}=require('./o25-wasm-proof.cjs');
const root=path.resolve(__dirname,'../../../..'),tc=acceptanceToolchain();
const fixture=path.join(root,'wasm/test/fixtures/pure-helpers');
const fresh=i=>({subjectKind:'item',subjectId:'abc',partition:i,revision:1,root:{hash:'hash',node:0},counters:Array(10).fill(0)});
const report={status:'running',cells:[],loopCases:0};
function setup(name){const cwd=fs.mkdtempSync(path.join(root,name));fs.mkdirSync(cwd+'/src');fs.mkdirSync(cwd+'/.pulse');fs.mkdirSync(cwd+'/node_modules/@pulse-compute',{recursive:true});for(const n of ['pulse','runtime'])fs.symlinkSync(root+'/packages/'+n,cwd+'/node_modules/@pulse-compute/'+n,'dir');
 for(const n of ['types.ts','partition.ts'])fs.copyFileSync(fixture+'/'+n,cwd+'/src/'+n);
 fs.writeFileSync(cwd+'/src/schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {PartitionHead} from './types';export default defineSchemaRegistry({schemas:{'app.Head':schema<PartitionHead>()}});`);
 fs.writeFileSync(cwd+'/.pulse/config.ts',`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);return cwd;}
function source(cwd,body,method='post'){fs.writeFileSync(cwd+'/src/index.ts',`import {Pulse} from '@pulse-compute/pulse';import {validPartition} from './partition';const app=new Pulse({auto:true});app.${method}('/',async(ctx)=>{${body}});export default app;`);}
function build(cwd){const plan=buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));assert.equal(plan.helpers.length,1);const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});const fastly=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,canonicalBuild:true,requirePlatformCapability:false,emitWat:false,bindings:{kv:{records:'records'}}});const js=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));return {plan,native,fastly,js,codecs:createCanonicalSchemaCodecs(plan.schemas.registry)};}
async function main(){
 for(const count of [1,2,16]){
  const cwd=setup('pure-'+count+'-');
  source(cwd,`const head=await ctx.req.json('app.Head');${Array.from({length:count},(_,i)=>`const r${i}=validPartition(head,'item','abc',0);`).join('')}return ctx.text(${Array.from({length:count},(_,i)=>`''+r${i}`).join("+'|'+")});`);
  const b=build(cwd);assert.equal(b.plan.effects.length,0);assert.equal(b.plan.continuations.length,0);
  const cases=[fresh(0),{...fresh(0),revision:2147483647},{...fresh(0),subjectId:'other'}, {...fresh(0),root:{hash:'',node:0}}, {...fresh(0),counters:[]}];
  for(const i of [0,9]){const h=fresh(0);h.counters[i]=-1;cases.push(h);}cases.push(fresh(0));
  for(const [index,head] of cases.entries()){
   const request={method:'POST',path:'/',url:'https://proof.test/',headers:{'content-type':'application/json'},body:JSON.stringify(head)};
   const expected=Array(count).fill(index<2||index===cases.length-1?'true':'false').join('|');
   const nr=await tc.executeCanonicalNativeModule(b.native,{request});const fr=tc.executeFastlyNativePlatformCapabilities(b.fastly,{request});const jr=await tc.executeNodeJavascriptApplication(b.js.loaded.application,new Request(request.url,{method:'POST',headers:request.headers,body:request.body}),{strict:false,schemaCodecs:b.codecs});
   assert.deepEqual([nr.response.status,nr.response.body],[200,expected]);assert.deepEqual([fr.response.status,fr.response.body],[200,expected]);assert.deepEqual([jr.status,await jr.text()],[200,expected]);
  }
  const targets={};for(const [target,artifact] of [['node',b.native],['fastly',b.fastly]]){
   const generatedBodies=[...artifact.source.matchAll(/function __pulse_pure_helper_\d+\(/g)].length;assert.equal(generatedBodies,1);
   const finalWasm=inspect(artifact,target,cwd,'__pulse_pure_helper_',null);assert.ok(finalWasm.roots[0].directCallSites>0,'retained helper has live direct callers, including shared expression wrappers');
   targets[target]={generatedBodies,generatedSourceBytes:Buffer.byteLength(artifact.source),wasmBytes:artifact.wasm.length,gzipBytes:gzipSync(artifact.wasm).length,finalWasm};
  }
  report.cells.push({callSites:count,canonicalHelpers:1,parityCases:cases.length,targets});fs.writeFileSync(process.env.PF05_OUTPUT,JSON.stringify(report,null,2)+'\n');console.error('pure '+count+' sites qualified');
 }
 for(const target of ['node','fastly']){const values=report.cells.map(c=>c.targets[target].finalWasm);assert.ok(values.every(v=>v.sharedBodyPartitions===1));assert.ok(values.every(v=>v.rootBytes<=values[0].rootBytes*1.1),'retained body must not scale with call sites; encoded global/function indices may vary');}
 const cwd=setup('loop-');source(cwd,`let result='';for(let i=0;i<16;i++){const row=await ctx.kv('records').getVersioned(''+i);if(row.status!=='found')return ctx.text('missing:'+i);const head=ctx.decodeJson(row.value.text,'app.Head');if(!validPartition(head,'item','abc',i))return ctx.text('invalid:'+i);const again=validPartition(head,'item','abc',i);if(again)result=result+i+',';}return ctx.text(result);`,'get');const b=build(cwd);
 const vectors=[{},... [0,15].flatMap(partition=>[{partition,missing:true},...[0,9].map(counter=>({partition,counter})),... [{subjectId:'other'},{root:{hash:'',node:0}},{revision:-1},{counters:[]},{partition:16}].map(change=>({partition,change}))]),{}];
 for(const vector of vectors){const kv=createNodeKvReference({kvInstanceId:'pure-loop'}),authority=createConditionalKvAuthority();authority.stores.set('records',new Map());const rows=[];
  for(let i=0;i<16;i++){const head=fresh(i);if(i===vector.partition){if(vector.missing){rows.push({status:'not-found'});continue;}Object.assign(head,vector.change);if(vector.counter!==undefined)head.counters[vector.counter]=-1;}const value={text:JSON.stringify(head)};rows.push({status:'found',generation:'g'+i,value});kv.kv('records').put(''+i,value);authority.seed('records',''+i,JSON.stringify({__pulseKv:1,value}));}
  const request={method:'GET',path:'/',url:'https://proof.test/'};const expected=vector.partition===undefined?Array.from({length:16},(_,i)=>i+',').join(''):(vector.missing?'missing:':'invalid:')+vector.partition;
  const n=await tc.executeCanonicalNativeModule(b.native,{request,strict:false,providerAdapter:{id:'loop',dispatchEffect:e=>rows[Number(e.key)]}});const f=tc.executeFastlyNativePlatformCapabilities(b.fastly,{request,conditionalKv:{authority}});const j=await tc.executeNodeJavascriptApplication(b.js.loaded.application,new Request(request.url),{strict:false,kvReference:kv,schemaCodecs:b.codecs});assert.equal(n.response.body,expected);assert.equal(f.response.body,expected);assert.equal(await j.text(),expected);report.loopCases++;
 }
 // O-25's substantial real fixture and error/suspension semantics from installed products.
 const legacy=fs.mkdtempSync(path.join(root,'o25-'));const {fixture:history,semantics}=require('./o25-history-helper.cjs');history(legacy,16);const plan=buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd:legacy,profile:'node'})));assert.equal(plan.helpers.length,1);const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});report.o25={};await semantics(tc,legacy,report.o25,native);await semantics(tc,legacy,report.o25);report.o25.finalWasm=inspect(native,'node',legacy);
 report.status='passed';fs.writeFileSync(process.env.PF05_OUTPUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
const keep=setInterval(()=>{},1000);main().catch(e=>{report.status='failed';report.failure={message:e.message,diagnostics:e.diagnostics};fs.writeFileSync(process.env.PF05_OUTPUT,JSON.stringify(report,null,2)+'\n');console.error(e,e.diagnostics);process.exitCode=1;}).finally(()=>clearInterval(keep));
