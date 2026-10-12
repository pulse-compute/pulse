'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const cases = [
  [[], 401, 'missing'],
  [[['x-proof', '']], 401, 'empty'],
  [[['x-proof', 'wrong']], 401, 'wrong'],
  [[['X-PrOoF', 'accepted']], 200, 'accepted'],
  [[['x-proof', 'accepted'], ['x-proof', 'wrong']], 200, 'accepted'],
];
async function main() {
  const dir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../..'), '.header-lookup-proof-'));
  const tc = acceptanceToolchain();
  let checks = 0;
  try {
    fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, '.pulse'));
    fs.writeFileSync(path.join(dir, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(_ => ({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{bindings:{backends:{'https://origin.example.test':'origin'},kv:{proof:'proof'}}}}}));`);
    for (const handler of [false, true]) {
      const branch = `if (value === undefined) return ctx.text('missing', {status:401});
if (value === '') return ctx.text('empty', {status:401});
if (value !== 'accepted') return ctx.text('wrong', {status:401});
return ctx.text('accepted');`;
      fs.writeFileSync(path.join(dir, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app = new Pulse({auto:true});
app.get('/request', async ctx => {const value = ctx.req.header('X-Proof'); ${branch}});
app.get('/response', async ctx => {const response = await ctx.fetch('https://origin.example.test/'); const value = response.header('X-Proof'); ${branch}});
app.get('/dispatch', async ctx => {const response = await ctx.fetch('https://origin.example.test/'); let dispatch = 'unacknowledged'; if (response.status === 202 && response.header('X-Proof') === 'accepted') dispatch = 'acked'; return ctx.text('healthy',{headers:{'x-tick-dispatch':dispatch}});});
app.get('/request-failure', async ctx => {const value = ctx.req.header('bad name'); await ctx.kv('proof').put('accepted',true); return ctx.text(value || 'continued');});
app.get('/response-failure', async ctx => {const response = await ctx.fetch('https://origin.example.test/'); const value = response.header('bad name'); await ctx.kv('proof').put('accepted',true); return ctx.text(value || 'continued');});
${handler ? "app.error(async (error, ctx, next) => ctx.text('application-error', {status:422}));" : ''}
export default app;`);
      const native = tc.compileFastly(tc.resolveProject({cwd:dir, profile:'proof'}));
      for (const kind of ['request', 'response']) {
        const run = (headers, options = {}) => tc.executeFastlyNativePlatformCapabilities(native, {
          request:{method:'GET',path:`/${kind}`,headers:kind === 'request' ? headers : []},
          fixtures:{'https://origin.example.test/':{status:202,headers,body:'origin'}}, kvStores:{proof:{}}, ...options,
        });
        for (const [headers, status, body] of cases) {
          const result = run(headers);
          assert.equal(result.response.status, status); assert.equal(result.response.body, body);
          assert.equal(result.instance.exports.pulse_fastly_last_error(),0);
          checks++;
        }
        const paged = run([['x-proof','accepted'],['x-proof','wrong']], {requestHeaderPageBytes:9});
        assert.equal(paged.response.body,'accepted'); checks++;
        const empty = run([], {headerLookupFault:call => call.kind === kind ? {cursor:0} : undefined});
        assert.equal(empty.response.body,'missing'); checks++;
        for (const [headers, status] of cases) {
          const ack = run(headers, {request:{method:'GET',path:'/dispatch'}});
          assert.equal(ack.response.status,200); assert.equal(ack.response.body,'healthy');
          assert.ok(ack.response.headers.some(([key,value]) => key === 'x-tick-dispatch' && value === (status === 200 ? 'acked' : 'unacknowledged')));
          checks++;
        }
        for (const fault of [{status:1},{status:2},{status:3},{status:4},{status:10},{written:-1},{written:65537},{cursor:-2},{cursor:0},{cursor:4294967296},{written:0,cursor:1},{unterminated:true}]) {
          const result = run([['x-proof','accepted']], {allowHandledHeaderError:true, headerLookupFault: call => call.kind === kind ? fault : undefined});
          assert.equal(result.response.status,500); assert.equal(result.response.body,'Internal Server Error');
          assert.equal(result.instance.exports.pulse_fastly_last_error(),1003);
          assert.equal(result.instance.exports.pulse_fastly_error_stage(),kind === 'request' ? 22 : 23);
          assert.equal(result.trace.filter(x => x.name === 'send_downstream').length,1);
          checks++;
        }
        const failed = run([], {request:{method:'GET',path:`/${kind}-failure`},allowHandledHeaderError:true});
        assert.equal(failed.response.status,500);
        assert.ok(!failed.trace.some(x => x.module === 'fastly_kv_store'), 'lookup failure cannot reach a protected effect');
        checks++;
      }
      await replay(native, dir);
    }
    console.log(`ok - Fastly header lookups: ${checks} compiled ABI checks`);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
async function replay(native, dir) {
  if (!process.env.PULSE_VICEROY_BIN) {
    console.log('skip - header lookup Viceroy replay requires PULSE_VICEROY_BIN; ABI fixture is not provider reality'); return;
  }
  const launcher = cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  let originHeaders = [];
  const origin = http.createServer((_req,res) => {res.writeHead(202,originHeaders.flat()); res.end('origin');});
  origin.listen(0,'127.0.0.1'); await once(origin,'listening');
  const wasmFile = path.join(dir,'main.wasm'), manifestFile = path.join(dir,'fastly.toml');
  fs.writeFileSync(wasmFile,native.wasm);
  fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'header-lookup-proof',backends:{origin:{url:`http://127.0.0.1:${origin.address().port}`,useSni:false}},kvStores:{proof:{}}}));
  let server;
  try {
    server = await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:60000,stopTimeoutMs:5000});
    for (const kind of ['request','response']) {
      for (const [headers,status,body] of cases) {
        originHeaders = headers;
        const requestHeaders = {};
        for (const [name,value] of headers) {
          const key = name.toLowerCase();
          if (requestHeaders[key] === undefined) requestHeaders[key] = value;
          else requestHeaders[key] = [requestHeaders[key],value].flat();
        }
        const result = await cli.requestFastlyCompute(server,{path:`/${kind}`,headers:kind === 'request' ? requestHeaders : {}});
        assert.equal(result.status,status,`${kind}: ${JSON.stringify(headers)}`); assert.equal(result.body.toString(),body);
        if (kind === 'response') {
          const ack = await cli.requestFastlyCompute(server,{path:'/dispatch'});
          assert.equal(ack.status,200); assert.equal(ack.body.toString(),'healthy');
          assert.ok(ack.headers.some(([key,value]) => key === 'x-tick-dispatch' && value === (status === 200 ? 'acked' : 'unacknowledged')));
        }
      }
      const result = await cli.requestFastlyCompute(server,{path:`/${kind}-failure`});
      assert.equal(result.status,500);assert.equal(result.body.toString(),'Internal Server Error');
    }
    console.log(`ok - local ${launcher.kind} ${launcher.inspection.version}: 17 header HTTP cases; Wasm sha256 ${createHash('sha256').update(native.wasm).digest('hex')}`);
  } finally {if(server) await server.stop(); origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve));}
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode=1;});
module.exports = {main};
