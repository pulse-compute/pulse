'use strict';
// Real generator/driver qualification. Observers use the maintained trusted
// lifecycle seam; no generated source replacement or production test switch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const installed = process.argv.includes('--installed');
const root = installed ? fs.realpathSync(process.cwd()) : path.resolve(__dirname,'../../..');
function load(name,file) {
  let directory;
  if (installed) {
    directory=path.dirname(require.resolve('@pulse-compute/'+name));
    while(!fs.existsSync(path.join(directory,'package.json'))) directory=path.dirname(directory);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'package.json'))).name,'@pulse-compute/'+name);
    assert(fs.realpathSync(directory).startsWith(root+path.sep));
  } else directory=path.join(root,name.startsWith('wasm-')?'wasm/packages/'+name.slice(5):'packages/'+name);
  return require(path.join(directory,'src',file));
}
const {compileCanonicalSource}=load('wasm-compiler','canonical-api-compiler');
const {compileCanonicalProject}=load('wasm-compiler','canonical-project-compiler');
const {buildCanonicalNativePlan}=load('wasm-compiler','canonical-native-plan');
const generator=load('provider-fastly','build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities:execute}=load('provider-fastly','testing/native-platform-capabilities-host');
const url='https://origin.example/body', bound=1024;
const sources={};
const source=sources.alias=`export default async function handler(ctx){const a=await ctx.fetch('${url}',{timeoutMs:500}).text(); const b=a; return ctx.text(a+b)}`;
const options={cwd:root,emitWat:false,requirePlatformCapability:false,maxDurationMs:1000,
  bindings:{backends:{'https://origin.example':'origin'}}};
function planFor(source, contentTypePolicy = 'accept-json-or-missing', typed = false, files = {}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-fetch-accounting-'));
  try {const file=path.join(dir,'index.ts');fs.writeFileSync(file,source);for(const [name,text]of Object.entries(files))fs.writeFileSync(path.join(dir,name),text);
    fs.writeFileSync(path.join(dir,'schemas.ts'),'export interface Origin {name:string; count:number}');
    return buildCanonicalNativePlan(compileCanonicalProject(file,{rootDir:dir,workspaceRoot:root,schemas:{maxBytes:bound,contentTypePolicy,...(typed?{entries:[{id:'app.Origin',namespace:'app',name:'Origin',source:'./schemas.ts',type:'Origin'}]}:{})},strict:false}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

function main(){
 const cases=[],check=(name,fn)=>{try{fn();cases.push(name)}catch(e){e.message=name+': '+e.message;throw e}};
 const observer=[{point:'invocation.closed',owner:'fetch-cohort-proof',order:100,body:`if(__fetch_ra===null)return; const l=__fetch_ra!; if(offsetof<__FCA_Header>()>16)unreachable(); if(!l.closed||l.backing!=__FCA_BACKING)unreachable(); __pulse_fastly_jwt_secret_calls=i32(l.handles);__pulse_fastly_jwt_crypto_calls=i32(l.records);__pulse_fastly_jwt_clock_calls=i32(l.primary);`}];
 const compile=(s,policy='accept-json-or-missing',files={})=>{const plan=planFor(s,policy,false,files);assert.equal(generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).manifest.resourceAccounting?.selection,'canonical-fetch-cohorts',s);return generator.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:observer});};
 const run=(c,fixture={},extra={})=>execute(c,{fixtures:{[url]:{body:'hello',headers:[['content-type','application/json'],['x-test','retained']],...fixture}},traceBodyIo:true,sendErrorDetailLayout:'scratch',allowHandledTransportError:true,allowHandledFetchDeadlineError:true,...extra});
 const plain=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(source),options);
 const alias=compile(source); assert.equal(alias.manifest.resourceAccounting.selection,'canonical-fetch-cohorts');
 const cleanupStorage=/const __fca_io:usize=memory\.data\((\d+)\)/.exec(alias.source);assert(cleanupStorage&&Number(cleanupStorage[1])>=20+3*4,'cleanup owns a complete ABI detail record and three disjoint outputs');
 check('retained-text-alias',()=>{const r=run(alias);const p=run(plain);assert.deepEqual(r.response,p.response);assert.deepEqual(r.trace,p.trace);assert.equal(r.response.body,'hellohello');assert.equal(r.trace.filter(x=>x.name==='close').length,2);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0)});
 const group=compile(sources.group=`export default async function handler(ctx){const {a,b}=await ctx.parallel({a:ctx.fetch('${url}',{timeoutMs:500}).text(),b:ctx.fetch('${url}',{timeoutMs:500}).text()});return ctx.text(a+b)}`);
 check('parallel-cohort',()=>{const r=run(group);assert.equal(r.response.body,'hellohello');assert.equal(r.trace.filter(x=>x.name==='close').length,4);const sends=r.trace.map((x,i)=>x.name==='send_async'?i:-1).filter(x=>x>=0),poll=r.trace.findIndex(x=>x.name==='pending_req_poll_v2');assert(sends.every(x=>x<poll));assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0)});
 const opaque=compile(sources.opaque=`export default async function handler(ctx){const r=await ctx.fetch('${url}');return r}`);
 check('opaque-transfer-without-timeout',()=>{const r=run(opaque);assert.equal(r.response.body,'hello');assert(!r.trace.some(x=>x.name==='close'));assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0)});
 const upload=compile(sources.upload=`export default async function handler(ctx){const r=await ctx.fetch('${url}',{method:'POST',body:'é雪😀',timeoutMs:500}).text();return ctx.text(r)}`);
 check('upload',()=>{const r=run(upload);assert.equal(r.response.body,'hello');assert.equal(r.outboundRequests[0].body,'é雪😀');assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0)});
 const cached=compile(`export default async function handler(ctx){const r=await ctx.fetch('${url}',{timeoutMs:500});const alias=r;const a=r.json();const b=alias.json();return ctx.json({a,b,h:r.header('x-test'),again:alias.header('x-test'),s:r.status})}`,'require-json');
 check('response-alias-cache',()=>{const r=run(cached,{body:'{"n":1}'});assert.deepEqual(JSON.parse(r.response.body),{a:{n:1},b:{n:1},h:'retained',again:'retained',s:200});assert.equal(r.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='header_values_get').length,2);assert.equal(r.trace.filter(x=>x.name==='close').length,2)});

 const sequential=compile(`export default async function handler(ctx){const a=await ctx.fetch('${url}',{timeoutMs:500});const b=await ctx.fetch('${url}',{timeoutMs:500});return ctx.text(a.text()+b.text()+a.text())}`);
 check('sequential-frames-retain-earlier-alias',()=>{const r=run(sequential);assert.equal(r.response.body,'hellohellohello');assert.equal(r.trace.filter(x=>x.name==='close').length,4);assert.equal(r.trace.filter(x=>x.name==='read').length,4)});
 const dynamic=compile(`export default async function handler(ctx){const target=ctx.req.header('x-url');const body=ctx.req.header('x-body')||'';const result=await ctx.fetch(target,{method:ctx.req.method,body,headers:{'x-path':ctx.req.path},timeoutMs:500}).text();return ctx.text(result)}`);
 check('dynamic-fields-use-existing-reader-bounds',()=>{const r=run(dynamic,{}, {request:{method:'POST',headers:[['x-url',url],['x-body','é雪😀']]}});assert.equal(r.response.body,'hello');assert.equal(r.outboundRequests[0].body,'é雪😀');assert.equal(r.outboundRequests[0].method,'POST')});
 const jsonUpload=compile(`export default async function handler(ctx){const result=await ctx.fetch('${url}',{method:'POST',json:{name:'é雪😀',count:3,ok:true,tags:['é',null,false,1]},timeoutMs:500}).text();return ctx.text(result)}`);
 check('json-upload-materialization-and-encoding',()=>{const r=run(jsonUpload);assert.deepEqual(JSON.parse(r.outboundRequests[0].body),{name:'é雪😀',count:3,ok:true,tags:['é',null,false,1]});assert(r.outboundRequests[0].headers.some(([k,v])=>k==='content-type'&&v==='application/json; charset=utf-8'))});
 const wideSource=`export default async function handler(ctx){const result=await ctx.parallel({${Array.from({length:32},(_,i)=>`r${i}:ctx.fetch('${url}',{timeoutMs:500}).text()`).join(',')}});return ctx.json(result)}`;
 const wide=compile(wideSource);
 check('width32-reserves-complete-cohort-before-dispatch',()=>{const r=run(wide);assert.equal(Object.keys(JSON.parse(r.response.body)).length,32);assert.equal(r.outboundRequests.length,32);assert.equal(r.trace.filter(x=>x.name==='close').length,64);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0);assert.equal(wide.manifest.resourceAccounting.required.handles,162);assert.equal(wide.manifest.resourceAccounting.required.effects,32)});
 const router=compile(`import {Router} from '@pulse-compute/runtime';const app=new Router();app.get('/fetch',async ctx=>{const r=await ctx.fetch('${url}',{timeoutMs:500}).text();return ctx.text(r+r)});app.get('/health',ctx=>ctx.text('ok'));export default app;`);
 check('router-sibling-and-selected-route',()=>{assert.equal(run(router,{}, {request:{path:'/fetch'}}).response.body,'hellohello');const r=run(router,{}, {request:{path:'/health'}});assert.equal(r.response.body,'ok');assert(!r.trace.some(x=>x.name==='send_async'));});
 const helperFiles={'helper.ts':`export async function fetchBody(ctx,input:string){const r=await ctx.fetch('${url}',{timeoutMs:500});const h=r.header('x-test');return r.text()+h+input;}`};
 const helperSource=`import {Router} from '@pulse-compute/runtime';import {fetchBody} from './helper';const app=new Router();app.get('/',async ctx=>{const a=await fetchBody(ctx,'');const b=await fetchBody(ctx,'');return ctx.text(a+b)});export default app;`;
 const repeated=compile(helperSource,'accept-json-or-missing',helperFiles);
 check('imported-helper-reuses-static-site-with-distinct-tickets',()=>{const r=run(repeated);assert.equal(r.response.body,'helloretainedhelloretained');assert.equal(r.outboundRequests.length,2);assert.equal(r.trace.filter(x=>x.name==='close').length,4);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0);assert.equal(repeated.manifest.resourceAccounting.required.effects,1024);assert.equal(r.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='header_values_get').length,2);});
 check('unproved-helper-header-stays-unselected',()=>{const files={'helper.ts':helperFiles['helper.ts'].replace("r.header('x-test')","r.header(ctx.req.path)")};assert.equal(generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(helperSource,'accept-json-or-missing',false,files),options).manifest.resourceAccounting,undefined);});
 const failure=(fn,stage)=>{let detail;assert.throws(fn,e=>{detail=e.detail;return e.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'&&(stage===undefined||detail.errorStage===stage)});return detail;};
 check('unknown-send-fences-later-group-members',()=>{let sends=0;const r=run(group,{}, {afterHostcall(c){if(c.name==='send_async'){sends++;return 1}}});assert.equal(r.response.status,502);assert.equal(sends,1);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),5);assert(!r.trace.some(x=>x.name==='close'))});
 check('unknown-poll-is-never-retried',()=>{let handle;const calls=[];const r=run(group,{}, {afterHostcall(c){if(c.name==='pending_req_poll_v2'){calls.push(c.args[0]);if(handle===undefined){handle=c.args[0];return 1}}}});assert.equal(r.response.status,502);assert.equal(calls.filter(x=>x===handle).length,1);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),3)});
 check('timeout-retains-each-unready-pending-and-output-claim',()=>{const r=run(group,{neverHeaders:true});assert.equal(r.response.status,504);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),6);assert.equal(r.instance.exports.pulse_fastly_fetch_unreaped(),2);assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,4)});
 check('uncertain-opaque-transfer-never-closes-or-resends',()=>{const d=failure(()=>run(opaque,{}, {afterHostcall(c){if(c.name==='send_downstream')return 1}}));assert.equal(d.trace.filter(x=>x.name==='send_downstream').length,1);assert(!d.trace.some(x=>x.name==='close'))});
 check('original-time-fences-upload-header-read-and-cleanup',()=>{for(const [c,target]of [[upload,'write'],[cached,'header_values_get'],[group,'pending_req_poll_v2']]){let expired=false;const after=[];failure(()=>run(c,{body:'{}'},{afterHostcall(x){if(expired)after.push(x.name);if(x.name===target&&!expired){expired=true;x.advance(1000)}}}));assert(expired);assert(after.every(x=>x==='clock_time_get'),JSON.stringify(after));}});
 check('clock-failure-denies-new-work',()=>{let sent=false,fault=false;const calls=[];failure(()=>run(group,{}, {afterHostcall(c){if(fault)calls.push(c.name);if(c.name==='send_async')sent=true;if(sent&&!fault&&c.name==='clock_time_get'){fault=true;return 1}}}));assert(fault);assert(calls.every(x=>x==='clock_time_get'))});
 check('unknown-close-retains-only-that-claim',()=>{const r=run(group,{}, {afterHostcall(c){if(c.module==='fastly_http_body'&&c.name==='close')return 1}});assert.equal(r.response.status,200);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),2);assert.equal(r.trace.filter(x=>x.module==='fastly_http_body'&&x.name==='close').length,2)});
 check('host-trap-has-no-guest-finalizer',()=>{const trap=new Error('host trap'),calls=[];assert.throws(()=>run(group,{}, {afterHostcall(c){calls.push(c.name);if(c.name==='send_async')throw trap}}),e=>e===trap);assert.equal(calls.at(-1),'send_async')});
 check('input-bound-rejects-corrupt-request-count-before-fetch',()=>{for(const count of [0xffffffff,65537]){const d=failure(()=>run(dynamic,{}, {afterHostcall(c){if(c.name==='method_get')c.writeU32(c.args[3],count)}}));assert(!d.trace.some(x=>x.name==='send_async'));}});
 check('unsupported-read-loop-and-unproved-profiles-stay-excluded',()=>{
   assert.throws(()=>planFor(`export default async function handler(ctx){for(let i=0;i<4;i++){await ctx.fetch('${url}').text()}return ctx.text('ok')}`));
   for(const s of [`export default async function handler(ctx){let url='https://origin.example/body';url=ctx.req.url;const r=await ctx.fetch(url).text();return ctx.text(r+r)}`,"import {Router} from '@pulse-compute/runtime';const app=new Router();app.get('/',async ctx=>{const r=await ctx.fetch('https://origin.example/body').text();return ctx.text(r)});app.error((error,ctx,next)=>ctx.text('recovered'));export default app;",source.replace('timeoutMs:500','timeoutMs:500,timeoutMs:0'),`export default async function handler(ctx){const r=await ctx.fetch('${url}');return ctx.text(r.header(ctx.req.path))}`])assert.equal(generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(s),options).manifest.resourceAccounting,undefined);
 });
 check('body-overflow-closes-every-known-group-resource',()=>{const r=failure(()=>run(group,{body:'x'.repeat(bound+1)}),21);assert.equal(r.trace.filter(x=>x.name==='close').length,4);assert(r.trace.filter(x=>x.name==='read').every(x=>x.bytes<=bound+1));});
 check('upload-partial-writes-and-corrupt-counts',()=>{const r=run(upload,{}, {bodyWriteChunkBytes:2});assert.equal(r.outboundRequests[0].body,'é雪😀');assert.equal(r.response.status,200);for(const count of [0,0xffffffff,100]){let changed=false;const closes=[];const r=failure(()=>run(upload,{}, {afterHostcall(c){if(c.name==='close')closes.push(c.module);if(c.name==='write'&&!changed){changed=true;c.writeU32(c.args[4],count)}}}),75);assert(!r.trace.some(x=>x.name==='send_async'));assert.deepEqual(closes,['fastly_http_req','fastly_http_body']);}});
 check('zero-handles-remain-namespace-specific',()=>{const r=run(opaque,{}, {handleStarts:{request:0,body:0,response:0,pending:0}});assert.equal(r.response.body,'hello');assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),0);});
 check('corrupt-response-header-count-preserves-primary-failure',()=>{let calls=0;const r=run(cached,{body:'{}'}, {allowHandledHeaderError:true,afterHostcall(c){if(c.module==='fastly_http_resp'&&c.name==='header_values_get'){calls++;c.writeU32(c.args[7],0xffffffff)}}});assert.equal(r.response.status,500);assert.equal(calls,1);assert(!r.trace.some(x=>x.name==='read'));assert.equal(r.instance.exports.pulse_fastly_jwt_clock_calls(),500);});
 const plainGroup=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(sources.group),options),plainOpaque=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(sources.opaque),options),plainUpload=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(sources.upload),options);
 check('unobserved-group-transfer-and-upload-parity',()=>{for(const [plain,observed]of [[plainGroup,group],[plainOpaque,opaque],[plainUpload,upload]]){const a=run(plain),b=run(observed);assert.deepEqual(a.response,b.response);assert.deepEqual(a.trace,b.trace);assert.deepEqual(a.outboundRequests,b.outboundRequests);}});
 const artifacts=Object.fromEntries(Object.entries({plain,plainGroup,plainOpaque,plainUpload,alias,group,opaque,upload,cached,sequential,dynamic,jsonUpload,wide,router,repeated}).map(([name,c])=>[name,{bytes:c.wasm.length,sha256:createHash('sha256').update(c.wasm).digest('hex')}]));
 const report={status:'passed',mode:installed?'installed':'workspace',cases,profiles:{alias:alias.manifest.resourceAccounting.required,group:group.manifest.resourceAccounting.required,wide:wide.manifest.resourceAccounting.required,dynamic:dynamic.manifest.resourceAccounting.required},artifacts};console.log(JSON.stringify(report));return report;
}
module.exports={main};if(require.main===module)main();
