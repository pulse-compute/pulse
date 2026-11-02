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
const source=`export default async function handler(ctx){const body=await ctx.fetch('${url}',{timeoutMs:500,headers:{'x-proof':'é'}}).json();return ctx.json(body)}`;
const options={cwd:root,emitWat:false,requirePlatformCapability:false,maxDurationMs:1000,
  bindings:{backends:{'https://origin.example':'origin'}}};
function planFor(source, contentTypePolicy = 'accept-json-or-missing', typed = false) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-fetch-accounting-'));
  try {const file=path.join(dir,'index.ts');fs.writeFileSync(file,source);
    fs.writeFileSync(path.join(dir,'schemas.ts'),'export interface Origin {name:string; count:number}');
    return buildCanonicalNativePlan(compileCanonicalProject(file,{rootDir:dir,workspaceRoot:root,schemas:{maxBytes:bound,contentTypePolicy,...(typed?{entries:[{id:'app.Origin',namespace:'app',name:'Origin',source:'./schemas.ts',type:'Origin'}]}:{})},strict:false}));
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
  const permissive=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(source),options);
  const plan=planFor(source,'require-json');
  const plain=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const observed=generator.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:observer});
  const typedSource="import type {Origin} from './schemas';"+source.replace('.json()',".json<Origin>('app.Origin')");
  const typed=generator.compileFastlyNativePlatformCapabilitiesPlan(planFor(typedSource,'require-json',true),options);
  const p=plain.manifest.resourceAccounting;
  assert(p?.admitted);assert.equal(p.selection,'canonical-single-get-json');
  assert.deepEqual(p.required,{handles:7,backingBytes:462056,records:13,cleanupSteps:7,effects:1});
  assert.equal(p.encodingBytes,45);assert.equal(p.readerBytes,3077);assert.equal(p.storageBytes,2688);
  assert.deepEqual(p.headerAdmission,{bufferBytes:65536,backingBytes:458770});
  assert.deepEqual(permissive.manifest.resourceAccounting.required,{handles:7,backingBytes:3286,records:12,cleanupSteps:7,effects:1});
  assert.deepEqual(plain.inspection.imports,observed.inspection.imports);
  assert.deepEqual(typed.manifest.resourceAccounting.required,p.required);
  const body='{"name":"é雪😀","count":3}';
  const run=(compiled=observed,fixture={},extra={})=>execute(compiled,{fixtures:{[url]:{body,headers:[['content-type','application/json']],...fixture}},
    traceBodyIo:true,allowHandledTransportError:true,allowHandledFetchDeadlineError:true,...extra});
  const metrics=r=>['secret','crypto','clock','schema'].map(k=>r.instance.exports['pulse_fastly_jwt_'+k+'_calls']());
  const cases=[],check=(name,fn)=>{try{fn();cases.push(name);}catch(e){e.message=name+': '+e.message;throw e;}};
  function failure(fn,stage){let d;assert.throws(fn,e=>{d=e.detail;return e.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED' && (stage===undefined||d.errorStage===stage);});return d;}
  const headerCalls=d=>d.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='header_values_get');
  check('closed-inventory-observer-and-single-invocation',()=>{
    const a=run(plain),b=run();assert.deepEqual(a.response,b.response);assert.deepEqual(a.trace,b.trace);
    assert.deepEqual(JSON.parse(a.response.body),JSON.parse(body));assert.deepEqual(metrics(b),[0,6,0,0]);
    const n=b.trace.length;b.instance.exports._start();assert.equal(b.trace.length,n);assert.equal(b.instance.exports.pulse_fastly_error_stage(),171);
    assert.equal(headerCalls(a).length,1);
    const c=run(permissive, {headers:[]});assert.deepEqual(JSON.parse(c.response.body),JSON.parse(body));assert.equal(headerCalls(c).length,0);
  });
  check('fragmented-unicode-nesting-and-escapes',()=>{
    const value={text:'a\0é雪😀z',nested:[true,null,3,{escape:'"\\\n'}]};
    const reads=new Set(),waits=new Set();const r=run(observed,{body:JSON.stringify(value),chunkBytes:1},{afterHostcall(c){if(c.name==='read')reads.add(c.args[3]);if(c.name==='select')waits.add(c.args[0]);}});
    assert.deepEqual(JSON.parse(r.response.body),value);assert.deepEqual(metrics(r),[0,6,0,0]);assert.equal(reads.size,1);assert.equal(waits.size,1);
  });
  check('exact-body-bound-and-overflow-sentinel',()=>{
    const value='x'.repeat(bound-2),r=run(observed,{body:JSON.stringify(value),chunkBytes:1});
    assert.equal(JSON.parse(r.response.body),value);assert.deepEqual(metrics(r),[0,6,0,0]);
    const d=failure(()=>run(plain,{body:JSON.stringify(value+'x')}),21);
    assert.equal(d.trace.filter(x=>x.name==='read').reduce((n,x)=>n+x.bytes,0),bound+1);
    assert.equal(d.trace.filter(x=>x.name==='close').length,2);
  });
  check('typed-projection-and-invalid-json-preserve-existing-errors',()=>{
    const r=run(typed);assert.deepEqual(JSON.parse(r.response.body),JSON.parse(body));
    for(const bad of ['{','', '{"name":3,"count":"bad"}']){
      const d=failure(()=>run(bad.startsWith('{"')?typed:plain,{body:bad}));
      assert.equal(d.trace.filter(x=>x.name==='close').length,2);assert(d.trace.some(x=>x.name==='status_set'&&x.status===500));
    }
  });
  check('strict-content-type-admission-and-first-value',()=>{
    for(const value of ['APPLICATION/JSON','application/problem+json','application/json; charset=utf-8'])assert.equal(run(observed,{headers:[['content-type',value]]}).response.status,200);
    for(const headers of [[],[['content-type','']],[['content-type','text/plain']],[['content-type','text/plain'],['content-type','application/json']]]){
      const d=failure(()=>run(plain,{headers}),44);assert.equal(headerCalls(d).length,1);assert(!d.trace.some(x=>x.name==='read'));assert.equal(d.trace.filter(x=>x.name==='close').length,2);
    }
    assert.equal(run(observed,{headers:[['content-type','application/json'],['content-type','text/plain']]}).response.status,200);
  });
  check('header-bound-includes-decode-and-lowercase-backing',()=>{
    const value='application/json;'+'A'.repeat(65535-17);
    assert.equal(Buffer.byteLength(value),65535);const r=run(observed,{headers:[['content-type',value]]});assert.deepEqual(metrics(r),[0,6,0,0]);
    const d=run(observed,{headers:[['content-type',value+'A']]},{allowHandledHeaderError:true});assert.equal(d.response.status,500);assert(!d.trace.some(x=>x.name==='read'));assert.deepEqual(metrics(d),[0,6,500,0]);
  });
  check('malformed-header-abi-stops-before-reader-and-disposes-once',()=>{
    for(const fault of [{written:0xffffffff},{written:65537},{unterminated:true},{cursor:-2},{status:1}]){
      const d=run(observed,{}, {allowHandledHeaderError:true,headerLookupFault:()=>fault});
      assert.equal(d.response.status,500);assert.equal(d.instance.exports.pulse_fastly_error_stage(),23);assert.equal(headerCalls(d).length,1);
      assert(!d.trace.some(x=>x.name==='read'));assert.equal(d.trace.filter(x=>x.name==='close').length,2);
    }
  });
  check('unknown-send-retains-reserved-header-backing',()=>{
    const r=run(observed,{}, {afterHostcall:c=>{if(c.name==='send_async')return 1;}});
    assert.equal(r.response.status,502);assert.deepEqual(metrics(r),[5,11,10,3200]);assert.equal(headerCalls(r).length,0);assert(!r.trace.some(x=>x.name==='close'||x.name==='pending_req_poll_v2'));
  });
  check('unknown-poll-never-retries',()=>{
    const r=run(observed,{}, {afterHostcall:c=>{if(c.name==='pending_req_poll_v2')return 1;}});
    assert.equal(r.response.status,502);assert.deepEqual(metrics(r),[3,9,10,3000]);assert.equal(headerCalls(r).length,0);assert.equal(r.trace.filter(x=>x.name==='pending_req_poll_v2').length,1);
  });
  check('fetch-timeout-preserves-protected-exit',()=>{
    const r=run(observed,{neverHeaders:true});assert.equal(r.response.status,504);assert.deepEqual(metrics(r),[3,9,504,210]);assert.equal(headerCalls(r).length,0);
  });
  check('original-deadline-fences-header-read-cleanup-and-exit',()=>{
    for(const target of ['pending_req_poll_v2','header_values_get','read']){let expired=false;const after=[];
      failure(()=>run(plain,{}, {afterHostcall(c){if(expired)after.push(c.module+':'+c.name);if(c.name===target&&!expired){c.advance(1000);expired=true;}}}));
      assert(expired);assert(after.every(x=>x==='wasi_snapshot_preview1:clock_time_get'),JSON.stringify(after));
    }
  });
  check('header-clock-failure-latches',()=>{
    let header=false,fault=false;const after=[];
    failure(()=>run(plain,{}, {afterHostcall(c){if(fault)after.push(c.name);if(c.name==='header_values_get')header=true;if(c.name==='clock_time_get'&&header&&!fault){fault=true;return 1;}}}));
    assert(fault);assert(after.every(x=>x==='clock_time_get'));
  });
  check('selection-still-proves-literals-and-complete-control-tree',()=>{
    for(const [i,text] of [source.replace('timeoutMs:500,',''),source.replace('timeoutMs:500,','timeoutMs:500,timeoutMs:0,'),source.replace('ctx.json(body)','ctx.json({body})'),source.replace("'x-proof':'é'","'x-proof':ctx.req.method")].entries()){
      assert.equal(generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(text,'require-json'),options).manifest.resourceAccounting?.selection,i===1?undefined:'canonical-fetch-cohorts');
    }
  });
  const artifacts=Object.fromEntries(Object.entries({permissive,plain,observed,typed}).map(([name,c])=>[name,{bytes:c.wasm.length,sha256:createHash('sha256').update(c.wasm).digest('hex')}]));
  const report={status:'passed',mode:installed?'installed':'workspace',cases,selection:p.selection,required:p.required,artifacts};console.log(JSON.stringify(report));return report;
}
module.exports={main};if(require.main===module)main();
