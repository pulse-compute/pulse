'use strict';
// Independent bytes and manifest producer: no production resource constructor.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture() {
  function bytes(length, seed) { const out=Buffer.alloc(length); for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;out[i]=seed&255;} return out; }
  const shared=bytes(1048577,7391), distinct=bytes(4099,177), unused=bytes(131073,992);
  shared.writeUInt32LE(0xfedcba98,1); distinct.writeUInt32LE(123456,3);
  const inputs=[['/copy',Buffer.from(shared)],['/distinct',distinct],['/empty',Buffer.alloc(0)],['/shared',shared],['/unused',unused]];
  const files=inputs.map(([file,bytes])=>({path:file,data:bytes.toString('base64'),byteLength:bytes.length,sha256:hash(bytes),contentType:'application/octet-stream'}));
  const version='pulse.embedded-assets.v1';
  const manifest={version,id:hash(JSON.stringify([version,files.map(f=>[f.path,f.contentType,f.byteLength,f.sha256])])),byteLength:inputs.reduce((n,[,b])=>n+b.length,0),files};
  const serialized=JSON.stringify(manifest);
  const budgets={files:5,fileBytes:shared.length,totalBytes:manifest.byteLength,serializedBytes:Buffer.byteLength(serialized),bindings:6};
  const bindings={shared:'/shared',alias:'/shared',copy:'/copy',distinct:'/distinct',empty:'/empty',unused:'/unused'};
  const expected={parent:shared[0],a:{value:0xfedcba98+shared[shared.length-1],length:shared.length,empty:0},b:{value:0xfedcba98+123456,length:shared.length,empty:0},again:{value:0xfedcba98+shared[shared.length-1],length:shared.length,empty:0}};
  return {inputs,shared,distinct,unused,manifest,serialized,budgets,bindings,expected};
}
function writeProject(cwd, data) {
  fs.mkdirSync(path.join(cwd,'src'),{recursive:true});fs.mkdirSync(path.join(cwd,'.pulse'),{recursive:true});fs.mkdirSync(path.join(cwd,'inputs'),{recursive:true});
  for(const [file,bytes] of data.inputs)fs.writeFileSync(path.join(cwd,'inputs',file.slice(1)+'.bin'),bytes);
  fs.writeFileSync(path.join(cwd,'src/schemas.ts'),`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';interface Input{value:number}interface Output{value:number;length:number;empty:number}interface Runs{parent:number;a:Output;b:Output;again:Output}export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>(),'proof.Runs':schema<Runs>()}});`);
  fs.writeFileSync(path.join(cwd,'src/first.ts'),`export function first(ctx,input){const data=ctx.resources.map('alias');const empty=ctx.resources.map('empty');return {value:data.readU32LE(1)+data.readU8(data.byteLength-1)+input.value,length:data.byteLength,empty:empty.byteLength};}export function unreachable(ctx,input){const data=ctx.resources.map('unused');return {value:data.readU8(0),length:data.byteLength,empty:0};}`);
  fs.writeFileSync(path.join(cwd,'src/second.ts'),`export function second(ctx,input){const data=ctx.resources.map('copy');const distinct=ctx.resources.map('distinct');return {value:data.readU32LE(1)+distinct.readU32LE(3)+input.value,length:data.byteLength,empty:0};}`);
  const pair="{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
  fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {first,unreachable} from './first';import {second} from './second';export default async function handler(ctx){const data=ctx.resources.map('shared');const a=ctx.call(first,{value:0},${pair});const b=ctx.call(second,{value:0},${pair});const again=ctx.call(first,{value:0},${pair});return ctx.json({parent:data.readU8(0),a,b,again},{schema:'proof.Runs'});}`);
  const config={pulse:{entry:'src/index.ts',schema:'src/schemas.ts',tests:null,strict:true,binaryResources:{manifest:data.serialized,bindings:data.bindings,budgets:data.budgets}},native:{host:'node',target:'native',outDir:'dist-native'},javascript:{host:'node',target:'javascript',outDir:'dist-javascript'}};
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
}
function physical(wasm,data) {
  const module=new WebAssembly.Module(wasm), imports={};
  for(const entry of WebAssembly.Module.imports(module)){if(entry.kind!=='function')throw Error('unexpected non-function import');(imports[entry.module]??={})[entry.name]=()=>0;}
  const memory=Buffer.from(new WebAssembly.Instance(module,imports).exports.memory.buffer);
  const counts={};
  for(const [name,bytes] of [['shared',data.shared],['distinct',data.distinct],['unused',data.unused]]) {
    let count=0,at=0;while((at=memory.indexOf(bytes,at))>=0){count++;at+=bytes.length;}counts[name]=count;
  }
  return {artifactBytes:wasm.length,sha256:hash(wasm),initialLinearMemoryBytes:memory.length,physicalCopies:counts};
}
module.exports={fixture,writeProject,physical,hash};
