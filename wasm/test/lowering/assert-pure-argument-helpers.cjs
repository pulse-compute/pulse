'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {acceptanceToolchain}=require('../s3/acceptance-toolchain.cjs');
const {buildCanonicalNativePlan,validateCanonicalNativePlan,stableStringify}=require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-compiler');
const root=path.resolve(__dirname,'../../..'),tc=acceptanceToolchain(),fixtures=path.join(__dirname,'../fixtures/pure-helpers');
const fresh=()=>({subjectKind:'item',subjectId:'abc',partition:0,revision:1,root:{hash:'hash',node:0},counters:Array(10).fill(0)});
const find=(v,p)=>{if(!v||typeof v!=='object')return;if(p(v))return v;for(const child of Object.values(v)){const result=find(child,p);if(result)return result;}};
const rehash=p=>{delete p.planHash;p.planHash=createHash('sha256').update(stableStringify(p)).digest('hex');return p;};
async function main(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-pf06-'));
 try{
  fs.mkdirSync(cwd+'/src');fs.mkdirSync(cwd+'/.pulse');fs.mkdirSync(cwd+'/node_modules/@pulse-compute',{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(root+'/packages/'+name,cwd+'/node_modules/@pulse-compute/'+name,'dir');
  for(const name of ['types.ts','partition.ts'])fs.copyFileSync(fixtures+'/'+name,cwd+'/src/'+name);
  fs.writeFileSync(cwd+'/src/schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {PartitionHead} from './types';type Input={id:string;kind?:string};export default defineSchemaRegistry({schemas:{'app.Head':schema<PartitionHead>(),'app.Input':schema<Input>()}});`);
  fs.writeFileSync(cwd+'/.pulse/config.ts',`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);
  function compile(body){
   fs.writeFileSync(cwd+'/src/index.ts',`import {Pulse} from '@pulse-compute/pulse';import type {PartitionHead} from './types';import {validPartition} from './partition';const app=new Pulse({auto:true});app.post('/',async(ctx)=>{${body}});export default app;`);
   return buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));
  }
  const call=`return ctx.text(''+validPartition(head,'item','abc',head.partition));`;
  const kv=`const store=ctx.kv<PartitionHead>('records');const row=await store.getVersioned('0');if(row.status!=='found')return ctx.text(row.status);const head=row.value;`;
  const variants=[
   `const head=await ctx.req.json('app.Head');${call}`,
   `${kv}${call}`,
   `${kv.replace('const head=row.value;',`let head=${JSON.stringify(fresh())};if(row.status==='found')head=row.value;`)}${call}`,
   `const text=await ctx.req.text();let input=null;if(ctx.req.method==='POST')input=ctx.decodeJson(text,'app.Input');if(input===null)return ctx.text('missing');const head=${JSON.stringify(fresh())};const kind=input.kind||'item';const id=input.id[0]+input.id[1]+input.id[2];return ctx.text(''+validPartition(head,kind,id,head.counters[0]));`,
   `const head=${JSON.stringify(fresh())};const alias=head.root;return ctx.text(''+validPartition(head,'item','abc',alias.node));`,
   `let result=true;for(let i=0;i<16;i++){${kv.replace("const store=ctx.kv<PartitionHead>('records');",'').replace('store.getVersioned',"ctx.kv<PartitionHead>('records').getVersioned").replace("'0'","''+i") }if(!validPartition(head,'item','abc',head.partition))result=false;}return ctx.text(''+result);`
  ];
  const plans=[];let parityCases=0;
  const {createNodeKvReference}=require('../../../packages/provider-node/src/runtime/conditional-kv');
  for(const [index,body] of variants.entries()){
   const plan=compile(body);plans.push(plan);validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
   assert.equal(plan.helpers.length,1);assert.equal(plan.effects.length,body.includes('getVersioned')?1:0);
   const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
   const js=tc.prepareJavascriptApplication(tc.resolveProject({cwd,profile:'js'}));
   const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(plan.schemas.registry);
   const cases=body.includes('getVersioned')?[{status:'found',value:fresh(),expected:'true'}, {status:'found',value:{...fresh(),revision:-1},expected:'false'}, {status:'found',value:{...fresh(),revision:'bad'},expected:'false'}, {status:'found',value:{...fresh(),counters:[]},expected:'false'}, {status:'found',value:{...fresh(),subjectId:'other'},expected:'false'}, {status:'not-found',expected:'not-found'}, {status:'failed',expected:'failed'}]:[{expected:'true'}];
   for(const vector of cases){
    const bodyText=JSON.stringify(index===3?{id:'abc'}:fresh()),request={method:'POST',path:'/',url:'https://pf06.test/',body:bodyText,headers:{'content-type':'application/json'}};
    const before=JSON.stringify(vector.value),keys=[];
    const nr=await tc.executeCanonicalNativeModule(native,{request,strict:false,providerAdapter:{id:'pf06',dispatchEffect:e=>{keys.push(e.key);return vector.status==='found'?{status:'found',value:vector.value,generation:'g'}:{status:vector.status};}}});
    // The reference host supports found/not-found; failed outcomes are asserted on Native separately.
    if(vector.status!=='failed'){
     const reference=createNodeKvReference({kvInstanceId:'pf06'});
     if(vector.status==='found')for(let i=0;i<16;i++)reference.kv('records').put(''+i,vector.value);
     const jr=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{method:'POST',body:bodyText,headers:request.headers}),{strict:false,kvReference:reference,schemaCodecs});
     assert.equal(await jr.text(),vector.expected,`JS ${index}`);parityCases++;
    }
    assert.equal(nr.response.body,vector.expected,`Native ${index}`);assert.equal(JSON.stringify(vector.value),before);
    assert.deepEqual(keys,body.includes('getVersioned')?Array.from({length:index===5 && vector.status==='found'?16:1},(_,i)=>''+i):[]);
   }
  }
  const negatives=[
   `${kv.replace('<PartitionHead>','')}${call}`,
   `${kv.replace('<PartitionHead>','<unknown>')}${call}`,
   `${kv.replace('<PartitionHead>','<{x:number}>')}${call}`,
   `${kv}head.root.node=2;${call}`,
   `${kv}const alias=head.counters;alias[0]=2;${call}`,
   `${kv}const box={head};box.head.revision=2;${call}`,
   `${kv.replace('const head=row.value;',`let head=${JSON.stringify(fresh())};head=row.value;head={x:1};`)}${call}`,
   `const head=ctx.req.json() as PartitionHead;${call}`,
   `const head=await ctx.req.json('app.Head');return ctx.text(''+validPartition(head,'item','abc',head.missing));`,
   variants[3].replace("if(input===null)return ctx.text('missing');",''),
   variants[3].replace("if(input===null)return ctx.text('missing');","if(input!==null && (input=null)===null){}else{return ctx.text('missing');}"),
   variants[3].replace("const head=", "for(let k=0;k<2;k++){const head=").replace("return ctx.text(''+validPartition(head,kind,id,head.counters[0]));", "const ok=validPartition(head,kind,id,head.counters[0]);input=null;}return ctx.text('done');"),
   variants[3].replace("if(input===null)return ctx.text('missing');","if(input!==null)return ctx.text('missing');"),
  ];
  for(const [i,body] of negatives.entries())assert.throws(()=>compile(body),e=>Boolean(e.diagnostics?.length),`source ${i}`);
  const callIn=p=>find(p.handlers,e=>e.kind==='pure-helper-call');
  const mutations=[
   p=>delete p.effects[0].borrowedValue,
   p=>p.effects[0].borrowedValue.version='old',
   p=>p.effects[0].borrowedValue.type.fields[0].type='function',
   p=>p.effects[0].borrowedValue.type.fields[0].type='number',
   p=>p.effects[0].borrowedValue.mutable=true,
   p=>{const arg=callIn(p).arguments[3];arg.property='missing';arg.valueKind='number';},
   p=>callIn(p).arguments[3].valueKind='string',
   p=>callIn(p).arguments[3].object.valueKind='number',
   p=>p.effects[0].operation='get',
   p=>find(p.handlers,e=>e.kind==='property'&&e.property==='value').object.id='local:forged',
   p=>{p.effects[0].borrowedValue.type={kind:'record',fields:[]};},
  ];
  for(const [i,mutate] of mutations.entries()){const p=structuredClone(plans[1]);mutate(p);assert.throws(()=>validateCanonicalNativePlan(rehash(p)),e=>e.name==='CanonicalNativePlanError',`plan ${i}`);}
  const nullPlan=structuredClone(plans[3]);find(nullPlan.handlers,e=>e.kind==='binary' && e.operator==='===' && e.right?.value===null).operator='!==';
  assert.throws(()=>validateCanonicalNativePlan(rehash(nullPlan)),e=>e.name==='CanonicalNativePlanError');
  console.log(JSON.stringify({status:'passed',parityCases,variants:variants.length,sourceRejections:negatives.length,planRejections:mutations.length+1}));
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
const keep=setInterval(()=>{},1000);main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1;}).finally(()=>clearInterval(keep));
