'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const base = 'https://transport.example.test';
async function main() {
  const dir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../..'), '.transport-proof-'));
  const tc = acceptanceToolchain();
  let checks = 0;
  try {
    fs.mkdirSync(path.join(dir,'src')); fs.mkdirSync(path.join(dir,'.pulse'));
    fs.writeFileSync(path.join(dir,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_ => ({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{bindings:{backends:{'${base}':'origin'},kv:{proof:'proof'}}}}}));`);
    for (const mode of ['recover','none','forward','chain','plain']) {
      const recovered = mode === 'recover' || mode === 'chain';
      const status = mode === 'recover' ? 200 : mode === 'chain' ? 503 : mode === 'forward' ? 500 : 502;
      const body = recovered ? 'PULSE_FETCH_NETWORK' : mode === 'forward' ? 'Internal Server Error' : 'Bad Gateway';
      fs.writeFileSync(path.join(dir,'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
app.get('/run', async ctx => {const response = await ctx.fetch('${base}/fail'); await ctx.kv('proof').put('checkpoint',true); return ctx.text('success');});
app.get('/group', async ctx => {const {before,failed,after} = await ctx.parallel({before:ctx.fetch('${base}/before'),failed:ctx.fetch('${base}/fail'),after:ctx.fetch('${base}/after')}); await ctx.kv('proof').put('checkpoint',true); return ctx.text('success');});
${mode === 'recover' ? "app.error(async (error,ctx,next) => ctx.text(error.code,{status:200,headers:{'x-tick-dispatch':'failed'}}));" : mode === 'forward' ? 'app.error(async (error,ctx,next) => next(error));' : mode === 'chain' ? `app.error(async (error,ctx,next) => {const response = await ctx.fetch('${base}/recovery'); return ctx.text('failed-handler-resumed');}); app.error(async (error,ctx,next) => ctx.text(error.code,{status:503,headers:{'x-tick-dispatch':'failed'}}));` : ''}
export default app;`);
      if (mode === 'plain') fs.writeFileSync(path.join(dir,'src/index.ts'), `import type {PulseContext} from '@pulse-compute/runtime';
export default async function handler(ctx:PulseContext) {const response = await ctx.fetch('${base}/fail'); await ctx.kv('proof').put('checkpoint',true); return ctx.text('success');}`);
      const native = tc.compileFastly(tc.resolveProject({cwd:dir,profile:'proof'}));
      for (const route of ['/run','/group']) {
        for (const failure of ['sendStatus','transportStatus']) for (const hostStatus of [1,7,8,9,11,12]) {
          const attempts = [];
          const options = {request:{path:route},allowHandledTransportError:true,kvStores:{proof:{}},
            fixtures:{[`${base}/fail`]:{[failure]:hostStatus},[`${base}/recovery`]:{[failure]:hostStatus},[`${base}/before`]:{body:'before'},[`${base}/after`]:{body:'after'}},
            onOutboundRequest:request => attempts.push(request.url)};
          const result = tc.executeFastlyNativePlatformCapabilities(native,options);
          assert.equal(result.response.status,status);
          assert.equal(result.response.body,body);
          assert.equal(attempts.filter(url => url === `${base}/fail`).length,1,'no implicit retry');
          const grouped = route === '/group' && mode !== 'plain';
          assert.equal(attempts.filter(url => url === `${base}/before`).length,grouped ? 1 : 0);
          assert.equal(attempts.filter(url => url === `${base}/after`).length,grouped && failure === 'transportStatus' ? 1 : 0,
            'send failure suppresses later undispatched members');
          assert.equal(result.instance.exports.pulse_fastly_last_error(),mode === 'none' || mode === 'plain' ? 1006 : 0);
          assert.ok(!result.trace.some(x => x.module === 'fastly_kv_store'),'failed success continuation never resumes');
          const sends = result.trace.filter(x => x.name === 'send_async');
          const waits = result.trace.filter(x => x.name === 'pending_req_wait');
          assert.deepEqual(result.transportResources,{pendingRequests:0,outboundRequests:0});
          assert.equal(waits.length,sends.length,'every dispatched sibling drains once');
          assert.equal(new Set(waits.map(x => x.pendingHandle)).size,waits.length,'no repeated wait');
          assert.equal(result.trace.filter(x => x.name === 'send_downstream').length,1);
          if (recovered) assert.ok(result.response.headers.some(([k,v]) => k === 'x-tick-dispatch' && v === 'failed'));
          assert.equal(attempts.filter(url => url === `${base}/recovery`).length,mode === 'chain' ? 1 : 0);
          checks++;
        }
      }
      if (recovered) {
        const mixed = tc.executeFastlyNativePlatformCapabilities(native,{request:{path:'/group'},allowHandledTransportError:true,
          fixtures:{[`${base}/before`]:{body:'before'},[`${base}/fail`]:{transportStatus:1},[`${base}/after`]:{transportStatus:3}},kvStores:{proof:{}}});
        assert.equal(mixed.response.status,500,'a sibling protocol fault takes priority over recovery');
        assert.equal(mixed.instance.exports.pulse_fastly_last_error(),1003);
        assert.equal(mixed.trace.filter(x => x.name === 'pending_req_wait').length,3);
        assert.deepEqual(mixed.transportResources,{pendingRequests:0,outboundRequests:0});
        checks++;
      }
      // ABI misuse is terminal even with a recovery handler; HTTP error statuses
      // are ordinary successful exchanges and remain available to application code.
      for (const failure of ['sendStatus','transportStatus']) for (const hostStatus of [2,3,4,5,6,10,13,14,99]) {
        const result = tc.executeFastlyNativePlatformCapabilities(native,{request:{path:'/run'},allowHandledTransportError:true,
          fixtures:{[`${base}/fail`]:{[failure]:hostStatus}},kvStores:{proof:{}}});
        assert.equal(result.response.status,500); assert.equal(result.response.body,'Internal Server Error');
        assert.equal(result.instance.exports.pulse_fastly_last_error(),1003);
        assert.equal(result.instance.exports.pulse_fastly_error_stage(),failure === 'sendStatus' ? 77 : 81);
        assert.ok(!result.trace.some(x => x.module === 'fastly_kv_store'));
        assert.deepEqual(result.transportResources,{pendingRequests:0,outboundRequests:0});
        checks++;
      }
      for (const originStatus of [404,500,503]) {
        const result = tc.executeFastlyNativePlatformCapabilities(native,{request:{path:'/run'},
          fixtures:{[`${base}/fail`]:{status:originStatus,body:'origin response'}},kvStores:{proof:{}}});
        assert.equal(result.response.status,200); assert.equal(result.response.body,'success');
        assert.ok(result.trace.some(x => x.module === 'fastly_kv_store'));
        checks++;
      }
      await replay(native,dir,mode);
    }
    console.log(`ok - Fastly transport recovery: ${checks} compiled ABI checks`);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
async function replay(native,dir,mode) {
  if (!process.env.PULSE_VICEROY_BIN) {console.log('skip - transport socket-reset replay requires PULSE_VICEROY_BIN; ABI fixture is not provider reality');return;}
  const launcher = cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  const requests = [];
  const origin = http.createServer((req,res) => {requests.push(req.url); if(req.url === '/fail' || req.url === '/recovery') req.socket.destroy(); else res.end('ready');});
  origin.listen(0,'127.0.0.1'); await once(origin,'listening');
  const wasmFile = path.join(dir,'main.wasm'), manifestFile = path.join(dir,'fastly.toml');
  fs.writeFileSync(wasmFile,native.wasm);
  fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'transport-proof',backends:{origin:{url:`http://127.0.0.1:${origin.address().port}`,useSni:false}},kvStores:{proof:{}}}));
  let server;
  try {
    server = await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:60000,stopTimeoutMs:5000});
    for (const route of ['/run','/group']) {
      requests.length = 0;
      const result = await cli.requestFastlyCompute(server,{path:route});
      assert.equal(result.status,mode === 'recover' ? 200 : mode === 'chain' ? 503 : mode === 'forward' ? 500 : 502);
      assert.equal(result.body.toString(),mode === 'recover' || mode === 'chain' ? 'PULSE_FETCH_NETWORK' : mode === 'forward' ? 'Internal Server Error' : 'Bad Gateway');
      assert.equal(requests.filter(x => x === '/fail').length,1);
      assert.equal(requests.filter(x => x === '/recovery').length,mode === 'chain' ? 1 : 0);
      if (mode === 'recover' || mode === 'chain') assert.ok(result.headers.some(([k,v]) => k === 'x-tick-dispatch' && v === 'failed'));
    }
    console.log(`ok - local ${launcher.kind} ${launcher.inspection.version}: ${mode} socket reset; Wasm sha256 ${createHash('sha256').update(native.wasm).digest('hex')}`);
  } finally {if(server) await server.stop();origin.closeAllConnections();await new Promise(resolve => origin.close(resolve));}
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode=1;});
module.exports = {main};
