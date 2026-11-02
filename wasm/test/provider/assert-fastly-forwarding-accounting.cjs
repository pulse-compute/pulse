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
const url='https://origin.example/upload';
const source=`export default async function handler(ctx){return ctx.fetch('${url}',{method:'POST',body:ctx.req.body(),timeoutMs:1500,headers:{'content-type':'application/octet-stream'}})}`;
const options={cwd:root,emitWat:false,requirePlatformCapability:false,maxDurationMs:2000,
  bodyForwarding:{requestMaxBytes:1048576,responseMaxBytes:1048576},bindings:{backends:{'https://origin.example':'origin'}}};
const planFor=s=>buildCanonicalNativePlan(compileCanonicalSource(s));
const observer=[{point:'effect.settle',owner:'accounting-proof',order:100,body:`
  const l=__fwd_ra!;
  if (l.transferred(2,5,1,2,1) || l.transferred(1,5,2,2,1) || l.transferred(1,5,1,3,1)
    || l.transferred(1,5,1,2,2)) unreachable();
  return true`},
  {point:'invocation.closed',owner:'accounting-proof',order:100,body:`
  const l=__fwd_ra!;
  if (!l.closed || l.backing != __FRA_BACKING || l.effects != 1 || __pulse_invocation_count > 1) unreachable();
  __pulse_fastly_jwt_secret_calls=i32(l.handles);
  __pulse_fastly_jwt_crypto_calls=i32(l.records);
  __pulse_fastly_jwt_clock_calls=i32(l.primary);
  let unknown=0,acquiring=0,live=0,disposing=0;
  for(let i=0;i<11;i++){const s=l.bank[i*8+5];if(s==PRL_UNKNOWN)unknown++;if(s==PRL_ACQUIRING)acquiring++;if(s==PRL_LIVE)live++;if(s==PRL_DISPOSING)disposing++;}
  __pulse_fastly_jwt_schema_calls=unknown*1000+acquiring*100+live*10+disposing;`}];
const hash=b=>createHash('sha256').update(b).digest('hex');
function main(){
  const plan=planFor(source), plain=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const observed=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:observer});
  const p=plain.manifest.resourceAccounting;
  assert(p && p.admitted);assert.equal(p.selection,'canonical-terminal-forwarding');
  assert.deepEqual(p.required,{handles:11,backingBytes:34055,records:15,cleanupSteps:12,effects:1});
  assert.equal(p.storageBytes,2944);assert.equal(p.durationNs,2000000000);
  assert.deepEqual(plain.inspection.imports,observed.inspection.imports);
  const run=(compiled,request={},fixture={},extra={})=>execute(compiled,{request:{method:'POST',body:'abc',...request},fixtures:{[url]:{echoBody:true,...fixture}},allowAbortedResponse:true,...extra});
  const metrics=r=>['secret','crypto','clock','schema'].map(k=>r.instance.exports['pulse_fastly_jwt_'+k+'_calls']());
  const cells=[];
  const check=(name,fn)=>{try{fn();cells.push(name);}catch(e){e.message=name+': '+e.message;throw e;}};
  check('normal-profile-closure-identity-and-observer-parity',()=>{
    const a=run(plain),b=run(observed);assert.deepEqual(a.response,b.response);assert.deepEqual(a.trace,b.trace);
    assert.deepEqual(metrics(b),[0,4,0,0]);
    const before=b.trace.length;b.instance.exports._start();assert.equal(b.trace.length,before,'same instance cannot create another invocation');
    assert.equal(b.instance.exports.pulse_fastly_error_stage(),171);
    assert.deepEqual(metrics(run(observed)),[0,4,0,0],'fresh instance has independent ledger');
  });
  check('pre-dispatch-denial-preserves-primary-and-exit-reserve',()=>{
    const r=run(observed,{headers:{'content-length':'1048577'}});
    assert.equal(r.response.status,413);assert.equal(r.outboundRequests.length,0);assert.deepEqual(metrics(r),[0,4,413,0]);
  });
  check('ambiguous-send-never-retries-consumed-request',()=>{
    let request;
    const r=run(observed,{}, {},{afterHostcall:c=>{if(c.name==='send_async_streaming'){request=c.args[0];return 1;}}});
    assert.equal(r.response.status,502);assert.deepEqual(metrics(r),[4,8,10,2200]);
    assert.equal(r.trace.filter(x=>x.module==='fastly_http_req'&&x.name==='close'&&x.handle===request).length,0);
    assert.equal(r.trace.filter(x=>x.name==='send_async_streaming').length,1);
    assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,0);
  });
  check('unknown-disposal-retains-charge-no-retry',()=>{
    let closed;
    const r=run(observed,{}, {},{afterHostcall:c=>{if(c.module==='fastly_http_body'&&c.name==='close'&&closed===undefined){closed=c.args[0];return 1;}}});
    assert.equal(r.response.status,502);assert(metrics(r)[0]>=1);assert.equal(metrics(r)[2],10);
    assert.equal(r.trace.filter(x=>x.module==='fastly_http_body'&&x.name==='close'&&x.handle===closed).length,1);
  });
  check('pending-timeout-holds-output-and-pending-claims',()=>{
    const r=run(observed,{}, {neverHeaders:true});assert.equal(r.response.status,504);
    assert.deepEqual(metrics(r),[3,7,504,210]);
  });
  check('unknown-poll-no-cleanup-retry',()=>{
    const r=run(observed,{}, {},{afterHostcall:c=>{if(c.name==='pending_req_poll_v2')return 1;}});
    assert.equal(r.response.status,502);assert.deepEqual(metrics(r),[3,7,10,3000]);
    assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,1);
  });
  check('original-request-deadline-denies-new-cleanup-and-exit',()=>{
    let expired=false;const calls=[];
    assert.throws(()=>run(plain,{}, {},{afterHostcall:c=>{
      if(expired)calls.push(c.module+':'+c.name);
      if(c.name==='read'&&!expired){c.advance(2000);expired=true;}
    }}),e=>e.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
      && !e.detail.trace.some(x=>x.name==='send_downstream'));
    assert(expired);assert(calls.every(x=>x==='wasi_snapshot_preview1:clock_time_get'));
  });
  check('handle-zero-in-each-real-namespace',()=>{
    for(const kind of ['request','body','response','pending']){
      const r=run(observed,{}, {},{handleStarts:{[kind]:0}});assert.equal(r.response.body,'abc');assert.deepEqual(metrics(r),[0,4,0,0]);
    }
  });
  check('unselected-and-unreachable-have-no-ledger',()=>{
    const absent=planFor("export default async function handler(ctx){return ctx.text('ok')}");
    const a=generator.compileFastlyNativePlatformCapabilitiesPlan(absent,{...options,bodyForwarding:undefined});
    const b=generator.compileFastlyNativePlatformCapabilitiesPlan(absent,options);
    assert.deepEqual(a.wasm,b.wasm);assert.equal(a.manifest.resourceAccounting,undefined);
    assert(!a.source.includes('PulseResourceLedger'));assert(!a.source.includes('__fra_'));
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unused-forward-'));
    try {
      fs.writeFileSync(path.join(dir,'unused.ts'),"export function unused(ctx){return ctx.fetch('https://origin.example/upload',{method:'POST',body:ctx.req.body()})}");
      fs.writeFileSync(path.join(dir,'main.ts'),"import {unused} from './unused';export default async function handler(ctx){return ctx.text('ok')}");
      const imported=buildCanonicalNativePlan(compileCanonicalProject(path.join(dir,'main.ts'),{rootDir:dir,workspaceRoot:root,target:'native'}));
      const c=generator.compileFastlyNativePlatformCapabilitiesPlan(imported,options);
      assert(!c.source.includes('PulseResourceLedger'));
      assert.equal(a.wasm.length,c.wasm.length);
      assert.deepEqual(a.inspection.imports,c.inspection.imports); // project/source identity hashes remain distinct
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  if(installed)for(const file of Object.keys(require.cache).filter(f=>f.includes('/@pulse-compute/')))
    assert(fs.realpathSync(file).startsWith(root+path.sep),'source-free installed closure');
  console.log(JSON.stringify({status:'passed',mode:installed?'installed':'workspace',cells,
    wasm:{bytes:plain.wasm.length,sha256:hash(plain.wasm)},profile:p.required,bankStorageEnvelope:p.storageBytes,
    evidence:'generated production driver with injected ABI; separate Viceroy gate',generalFetchAccounting:false}));
}
main();
