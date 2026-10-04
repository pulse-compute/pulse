'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const root = path.resolve(__dirname, '../../..'), tc = acceptanceToolchain();
const fixtures = path.join(__dirname, '../fixtures/pure-helpers');
const fresh = () => ({subjectKind:'item',subjectId:'abc',partition:0,revision:1,root:{hash:'hash',node:0},counters:Array(10).fill(0)});
async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pf03-'));
  try {
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','runtime'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    const types = fs.readFileSync(path.join(fixtures,'types.ts'),'utf8');
    const original = fs.readFileSync(path.join(fixtures,'partition.ts'),'utf8');
    fs.writeFileSync(path.join(cwd,'src/types.ts'),types);
    fs.writeFileSync(path.join(cwd,'src/schemas.ts'),`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {PartitionHead} from './types';export default defineSchemaRegistry({schemas:{'app.Head':schema<PartitionHead>()}});`);
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);
    function compile(helper = original, body = `const head=await ctx.req.json('app.Head');const valid=validPartition(head,'item','abc',0);if(!validPartition(head,'item','abc',0))return ctx.text('false');return ctx.text(''+valid);`, imported = true) {
      fs.writeFileSync(path.join(cwd,'src/partition.ts'),helper);
      fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {Pulse} from '@pulse-compute/pulse';${imported && body.includes("validPartition(") ? "import {validPartition} from './partition';" : helper}const app=new Pulse({auto:true});app.post('/',async(ctx)=>{${body}});export default app;`);
      const compiled=tc.compileProject(tc.resolveProject({cwd,profile:'node'}));
      return {compiled,plan:buildCanonicalNativePlan(compiled)};
    }
    const {plan}=compile();
    const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(plan.schemas.registry);
    validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
    assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,0);assert.equal(plan.continuations.length,0);
    const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
    const prepared=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));
    const cases = [[fresh(),true]];
    for (const length of [0,1,9,11,256]) cases.push([{...fresh(),counters:Array(length).fill(0)},false]);
    for (const value of [-1,0.5,2147483648,2147483647]) {
      cases.push([{...fresh(),revision:value},value===2147483647]);
      cases.push([{...fresh(),root:{hash:'hash',node:value}},value===2147483647]);
      for(let i=0;i<10;i++){const h=fresh();h.counters[i]=value;cases.push([h,value===2147483647]);}
    }
    for(const change of [{subjectKind:'other'},{subjectId:'other'},{partition:1},{root:{hash:'',node:0}}])cases.push([{...fresh(),...change},false]);
    cases.push([fresh(),true]);
    for(const [head,expected] of cases) {
      const body=JSON.stringify(head), request={method:'POST',path:'/',url:'https://test/',headers:{'content-type':'application/json'},body};
      const nr=await tc.executeCanonicalNativeModule(native,{request});
      const jr=await tc.executeNodeJavascriptApplication(prepared.loaded.application,new Request(request.url,{method:'POST',headers:request.headers,body}),{strict:false,schemaCodecs});
      assert.equal(nr.response.body,String(expected));assert.equal(await jr.text(),String(expected));
      // The decoded caller graph is still available after repeated borrowed reads.
      const controller=await tc.instantiateCanonicalNativeModule(native,{request});
      controller.start();
      const roots=[...controller.heap.values.values()].filter(v=>v && v.subjectKind!==undefined && Array.isArray(v.counters));
      assert.ok(roots.length);for(const value of roots)assert.deepEqual(value,head);
      assert.equal(new Set(roots).size,1,'no record copies');
      const originalRoot=roots[0];
      for (const value of controller.heap.values.values()) {
        if (Array.isArray(value)) assert.equal(value,originalRoot.counters,'array reads borrow the caller identity');
        else if(value && value.hash!==undefined) assert.equal(value,originalRoot.root,'nested reads borrow the caller identity');
      }
      controller.close();
    }
    // Read-only aliases, including nested record and array aliases.
    const aliased=original.replace('if (head.subjectKind', 'const alias=head;const nested=alias.root;const counts=alias.counters;\n  if (alias.subjectKind').replaceAll('head.root.', 'nested.').replaceAll('head.counters','counts');
    const aliasPlan=compile(aliased).plan;
    const aliasNative=compileCanonicalNativePlan(aliasPlan,{cwd:root,emitWat:false});
    assert.equal((await tc.executeCanonicalNativeModule(aliasNative,{request:{method:'POST',path:'/',url:'https://test/',body:JSON.stringify(fresh()),headers:{'content-type':'application/json'}}})).response.body,'true');
    // A renamed imported interface remains structural; same-file helper too.
    compile(original.replace('{ PartitionHead }','{ PartitionHead as Head }').replace('head: PartitionHead','head: Head'));
    compile(original,undefined,false);
    const arrays=compile(`export function validPartition(head:number[],a:string,b:string,c:number):boolean{const alias=head;return alias.length===0 || alias[0]>=c;}`, `const values=[0,1,2];const valid=validPartition(values,'item','abc',0);return ctx.text(''+valid);`);
    assert.equal((await tc.executeCanonicalNativeModule(compileCanonicalNativePlan(arrays.plan,{cwd:root,emitWat:false}),{request:{method:'POST',path:'/',url:'https://test/'}})).response.body,'true');
    const reject = (helper,body) => assert.throws(()=>compile(helper,body),e=>Boolean(e.diagnostics?.length));
    let rejections=0;
    for(const statement of ['head.revision=2;','const alias=head;alias.root.node++;','const alias=head.counters;alias[0]=1;',
      'head.counters.push(1);','const alias=head;return alias;','const out={head};','const f=()=>head;','return other(head);',
      'let alias=head;alias=head;']) {reject(original.replace('  if (head.subjectKind',`  ${statement}\n  if (head.subjectKind`));rejections++;}
    for(const type of ['{x?:number}','{x:string[]}','{x:{y:{z:number}}}','{[key:string]:number}','{x:number}|null','{x:()=>number}','{x:any}']) {
      reject(`export function validPartition(head:${type},a:string,b:string,c:number):boolean{return true;}`);rejections++;
    }
    reject(original,`const head=${JSON.stringify(fresh())};const alias=head.root;alias.node='wrong';const result=validPartition(head,'item','abc',0);return ctx.text(''+result);`);rejections++;
    for(const setup of ["const alias=true?head:head;alias.root.node='wrong';", "let alias={};alias=head;alias.root.node='wrong';", "const box={value:head};box.value.root.node='wrong';"]) {
      reject(original,`const head=${JSON.stringify(fresh())};${setup}const result=validPartition(head,'item','abc',0);return ctx.text(''+result);`);rejections++;
    }
    reject(original,`const head=ctx.req.json();const result=validPartition(head,'item','abc',0);return ctx.text(''+result);`);rejections++;
    reject(original,`const head=await ctx.req.json('app.Head');for(let i=0;i<2 && validPartition(head,'item','abc',i);i++){}return ctx.text('x');`);rejections++;
    const find=(v,predicate)=>{if(!v||typeof v!=='object')return;if(predicate(v))return v;for(const child of Object.values(v)){const result=find(child,predicate);if(result)return result;}};
    const mutations=[
      p=>p.helpers[0].parameters[0].borrow.version='old',
      p=>delete p.helpers[0].parameters[0].borrow,
      p=>p.helpers[0].parameters[0].borrow.type.fields=null,
      p=>p.helpers[0].parameters[0].borrow.type.fields=[null],
      p=>p.helpers[0].parameters[0].borrow.mutable=true,
      p=>p.helpers[0].parameters[0].borrow.type.fields[0].type='function',
      p=>p.helpers[0].parameters[0].borrow.type.fields.push(p.helpers[0].parameters[0].borrow.type.fields[0]),
      p=>p.helpers[0].parameters[0].borrow.type.fields[0].name='__proto__',
      p=>p.helpers[0].parameters[0].borrow.type.fields[0].optional=true,
      p=>p.helpers[0].parameters[0].borrow.type.fields.find(f=>f.name==='counters').type.element='string',
      p=>find(p.helpers[0].body,e=>e.kind==='property').property='missing',
      p=>find(p.helpers[0].body,e=>e.kind==='element').index={kind:'literal',value:'zero',valueKind:'string'},
      p=>find(p.helpers[0].body,e=>e.kind==='property').valueKind='boolean',
      p=>p.helpers[0].body.unshift({kind:'expression',expression:{kind:'assignment',operator:'=',target:{kind:'property',object:{kind:'local',id:p.helpers[0].parameters[0].localId,valueKind:'object'},property:'revision',valueKind:'number'},value:{kind:'literal',value:5,valueKind:'number'},valueKind:'number'}}),
      p=>find(p.handlers,e=>e.kind==='pure-helper-call').arguments[0]={kind:'object',entries:[],valueKind:'object'},
      p=>p.helpers[0].body.at(-1).value={kind:'local',id:p.helpers[0].parameters[0].localId,valueKind:'object'},
    ];
    for(const [i,mutation] of mutations.entries()){
      const p=structuredClone(plan);mutation(p);delete p.planHash;p.planHash=createHash('sha256').update(stableStringify(p)).digest('hex');
      assert.throws(()=>validateCanonicalNativePlan(p),e=>e.name==='CanonicalNativePlanError',`tamper ${i}`);
    }
    // Compare repeated borrowing against an identical caller with no helper calls.
    // Counting heap insertions distinguishes handles from copied payload objects.
    const costs=[];
    for(const count of [0,1,2,16]) {
      const calls=Array.from({length:count},(_,i)=>`const result${i}=validPartition(head,'item','abc',0);`).join('');
      const {plan:costPlan}=compile(original,`const head=await ctx.req.json('app.Head');${calls}return ctx.text('done');`);
      const artifact=compileCanonicalNativePlan(costPlan,{cwd:root,emitWat:false});
      const controller=await tc.instantiateCanonicalNativeModule(artifact,{request:{method:'POST',path:'/',url:'https://test/',body:JSON.stringify(fresh()),headers:{'content-type':'application/json'}}});
      const inserted=[];const put=controller.heap.put.bind(controller.heap);controller.heap.put=v=>{inserted.push(v);return put(v);};
      controller.start();
      const objects=inserted.filter(v=>v&&typeof v==='object'&&(Array.isArray(v)||v.subjectKind!==undefined||v.hash!==undefined));
      assert.equal(new Set(objects).size,count ? 3 : 1,'one head, nested record and numeric array payload');
      assert.equal(costPlan.effects.length,0);assert.equal(costPlan.continuations.length,0);
      costs.push({calls:count,handles:controller.heap.size(),structuredHandleInsertions:objects.length,distinctPayloadObjects:new Set(objects).size,wasmBytes:artifact.wasm.length,linearMemoryBytes:controller.exports.memory.buffer.byteLength});
      controller.close();
    }
    console.log(JSON.stringify({status:'passed',parityCases:cases.length,sourceRejections:rejections,planRejections:mutations.length,costs,
      representation:'Borrowed i32 value handles; no per-call serialization, effects, payload copies or guest heap allocation. Property/operator reads retain existing host-handle costs; no reclamation or RSS claim.'}));
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1;});
