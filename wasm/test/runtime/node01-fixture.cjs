'use strict';
// This same fixture runs from an isolated exact-package install. No internal imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createNodeLauncher } = require('@pulse-compute/provider-node/server');
const cli = path.resolve('node_modules/@pulse-compute/cli/bin/pulse.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'running', targets: {}, publicImport: '@pulse-compute/provider-node/server' };
const launchers = new Set();
const make = options => { const launcher = createNodeLauncher(options); launchers.add(launcher); return launcher; };
function request(port, route = '/hello', { method = 'GET', body, unfinished = false, agent = false } = {}) {
  let req;
  const result = new Promise((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port, path: route, method, agent }, res => {
      const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('fixture timeout')));
    if (unfinished) { req.setHeader('content-length', '5'); req.flushHeaders(); req.write('x'); }
    else req.end(body);
  });
  return { result, cancel: () => req.destroy(), finish: () => req.end('done') };
}
async function waitActive(launcher) {
  for (let i = 0; i < 100 && !launcher.status().activeRequests; i++) await delay(5);
  assert.equal(launcher.status().activeRequests, 1);
}
async function build(target) {
  const result = await promisify(execFile)(process.execPath, [cli, 'build', '--profile', target, '--json'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(JSON.parse(result.stdout).status, 'built');
}
async function main() {
  fs.mkdirSync('src', { recursive: true }); fs.mkdirSync('.pulse', { recursive: true });
  fs.writeFileSync('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},native:{host:'node',target:'native',outDir:'dist-native'},javascript:{host:'node',target:'javascript',outDir:'dist-javascript'}}));`);
  fs.writeFileSync('src/schemas.ts', `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema'; interface Value {n:number}; export default defineSchemaRegistry({schemas:{'app.Value':schema<Value>()}});`);
  fs.writeFileSync('src/index.ts', `import {Pulse} from '@pulse-compute/pulse'; const app=new Pulse({auto:true});
    app.get('/hello',async ctx=>{const name=await ctx.config.get('name');return ctx.text(name ?? 'missing');});
    app.get('/schema',async ctx=>ctx.json({n:7},{schema:'app.Value'}));
    app.get('/fetch',async ctx=>{const origin=await ctx.config.get('origin');const text=await ctx.fetch(origin ?? 'http://invalid/').text();return ctx.text(text);});
    app.head('/head',async ctx=>ctx.text('head body'));
    app.post('/echo',async ctx=>{const text=await ctx.req.text();return ctx.text(text);});
    app.get('/secret',async (ctx,next)=>{const secret=await ctx.secret.get('token');return next(secret);});
    app.get('/effects',async ctx=>{const a=await ctx.config.get('name');const b=await ctx.config.get('name');return ctx.text(b ?? a ?? '');});
    app.error(async(error,ctx,next)=>{if(error.code==='PULSE_REQUEST_BODY_INVALID_UTF8')return ctx.text('invalid UTF-8',{status:400});return next(error);});
    export default app;`);
  for (const target of ['native', 'javascript']) await build(target);
  // Production starts without source, configuration, or the development server.
  fs.rmSync('src', { recursive: true }); fs.rmSync('.pulse', { recursive: true });
  for (const target of ['native', 'javascript']) {
    const base = { target, buildDir: path.resolve('dist-' + target), port: 0, config: {name: 'NODE-01'}, secrets: {token: 'never-return-this-secret'}, maxDurationMs: 200, maxRequestBodyBytes: 16, maxConcurrentRequests: 1 };
    const launcher = make(base);
    assert.equal(launcher.status().state, 'created');
    const first = launcher.start(); assert.equal(launcher.start(), first);
    let { address: { port } } = await first;
    assert.equal((await request(port).result).body, 'NODE-01');
    assert.equal((await request(port, '/_pulse/ready').result).status, 200);
    assert.equal((await request(port, '/head', {method:'HEAD'}).result).body, '');
    assert.equal((await request(port, '/echo', {method:'POST',body:'hello'}).result).body, 'hello');
    assert.equal((await request(port, '/echo', {method:'POST',body:'x'.repeat(17)}).result).status, 413);
    assert.equal((await request(port,'/echo',{method:'POST',body:Buffer.from([0xff])}).result).status,400);
    assert.deepEqual(JSON.parse((await request(port,'/schema').result).body),{n:7});
    const secret = await request(port, '/secret').result;
    assert.equal(secret.status, 500); assert.ok(!JSON.stringify(secret).includes(base.secrets.token));
    const slow = request(port, '/echo', {method:'POST',unfinished:true});
    await waitActive(launcher);
    assert.equal((await request(port).result).status, 503);
    assert.equal((await request(port, '/_pulse/ready').result).status, 200);
    assert.equal((await slow.result).status, 504);
    const disconnect = request(port, '/echo', {method:'POST',unfinished:true});
    const disconnected = disconnect.result.catch(() => {});
    await waitActive(launcher); disconnect.cancel(); await disconnected;
    for (let i=0;i<100 && launcher.status().activeRequests;i++) await delay(5);
    assert.equal(launcher.status().activeRequests, 0);
    assert.deepEqual(await launcher.close(), {forced:false,abortedRequests:0});
    assert.deepEqual(await launcher.close(), {forced:false,abortedRequests:0});
    ({ address: { port } } = await launcher.start());
    assert.equal((await request(port).result).body, 'NODE-01');
    await launcher.close();
    const graceful=make({...base,maxDurationMs:3000}); port=(await graceful.start()).address.port;
    const inFlight=request(port,'/echo',{method:'POST',unfinished:true}); await waitActive(graceful);
    const gracefulClose=graceful.close(); assert.equal(graceful.status().state,'draining');
    inFlight.finish(); assert.equal((await inFlight.result).body,'xdone');
    assert.deepEqual(await gracefulClose,{forced:false,abortedRequests:0});
    const limited = make({...base,maxEffects:1});
    port=(await limited.start()).address.port;
    assert.equal((await request(port,'/effects').result).status,500);
    await limited.close();
    const draining = make({...base,maxDurationMs:3000,shutdownTimeoutMs:40});
    port=(await draining.start()).address.port;
    const unfinished=request(port,'/echo',{method:'POST',unfinished:true});
    const ended=unfinished.result.catch(()=>{});
    await waitActive(draining);
    const start=Date.now(), closing=draining.close();
    assert.equal(draining.status().state,'draining');
    await assert.rejects(draining.start(),/draining/);
    assert.deepEqual(await closing,{forced:true,abortedRequests:1});
    assert.ok(Date.now()-start<1000); await ended;
    await draining.start(); await draining.close();
    // Port conflicts reject before readiness and leave the launcher restartable.
    const occupied=make(base); port=(await occupied.start()).address.port;
    const collision=make({...base,port}); await assert.rejects(collision.start(),/could not listen/);
    assert.equal(collision.status().state,'stopped'); await occupied.close(); await collision.start(); await collision.close();
    for (const bad of [{target:'fastly'}, {maxDurationMs:0}, {maxDurationMs:undefined}, {maxConcurrentRequests:0}, {maxRequestBodyBytes:Infinity}, {unknown:true}, {config:{x:1}}, {readinessPath:'/'}]) assert.throws(()=>createNodeLauncher({...base,...bad}));
    assert.throws(()=>createNodeLauncher({...base,strict:'yes'}));
    assert.throws(()=>createNodeLauncher({...base,target:target==='native'?'javascript':'native'}),/mismatch/);
    if(target==='native') {
      const file=path.join(base.buildDir,'canonical-native.wasm'),bytes=fs.readFileSync(file);
      fs.writeFileSync(file,Buffer.concat([bytes,Buffer.from([1])]));assert.throws(()=>createNodeLauncher(base),/hash mismatch/);fs.writeFileSync(file,bytes);
    }
    // Real upstream I/O: timeout must cancel the provider fetch, not just send 504.
    let accepted, originResponse, originClosed;
    const arrival=new Promise(resolve=>{accepted=resolve;});
    const closed=new Promise(resolve=>{originClosed=resolve;});
    const origin=http.createServer((req,res)=>{originResponse=res;res.once('close',originClosed);accepted();});
    await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
    try {
      const outgoing=make({...base,networkFetch:true,maxDurationMs:150,config:{origin:'http://127.0.0.1:'+origin.address().port}});
      port=(await outgoing.start()).address.port;
      const response=request(port,'/fetch').result;
      await arrival; assert.equal((await response).status,504);
      await Promise.race([closed,delay(1000).then(()=>{throw new Error('origin was not cancelled');})]);
      await outgoing.close();
    } finally {originResponse?.destroy();await new Promise(resolve=>origin.close(resolve));}
    // Documented process integration: signal drain and a fresh process restart.
    const script = `const {createNodeLauncher}=require('@pulse-compute/provider-node/server');
      const host=createNodeLauncher(${JSON.stringify({...base,maxDurationMs:1000})});
      host.start().then(s=>{process.stdout.write(JSON.stringify(s)+'\\n');process.once('SIGTERM',async()=>{await host.close();});}).catch(()=>{process.exitCode=1;});`;
    fs.writeFileSync('server.cjs',script);
    for(let cycle=0;cycle<2;cycle++) {
      const child=spawn(process.execPath,['server.cjs'],{stdio:['ignore','pipe','pipe']});
      let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
      const watchdog=setTimeout(()=>child.kill('SIGKILL'),5000);
      const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
      try {
        const ready=await Promise.race([new Promise(resolve=>child.stdout.once('data',chunk=>resolve(JSON.parse(chunk)))),exited.then(()=>{throw new Error('child exited before ready: '+stderr);})]);
        assert.equal((await request(ready.address.port).result).body,'NODE-01');
        child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});
      } finally {clearTimeout(watchdog);child.kill('SIGKILL');}
    }
    report.targets[target]={status:'passed',readiness:true,requestBudget:true,bodyLimit:true,effectLimit:true,concurrency:true,disconnect:true,gracefulDrain:true,forcedDrain:true,fetchCancellation:true,signalShutdown:true,processRestart:true,schemas:true,utf8:true,restart:true,portConflict:true,redaction:true};
    console.log('ok - NODE-01 ' + target + ' public launcher lifecycle and budgets');
  }
  fs.writeFileSync('public-types.cts', `import {createNodeLauncher, type NodeLauncherOptions} from '@pulse-compute/provider-node/server';
    const options:NodeLauncherOptions={target:'native',buildDir:'dist',port:0,strict:true};
    const host=createNodeLauncher(options);void host.start();void host.close();host.status();
    // @ts-expect-error target must be explicit
    createNodeLauncher({buildDir:'dist'});
    // @ts-expect-error stream extension is not part of the core launcher
    createNodeLauncher({...options,bodyForwarding:true});`);
  await promisify(execFile)(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','node16','--moduleResolution','node16','--target','es2022','public-types.cts'],{timeout:30000});
  report.publicTypes='passed';
  report.status='passed';
}
main().catch(error=>{report.status='failed';console.error(error.stack || error);process.exitCode=1;}).finally(async()=>{
  await Promise.all([...launchers].map(launcher=>launcher.close()));
  if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
});
