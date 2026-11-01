'use strict';
const assert=require('node:assert/strict');
const platform=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const adapter=require('../../../packages/provider-fastly/src/build/host-extensions');
const fixture=require('../support/host-extension-fixture.cjs');
const execute=require('../support/terminal-host.cjs');
const clone=x=>structuredClone(x);
let checks=0;
function check(name,fn){fn();checks++;console.log('ok - '+name);}
const first=fixture(),second=fixture({name:'@independent/edge',abi:'different_terminal',operation:'finish',version:'91.0.0'});
try {
  for(const f of [first,second]) {
    const {plan,options}=f.compile(), abi=f.artifact.data.imports[0].module;
    const native=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
    check(f.name+' authentic completion uses shared response authority',()=>{
      const r=execute(native.wasm,{abi});assert.ifError(r.trap);assert.equal(r.error,0);assert.equal(r.calls,1);assert.equal(r.sends.length,0);
      assert.deepEqual(r.trace.find(x=>x.kind==='dispatch'),{kind:'dispatch',request:1,backend:'edge_backend'});
      assert.deepEqual(r.closes.map(x=>[x.module,...x.args]),[['fastly_http_req',1],['fastly_http_body',2]]);
      assert.equal(r.instance.exports.pulse_set_effect_result(0,r.instance.exports.pulse_result_handle()),0);
      r.instance.exports._start();assert.equal(r.calls,1);assert.equal(r.closes.length,2);
      assert(!native.inspection.exports.some(x=>/^pulse_extension_/.test(x.name)));
      assert.equal(native.manifest.hostExtensions.finalWasmSha256,native.manifest.wasm.sha256);
      assert.equal(native.manifest.hostExtensions.useSites[0].contributionId,f.artifact.id);
    });
    check(f.name+' ordinary branch retains response and cleanup',()=>{
      const r=execute(native.wasm,{abi,path:'/plain'});assert.ifError(r.trap);assert.equal(r.error,0);assert.equal(r.calls,0);assert.equal(r.sends.length,1);assert.equal(r.sends[0].body,'plain');assert.equal(r.closes.length,2);
    });
    check(f.name+' uncertain outcome never sends, retries, or disposes',()=>{
      for(const opts of [{status:7},{trap:true}]) {const r=execute(native.wasm,{abi,...opts});assert.equal(r.calls,1);assert.equal(r.sends.length,0);assert.equal(r.closes.length,0);if(opts.trap)assert(r.trap instanceof WebAssembly.RuntimeError);else {assert.equal(r.stage,281);assert.equal(r.error,1003);}r.instance.exports._start();assert.equal(r.calls,1);}
    });
    check(f.name+' cleanup failure retires handles once and preserves authority',()=>{
      const r=execute(native.wasm,{abi,closeStatus:7});assert.equal(r.stage,285);assert.equal(r.closes.length,2);assert.equal(r.sends.length,0);assert.equal(r.calls,1);r.instance.exports._start();assert.equal(r.closes.length,2);
    });
    check(f.name+' raw setter cannot authenticate a dispatch result',()=>{
      let setter;const r=execute(native.wasm,{abi,onDispatch:x=>{setter=x.pulse_set_effect_result(0,1)}});assert.equal(setter,0);assert.equal(r.sends.length,0);assert.equal(r.calls,1);assert.notEqual(r.error,0);
    });
    check(f.name+' original deadline fences pre/post-dispatch',()=>{
      const pre=execute(native.wasm,{abi,clock:n=>n<4?0:1001});assert.equal(pre.calls,0);assert.equal(pre.sends.length,1);assert.equal(pre.sends[0].status,504);assert.equal(pre.closes.length,2);
      let dispatched=false;const post=execute(native.wasm,{abi,onDispatch:()=>{dispatched=true},clock:()=>dispatched?1001:0});assert.equal(post.calls,1);assert.equal(post.sends.length,0);assert.notEqual(post.error,0);assert.equal(post.closes.length,2);
    });
    check(f.name+' uses the same optional observer binding',()=>{
      const note=n=>`__pulse_fastly_jwt_secret_calls = __pulse_fastly_jwt_secret_calls * 10 + ${n};`;
      const hook=(point,body)=>({point,owner:'test.observer',order:20,body});
      const services=[hook('request.acquired',note(1)),hook('effect.settle',note(2)+'return true'),
        {point:'effect.deliver',owner:'test.observer',order:20,before:note(3),after:note(5)},hook('effect.result',note(4)+'return true'),
        hook('invocation.end',note(6)),hook('invocation.close',note(7)),hook('invocation.closed',note(8))];
      const observed=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:services});
      const r=execute(observed.wasm,{abi});assert.equal(r.error,0);assert.equal(r.instance.exports.pulse_fastly_jwt_secret_calls(),12345678);
      assert.equal(execute(native.wasm,{abi}).instance.exports.pulse_fastly_jwt_secret_calls(),0);
      const reordered=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,lifecycleServices:[...services].reverse()});
      assert.equal(reordered.source,observed.source);
      const trapped=execute(observed.wasm,{abi,trap:true});assert.equal(trapped.instance.exports.pulse_fastly_jwt_secret_calls(),1);
    });
    check(f.name+' rejects undeclared and malformed service/placement/binding',()=>{
      const reject=(p,o,code)=>assert.throws(()=>adapter.select(p,o),e=>e.code==='PULSE_HOST_EXTENSION_'+code);
      reject(plan,{...options,realizationArtifacts:[]},'TARGET');
      reject(plan,{...options,targetDescriptor:{...adapter.TARGET,target:'javascript'}},'TARGET');
      reject(plan,{...options,bindings:{backends:{}}},'BINDING');
      reject(plan,{...options,bindings:{backends:{edge:'x'.repeat(adapter.MAX_BACKEND_BYTES+1)}}},'BINDING');
      for(const edit of [p=>p.effects.push(clone(p.effects[0])),p=>p.effects[0].result.mode='bind',p=>p.effects[0].grouped=true,p=>p.effects[0].declaredResult='value',p=>p.effects[0].inputs[1].value.entries.push({}),p=>p.routing={entries:[{}]},p=>p.callables=[{}],p=>p.entry.body[0].test.left.path=['req','body']]) {const p=clone(plan);edit(p);reject(p,options,'PLACEMENT');}
    });
  }
  check('compiled service guards authenticate ticket/token before consumption',()=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
    const {plan,options}=first.compile(),native=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
    const asc=require('../../packages/build-support/src/assemblyscript-compile').resolveAsc(path.resolve(__dirname,'../../packages/compiler'));
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-terminal-guards-'));
    try {
      const name='fastly-native-platform-capabilities.as',file=path.join(tmp,name+'.ts'),out=path.join(tmp,'guards.wasm');
      // Test-only entrypoints expose the actual emitted service/driver primitives;
      // they are compiled into this fixture only, never appended to production Wasm.
      fs.writeFileSync(file,native.source+`
export function test_prepare(): i32 {
  __pulse_invocation_started = true
  __pulse_fastly_request_handle = 1; __pulse_fastly_request_body_handle = 2
  __pulse_extension_handles_owned = true; __request_deadline = 1000000000000
  __pulse_fastly_request_method = 'GET'; __pulse_fastly_request_url = 'https://test.invalid/transfer'; __pulse_fastly_request_path = '/transfer'
  pulse_start(); return unchecked(__pulse_invocation_tickets[0])
}
export function test_token(): i32 { return __pulse_extension_token }
export function test_ticket(): i32 { return unchecked(__pulse_invocation_tickets[0]) }
export function test_settle(ticket: i32, token: i32): i32 { return __pulse_invocation_settle(0, ticket, token) }
export function test_close(): void { __pulse_invocation_close() }
`);
      const r=spawnSync(asc.executable,[asc.script,file,'--outFile',out,'--runtime','stub','--optimize','--noAssert','--use',`abort=${name}/__pulse_fastly_abort`],{cwd:tmp,encoding:'utf8',timeout:30000});
      assert.equal(r.status,0,r.stderr);const bytes=fs.readFileSync(out),abi=first.artifact.data.imports[0].module;
      for(const attack of ['ticket','token','raw','closed','duplicate']) {
        const result=execute(bytes,{abi,run:x=>{
          const ticket=x.test_prepare(),token=x.test_token();assert(ticket>0&&token>0);
          if(attack==='ticket'){assert.equal(x.test_settle(ticket+1,token),0);assert.equal(x.test_ticket(),ticket);}
          if(attack==='token'){assert.equal(x.test_settle(ticket,token+1),0);assert.equal(x.test_ticket(),ticket);}
          if(attack==='raw'){assert.equal(x.pulse_set_effect_result(0,token),0);assert.equal(x.test_ticket(),ticket);}
          if(attack==='closed'){x.test_close();assert.equal(x.test_token(),0);assert.equal(x.test_settle(ticket,token),0);}
          if(attack==='duplicate'){assert.equal(x.test_settle(ticket,token),1);assert.equal(x.test_ticket(),0);assert.equal(x.test_settle(ticket,token),0);}
        }});assert.ifError(result.trap);assert.equal(result.calls,1);assert.equal(result.sends.length,0);
      }
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
  check('unselected contributions omit service, observers and ABI machinery',()=>{
    const {plan,options}=first.compile("return ctx.text('plain');");
    const absent=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,realizationArtifacts:[],requirePlatformCapability:false});
    const unused=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,requirePlatformCapability:false});
    assert.equal(absent.source,unused.source);assert.deepEqual(absent.wasm,unused.wasm);assert.deepEqual(absent.inspection.imports,unused.inspection.imports);
    assert.equal(unused.manifest.hostExtensions,undefined);assert.doesNotMatch(unused.source,/__pulse_extension_|__pulse_response_authority|__pulse_lifecycle_/);
  });
  check('final inspection rejects undeclared imports and mismatched contributed signatures',()=>{
    const {plan,options}=first.compile();
    const native=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
    assert.throws(()=>platform.inspectFastlyNativePlatformCapabilitiesWasm(native.wasm),{code:'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORT_UNSUPPORTED'});
    const c=require('../../packages/contracts/src/provider/toolchain').hostExtensions;
    const a=clone(first.artifact);a.data.imports[0].parameters=['i64','i32','i32'];
    const policy=c.composeImportPolicy(native.manifest.hostExtensions.importPolicy.permittedImports.filter(x=>x.module!==a.data.imports[0].module),[a]);
    assert.throws(()=>platform.inspectFastlyNativePlatformCapabilitiesWasm(native.wasm,{extensionPolicy:policy}),{code:'PULSE_HOST_EXTENSION_SIGNATURE'});
  });
  console.log(`ok - ${checks} Fastly terminal adapter groups; injected ABI only, no hosted acceptance`);
} finally {first.close();second.close();}
