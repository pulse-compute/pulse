#!/usr/bin/env node
'use strict';
// R08 opt-in installed/local qualification. Never configures or deploys a service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const zlib = require('node:zlib');
const {once} = require('node:events');
const {spawn,execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {packRelease,readTarEntries} = require('../../../scripts/pack-release.cjs');
const {catalogFromTarballs,createReadOnlyRegistry} = require('../release/read-only-npm-registry.cjs');
const {installedAcceptanceReport} = require('../support/installed-acceptance-report.cjs');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {executeFastlyNativePlatformCapabilities:execute} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root=path.resolve(__dirname,'../../..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const reportFile=installedAcceptanceReport(process.env.R08_PROOF_FILE || path.join(root,'wasm/.test-results/r08-dynamic-backends.json'));
const report={schemaVersion:'pulse.fastly-dynamic-installed.v1',status:'running',scope:'installed public CLI, injected ABI and local Compute; no hosted acceptance',featureAcceptance:'pending-hosted',
  lanes:{nativeInjected:'installed artifact on workspace ABI oracle',javascript:'installed emitted Fastly closure on Node provider-emulation; not js-compute Wasm',localCompute:'installed Native Wasm on real local Fastly engine',hosted:'not-run'},
  source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),
  workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  scriptSha256:hash(fs.readFileSync(__filename)),workingDiffSha256:hash(execFileSync('git',['diff','HEAD'],{cwd:root})),
  lockfileSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml'))),node:process.version,nodeBinarySha256:hash(fs.readFileSync(process.execPath)),startedAt:new Date().toISOString(),
  hosted:{status:'not-run',requirements:['authorized Fastly test service and Dynamic Backends entitlement','public DNS and platform-root TLS/certificate rejection','host resource limits, unavailable capability and connection reuse'],releaseDisposition:'not-waived'},
  artifacts:[],matrix:[],checks:[],failedAttempts:[],cleanup:{status:'pending'}};
const save=()=>{fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');};
const schema=`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
export interface Batch { endpoints:string[] }
export interface Payload { text:string; active:boolean; rows:{name:string}[]; note?:string|null }
export default defineSchemaRegistry({schemas:{'proof.Batch':schema<Batch>(),'proof.Payload':schema<Payload>()}});`;
const app=max=>`import type {Batch} from './schemas.js';
export default async function handler(ctx) {
 const input=await ctx.req.json<Batch>('proof.Batch');
 const effects=ctx.effects<string>({max:${max}});
 for(const endpoint of input.endpoints) effects.add(ctx.fetch(endpoint,{timeoutMs:1000}).text());
 const results=await ctx.parallel(effects);
 return ctx.json(results);
}`;
const errorApp=`import {Pulse} from '@pulse-compute/pulse'; import type {Payload} from './schemas.js';
const app=new Pulse({auto:true});
app.use(async(ctx,next)=>{ctx.state.set('admitted','yes');return next();});
app.post('/',async ctx=>{
 const {first,second}=await ctx.parallel({first:ctx.fetch(ctx.req.header('x-a')).json<Payload>('proof.Payload'),second:ctx.fetch(ctx.req.header('x-b')).json<Payload>('proof.Payload')});
 return ctx.text(ctx.encodeJson(first,'proof.Payload')+'|'+ctx.encodeJson(second,'proof.Payload'));
});
app.error(async(error,ctx,next)=>ctx.text(error.code,{status:422}));
export default app;`;
function config(mappedOrigin='http://repeat.test') {
 const bindings={dynamicBackends:true},mapped={dynamicBackends:true,backends:{[mappedOrigin]:'configured'}};
 return `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false,defaultProfile:'native'},
 native:{host:'fastly',target:'native',fastly:{bindings:${JSON.stringify(bindings)}}},
 fixed:{host:'fastly',target:'native',fastly:{bindings:{dynamicBackends:false,backends:{'http://repeat.test':'configured'}}}},
 mixed:{host:'fastly',target:'native',fastly:{bindings:${JSON.stringify(mapped)}}},
 javascript:{host:'fastly',target:'javascript',fastly:{bindings:${JSON.stringify(bindings)}}}
}));`;
}
// Runs as a separate process inside the installed consumer, importing the actual
// CLI-emitted application closure and its embedded provider lifecycle/codecs.
async function javascriptProof() {
 const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
 const {pathToFileURL}=require('node:url');const input=JSON.parse(fs.readFileSync(process.argv[2]));
 const loaded=await import(pathToFileURL(path.resolve(input.bundle)).href);
 const calls=[],completed=[],pending=[],errors=[];const abort=new AbortController();
 const handler=loaded.createFastlyJavascriptHandler(loaded.application,{schemaCodecs:loaded.schemaCodecs,bindings:input.bindings||{dynamicBackends:true},onError:error=>errors.push({code:error.code||null,name:error.name}),onEffectObservation:event=>{if(event.error)errors.push(event.error);},
 fetchImplementation:(url,init)=>new Promise((resolve,reject)=>{
   calls.push({url,backend:init.backend||null});
   const signal=init.signal;
   if(signal?.aborted){reject(signal.reason);return;}
   signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
   if(input.mode==='transport'){reject(new Error('controlled transport failure'));return;}
   if(input.mode==='timeout')return;
   pending.push({url,resolve});
   if(calls.length===input.endpoints.length){
     if(input.mode==='cancel'){abort.abort(new Error('controlled cancellation'));return;}
     for(const item of pending.reverse()){
       completed.push(item.url);
       const body=input.schemaBody ? (input.mode==='bad-schema'?'{}':JSON.stringify(input.schemaBody)) : new URL(item.url).pathname.slice(1);
       item.resolve(new Response(body,{headers:{'content-type':input.schemaBody?'application/json':'text/plain'}}));
     }
   }
 })});
 const headers={'content-type':'application/json',...(input.headers||{})};
 let result;
 try{const response=await handler(new Request('https://installed.test'+(input.path||'/'),{method:input.method||'POST',...(input.method==='GET'?{}:{body:JSON.stringify({endpoints:input.endpoints})}),headers,signal:abort.signal}));result={status:response.status,body:await response.text()};}
 catch(error){result={error:error.code||error.name,message:error.message};}
 console.log(JSON.stringify({...result,calls,completed,errors}));
}
function artifact(directory){const wasm=fs.readFileSync(path.join(directory,'bin/main.wasm'));return {wasm,plan:JSON.parse(fs.readFileSync(path.join(directory,'fastly-native-plan.json'))),directory};}
const registrations=r=>r.trace.filter(x=>x.name==='register_dynamic_backend');
const sends=r=>r.trace.filter(x=>x.name==='send_async');
async function main(){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-r08-installed-')),consumer=path.join(temporary,'consumer'),pack=path.join(temporary,'packages');
 assert(!temporary.startsWith(root+path.sep));
 let registry,compute;const origins=[];const started=performance.now();
 const env={...process.env,npm_config_cache:path.join(temporary,'cache'),npm_config_fetch_retries:'0'};
 for(const key of ['NODE_PATH','NODE_OPTIONS','PULSE_PROFILE','npm_config_registry','NPM_CONFIG_REGISTRY'])delete env[key];
 async function run(command,args,timeout=120000){
  return new Promise((resolve,reject)=>{
   const child=spawn(command,args,{cwd:consumer,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});let stdout='',stderr='',fault;
   const stop=()=>{fault=new Error('Installed child timed out');try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}};
   const timer=setTimeout(stop,timeout);
   child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',(code,signal)=>{clearTimeout(timer);code===0?resolve(stdout):reject(fault||new Error(`Installed command failed (${code}/${signal}): ${stderr.slice(-6000)} ${stdout.slice(-1000)}`));});
  });
 }
 function verifyInstalled(manifest){const files=[],packages=[];
  for(const name of fs.readdirSync(path.join(consumer,'node_modules/@pulse-compute')).sort()){
   const p=manifest.packages.find(p=>p.name==='@pulse-compute/'+name);assert(p);
   packages.push({name:p.name,version:p.version,sha256:p.sha256});
   const directory=path.join(consumer,'node_modules',p.name);assert(fs.realpathSync(directory).startsWith(consumer+path.sep));
   const tarball=path.join(pack,p.tarball);assert.equal(hash(fs.readFileSync(tarball)),p.sha256);
   for(const [file,bytes]of readTarEntries(tarball)){
    let target=path.join(directory,file.replace(/^package\//,''));if(!fs.existsSync(target)&&path.basename(target)==='.gitignore')target=path.join(path.dirname(target),'.npmignore');
    assert.deepEqual(fs.readFileSync(target),bytes,p.name+'/'+file);files.push([p.name+'/'+file,hash(bytes)]);
   }
  }report.installedPackages=packages;return hash(JSON.stringify(files));
 }
 try{
  const launcher=fastly.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,binary:process.env.PULSE_FASTLY_BIN,required:true});
  report.engine={kind:launcher.kind,version:launcher.inspection.version,binarySha256:hash(fs.readFileSync(launcher.inspection.binary))};save();
  // Use the real build explicitly. packRelease's build:false is not a build
  // bypass: the fresh workspace build above must succeed before every pack.
  fs.mkdirSync(consumer,{recursive:true});await run('npm',['--prefix',root,'run','build']);report.workspaceBuild='passed';
  const packed=packRelease({repoRoot:root,outDir:pack,build:false});
  report.packages=packed.manifest.packages.map(p=>({name:p.name,version:p.version,sha256:p.sha256}));
  const version=packed.manifest.packages[0].version;
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module',dependencies:Object.fromEntries(['pulse','cli','provider-fastly'].map(name=>['@pulse-compute/'+name,version]))}));
  registry=createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p=>path.join(pack,p.tarball))));await new Promise(resolve=>registry.server.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(consumer,'.npmrc'),`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
  await run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],180000);assert.equal(registry.requests.missing,0);assert.equal(registry.requests.rejected,0);
  report.installedHash=verifyInstalled(packed.manifest);report.lifecycleScripts=false;
  const lock=fs.readFileSync(path.join(consumer,'package-lock.json'));report.installedLockSha256=hash(lock);
  report.dependencies=Object.entries(JSON.parse(lock).packages).filter(([name])=>name).map(([name,p])=>({path:name,version:p.version,integrity:p.integrity||null}));
  fs.mkdirSync(path.join(consumer,'.pulse'));fs.mkdirSync(path.join(consumer,'src'));
  fs.writeFileSync(path.join(consumer,'.pulse/config.ts'),config());fs.writeFileSync(path.join(consumer,'src/schemas.ts'),schema);
  fs.writeFileSync(path.join(consumer,'javascript-proof.cjs'),'('+javascriptProof.toString()+')().catch(e=>{console.error(e);process.exitCode=1});');
  const cli=path.join(consumer,'node_modules/@pulse-compute/cli/bin/pulse.js');
  async function build(profile,label){console.log('R08 build '+label);const out=path.join(consumer,'dist',label);const result=JSON.parse(await run(process.execPath,[cli,'build','--profile',profile,'--out',out,'--json']));assert.equal(result.status,'built');return out;}
  async function js(bundle,endpoints,extra={}){const file=path.join(consumer,'request.json');fs.writeFileSync(file,JSON.stringify({bundle,endpoints,...extra}));return JSON.parse(await run(process.execPath,[path.join(consumer,'javascript-proof.cjs'),file]));}
  const native=(a,endpoints,extra={})=>execute(a,{request:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoints})},fixtures:Object.fromEntries(endpoints.map(url=>[url,{body:new URL(url).pathname.slice(1)}])),...extra});
  const artifacts=new Map();
  for(const capacity of [1,4,16,32]){
   fs.writeFileSync(path.join(consumer,'src/index.ts'),app(capacity));
   const dynamic=artifact(await build('native','dynamic-'+capacity)),fixed=artifact(await build('fixed','fixed-'+capacity)),javascript=await build('javascript','javascript-'+capacity);
   const bundle=path.join(javascript,'src/application.js');artifacts.set(capacity,{dynamic,fixed,bundle});
   const imports=WebAssembly.Module.imports(new WebAssembly.Module(dynamic.wasm));assert(imports.some(x=>x.name==='register_dynamic_backend'));
   assert(!WebAssembly.Module.imports(new WebAssembly.Module(fixed.wasm)).some(x=>x.name==='register_dynamic_backend'));
   const sample={capacity,dynamicBytes:dynamic.wasm.length,fixedBytes:fixed.wasm.length,deltaBytes:dynamic.wasm.length-fixed.wasm.length,
    dynamicGzipBytes:zlib.gzipSync(dynamic.wasm,{level:9}).length,fixedGzipBytes:zlib.gzipSync(fixed.wasm,{level:9}).length,
    wasmSha256:hash(dynamic.wasm),fixedSha256:hash(fixed.wasm),sourceSha256:hash(fs.readFileSync(path.join(consumer,'src/index.ts'))),javascriptBundleBytes:fs.statSync(bundle).size,javascriptBundleSha256:hash(fs.readFileSync(bundle))};
   report.artifacts.push(sample);
   for(const kind of ['repeated','distinct']){
    const endpoints=Array.from({length:capacity},(_,i)=>`http://${kind==='repeated'?'repeat':'origin-'+i}.test/${i}`),expected=endpoints.map((_,i)=>String(i));
    const timings=[];let observed;
    for(let i=0;i<11;i++){const start=performance.now();observed=native(dynamic,endpoints);if(i>0)timings.push(performance.now()-start);}
    assert.deepEqual(JSON.parse(observed.response.body),expected);assert.equal(registrations(observed).length,kind==='repeated'?1:capacity);assert.equal(sends(observed).length,capacity);
    const matched=await js(bundle,endpoints);assert.equal(matched.status,200);assert.deepEqual(JSON.parse(matched.body),expected);
    assert.deepEqual(matched.completed,[...endpoints].reverse());assert.equal(matched.calls.length,capacity);
    timings.sort((a,b)=>a-b);
    let controlMedian=null;
    if(kind==='repeated'){const controls=[];for(let i=0;i<11;i++){const start=performance.now();const r=native(fixed,endpoints);if(i>0)controls.push(performance.now()-start);assert.deepEqual(JSON.parse(r.response.body),expected);assert.equal(registrations(r).length,0);}controls.sort((a,b)=>a-b);controlMedian=controls[5];}
    report.matrix.push({capacity,kind,registrations:registrations(observed).length,sends:sends(observed).length,
     linearMemoryBytes:observed.instance.exports.memory.buffer.byteLength,linearMemoryScope:'committed Wasm memory after execution; not RSS or live guest allocation',
     injectedExecutionMedianMs:timings[5],fixedControlMedianMs:controlMedian,timingScope:'fresh Wasm instance + guest + strict JS host, no network; not platform registration CPU',javascript:'passed',native:'passed'});save();
   }
  }
  const {dynamic,bundle}=artifacts.get(32),two=['http://alpha.test/0','http://beta.test/1'];
  for(const status of [1,5,13]){const r=native(dynamic,two,{dynamicBackendStatus:status,allowHandledDynamicBackendError:true});assert.equal(r.response.status,500);assert.equal(sends(r).length,0);assert.equal(r.transportResources.outboundRequests,0);report.checks.push({case:'registration-'+status,status:'passed',scope:'injected ABI only'});}
  const bad=execute(dynamic,{request:{method:'POST',body:JSON.stringify({endpoints:['ftp://invalid.test/0']})},allowHandledDynamicBackendError:true});assert.equal(bad.response.status,400);assert.equal(sends(bad).length,0);
  const jsBad=await js(bundle,['ftp://invalid.test/0']);assert.equal(jsBad.status,500);assert.equal(jsBad.completed.length,0);assert.equal(jsBad.calls.length,0);report.checks.push({case:'invalid-url',status:'passed',nativeHttp:400,javascriptHttp:500,javascriptCode:'not-exposed-by-contained-public-lifecycle'});
  for(const mode of ['transport','timeout']){
   const fixtures=Object.fromEntries(two.map(url=>[url,{body:'unused',...(mode==='transport'?{transportStatus:1}:{neverHeaders:true})}]));
   const r=native(dynamic,two,{fixtures,allowHandledTransportError:true,allowHandledFetchDeadlineError:true});assert.equal(r.response.status,mode==='transport'?502:504);
   const j=await js(bundle,two,{mode});assert.equal(j.status,500);const code=mode==='transport'?'PULSE_FASTLY_FETCH_NETWORK':'PULSE_FETCH_TIMEOUT';assert(j.errors.some(error=>error.code===code),JSON.stringify(j.errors));assert.equal(j.calls.length,2);assert.equal(j.completed.length,0);report.checks.push({case:mode,status:'passed',nativeHttp:r.response.status,javascriptHttp:j.status,javascriptCode:code});
  }
  const abort=new AbortController(),reason=new Error('R08 controlled cancellation');
  assert.throws(()=>native(dynamic,two,{signal:abort.signal,fixtures:Object.fromEntries(two.map(url=>[url,{neverHeaders:true}])),asyncSelectFault:()=>abort.abort(reason)}),e=>e===reason);
  const cancelled=await js(bundle,two,{mode:'cancel'});assert.equal(cancelled.status,500);assert.equal(cancelled.calls.length,2);assert.equal(cancelled.completed.length,0);assert(cancelled.errors.length>0);report.checks.push({case:'cancellation',status:'passed',javascriptErrors:cancelled.errors,wireCancellation:'not-claimed'});
  const empty=native(dynamic,[]),emptyJs=await js(bundle,[]);assert.equal(empty.response.body,'[]');assert.equal(emptyJs.body,'[]');assert.equal(registrations(empty).length,0);assert.equal(emptyJs.calls.length,0);report.checks.push({case:'empty-collection',status:'passed'});
  fs.writeFileSync(path.join(consumer,'src/index.ts'),app(4));const mixed=artifact(await build('mixed','mixed'));
  const mr=native(mixed,['http://repeat.test/0','http://other.test/1']);assert.deepEqual(sends(mr).map(x=>x.backend),['configured','pulse-native-dynamic-0']);assert.equal(registrations(mr).length,1);
  const mj=await js(bundle,['http://repeat.test/0','http://other.test/1'],{bindings:{dynamicBackends:true,backends:{'http://repeat.test':'configured'}}});assert.deepEqual(mj.calls.map(x=>x.backend),['configured',null]);report.checks.push({case:'mixed-static-dynamic',status:'passed'});
  fs.writeFileSync(path.join(consumer,'src/index.ts'),errorApp);const schemaNative=artifact(await build('native','schema-errors')),schemaJs=path.join(await build('javascript','schema-errors-js'),'src/application.js');
  const value={text:'snow 雪',active:true,rows:[{name:'a'}],note:null},headers={'x-a':two[0],'x-b':two[1]};
  for(const invalid of [false,true]){
   const body=invalid?'{}':JSON.stringify(value);const r=execute(schemaNative,{request:{method:'POST',headers},fixtures:Object.fromEntries(two.map(url=>[url,{json:JSON.parse(body)}]))});
   const j=await js(schemaJs,two,{headers,schemaBody:value,...(invalid?{mode:'bad-schema'}:{})});assert.equal(r.response.status,invalid?422:200);assert.equal(j.status,r.response.status);assert.equal(j.body,r.response.body);
   assert.equal(r.response.body,invalid?'PULSE_SCHEMA_DECODE':JSON.stringify(value)+'|'+JSON.stringify(value));report.checks.push({case:invalid?'schema-error-recovery':'schema-textResult-composition',status:'passed'});
  }
  // This exact fixture also owns the canonical guide's source-bound example.
  fs.writeFileSync(path.join(consumer,'src/index.ts'),fs.readFileSync(path.join(root,'wasm/test/fixtures/projects/fastly-compute-reality/dynamic-backends-example.ts')));
  report.publicExampleSha256=hash(fs.readFileSync(path.join(consumer,'src/index.ts')));
  const exampleNative=artifact(await build('native','public-example')),exampleJs=path.join(await build('javascript','public-example-js'),'src/application.js');
  const exampleHeaders={'x-first-url':two[0],'x-second-url':two[1]};
  const example=execute(exampleNative,{request:{path:'/compare',headers:exampleHeaders},fixtures:Object.fromEntries(two.map((url,i)=>[url,{body:String(i)}]))});
  assert.deepEqual(JSON.parse(example.response.body),{first:'0',second:'1'});assert.equal(registrations(example).length,2);
  const ej=await js(exampleJs,two,{method:'GET',path:'/compare',headers:exampleHeaders});assert.equal(ej.status,200);assert.equal(ej.body,example.response.body);report.checks.push({case:'canonical-public-example',status:'passed'});
  // Local real-network matrix: 32 independently listening origins, and paths at
  // one repeated origin. Every batch waits for all arrivals, then finishes in
  // reverse order. Readiness probes never enter this POST-only application.
  let expected=0,batch=[],arrivals=[],completed=[],observedOrigins=[];
  function originHandler(originIndex,req,res){const index=Number(req.url.slice(1));arrivals.push(index);observedOrigins.push({request:index,origin:originIndex});batch.push({index,originIndex,res});
   assert.equal(req.headers.host,`127.0.0.1:${res.socket.localPort}`);
   if(batch.length===expected){const members=batch.sort((a,b)=>b.index-a.index);batch=[];
    const finish=i=>{const m=members[i];m.res.once('finish',()=>{completed.push(m.index);if(i+1<members.length)finish(i+1);});m.res.end(m.originIndex+':'+m.index);};finish(0);}
  }
  for(let i=0;i<32;i++){const server=http.createServer((req,res)=>originHandler(i,req,res));origins.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');}
  const ports=origins.map(o=>o.address().port);const manifestFile=path.join(dynamic.directory,'fastly.toml');
  fs.writeFileSync(manifestFile,fastly.renderFastlyLocalConfig({name:'r08-installed-dynamic',backends:{}}));
  compute=await fastly.startFastlyComputeServe({launcher,packageRoot:dynamic.directory,wasmFile:path.join(dynamic.directory,'bin/main.wasm'),manifestFile,startTimeoutMs:15000,stopTimeoutMs:3000});
  report.local=[];
  for(const capacity of [1,4,16,32])for(const kind of ['repeated','distinct']){
   expected=capacity;arrivals=[];completed=[];batch=[];observedOrigins=[];
   const endpoints=Array.from({length:capacity},(_,i)=>`http://127.0.0.1:${ports[kind==='repeated'?0:i]}/${i}`),start=performance.now();
   const response=await fetch(compute.baseUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoints}),signal:AbortSignal.timeout(5000)});
   assert.equal(response.status,200);assert.deepEqual(await response.json(),endpoints.map((_,i)=>(kind==='repeated'?0:i)+':'+i));
   assert.deepEqual(observedOrigins.sort((a,b)=>a.request-b.request),Array.from({length:capacity},(_,i)=>({request:i,origin:kind==='repeated'?0:i})));
   assert.deepEqual([...arrivals].sort((a,b)=>a-b),Array.from({length:capacity},(_,i)=>i));assert.deepEqual(completed,Array.from({length:capacity},(_,i)=>capacity-1-i));
   report.local.push({capacity,artifactCapacity:32,kind,status:'passed',listenerIdentityVerified:true,loopbackRoundTripMs:performance.now()-start,timingScope:'host + loopback transport + origin barrier; not registration overhead'});
  }
  // Production TLS has no fixture CA override. An untrusted local certificate
  // must fail before HTTP reaches the origin; trusted public TLS stays hosted.
  const key=path.join(temporary,'tls-key.pem'),cert=path.join(temporary,'tls-cert.pem');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','basicConstraints=critical,CA:FALSE','-addext','subjectAltName=DNS:localhost','-keyout',key,'-out',cert]);
  let tlsRequests=0;const tlsErrors=[];
  const tlsServer=require('node:https').createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(_req,res)=>{tlsRequests++;res.end('unexpected');});origins.push(tlsServer);
  tlsServer.on('tlsClientError',error=>tlsErrors.push(error.code));tlsServer.listen(0);await once(tlsServer,'listening');
  const response=await fetch(compute.baseUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoints:[`https://localhost:${tlsServer.address().port}/0`]}),signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,502);assert.equal(await response.text(),'Bad Gateway');assert.equal(tlsRequests,0);
  assert(tlsErrors.length>0||/UnknownIssuer|unknown issuer|certificate/i.test(compute.logs.stderr));
  report.local.push({kind:'untrusted-tls',status:'passed',http:502,originHttpRequests:tlsRequests,tlsErrors,customTrustOverride:false});
  await compute.stop();assert(compute.child.exitCode!==null||compute.child.signalCode);compute=null;
  assert.equal(verifyInstalled(packed.manifest),report.installedHash);for(const {dynamic:a}of artifacts.values())assert.equal(hash(fs.readFileSync(path.join(a.directory,'bin/main.wasm'))),hash(a.wasm));
  report.installedBytesUnchanged=true;report.registry={...registry.requests};report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack||String(error);throw error;}
 finally{
  if(compute)await compute.stop();
  for(const origin of origins){origin.closeAllConnections();if(origin.listening)await new Promise(resolve=>origin.close(resolve));}
  if(registry)await new Promise(resolve=>registry.server.close(resolve));
  fs.rmSync(temporary,{recursive:true,force:true});report.cleanup={status:fs.existsSync(temporary)?'failed':'passed',consumerRemoved:!fs.existsSync(consumer),temporaryRemoved:!fs.existsSync(temporary)};
  report.durationMs=performance.now()-started;save();
 }
 console.log(JSON.stringify({status:report.status,report:reportFile,matrixCells:report.matrix.length,localCells:report.local.length,checks:report.checks.length,hosted:report.hosted.status,cleanup:report.cleanup.status}));
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
