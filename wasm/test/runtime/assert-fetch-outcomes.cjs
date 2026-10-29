'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {compileCanonicalSource,loadCanonicalModule} = require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan,validateCanonicalNativePlan:assertCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-compiler');
const native = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const node = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const fastly = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities:executeFastly} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root = path.resolve(__dirname,'../../..'), url='https://origin.test/data';
const fulfilled=value=>({status:'fulfilled',value});
const rejected=code=>({status:'rejected',error:{code}});
const options={cwd:root,emitWat:false,requirePlatformCapability:false,bindings:{backends:{'https://origin.test':'origin'}}};
async function assertDynamicInitFence() {
  const compiled=compileCanonicalSource(`export default async function handler(ctx){const init=await ctx.req.json();const result=await ctx.fetch('${url}',init).text();return ctx.json(result)}`,{strict:false});
  const plan=buildCanonicalNativePlan(compiled),request={method:'POST',body:JSON.stringify({errors:'collect'}),headers:[['content-type','application/json']]};
  let dispatches=0;
  const adapter={id:'outcome-admission-proof',dispatchEffect(){dispatches++;throw Error('must not dispatch')}};
  await assert.rejects(()=>node.executeCanonicalProgram(loadCanonicalModule(compiled),{request,providerAdapter:adapter}),e=>e.code==='PULSE_FETCH_ERRORS_LITERAL_REQUIRED');
  const wasm=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
  await assert.rejects(()=>native.executeCanonicalNativeModule(wasm,{request,providerAdapter:adapter}),e=>e.code==='PULSE_FETCH_ERRORS_LITERAL_REQUIRED');
  assert.equal(dispatches,0);
  const edge=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  assert.throws(()=>executeFastly(edge,{request}),e=>e.detail?.errorStage===48 && !e.detail?.outboundRequests?.length);
  console.log('ok - dynamic init selector denied before dispatch on generator, Node Native and Fastly Native');
}
async function main() {
  await assertDynamicInitFence();
  let checks=3;
  compileCanonicalSource(`export default async function handler(ctx){const policy='collect';const result=await ctx.fetch('${url}',{errors:policy}).text();return ctx.json(result)}`,{target:'javascript',strict:false});
  checks++;

  for(const init of ["{errors:ctx.req.path}", "{errors:'ignore'}", "{['errors']:'collect'}", "{...{errors:'collect'}}", "options"]) {
    assert.throws(()=>buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){const options={errors:'collect'};const r=await ctx.fetch('${url}',${init}).text();return ctx.json(r)}`,{strict:false})),`reject hidden/dynamic selector ${init}`);checks++;
  }
  const shapes = {
    text:`const result=await ctx.fetch('${url}',{errors:'collect',timeoutMs:20}).text();return ctx.json(result)`,
    json:`const result=await ctx.fetch('${url}',{errors:'collect',timeoutMs:20}).json();return ctx.json(result)`,
    keyed:`const result=await ctx.parallel({first:ctx.fetch('${url}',{errors:'collect',timeoutMs:20}).text(),second:ctx.fetch('${url}/other',{errors:'collect',timeoutMs:100}).text()});return ctx.json(result)`,
    collection:`const endpoints=['${url}','${url}/other'];const effects=ctx.effects({max:2});for(const endpoint of endpoints){effects.add(ctx.fetch(endpoint,{errors:'collect',timeoutMs:20}).text());}const result=await ctx.parallel(effects);return ctx.json(result)`,
    raw:`const result=await ctx.fetch('${url}',{errors:'collect',timeoutMs:20});if(result.status==='fulfilled')return result.value;return ctx.json(result)`,
    mixed:`const result=await ctx.parallel({first:ctx.fetch('${url}',{errors:'collect',timeoutMs:20}).text(),second:ctx.fetch('${url}/other').text()});return ctx.json(result)`
  };
  for(const [shape,body]of Object.entries(shapes)) {
    const compiled=compileCanonicalSource(`export default async function handler(ctx){${body}}`,{fileName:'outcomes.ts',strict:false});
    const plan=buildCanonicalNativePlan(compiled);
    for(const mutate of [p=>{delete p.effects[0].fetchErrors}, p=>{p.effects[0].result.valueKind='string'},p=>{p.effects[0].inputs.find(i=>i.name==='fetchErrors').value.value='ignore'}]) {
      const forged=JSON.parse(JSON.stringify(plan));mutate(forged);
      assert.throws(()=>assertCanonicalNativePlan(forged),/validation failed/);checks++;
    }
    const wasm=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false});
    const edge=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
    const runs={
      generator:fixtures=>node.executeCanonicalProgram(loadCanonicalModule(compiled),{fetches:fixtures}),
      native:fixtures=>native.executeCanonicalNativeModule(wasm,{providerAdapter:node.createNodeProviderAdapter({fetches:fixtures})}),
      fastly:fixtures=>executeFastly(edge,{fixtures,allowHandledTransportError:true,allowHandledFetchDeadlineError:true})
    };
    for(const [target,run]of Object.entries(runs))for(const failure of ['success','network','timeout']) {
      const base={status:503,headers:[['content-type',shape==='json'?'application/json':'text/plain'],['x-test','retained']],body:shape==='json'?'42':'payload'};
      const fault=failure==='network'?(target==='fastly'?{transportStatus:1}:{kind:'network-error'}):failure==='timeout'?(target==='fastly'?{neverHeaders:true}:{kind:'timeout'}):{};
      const result=await run({[url]:{...base,...fault},[url+'/other']:{...base,body:'other',delayMs:10}});
      const first=failure==='success'?fulfilled(shape==='json'?42:'payload'):rejected(failure==='network'?'PULSE_FETCH_NETWORK':'PULSE_FETCH_TIMEOUT');
      if(shape==='raw'&&failure==='success'){assert.equal(result.response.status,503);if(target==='fastly')assert.equal(result.response.body,'payload');else {assert.equal(result.response.bodyClass,'opaque');assert.ok(result.response.bodyHandle);}}
      else assert.deepEqual(JSON.parse(result.response.body),shape==='keyed'?{first,second:fulfilled('other')}:shape==='mixed'?{first,second:'other'}:shape==='collection'?[first,fulfilled('other')]:first,`${target}/${shape}/${failure}`);
      checks++;
    }
    if(shape==='text') {
      const http=require('node:http'), {once}=require('node:events');
      let mode,requests=0;
      const server=http.createServer((req,res)=>{
        requests++;
        if(mode==='reset')req.socket.destroy();
        else if(mode==='body-reset'){res.writeHead(200,{'content-type':'text/plain','content-length':'100'});res.write('partial');setImmediate(()=>res.destroy());}
      });
      server.listen(0,'127.0.0.1');await once(server,'listening');
      try {
        for(mode of ['reset','body-reset','stall']) {
          const adapter=node.createNodeProviderAdapter({fetchImplementation:(_url,init)=>fetch(`http://127.0.0.1:${server.address().port}/`,init)});
          const result=await native.executeCanonicalNativeModule(wasm,{providerAdapter:adapter});
          assert.deepEqual(JSON.parse(result.response.body),rejected(mode==='stall'?'PULSE_FETCH_TIMEOUT':'PULSE_FETCH_NETWORK'),`real Node ${mode}`);checks++;
        }
        assert.equal(requests,3,'one real transport attempt per operation');checks++;
      } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

      for(const field of ['sendStatus','bodyReadStatus']) {
        const r=executeFastly(edge,{fixtures:{[url]:{[field]:1,body:'payload'}},allowHandledTransportError:true});
        assert.deepEqual(JSON.parse(r.response.body),rejected('PULSE_FETCH_NETWORK'));checks++;
      }
      for(const field of ['sendStatus','transportStatus','bodyReadStatus']) {
        assert.throws(()=>executeFastly(edge,{fixtures:{[url]:{[field]:2,body:'payload'}}}),`${field} integrity error must be fatal`);checks++;
      }
      const budget=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,maxDurationMs:20});
      const expired=executeFastly(budget,{fixtures:{[url]:{neverHeaders:true}}});assert.equal(expired.response.status,504);assert.equal(expired.instance.exports.pulse_fastly_request_expired(),1);checks++;
    }
    if(shape==='keyed') {
      for(const field of ['sendStatus','bodyReadStatus']) {
        const r=executeFastly(edge,{fixtures:{[url]:{[field]:1,body:'bad'},[url+'/other']:{body:'other'}},allowHandledTransportError:true});
        assert.deepEqual(JSON.parse(r.response.body),{first:rejected('PULSE_FETCH_NETWORK'),second:fulfilled('other')});checks++;
      }
      const controller=new AbortController(),reason=new Error('enclosing cancellation');
      assert.throws(()=>executeFastly(edge,{signal:controller.signal,fixtures:{[url]:{body:'ok'},[url+'/other']:{body:'other'}},afterHostcall(c){if(c.name==='send_async')controller.abort(reason)}}),e=>e===reason);checks++;
    }
    if(shape==='json')for(const [target,run]of Object.entries(runs)) {
      await assert.rejects(async()=>run({[url]:{body:'{bad',headers:[['content-type','application/json']]}}),`${target}: invalid JSON remains fatal`);checks++;
    }
    if(shape==='mixed')for(const [target,run]of Object.entries(runs)) {
      const fixtures={[url]:{body:'ok'},[url+'/other']:target==='fastly'?{transportStatus:1}:{kind:'network-error'}};
      if(target==='fastly')assert.equal((await run(fixtures)).response.status,502);
      else await assert.rejects(async()=>run(fixtures),`${target}: noncollecting sibling remains fatal`);checks++;
    }
    const hash=data=>require('node:crypto').createHash('sha256').update(data).digest('hex');
    console.log(`ok ${shape}; ${checks} checks; Node ${wasm.wasm.length} bytes ${hash(wasm.wasm)}; Fastly ${edge.wasm.length} bytes ${hash(edge.wasm)}`);
  }
  console.log(`ok - fetch outcomes: ${checks} cross-target cases`);
}
module.exports=main;
module.exports.assertDynamicInitFence=assertDynamicInitFence;
if(require.main===module)main().catch(e=>{console.error(e,e.detail);process.exitCode=1});
