'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {PACKAGE_SET} = require('../../../scripts/package-support.cjs');
const {resolveProject} = require('../../packages/cli/src/project-config.js');
const {compileProject} = require('../../packages/cli/src/project-execution.js');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan.js');
const {compileFastlyNativePlatformCapabilitiesPlan} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const {executeFastlyNativePlatformCapabilities} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root=path.resolve(__dirname,'../../..');
function main(options = {}){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-bounded-concat-'));
 try{
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const p of PACKAGE_SET)fs.symlinkSync(path.join(root,p.dir),path.join(cwd,'node_modules',p.name),'dir');
  fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false,crypto:['SHA-256']},fastly:{host:'fastly',target:'native'}}));`);
  fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {Pulse} from '@pulse-compute/pulse';import {crypto} from '@pulse-compute/crypto';
const app=new Pulse({auto:true});app.post('/concat',async ctx=>{
 const input=await ctx.req.json();let joined='';let retained='';let total=0;let first='';
 for(let i=0;i<1024;i++){joined+=input.fragment;total+=joined.length;if(joined)first=joined[0];if(i===511)retained=joined;}
 const digest=await crypto.digestText(ctx,joined);
 const before=await crypto.digestText(ctx,retained);
 return ctx.json({digest,before,length:joined.length,total,first,last:joined[joined.length-1],equal:joined===retained,coerced:'v'+input.n+true+null});
});
app.post('/json',async ctx=>{
 const input=await ctx.req.json();const rows=[];
 for(let i=0;i<1024;i++)rows[i]={value:input.fragment,index:i};
 return ctx.json({rows,tail:input.fragment});
});export default app;`);
  const plan=buildCanonicalNativePlan(compileProject(resolveProject({cwd,profile:'fastly'})));
  const modes=Object.hasOwn(options,'nativeOptimization')?[options.nativeOptimization]:[undefined,'native-shrink0','experimental-native-bounded-size','experimental-native-size'];
  for(const nativeOptimization of modes){
  const compiled=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd,bindings:{},canonicalBuild:true,nativeOptimization});
  let maxMemoryBytes=0;
  for(const fragment of ['x'.repeat(512),'\u0001'.repeat(512),'😀'.repeat(256),'','\ud800x\udfff']){
   const result=executeFastlyNativePlatformCapabilities(compiled,{request:{method:'POST',path:'/concat',headers:[['content-type','application/json']],body:JSON.stringify({fragment,n:7})}});
   const expected=text=>text.isWellFormed()?{status:'ok',byteLength:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}:{status:'failed',reason:'invalid-text'};
   assert.equal(result.response.status,200);assert.deepEqual(JSON.parse(result.response.body),{digest:expected(fragment.repeat(1024)),before:expected(fragment.repeat(512)),length:fragment.length*1024,total:fragment.length*1024*1025/2,first:fragment[0]||'',last:fragment.at(-1)??null,equal:fragment.length===0,coerced:'v7truenull'});
   maxMemoryBytes=Math.max(maxMemoryBytes,result.instance.exports.memory.buffer.byteLength);
   assert.throws(()=>result.instance.exports.memory.grow(4097),RangeError);
  }
  assert.ok(maxMemoryBytes<=33554432);
  // A large fragment followed by thousands of punctuation/value fragments
  // exposed the sibling shrink2 join path even without any concatenation rope.
  let jsonMemoryBytes=0;
  for(const fragment of ['x'.repeat(512),'\u0001\\\"\ud800😀'.repeat(32)]){
   const result=executeFastlyNativePlatformCapabilities(compiled,{request:{method:'POST',path:'/json',headers:[['content-type','application/json']],body:JSON.stringify({fragment})}});
   const expected={rows:Array.from({length:1024},(_,index)=>({value:fragment,index})),tail:fragment};
   assert.equal(result.response.status,200);
   assert.equal(result.response.body,JSON.stringify(expected),'JSON escaping, member order and exact UTF-16');
   jsonMemoryBytes=Math.max(jsonMemoryBytes,result.instance.exports.memory.buffer.byteLength);
  }
  assert.ok(jsonMemoryBytes<=33554432,'many-fragment JSON stays within 32 MiB');
  console.log('ok - bounded Fastly string assembly '+(nativeOptimization||'default')+' '+JSON.stringify({concatMemoryBytes:maxMemoryBytes,jsonMemoryBytes,wasmBytes:compiled.wasm.length,compileMs:compiled.assemblyScriptDurationMs}));
  }

 }finally{fs.rmSync(cwd,{recursive:true,force:true})}
}
module.exports={main};if(require.main===module)main();
