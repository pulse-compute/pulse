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
const source=`export default async function handler(ctx){const body=await ctx.fetch('${url}',{timeoutMs:500,headers:{'x-proof':'é'}}).text();return ctx.text(body)}`;
const options={cwd:root,emitWat:false,requirePlatformCapability:false,maxDurationMs:1000,
  bindings:{backends:{'https://origin.example':'origin'}}};
function planFor(source) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-fetch-accounting-'));
  try {const file=path.join(dir,'index.ts');fs.writeFileSync(file,source);
    return buildCanonicalNativePlan(compileCanonicalProject(file,{rootDir:dir,workspaceRoot:root,schemas:{maxBytes:bound},strict:false}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const observer=[{point:'effect.settle',owner:'fetch-accounting-proof',order:100,body:`
  const l=__fetch_ra!;
  if(l.transferred(2,3,1,2,1)||l.transferred(1,3,2,2,1)||l.transferred(1,3,1,3,1)||l.transferred(1,3,1,2,2)) unreachable();
  return true`},
  {point:'invocation.closed',owner:'fetch-accounting-proof',order:100,body:`
  const l=__fetch_ra!;
  if(!l.closed || l.backing!=__FCA_BACKING || l.effects!=1 || __pulse_invocation_count!=1) unreachable();
  __pulse_fastly_jwt_secret_calls=i32(l.handles);
  __pulse_fastly_jwt_crypto_calls=i32(l.records);
  __pulse_fastly_jwt_clock_calls=i32(l.primary);
  let unknown=0,acquiring=0,live=0,disposing=0;
  for(let i=0;i<7;i++){const s=l.bank[i*8+5];if(s==PRL_UNKNOWN)unknown++;if(s==PRL_ACQUIRING)acquiring++;if(s==PRL_LIVE)live++;if(s==PRL_DISPOSING)disposing++;}
  __pulse_fastly_jwt_schema_calls=unknown*1000+acquiring*100+live*10+disposing;`}];
function main(){
  const plan=planFor(source),plain=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const observed=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:observer});
  const p=plain.manifest.resourceAccounting;
  assert(p?.admitted);assert.equal(p.selection,'canonical-single-get-text');
  assert.deepEqual(p.required,{handles:7,backingBytes:3286,records:12,cleanupSteps:7,effects:1});
  assert.equal(p.encodingBytes,45);assert.equal(p.readerBytes,3077);assert.equal(p.storageBytes,2560);
  assert.deepEqual(plain.inspection.imports,observed.inspection.imports);
  const run=(compiled=observed,fixture={},extra={})=>execute(compiled,{fixtures:{[url]:{body:'hello',...fixture}},
    traceBodyIo:true,allowHandledTransportError:true,allowHandledFetchDeadlineError:true,...extra});
  const metrics=r=>['secret','crypto','clock','schema'].map(k=>r.instance.exports['pulse_fastly_jwt_'+k+'_calls']());
  const cases=[],check=(name,fn)=>{try{fn();cases.push(name);}catch(e){e.message=name+': '+e.message;throw e;}};
  function failure(fn,stage){let d;assert.throws(fn,e=>{d=e.detail;return e.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED' && (stage===undefined||d.errorStage===stage);});return d;}
  check('profile-closure-and-observer-parity',()=>{
    const a=run(plain),b=run();assert.deepEqual(a.response,b.response);assert.deepEqual(a.trace,b.trace);
    assert.deepEqual(metrics(b),[0,5,0,0]);const count=b.trace.length;b.instance.exports._start();
    assert.equal(b.trace.length,count);assert.equal(b.instance.exports.pulse_fastly_error_stage(),171);
    assert.deepEqual(metrics(run()),[0,5,0,0]);
  });
  check('fragmentation-independent-reader-and-wait-backing',()=>{
    const waits=new Set(),ready=new Set(),clocks=new Set(),reads=new Set();
    const text='a'.repeat(bound),r=run(observed,{body:text,chunkBytes:1},{afterHostcall(c){
      if(c.name==='select'){waits.add(c.args[0]);ready.add(c.args[3]);}
      if(c.name==='clock_time_get')clocks.add(c.args[2]);
      if(c.name==='read')reads.add(c.args[3]);
    }});
    assert.equal(r.response.body,text);assert.deepEqual(metrics(r),[0,5,0,0]);
    assert.equal(waits.size,1);assert.equal(ready.size,1);assert.equal(reads.size,1);assert.equal(clocks.size,2);
    assert(r.instance.exports.memory.buffer.byteLength<4*1024*1024);
    const rows=r.trace.filter(x=>x.name==='read');let offset=0;for(const row of rows){assert.equal(row.pointer,rows[0].pointer+offset);offset+=row.bytes;}
  });
  check('empty-and-split-unicode-retain-result',()=>{for(const text of ['', 'a\0é雪😀z']){const r=run(observed,{body:text,chunkBytes:1});assert.equal(r.response.body,text);assert.deepEqual(metrics(r),[0,5,0,0]);}});
  check('unknown-send-holds-input-and-output-overlap',()=>{
    const r=run(observed,{}, {afterHostcall:c=>{if(c.name==='send_async')return 1;}});
    assert.equal(r.response.status,502);assert.deepEqual(metrics(r),[5,10,10,3200]);
    assert.equal(r.trace.filter(x=>x.name==='send_async').length,1);
    assert(!r.trace.some(x=>x.name==='close'||x.name==='pending_req_poll_v2'));
  });
  check('unknown-and-invalid-poll-never-retried',()=>{
    for(const invalid of [false,true]){const r=run(observed,{}, {afterHostcall(c){if(c.name==='pending_req_poll_v2'){if(invalid)c.writeU32(c.args[2],2);else return 1;}}});
      assert.equal(r.response.status,invalid?500:502);assert.deepEqual(metrics(r),[3,8,10,3000]);
      assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,1);
      assert(!r.trace.some(x=>x.name==='close'));
    }
  });
  check('fetch-timeout-protects-exit-and-retains-pending',()=>{
    const r=run(observed,{neverHeaders:true});assert.equal(r.response.status,504);assert.equal(r.response.body,'Gateway Timeout');
    assert.deepEqual(r.response.headers,[['content-type','text/plain; charset=utf-8']]);
    assert.deepEqual(metrics(r),[3,8,504,210]);
    assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,2);
    assert.equal(r.instance.exports.pulse_fastly_fetch_unreaped(),1);
  });
  check('late-known-outputs-are-closed-with-original-time',()=>{
    const r=run(observed,{}, {hostcallDelayMs:{'fastly_http_req.pending_req_poll_v2':500}});
    assert.equal(r.response.status,504);assert.deepEqual(metrics(r),[0,5,504,0]);
    assert.equal(r.trace.filter(x=>x.name==='close').length,2);
  });
  check('original-deadline-denies-cleanup-and-exit',()=>{
    for(const target of ['method_set','pending_req_poll_v2','read']){let expired=false;const after=[];
      failure(()=>run(plain,{}, {afterHostcall(c){if(expired)after.push(c.module+':'+c.name);if(c.name===target&&!expired){c.advance(1000);expired=true;}}}));
      assert(expired);assert(after.every(x=>x==='wasi_snapshot_preview1:clock_time_get'),JSON.stringify(after));
    }
  });
  check('clock-failure-latches-across-valid-later-samples',()=>{
    let dispatched=false,fault=false;const after=[];
    failure(()=>run(plain,{}, {afterHostcall(c){
      if(fault)after.push(c.module+':'+c.name);
      if(c.name==='send_async')dispatched=true;
      if(c.name==='clock_time_get'&&dispatched&&!fault){fault=true;return 1;}
    }}));assert(fault);assert(after.every(x=>x==='wasi_snapshot_preview1:clock_time_get'));
  });
  check('unknown-disposal-is-never-retried',()=>{
    const r=run(observed,{}, {afterHostcall:c=>{if(c.module==='fastly_http_body'&&c.name==='close')return 1;}});
    assert.equal(r.response.status,200);assert.deepEqual(metrics(r),[1,6,10,1000]);
    assert.equal(r.trace.filter(x=>x.module==='fastly_http_body'&&x.name==='close').length,1);
  });
  check('reader-failures-stop-and-preserve-primary',()=>{
    const overflow=failure(()=>run(plain,{body:'x'.repeat(bound+100)}),21);
    assert.equal(overflow.trace.filter(x=>x.name==='read').reduce((n,x)=>n+x.bytes,0),bound+1);
    for(const fault of ['negative','oversized','status']){let reads=0;
      const d=failure(()=>run(plain,{}, {afterHostcall(c){if(c.name!=='read')return;reads++;if(fault==='status')return 1;c.writeU32(c.args[3],fault==='negative'?0xffffffff:c.args[2]+1);}}),20);
      assert.equal(reads,1);assert.equal(d.trace.filter(x=>x.name==='close').length,2);
    }
  });
  check('unknown-acquisition-never-closes-a-guessed-handle',()=>{
    let request;
    const d=failure(()=>run(plain,{}, {afterHostcall(c){if(c.module==='fastly_http_req'&&c.name==='new'){request=c.readU32(c.args[0]);return 1;}}}),70);
    assert(!d.trace.some(x=>x.name==='send_async'||(x.module==='fastly_http_req'&&x.name==='close')));
    assert(request!==undefined);
  });
  check('ambiguous-exit-send-does-not-retry-or-close',()=>{
    const d=run(observed,{neverHeaders:true}, {afterHostcall:c=>{if(c.name==='send_downstream')return 1;}});
    assert.deepEqual(metrics(d),[5,10,504,2210]);
    assert.equal(d.trace.filter(x=>x.name==='send_downstream').length,1);
    assert(!d.trace.some(x=>x.name==='close'));
  });
  check('host-trap-does-not-run-guest-cleanup',()=>{
    const trap=new Error('injected host trap'),calls=[];
    assert.throws(()=>run(plain,{}, {afterHostcall(c){calls.push(c.name);if(c.name==='send_async')throw trap;}}),e=>e===trap);
    assert.equal(calls.at(-1),'send_async');
  });
  check('zero-handles-in-each-namespace',()=>{for(const kind of ['request','body','response','pending']){const r=run(observed,{}, {handleStarts:{[kind]:0}});assert.equal(r.response.body,'hello');assert.deepEqual(metrics(r),[0,5,0,0]);}});
  check('selection-proves-control-and-literals',()=>{
    const unselected=[source.replace('timeoutMs:500,',''),
      source.replace('timeoutMs:500,','timeoutMs:500,timeoutMs:0,'),
      source.replace("headers:{'x-proof':'é'}", "headers:{x:'a'},headers:{'very-long-key':'long value'}"),
      source.replace("headers:{'x-proof':'é'}", "headers:{x:'a',x:'long value'}"),source.replace('.text()', '.json()').replace('ctx.text(body)','ctx.json({body})'),
      source.replace("headers:{'x-proof':'é'}", "headers:{'x-proof':ctx.req.method}"),
      source.replace('return ctx.text(body)', 'return ctx.text(body+body)'),
      source.replace('return ctx.text(body)', `const again=await ctx.fetch('${url}',{timeoutMs:500}).text();return ctx.text(again)`)];
    for(const [i,text] of unselected.entries()){const a=generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(text),options);assert.equal(a.manifest.resourceAccounting?.selection,[1,2,3].includes(i)?undefined:'canonical-fetch-cohorts');if([1,2,3].includes(i))assert(!a.source.includes('class PulseResourceLedger'));}
    for(const maxDurationMs of [undefined]){const a=generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,maxDurationMs});assert.equal(a.manifest.resourceAccounting,undefined);}
  });
  const report={status:'passed',mode:installed?'installed':'workspace',cases,selection:p.selection,required:p.required,
    artifacts:{plain:{bytes:plain.wasm.length,sha256:createHash('sha256').update(plain.wasm).digest('hex')},observed:{bytes:observed.wasm.length,sha256:createHash('sha256').update(observed.wasm).digest('hex')}}};
  console.log(JSON.stringify(report));return report;
}
module.exports={main};if(require.main===module)main();
