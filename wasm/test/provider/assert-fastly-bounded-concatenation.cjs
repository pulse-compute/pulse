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
function main(){
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
});export default app;`);
  const plan=buildCanonicalNativePlan(compileProject(resolveProject({cwd,profile:'fastly'})));
  const compiled=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd,bindings:{},canonicalBuild:true});
  let maxMemoryBytes=0;
  for(const fragment of ['x'.repeat(512),'\u0001'.repeat(512),'😀'.repeat(256)]){
   const result=executeFastlyNativePlatformCapabilities(compiled,{request:{method:'POST',path:'/concat',headers:[['content-type','application/json']],body:JSON.stringify({fragment,n:7})}});
   const expected=text=>({status:'ok',byteLength:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});
   assert.equal(result.response.status,200);assert.deepEqual(JSON.parse(result.response.body),{digest:expected(fragment.repeat(1024)),before:expected(fragment.repeat(512)),length:fragment.length*1024,total:fragment.length*1024*1025/2,first:fragment[0],last:fragment.at(-1),equal:false,coerced:'v7truenull'});
   maxMemoryBytes=Math.max(maxMemoryBytes,result.instance.exports.memory.buffer.byteLength);
   assert.throws(()=>result.instance.exports.memory.grow(4097),RangeError);
  }
  assert.ok(maxMemoryBytes<=33554432);
  console.log('ok - bounded Fastly concatenation preserves snapshots, UTF-16 and exact digest bytes; memory '+maxMemoryBytes);
 }finally{fs.rmSync(cwd,{recursive:true,force:true})}
}
module.exports={main};if(require.main===module)main();
