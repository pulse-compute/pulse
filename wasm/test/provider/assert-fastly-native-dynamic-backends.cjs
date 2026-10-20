'use strict';
const assert = require('node:assert/strict');
const {compileCanonicalSource} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const source = `export default async function handler(ctx) {
  const {first,second} = await ctx.parallel({
    first:ctx.fetch(ctx.req.header('x-a'),{timeoutMs:100}).text(),
    second:ctx.fetch(ctx.req.header('x-b')).text()
  });
  return ctx.text(first + '|' + second);
}`;
const plan = () => buildCanonicalNativePlan(compileCanonicalSource(source,{fileName:'dynamic-backend-proof.ts',strict:false}));
const registrations = r => r.trace.filter(x => x.name === 'register_dynamic_backend');
const sends = r => r.trace.filter(x => x.name === 'send_async');
function main() {
  let checks = 0;
  for (const [name,compile,generate,execute] of [
    ['http',http.compileFastlyNativeHttpEffectsPlan,http.generateFastlyNativeHttpEffectsAssemblyScript,httpHost.executeFastlyNativeHttpEffects],
    ['platform',platform.compileFastlyNativePlatformCapabilitiesPlan,platform.generateFastlyNativePlatformCapabilitiesAssemblyScript,platformHost.executeFastlyNativePlatformCapabilities]
  ]) {
    const p = plan();
    const options = {cwd:process.cwd(),canonicalBuild:true,requirePlatformCapability:false,emitWat:false,dynamicBackends:true,bindings:{dynamicBackends:true}};
    const compiled = compile(p,options);
    assert(compiled.manifest.allowedImports.some(([module,name])=>module==='fastly_http_req'&&name==='register_dynamic_backend'));
    assert.equal(compiled.manifest.dynamicBackends.maxRegistrationAttempts,32);
    const run = (a,b=a,extra={}) => execute(compiled,{request:{headers:{'x-a':a,'x-b':b}},fixtures:{[new URL(a).href.split('#')[0]]:{body:'a'},[new URL(b).href.split('#')[0]]:{body:'b'}},...extra});
    let r = run('http://alpha.test/a','https://beta.test:8443/b');
    assert.equal(r.response.body,'a|b');
    assert.deepEqual(registrations(r).map(x=>[x.target,x.host,x.tls,x.sni]),[['alpha.test:80','alpha.test',false,''],['beta.test:8443','beta.test:8443',true,'beta.test']]);
    assert.equal(sends(r).length,2);assert.deepEqual(sends(r).map(x=>x.backend),registrations(r).map(x=>x.backendName));checks++;
    r = run('HTTPS://Alpha.TEST:443/a#fragment','https://alpha.test/b');
    assert.equal(r.response.body,'a|b');assert.equal(registrations(r).length,1);
    assert.deepEqual(sends(r).map(x=>x.url),['https://alpha.test/a','https://alpha.test/b']);checks++;
    r = run('http://alpha.test:80/a','http://alpha.test:81/b');assert.equal(registrations(r).length,2);checks++;
    r = run('http://127.0.0.1/a','http://alpha.test./b');assert.equal(registrations(r).length,2);checks++;
    // Build-time origin inference is absent: a runtime configured mapping still
    // wins, while a different origin must not hit the legacy single-backend path.
    const mapped = compile(p,{...options,backends:{'https://mapped.test':'mapped'},bindings:{dynamicBackends:true,backends:{'https://mapped.test':'mapped'}}});
    r = execute(mapped,{request:{headers:{'x-a':'https://mapped.test/a','x-b':'http://other.test/b'}},fixtures:{'https://mapped.test/a':{body:'a'},'http://other.test/b':{body:'b'}}});
    assert.deepEqual(sends(r).map(x=>x.backend),['mapped','pulse-native-dynamic-0']);assert.equal(registrations(r).length,1);checks++;
    const fixed = Object.fromEntries(p.effects.map(e=>[e.id,'explicit']));
    const staticOptions = {...options,dynamicBackends:false,effectBackends:fixed,bindings:{effectBackends:fixed,dynamicBackends:false}};
    const off = compile(p,staticOptions), unused = compile(p,{...staticOptions,dynamicBackends:true,bindings:{...staticOptions.bindings,dynamicBackends:true}});
    assert.equal(off.source,unused.source);assert.deepEqual(off.wasm,unused.wasm);
    assert(!off.inspection.imports.some(x=>x.name==='register_dynamic_backend'));
    assert(!off.source.includes('__pulse_dynamic_'));checks++;
    // Explicit effect bindings also bypass dynamic URL eligibility.
    r = execute(unused,{request:{headers:{'x-a':'https://[::1]/a','x-b':'https://[::1]/b'}},fixtures:{'https://[::1]/a':{body:'a'},'https://[::1]/b':{body:'b'}}});
    assert.equal(r.response.body,'a|b');assert.equal(registrations(r).length,0);checks++;
    const reservedStatic=Object.fromEntries(p.effects.map(e=>[e.id,'pulse-native-dynamic-0']));
    const reserved=compile(p,{...staticOptions,effectBackends:reservedStatic,bindings:{effectBackends:reservedStatic}});
    r=execute(reserved,{request:{headers:{'x-a':'https://static.test/a','x-b':'https://static.test/b'}},fixtures:{'https://static.test/a':{body:'a'},'https://static.test/b':{body:'b'}}});
    assert.equal(r.response.body,'a|b');assert.equal(registrations(r).length,0);checks++;
    assert.throws(()=>generate(p,{...options,dynamicBackends:false,bindings:{dynamicBackends:false}}));checks++;
    const invalid = ['ftp://host/a','https://user:token@host/a','https://[::1]/a','https://127.0.0.1/a','http://127.1/a','http://0177.0.0.1/a','http://0x7f000001/a','http://alpha.123/a','https://xn--example.test/a','https://é.test/a','https://host:0/a','https://host:65536/a','https://-bad.test/a','https://bad..test/a','https://host\\evil/a','https://host/a b'];
    for (const url of invalid) {
      // Catch the raw provider diagnostic in the lower-level fixture; the
      // platform driver additionally emits a safe actionable HTTP response.
      let result;
      const call=()=>execute(compiled,{request:{headers:{'x-a':url,'x-b':'https://valid.test/b'}},allowHandledDynamicBackendError:true});
      if(name==='http') assert.throws(call,e=>{result=e.detail;return e.detail.errorStage===273;});
      else {result=call();assert.equal(result.response.status,400);assert.equal(result.instance.exports.pulse_fastly_error_stage(),273);assert(!result.response.body.includes(url));}
      assert.equal(registrations(result).length,0);assert.equal(sends(result).length,0);assert(!result.trace.some(x=>x.module==='fastly_http_req'&&x.name==='new'));checks++;
    }
    for(const status of [1,5,13]) {
      const stage=status===5?274:275;
      let result;
      const call=()=>run('https://alpha.test/a','https://beta.test/b',{dynamicBackendStatus:status,allowHandledDynamicBackendError:true});
      if(name==='http')assert.throws(call,e=>{result=e.detail;return e.detail.errorStage===stage;});
      else {result=call();assert.equal(result.response.status,500);assert.equal(result.instance.exports.pulse_fastly_dynamic_backend_status(),status);}
      assert.equal(registrations(result).length,1);assert.equal(sends(result).length,0);assert(!result.trace.some(x=>x.module==='fastly_http_req'&&x.name==='new'));checks++;
    }
    let collision;
    const collide=()=>run('https://alpha.test/a','https://beta.test/b',{staticBackendNames:['pulse-native-dynamic-0'],allowHandledDynamicBackendError:true});
    if(name==='http')assert.throws(collide,e=>{collision=e.detail;return e.detail.errorStage===275;});
    else{collision=collide();assert.equal(collision.response.status,500);}
    assert.equal(registrations(collision).length,1);assert.equal(sends(collision).length,0);checks++;
    if(name==='platform') {
      assert(generate(p,{...options,maxDurationMs:1000,bodyForwarding:{requestMaxBytes:1024,responseMaxBytes:1024}}).manifest.dynamicBackends, 'Unused forwarding configuration does not disable ordinary dynamic fetch');checks++;
      const {inspectFastlyCanonicalTarget}=require('../../../packages/provider-fastly/src/build/canonical-target.js');
      const inspected=inspectFastlyCanonicalTarget({plan:p,native:mapped,bindings:{dynamicBackends:true,backends:{'https://mapped.test':'mapped'}}});
      assert.equal(inspected.policy.dynamicBackends.maxRegistrationAttempts,32);
      assert.throws(()=>inspectFastlyCanonicalTarget({plan:p,native:mapped,bindings:{dynamicBackends:true,backends:{'https://mapped.test':'changed'}}}),{code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'});
      assert.throws(()=>inspectFastlyCanonicalTarget({plan:p,native:off,bindings:{dynamicBackends:true}}),{code:'PULSE_FASTLY_NATIVE_ARTIFACT_INVALID'});checks++;
      // A successful sibling is settled before a later registration failure;
      // the failed destination never allocates an outbound request.
      r=run('http://alpha.test/a','http://beta.test/b',{onDynamicBackendRegistration:record=>record.target==='beta.test:80'?1:0,allowHandledDynamicBackendError:true});
      assert.equal(r.response.status,500);assert.equal(sends(r).length,1);
      assert.equal(r.transportResources.pendingRequests,0);assert.equal(r.transportResources.outboundRequests,0);checks++;

      r=run('http://alpha.test/a','http://beta.test/b',{dynamicBackendRegistrationMs:100,allowHandledFetchDeadlineError:true});
      assert.equal(r.response.status,504);assert.equal(sends(r).length,0);assert.equal(r.transportResources.outboundRequests,0);checks++;
      const budget=compile(p,{...options,maxDurationMs:50});
      r=execute(budget,{request:{headers:{'x-a':'http://alpha.test/a','x-b':'http://beta.test/b'}},dynamicBackendRegistrationMs:50,allowHandledFetchDeadlineError:true});
      assert.equal(r.response.status,504);assert.equal(sends(r).length,0);checks++;
    }
  }
  const collectionSource=`export default async function handler(ctx) {
    const input=await ctx.req.json();
    const first=ctx.effects({max:32});
    for(const url of input.first) first.add(ctx.fetch(url).text());
    const a=await ctx.parallel(first);
    const second=ctx.effects({max:32});
    for(const url of input.second) second.add(ctx.fetch(url).text());
    const b=await ctx.parallel(second);
    return ctx.json({a,b});
  }`;
  const cp=buildCanonicalNativePlan(compileCanonicalSource(collectionSource,{fileName:'dynamic-collections.ts',strict:false}));
  const collection=platform.compileFastlyNativePlatformCapabilitiesPlan(cp,{cwd:process.cwd(),canonicalBuild:true,requirePlatformCapability:false,bindings:{dynamicBackends:true},emitWat:false});
  const urls=Array.from({length:33},(_,i)=>`http://origin-${i}.test/item`);
  const fixtures=Object.fromEntries(urls.map((url,i)=>[url,{body:String(i)}]));
  function collect(first,second,extra={}) {return platformHost.executeFastlyNativePlatformCapabilities(collection,{request:{method:'POST',body:JSON.stringify({first,second})},fixtures,...extra});}
  let r=collect(urls.slice(0,32),[urls[0]]);
  assert.deepEqual(JSON.parse(r.response.body),{a:urls.slice(0,32).map((_,i)=>String(i)),b:['0']});
  assert.equal(registrations(r).length,32);assert.equal(sends(r).length,33);checks++;
  r=collect(urls.slice(0,32),[urls[0],urls[32]],{allowHandledDynamicBackendError:true});
  assert.equal(r.response.status,500);assert.equal(r.instance.exports.pulse_fastly_error_stage(),276);
  assert.equal(registrations(r).length,32);assert.equal(sends(r).length,33);
  assert.equal(r.transportResources.pendingRequests,0);assert.equal(r.transportResources.outboundRequests,0);checks++;
  console.log(`ok - Native dynamic backends: ${checks} compiled provider checks`);
}
module.exports={main};
if(require.main===module)main();

// Real local execution of the production generator, kept separate from the
// injected ABI cells and from R08's installed/hosted qualification.
async function local(launcherOptions = {}) {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const httpServer=require('node:http');
  const {once}=require('node:events');
  const cli=require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
  const launcher=cli.inspectFastlyComputeLauncher({...launcherOptions,required:true});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-native-dynamic-local-'));
  let server,arrivals=[],completions=[],alpha,beta;
  const origins=['a','b'].map(id=>httpServer.createServer((req,res)=>{
    arrivals.push(id);assert.equal(req.headers.host,`127.0.0.1:${res.socket.localPort}`);
    res.on('finish',()=>completions.push(id));
    if(id==='a')alpha=res;else beta=res;
    if(alpha&&beta){const a=alpha,b=beta;alpha=beta=null;b.once('finish',()=>a.end('a'));b.end('b');}
  }));
  try {
    for(const origin of origins){origin.listen(0,'127.0.0.1');await once(origin,'listening');}
    const urls=origins.map(origin=>`http://127.0.0.1:${origin.address().port}/probe`);
    // No per-fetch timing assertion on a real scheduler; timing boundaries are
    // exercised by the deterministic host cells above.
    const p=buildCanonicalNativePlan(compileCanonicalSource(source.replace(',{timeoutMs:100}',''),{fileName:'dynamic-local.ts',strict:false}));
    const native=platform.compileFastlyNativePlatformCapabilitiesPlan(p,{cwd:process.cwd(),canonicalBuild:true,requirePlatformCapability:false,bindings:{dynamicBackends:true},emitWat:false});
    const wasmFile=path.join(directory,'main.wasm'),manifestFile=path.join(directory,'fastly.toml');
    fs.writeFileSync(wasmFile,native.wasm);fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'pulse-native-dynamic-local',backends:{}}));
    server=await cli.startFastlyComputeServe({launcher,packageRoot:directory,wasmFile,manifestFile,startTimeoutMs:15000,stopTimeoutMs:3000});
    for(let i=0;i<2;i++){
      arrivals=[];completions=[];
      const response=await fetch(server.baseUrl,{headers:{'x-a':urls[0],'x-b':urls[1]},signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200);assert.equal(await response.text(),'a|b');
      assert.deepEqual([...arrivals].sort(),['a','b']);assert.deepEqual(completions,['b','a']);
    }
    console.log(JSON.stringify({proof:'R07 production Native generator, runtime multi-origin HTTP, reverse completion and fresh requests',status:'passed',launcher:launcher.kind,wasm:native.manifest.wasm,hosted:'not-run'}));
  } finally {
    if(server){await server.stop();assert(server.child.exitCode!==null||server.child.signalCode);}
    for(const origin of origins){origin.closeAllConnections();if(origin.listening)await new Promise(resolve=>origin.close(resolve));}
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
module.exports.local=local;
