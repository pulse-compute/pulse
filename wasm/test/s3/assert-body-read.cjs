'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acceptanceToolchain } = require('./acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const protocol = require('../../../packages/s3/src/provider.js');

async function main() {
  const cwd = fs.mkdtempSync(path.join(__dirname, '.body-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 's3']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    const binding = { endpoint: 'https://objects.example.invalid', bucket: 'body-fixture', region: 'us-east-1', accessKeyIdSecret: 'KEY', secretAccessKeySecret: 'SECRET', maxTextBytes: 32768, timeoutMs: 1000 };
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'native', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] }, native: { host: 'node', target: 'native', node: { bindings: { s3: { objects: binding } } } }, javascript: { host: 'node', target: 'javascript', node: { bindings: { s3: { objects: binding } } } } };
    config.fastly = {host:'fastly',target:'native',fastly:{maxDurationMs:500,bindings:{secretStore:'app_secrets',s3:{objects:{...binding,backend:'object_origin'}}}}};
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import { Pulse } from '@pulse-compute/pulse'; import { s3 } from '@pulse-compute/s3';
      const app = new Pulse({auto:true});
      app.post('/body', async ctx => { const key = await ctx.req.text(); const r = await s3.getBody(ctx, 'objects', key); return r; });
      app.post('/head', async ctx => { const r = await s3.getBody(ctx, 'objects', 'image', {method:'HEAD'}); return r; });
      app.post('/range', async ctx => { const r = await s3.getBody(ctx, 'objects', 'image', {range:'bytes=1-3'}); return r; });
      app.post('/conditional', async ctx => { const r = await s3.getBody(ctx, 'objects', 'image', {ifNoneMatch:'"fixture"'}); return r; });
      app.post('/discard', async ctx => { const r = await s3.getBody(ctx, 'objects', 'image'); return ctx.text('discarded'); });
      export default app;`);
    const toolchain = acceptanceToolchain();
    const project = toolchain.resolveProject({ cwd, profile: 'native' });
    const native = toolchain.compileNativeProjectInMemory(project);
    const js = toolchain.prepareJavascriptApplication(toolchain.resolveProject({ cwd, profile: 'javascript' }));
    const fastly = toolchain.compileFastly(toolchain.resolveProject({cwd,profile:'fastly'}));
    const bytes = Buffer.from([0, 255, 192, 128, 254, 1]);
    let cases = 0;
    for (const target of ['native', 'javascript']) {
      async function run(route, origin, key = 'image', extra = {}) {
        let cancelled = 0, requests = 0;
        const fetchImplementation = async (url, init) => {
          requests++;
          const headers = new Headers(init.headers);
          assert.equal(headers.get('accept-encoding'), 'identity');
          if (route === '/range') { assert.equal(headers.get('range'), 'bytes=1-3'); assert.match(headers.get('authorization'), /;range/); }
          if (route === '/conditional') assert.equal(headers.get('if-none-match'), '"fixture"');
          const body = origin.stream || new ReadableStream({ start(c) { if (origin.bytes) c.enqueue(origin.bytes); if (!origin.pending) c.close(); }, cancel() { cancelled++; } });
          return { status: origin.status ?? 200, headers: origin.headers ?? [['content-length', String(origin.bytes?.length ?? 6)]], body };
        };
        const options = { secrets: {KEY:'fixture-key', SECRET:'fixture-secret'}, fetchImplementation, strict: false, ...extra };
        let response;
        if (target === 'native') {
          const result = await toolchain.executeCanonicalNativeModule(native.native, toolchain.driver.executionOptions(project.providerConfig, { ...options, request: { method:'POST', url:'https://app.invalid'+route, path:route, headers:[], body:key } }));
          assert.equal(result.status, 'completed');
          response = new Response(result.response.bodyStream ?? result.response.body ?? null, { status: result.response.status, headers: result.response.headers });
        } else response = await toolchain.executeNodeJavascriptApplication(js.loaded.application, new Request('https://app.invalid'+route, {method:'POST', body:key}), { ...options, s3:{objects:binding} });
        return { response, get cancelled() { return cancelled; }, get requests() { return requests; } };
      }
      let r = await run('/body', {bytes}); assert.equal(r.response.status,200); assert.deepEqual(Buffer.from(await r.response.arrayBuffer()),bytes); cases++;
      r = await run('/range', {status:206,bytes:bytes.subarray(1,4),headers:[['content-length','3'],['content-range','bytes 1-3/6']]}); assert.equal(r.response.status,206); assert.deepEqual(Buffer.from(await r.response.arrayBuffer()),bytes.subarray(1,4)); assert.equal(r.response.headers.has('x-amz-checksum-sha256'),false); cases++;
      r = await run('/conditional',{status:304,headers:[],pending:true}); assert.equal(r.response.status,304); assert.equal(await r.response.text(),''); cases++;
      r = await run('/head',{headers:[['content-length','9999999']],pending:true}); assert.equal(r.response.status,200); assert.equal(await r.response.text(),''); cases++;
      for (const origin of [{bytes,headers:[['content-length','32769']]},{bytes,headers:[['content-length','6'],['Content-Length','6']]},{bytes,status:302},{bytes,headers:[['content-length','6'],['content-encoding','gzip']]},{bytes,status:206,headers:[['content-length','6'],['content-range','bytes 0-5/6']]}]) {
        r=await run('/body',origin); assert.equal(r.response.status,502); cases++;
      }
      r=await run('/body',{bytes,headers:[['content-length','7']]}); await assert.rejects(r.response.arrayBuffer()); cases++;
      r=await run('/body',{bytes,headers:[['content-length','5']]}); await assert.rejects(r.response.arrayBuffer()); cases++;
      r=await run('/body',{pending:true},'../escape'); assert.equal(r.requests,0); assert.equal(r.response.status,502); cases++;
      r=await run('/discard',{pending:true}); assert.equal(await r.response.text(),'discarded'); await new Promise(setImmediate); assert.equal(r.cancelled,1); cases++;
      r=await run('/body',{bytes:bytes.subarray(0,1),pending:true}); const reader=r.response.body.getReader(); assert.deepEqual((await reader.read()).value,bytes.subarray(0,1)); await reader.cancel(); await new Promise(setImmediate); assert.equal(r.cancelled,1); cases++;
      const aborter = new AbortController();
      r=await run('/body',{pending:true},'image',{signal:aborter.signal}); aborter.abort(); await assert.rejects(r.response.arrayBuffer()); await new Promise(setImmediate); assert.equal(r.cancelled,1); cases++;
      r=await run('/body',{pending:true},'image',{maxDurationMs:80}); await assert.rejects(r.response.arrayBuffer()); await new Promise(setImmediate); assert.equal(r.cancelled,1); cases++;
    }
    cases += await require('./fastly-body-cases.cjs').run(toolchain, fastly, binding);
    const lower = require('../../../packages/s3/pulsewasm.compiler.cjs').buildS3LoweringPlan;
    for (const expression of ["{range:ctx.req.path}", "{method:'POST'}", "{range:'bytes=0-1',range:'bytes=1-2'}", "{headers:{authorization:'x'}}"]) {
      const sourceText = `import {s3} from '@pulse-compute/s3'; app.get('/',async ctx=>{const r=await s3.getBody(ctx,'objects','image',${expression});return r;});`;
      assert.equal(lower({sourceText}).hasErrors,true);
    }
    for (const options of [{range:'bytes=1-'},{range:'bytes=2-1'},{range:'bytes=0-1,3-4'},{method:'HEAD',range:'bytes=0-1'},{ifNoneMatch:'"one", "two"'},{method:'POST'}]) assert.throws(()=>protocol.normalizeBodyOptions(options));
    console.log(`ok - AST-02A ${cases} binary/opaque executions on Node Native, Node JavaScript and Fastly Native ABI fixtures, bounded metadata, partial ranges, deadline and discard cleanup`);
  } finally {
    const cleanup = () => fs.rmSync(cwd,{recursive:true,force:true});
    cleanup();
    // Source-graph fixtures restore input files at process exit; clean after them.
    process.once('exit', cleanup);
  }
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
