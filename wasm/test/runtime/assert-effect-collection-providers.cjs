'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { compileNativeProjectInMemory, prepareJavascriptApplication } = require('../../packages/cli/src/project-execution.js');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const { executeNodeJavascriptTestCase } = require('../../../packages/provider-node/src/javascript/test-runtime.js');
const { executeFastlyJavascriptTestCase } = require('../../../packages/provider-fastly/src/javascript/test-runtime.js');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const root = path.resolve(__dirname, '../../..');
const cwd = path.join(root, 'examples/03-fetch-composition/dynamic-probes');
const allowedPackages = { '@pulse-compute/pulse': require('../../../packages/pulse/src/index.js'), '@pulse-compute/runtime': require('../../../packages/runtime/src/index.js') };
async function main() {
  const projects = Object.fromEntries(['node-native', 'node-javascript', 'fastly-javascript'].map(profile => [profile, resolveProject({cwd, profile})]));
  const compiled = compileNativeProjectInMemory(projects['node-native']);
  const schemaBundle = compiled.compiled.schema.bundle;
  const schemaCodecs = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js').createCanonicalSchemaCodecs(schemaBundle.registry);
  const node = prepareJavascriptApplication(projects['node-javascript'], { allowedPackages, schemaBundle });
  const fastly = prepareJavascriptApplication(projects['fastly-javascript'], { allowedPackages, schemaBundle, localEmulation: true });
  const artifact = compileFastlyNativePlatformCapabilitiesPlan(compiled.plan, { cwd: root, requirePlatformCapability: false, canonicalBuild: true,
    effectBackends: Object.fromEntries(compiled.plan.effects.map(effect => [effect.id, 'origin'])) });
  const cases = [...projects['node-native'].tests];
  cases.push({ name: 'at-limit', request: { method: 'POST', path: '/probe', headers: [['content-type', 'application/json']], body: JSON.stringify({endpoints: Array(32).fill('https://one.example/probe/a')}) },
    fetches: { 'https://one.example/probe/a': { value: {ok:true} } }, expect: { json: {results: Array(32).fill({ok:true})} } });
  for (const test of cases) {
    const adapter = createNodeProviderAdapter({ fetches: test.fetches || {}, networkFetch: false });
    const a = await executeCanonicalNativeModule(compiled.native, {request: test.request, providerAdapter: adapter, strict: true});
    const b = await executeNodeJavascriptTestCase(node.loaded.application, test, {strict: true, schemaCodecs});
    const c = await executeFastlyJavascriptTestCase(fastly.loaded.application, test, {strict: true, schemaCodecs, bindings: { backends: { 'https://one.example': 'origin', 'https://two.example': 'origin' } }, networkFetch: false});
    const fixtures = { origin: Object.fromEntries(Object.entries(test.fetches || {}).map(([url, fixture]) => [new URL(url).pathname, { json: fixture.value }])) };
    const d = executeFastlyNativePlatformCapabilities(artifact, { request: test.request, fixtures });
    for (const [mode, result] of [['node-native',a], ['node-javascript',b], ['fastly-javascript',c]]) {
      assert.equal(result.response.status,test.expect.status || 200, `${test.name}/${mode}`);
      if(test.expect.json) assert.deepEqual(JSON.parse(result.response.body),test.expect.json,`${test.name}/${mode}`);
      else assert.equal(result.response.body,test.expect.text);
    }
    assert.equal(d.response.status,test.expect.status || 200);
    const expected = test.expect.json;
    if(expected) assert.deepEqual(JSON.parse(d.response.body),expected); else assert.equal(d.response.body,test.expect.text);
    const trace = d.trace.filter(x=>['send_async','pending_req_wait','pending_req_poll'].includes(x.name));
    const n = JSON.parse(test.request.body).endpoints.length;
    assert.equal(trace.slice(0,n).filter(x=>x.name==='send_async').length,n,'all members start before polling');
  }
  const eventRoot = fs.mkdtempSync(path.join(root, 'wasm/.test-results/effect-collection-event-'));
  try {
    fs.cpSync(cwd,eventRoot,{recursive:true,filter:file=>!file.includes('/dist')});
    fs.writeFileSync(path.join(eventRoot,'src/index.ts'), `import { Pulse } from '@pulse-compute/pulse'
const app = new Pulse({auto:true})
app.on('probe.batch', {schema:'probe.Input'}, async ctx => {
  const input = ctx.event.payload
  const effects = ctx.effects({max:4})
  for (const endpoint of input.endpoints) { effects.add(ctx.fetch(endpoint).json('probe.Result')) }
  const results = await ctx.parallel(effects)
  ctx.state.set('done','yes')
})
export default app
`);
    const project=resolveProject({cwd:eventRoot,profile:'node-native'});
    const built=compileNativeProjectInMemory(project);
    const javascript=prepareJavascriptApplication(resolveProject({cwd:eventRoot,profile:'node-javascript'}),{allowedPackages,schemaBundle:built.compiled.schema.bundle});
    const executeEvent=require('../../../packages/provider-node/src/javascript/runtime-host.js').executeNodeJavascriptEvent;
    for (const count of [0,2]) for (const target of ['native','javascript']) {
      const frame={version:'pulse.event-frame.v1',type:'probe.batch',schemaId:'probe.Input',payload:{endpoints:Array(count).fill('https://one.example/probe/a')}};
      const options={schemaCodecs,fetchImplementation:async()=>new Response('{"ok":true}',{headers:{'content-type':'application/json'}})};
      const result=target==='native'
        ? await require('../../packages/host-runtime/src/runtime/canonical-native-host.js').executeCanonicalNativeEvent(built.native,frame,{providerAdapter:createNodeProviderAdapter(options)})
        : await executeEvent(javascript.loaded.application,frame,options);
      assert.equal(result.status,'completed',`${target} event ${count}`);
      const abort=new AbortController();abort.abort();
      const cancelled=target==='native'
        ? await require('../../packages/host-runtime/src/runtime/canonical-native-host.js').executeCanonicalNativeEvent(built.native,frame,{signal:abort.signal,providerAdapter:createNodeProviderAdapter(options)})
        : await executeEvent(javascript.loaded.application,frame,{...options,signal:abort.signal});
      assert.equal(cancelled.status,'failed',`${target} cancelled event ${count}`);
    }
  } finally {fs.rmSync(eventRoot,{recursive:true,force:true});}
  // Real local HTTP, with the origin withholding every response until both
  // siblings arrive. A sequential realization fails the bounded request timeout.
  let received = [], completed = [], batch = [];
  const origin = http.createServer((request,response) => {
    received.push(request.url); batch.push({request,response});
    if (batch.length === 2) {
      for (const member of [...batch].sort((a,b)=>b.request.url.localeCompare(a.request.url))) {
        completed.push(member.request.url);
        member.response.setHeader('content-type','application/json');
        member.response.end(JSON.stringify({ok:member.request.url.endsWith('/a')}));
      }
    }
  });
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
  const originUrl = `http://127.0.0.1:${origin.address().port}`;
  const request = {method:'POST',path:'/probe',headers:[['content-type','application/json']],body:JSON.stringify({endpoints:[`${originUrl}/a`,`${originUrl}/b`]})};
  let server, temporary;
  try {
    for (const mode of ['node-native','node-javascript']) {
      received=[];completed=[];batch=[];
      const abort = AbortSignal.timeout(10000);
      const result = mode === 'node-native'
        ? await executeCanonicalNativeModule(compiled.native,{request,strict:true,signal:abort,providerAdapter:createNodeProviderAdapter({fetchImplementation:globalThis.fetch})})
        : await executeNodeJavascriptTestCase(node.loaded.application,{request},{strict:true,schemaCodecs,networkFetch:true,signal:abort});
      assert.equal(result.response.status,200,mode);
      assert.deepEqual(JSON.parse(result.response.body),{results:[{ok:true},{ok:false}]},mode);
      assert.deepEqual([...received].sort(),['/a','/b']);assert.deepEqual(completed,['/b','/a']);
    }
    if (process.argv.includes('--fastly-reality')) {
      const fastlyCli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
      temporary = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-collection-reality-'));
      const wasmFile = path.join(temporary,'main.wasm'), manifestFile=path.join(temporary,'fastly.toml');
      fs.writeFileSync(wasmFile,artifact.wasm);
      fs.writeFileSync(manifestFile,fastlyCli.renderFastlyLocalConfig({name:'pulse-collection-reality',backends:{origin:{url:originUrl,overrideHost:new URL(originUrl).host,useSni:false}}}));
      server = await fastlyCli.startFastlyComputeServe({launcher:fastlyCli.inspectFastlyComputeLauncher({env:process.env}),packageRoot:temporary,wasmFile,manifestFile,env:process.env,startTimeoutMs:60000,stopTimeoutMs:5000});
      received=[];completed=[];batch=[];
      const response=await fastlyCli.requestFastlyCompute(server,{...request,timeoutMs:10000});
      assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body.toString()),{results:[{ok:true},{ok:false}]});
      assert.deepEqual([...received].sort(),['/a','/b']);assert.deepEqual(completed,['/b','/a']);
    }
  } finally {
    if(server) await server.stop();
    origin.closeAllConnections();await new Promise(resolve=>origin.close(resolve));
    if(temporary) fs.rmSync(temporary,{recursive:true,force:true});
  }
  console.log(JSON.stringify({status:'passed',cases:cases.length,targets:['node-native','node-javascript','fastly-native','fastly-javascript'],nodeEvents:8,nodeHttpReality:true,fastlyComputeReality:process.argv.includes('--fastly-reality'), nativeBytes:compiled.native.wasm.length,fastlyBytes:artifact.wasm.length}));
}
main().catch(error=>{console.error(error.stack);if(error.diagnostics)console.error(error.diagnostics);if(error.detail?.stderr)console.error(error.detail.stderr);process.exitCode=1;});
