'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { generateCanonicalNativeAssemblyScript } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { prepareHandleOwnership } = require('../../packages/runtime-core-as/src/compiler/canonical-native-ownership');
const ownership = require('../../../packages/provider-fastly/src/build/native-handle-ownership');
const { build, planFor } = require('./assert-fastly-handle-ownership.cjs');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root = path.resolve(__dirname, '../../..');
const origin = 'https://frames.test';
const providerOptions = { bindings: { backends: { [origin]: 'origin' }, configStore: 'config', secretStore:'secrets', kv:{proof:'proof'} } };
const churn = `let n=70000.25;let text='';const box={value:n};
for(let outer=0;outer<32;outer++){if(outer>=input.n)break;for(let i=0;i<128;i++){n+=0.25;box.value=n;text=('replacement-'+n+' ').trim();}}`;

function fixture() {
  const cwd = fs.mkdtempSync(path.join(root, '.mem9-frames-'));
  fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},native:{host:'fastly',target:'native',fastly:${JSON.stringify(providerOptions)}}}));`);
  fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
export default defineSchemaRegistry({schemas:{'proof.Input':schema<{n:number}>()}});`);
  fs.writeFileSync(path.join(cwd, 'src/pure.ts'), `export function borrowed(value:string, amount:number):string {
let text=value;for(let i=0;i<128;i++){text=text+'x';}return value;}`);
  fs.writeFileSync(path.join(cwd, 'src/lookup.ts'), `export async function lookup(ctx, key:string) {
if(key==='early')return key;let text=key;for(let i=0;i<128;i++){text=(' '+key+i+' ').trim();}
const answer=await ctx.fetch('${origin}/'+key,{timeoutMs:2000}).text();return text+'|'+answer;}`);
  fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
import {borrowed} from './pure';import {lookup} from './lookup';
const app=new Pulse({auto:true});
const shared=async(ctx,next)=>{const tag=await ctx.fetch('${origin}/tag').text();ctx.state.set('stage',tag||'missing');return next();};
app.post('/frames',shared);app.post('/stage',shared);app.use('/twostages',shared);app.post('/twostages',shared);
app.post('/frames',async ctx=>{const input=await ctx.req.json('proof.Input');const keep='caller-'+input.n;
const expression=['left-'+input.n,borrowed('borrowed-'+input.n,input.n)];
const early=await lookup(ctx,'early');const a=await lookup(ctx,'a');const b=await lookup(ctx,'b');
${churn}return ctx.json({keep,expression,early,a,b,n,text,box,stage:ctx.state.get('stage')});});
app.post('/stage',async ctx=>{const input=await ctx.req.json('proof.Input');${churn}return ctx.json({stage:ctx.state.get('stage'),n,text});});
app.post('/twostages',async ctx=>{const input=await ctx.req.json('proof.Input');${churn}return ctx.json({stage:ctx.state.get('stage'),n,text});});
app.post('/group',async ctx=>{const input=await ctx.req.json('proof.Input');
const {slow,fast}=await ctx.parallel({slow:ctx.fetch('${origin}/slow',{timeoutMs:2000}),fast:ctx.fetch('${origin}/fast',{timeoutMs:500})});
${churn}return ctx.json({slow:slow.status,fast:fast.status,n,text});});
app.post('/opaque',async ctx=>{const input=await ctx.req.json('proof.Input');const response=await ctx.fetch('${origin}/a',{timeoutMs:1000});${churn}return response;});
app.post('/ready',async ctx=>{const input=await ctx.req.json('proof.Input');
const {tag,secret,row}=await ctx.parallel({tag:ctx.config.get('TAG'),secret:ctx.secret.get('KEY'),row:ctx.kv('proof').get('row')});
${churn}return ctx.json({tag,secret,row,n,text});});
app.error(async(error,ctx,next)=>{const input={n:2};const original=error;${churn}
if(ctx.req.header('x-recover')==='again'){const result=await ctx.fetch('${origin}/recovery',{timeoutMs:1000});return ctx.text(original.code+'|'+result.status);}
return ctx.json({code:original.code,n,text});});
export default app;`);
  try {
    const tc=acceptanceToolchain();
    const plan=buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'native'})));
    return {cwd,plan};
  } catch(e) { fs.rmSync(cwd,{recursive:true,force:true}); throw e; }
}
function request(route='/frames', n=1, extra={}) {
  return {clockUnixSeconds:1700000000,request:{method:'POST',path:route,headers:[['content-type','application/json']],body:JSON.stringify({n})},
    configStores:{config:{TAG:'stage-tag'}},secretStore:'secrets',secrets:{KEY:'fixture-secret'},kvStores:{proof:{row:{value:'stored'}}}, fixtures:{
      [origin+'/tag']:{status:200,body:'stage-tag'},[origin+'/a']:{status:201,body:'alpha'},[origin+'/b']:{status:202,body:'beta'},
      [origin+'/slow']:{status:203,body:'slow',delayMs:1500},[origin+'/fast']:{status:204,body:'',delayMs:100},
      [origin+'/recovery']:{status:205,body:'recovered',delayMs:600}},
    allowHandledFetchDeadlineError:true,allowHandledTransportError:true,...extra};
}
function semantics(r) { return {response:r.response,trace:r.trace,outboundRequests:r.outboundRequests,
  transportResources:r.transportResources,monotonicMs:r.monotonicMs}; }
function admission(plan) {
  const portable=generateCanonicalNativeAssemblyScript(plan,{handleOwnership:'fastly-handle-tracing-v1'});
  assert.equal(portable.manifest.handleOwnership.enabled,true,JSON.stringify(portable.manifest.handleOwnership));
  assert.equal(plan.helpers.length,2);assert.equal(plan.stages.length,1);
  ownership.validateRoots(plan,portable.manifest);
  for(const name of ownership.providerRoots(plan)) assert.throws(()=>ownership.providerSource(plan,true,
    ownership.providerRoots(plan).filter(x=>x!==name)),/provider root descriptor/);
  // Every frame/result/state owner is independently mandatory, regardless of
  // whether a ready flag or the current program counter happens to use it.
  for (const root of portable.manifest.handleOwnership.roots) {
    assert.throws(()=>ownership.validateRoots(plan,{...portable.manifest,handleOwnership:{...portable.manifest.handleOwnership,
      roots:portable.manifest.handleOwnership.roots.filter(x=>x!==root)}}),/root descriptor/,root);
  }
  const base={plan,policy:'fastly-handle-tracing-v1',schemaActive:true,budgeted:false,expressions:[],eventReachable:false};
  for (const p of [
    {...plan,helpers:[...plan.helpers,{version:'future-frame',body:[]}]},
    {...plan,stages:[{version:'future-stage',body:[]}]},
    {...plan,helpers:plan.helpers.map(h=>({...h,body:[{kind:'unknown-owner'}]}))},
    {...plan,stages:plan.stages.map(s=>({...s,body:[{kind:'unknown-owner'}]}))},
    {...plan,effects:[...plan.effects,{kind:'unknown-effect'}]}
  ]) assert.equal(prepareHandleOwnership({...base,plan:p}).enabled,false);
  const pure=portable.source.split('function __pulse_pure_helper_')[1].split('\nfunction ')[0];
  assert(!pure.includes('__pulse_handle_checkpoint'), 'pure helper cannot collect across caller operands');
  return portable.manifest.handleOwnership.roots.length;
}
function withProbes(fn) {
  const original=ownership.tableSource;
  ownership.tableSource=enabled=>original(enabled)+(enabled?`
export function frames_roots(): void {
  __pulse_fastly_payloads[0] = __pulse_fastly_string_value('provider payload only')
  __pulse_fastly_ready[0] = __pulse_fastly_string_value('provider ready only')
  __pulse_effect_result_0 = __pulse_fastly_string_value('guest result with cleared flags')
  __pulse_effect_ready_0 = 0; __pulse_effect_pending_0 = 0
  __pulse_helper_result = __pulse_fastly_string_value('helper return only')
}
export function frames_valid(): bool {
  return __pulse_fastly_string(__pulse_fastly_payloads[0]) == 'provider payload only'
    && __pulse_fastly_string(__pulse_fastly_ready[0]) == 'provider ready only'
    && __pulse_fastly_string(__pulse_effect_result_0) == 'guest result with cleared flags'
    && __pulse_fastly_string(__pulse_helper_result) == 'helper return only'
}
export function frames_resource(): i32 {
  const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_FETCH
  value.responseHandle = 1900000000; value.bodyHandle = 1900000001
  return __pulse_fastly_put(value)
}
export function frames_pins(): i32 { return __pulse_handle_resource_roots.length }
export function frames_duplicate(): i32 { return __pulse_invocation_settle(0, 1, __pulse_effect_result_0) }
`: '');
  try { return fn(); } finally {ownership.tableSource=original;}
}
function resourceCases(cwd, elideJsonCacheArena) {
  const tc=acceptanceToolchain(), configFile=path.join(cwd,'.pulse/config.ts'), entryFile=path.join(cwd,'src/index.ts');
  const schema=`ctx.decodeJson('{"n":1}','proof.Input');`;
  const body=Buffer.from([0,255,192,128,254,1]);let cases=0;
  for(const kind of ['forward','s3']) {
    const binding={endpoint:origin,bucket:'body-fixture',region:'us-east-1',accessKeyIdSecret:'KEY',secretAccessKeySecret:'SECRET',maxTextBytes:32768,timeoutMs:1000,backend:'origin'};
    const config=kind==='forward'?{...providerOptions,maxDurationMs:2000,bodyForwarding:{requestMaxBytes:32768,responseMaxBytes:32768}}
      :{maxDurationMs:500,bindings:{secretStore:'app_secrets',s3:{objects:binding}}};
    fs.writeFileSync(configFile,`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false,crypto:['SHA-256','HMAC-SHA256']},native:{host:'fastly',target:'native',fastly:${JSON.stringify(config)}}}));`);
    fs.writeFileSync(entryFile,`import {Pulse} from '@pulse-compute/pulse';${kind==='s3'?"import {s3} from '@pulse-compute/s3';":''}
const app=new Pulse({auto:true});app.post('/',async ctx=>{${schema}
${kind==='forward'?`return ctx.fetch('${origin}/upload',{method:'POST',body:ctx.req.body(),timeoutMs:1500});`
  :`const response=await s3.getBody(ctx,'objects','image');let text='';for(let i=0;i<128;i++){text=('replace-'+i+' ').trim();}return response;`}});
${kind==='s3'?`app.post('/discard',async ctx=>{${schema}const response=await s3.getBody(ctx,'objects','image');let text='';for(let i=0;i<128;i++){text=('replace-'+i+' ').trim();}return ctx.text('discarded');});`:''}
export default app;`);
    const plan=buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'native'})));
    const traced=build(plan,{force:true,observed:true,providerOptions:config,elideJsonCacheArena});
    const control=build(plan,{retained:true,providerOptions:config,elideJsonCacheArena});
    assert.equal(traced.manifest.handleOwnership.enabled,true,JSON.stringify(traced.manifest.handleOwnership));
    for(const root of ownership.providerRoots(plan)) assert.throws(()=>ownership.providerSource(plan,true,
      ownership.providerRoots(plan).filter(x=>x!==root)),/provider root descriptor/);
    for(const fault of [{},{delayMs:3000},{bodyDelayMs:3000},{bodyReadStatus:1}]) {
      const opts={request:{method:'POST',path:'/',body},secrets:{KEY:'fixture-key',SECRET:'fixture-secret'},secretStore:'app_secrets',
        clockUnixSeconds:1369353600,allowAbortedResponse:true,fixtures:{
          [kind==='forward'?origin+'/upload':origin+'/body-fixture/image']:{status:200,headers:[['content-length','6']],body,chunkBytes:2,...fault}}};
      const a=execute(traced,opts),b=execute(control,opts);assert.deepEqual(semantics(a),semantics(b));
      assert(a.instance.exports.mem9_sweeps()>0);if(Object.keys(fault).length===0)assert.deepEqual(a.response.bodyBytes,body);cases++;
      if(kind==='s3'&&Object.keys(fault).length===0) {
        opts.request.path='/discard';opts.fixtures[origin+'/body-fixture/image'].bodyDelayMs=3000;
        const r=execute(traced,opts);assert.deepEqual(semantics(r),semantics(execute(control,opts)));assert.equal(r.response.body,'discarded');
        assert.equal(r.trace.filter(x=>x.name==='read'&&x.handle!==2).length,0);cases++;
      }
    }
  }
  return cases;
}
function fatalCases(elideJsonCacheArena) {
  const plan=planFor(`const result=await ctx.fetch('${origin}/slow',{timeoutMs:100});return ctx.text(''+result.status);`);
  const traced=build(plan,{force:true,observed:true,providerOptions,elideJsonCacheArena}),
    retained=build(plan,{retained:true,providerOptions,elideJsonCacheArena});
  for(const [fault,status,body] of [[{neverHeaders:true},504,'Gateway Timeout'],[{transportStatus:1},502,'Bad Gateway'],[{sendStatus:1},502,'Bad Gateway']]) {
    const opts=request('/');opts.fixtures[origin+'/slow']={...fault};
    const a=execute(traced,opts),b=execute(retained,opts);assert.deepEqual(semantics(a),semantics(b));
    assert.equal(a.response.status,status);assert.equal(a.response.body,body);
    assert.equal(a.instance.exports.pulse_fastly_last_error(),b.instance.exports.pulse_fastly_last_error());
    assert.equal(a.instance.exports.pulse_fastly_error_stage(),b.instance.exports.pulse_fastly_error_stage());
    const e=a.instance.exports,before=e.mem9_count();e.mem9_sweep();assert.equal(e.mem9_count(),before,'latched failure suppresses collection');
  }
  return 3;
}
async function main() {
  const {cwd,plan}=fixture();
  try {
    const rootRejections=admission(plan), rows=[];
    for(const elideJsonCacheArena of [false,true]) {
      const control=build(plan,{retained:true,providerOptions,elideJsonCacheArena});
      const traced=withProbes(()=>build(plan,{force:true,observed:true,providerOptions,elideJsonCacheArena}));
      let cases=0;
      const compare=opts=>{const a=execute(traced,opts),b=execute(control,opts);assert.deepEqual(semantics(a),semantics(b));cases++;return a;};
      for(const route of ['/frames','/stage','/twostages','/group','/opaque','/ready']) {
        const r=compare(request(route,2));assert(r.instance.exports.mem9_sweeps()>0);
      }
      const good=compare(request('/frames',1));const output=JSON.parse(good.response.body);
      assert.deepEqual(output.expression,['left-1','borrowed-1']);assert.equal(output.keep,'caller-1');
      assert.equal(output.a,'a127|alpha');assert.equal(output.b,'b127|beta');assert.equal(output.stage,'stage-tag');
      const invalid=request('/frames');invalid.request.body='{"n":"invalid"}';
      assert.equal(JSON.parse(compare(invalid).response.body).code,'PULSE_SCHEMA_DECODE');
      for(const fault of [{neverHeaders:true},{transportStatus:1,delayMs:10},{sendStatus:1}]) {
        const opts=request('/group');opts.fixtures[origin+'/slow']={...opts.fixtures[origin+'/slow'],...fault};
        const r=compare(opts);assert.match(JSON.parse(r.response.body).code,/PULSE_FETCH_(TIMEOUT|NETWORK)/);
      }
      // Retired completion arrives during recovery; cleanup must still reap it
      // without exposing the cancelled result or closing a different wrapper.
      const late=request('/opaque');late.fixtures[origin+'/a'].delayMs=1400;late.request.headers.push(['x-recover','again']);
      const lr=compare(late);assert.equal(lr.response.body,'PULSE_FETCH_TIMEOUT|205');
      assert.equal(lr.instance.exports.pulse_fastly_fetch_unreaped(),0);
      const e=good.instance.exports;e.frames_roots();const resource=e.frames_resource();e.mem9_sweep();e.mem9_gc();
      assert.equal(e.frames_valid(),1);assert.equal(e.mem9_has(resource),1,'wrapper pinned; raw resource IDs are not handles');
      assert.equal(e.frames_duplicate(),0,'closed invocation rejects late/duplicate settlement');
      assert.equal(e.pulse_fastly_error_stage(),171);
      for(const artifact of [traced,control]) {
        const controller=new AbortController(),cancelled=new Error('cancelled by host');
        const opts=request('/group');opts.signal=controller.signal;opts.asyncSelectFault=()=>{controller.abort(cancelled);};
        assert.throws(()=>execute(artifact,opts),error=>error===cancelled);
      }
      const ordinary=build(plan,{observed:true,providerOptions,elideJsonCacheArena});
      const retained=build(plan,{observed:true,retained:true,providerOptions,elideJsonCacheArena});
      const cells=[];
      for(const n of [1,8,32]) {
        const a=execute(ordinary,request('/frames',n)),b=execute(retained,request('/frames',n));
        assert.deepEqual(semantics(a),semantics(b));const x=a.instance.exports;
        cells.push({n,live:x.mem9_count(),retained:b.instance.exports.mem9_count(),peakCapacity:x.mem9_peak_capacity(),
          peakScratch:x.mem9_peak_scratch(),sweeps:x.mem9_sweeps(),memoryBytes:x.memory.buffer.byteLength});
      }
      assert(cells[2].retained>cells[0].retained*5);assert(cells.every(c=>c.live<4000&&c.peakCapacity<8000));
      assert(cells[2].live<cells[2].retained/5);
      rows.push({elideJsonCacheArena,cases,cells,resourceCases:resourceCases(cwd,elideJsonCacheArena),fatalCases:fatalCases(elideJsonCacheArena)});
    }
    console.log(JSON.stringify({task:'MEM9-09B',status:'passed',providerReality:false,rootRejections,rows}));
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={fixture,request,semantics,providerOptions,main};
if(require.main===module)main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1;});
