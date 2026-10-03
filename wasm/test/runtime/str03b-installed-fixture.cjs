'use strict';
// Copied outside the checkout. All Pulse imports resolve from the exact install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Writable } = require('node:stream');
const { once } = require('node:events');
const runtime = require('@pulse-compute/runtime/host');
const { executeCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const driver = require('@pulse-compute/provider-node/toolchain').createDriver();
const cli = path.resolve('node_modules/@pulse-compute/cli/bin/pulse.js');
const sha = value => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, label, ms = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}
const report = { version: 'pulse.str03b-wire.v1', status: 'running', node: process.version, targets: {}, exclusions: ['Fastly output', 'transforms', 'MCP SSE', 'arbitrary JavaScript memory/CPU bounds', 'aggregate release seal'] };
const save = () => fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
async function command(args, fail = false) {
  let result;
  try { result = await promisify(execFile)(process.execPath, [cli, ...args, '--json'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) {
    if (fail) return { code: error.code, text: error.stdout + error.stderr };
    let detail; try { const value = JSON.parse(error.stdout); detail = {error:value.error, diagnostics:value.diagnostics, checks:value.checks?.filter(c=>c.status==='failed'), cases:value.cases?.filter(c=>c.status==='failed')}; } catch { detail = (error.stdout + error.stderr).slice(-4000); }
    throw new Error(args.join(' ') + ': ' + JSON.stringify(detail));
  }
  assert.equal(fail, false, 'expected CLI rejection: ' + args.join(' '));
  return JSON.parse(result.stdout);
}
async function dev(profile) {
  const child = spawn(process.execPath, [cli, 'dev', '--profile', profile, '--port', '0', '--no-watch', '--json'], { stdio: ['ignore','pipe','pipe'] });
  const ready = deferred(), closed = deferred(), events = [];
  let stdout = '', stderr = '', stopping = false;
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  child.stdout.on('data', data => {
    stdout += data;
    if (stdout.length > 8 * 1024 * 1024) child.kill('SIGKILL');
    let index;
    while ((index = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, index); stdout = stdout.slice(index + 1);
      let event; try { event = JSON.parse(line); } catch { continue; }
      events.push(event); if (event.event === 'ready') ready.resolve(event);
    }
  });
  child.stderr.on('data', data => { stderr += data; if (stderr.length > 1024 * 1024) child.kill('SIGKILL'); });
  child.on('error', error => ready.resolve({ error: error.message }));
  child.on('close', (code, signal) => { clearTimeout(timer); ready.resolve({ error: stderr || 'dev exited' }); closed.resolve({ code, signal, stopping }); });
  async function stop() { stopping = true; child.kill('SIGTERM'); try { await bounded(closed.promise, 'dev cleanup', 5000); } finally { child.kill('SIGKILL'); } }
  try {
    const event = await bounded(ready.promise, 'dev startup', 25000);
    assert.ok(event.url, JSON.stringify(event));
    return { url: event.url, events, stop, closed };
  } catch (error) { await stop(); throw error; }
}
function request(url, { method = 'GET', pause = false } = {}) {
  const first = deferred(), done = deferred(), chunks = [];
  let status, headers, response, bytes = 0;
  const snapshot = complete => ({ complete, status, headers, body: Buffer.concat(chunks).toString() });
  const req = http.get(url, { method, agent: false }, res => {
    response = res; status = res.statusCode; headers = res.headers;
    res.on('data', chunk => {
      bytes += chunk.length; if (bytes > 1048576 + 1024) { req.destroy(new Error('fixture response limit')); return; }
      chunks.push(chunk); first.resolve(snapshot(false));
      if (pause) { pause = false; res.pause(); setTimeout(() => res.resume(), 40); }
    });
    res.on('end', () => { first.resolve(snapshot(true)); done.resolve(snapshot(true)); });
    res.on('error', () => { first.resolve(snapshot(false)); done.resolve(snapshot(false)); });
    res.on('close', () => { first.resolve(snapshot(false)); done.resolve(snapshot(false)); });
  });
  req.on('error', () => { first.resolve(snapshot(false)); done.resolve(snapshot(false)); });
  req.setTimeout(6000, () => req.destroy(new Error('client deadline')));
  return { first: first.promise, done: done.promise, cancel() { response?.destroy(); req.destroy(); } };
}
async function controlled(target, native, chunk) {
  const evidence = [];
  for (const mode of ['success','disconnect','deadline','finish-deadline']) {
    const first = deferred(), writes = [];
    let release, releaseFinal;
    const sink = new Writable({ highWaterMark: 1,
      write(bytes, _encoding, done) { writes.push(bytes.length); if (writes.length === 1 && mode !== 'finish-deadline') { release = done; first.resolve(); } else done(); },
      final(done) { if (mode === 'finish-deadline') releaseFinal = done; else done(); } });
    sink.setHeader = () => {};
    const abort = new AbortController();
    const duration = mode.includes('deadline') ? 250 : 5000;
    const budget = runtime.createRequestBudget({ maxDurationMs: duration, signal: abort.signal });
    const output = driver.createGeneratedOutput(sink, { generatedOutput: true, maxDurationMs: duration, requestBudget: budget, requestMethod: 'GET' });
    const options = { request: { method:'GET',path:'/bulk' }, outputExecution: output, requestBudget: budget, signal: budget.signal, strict: false };
    const executing = target === 'native' ? executeCanonicalNativeModule(native, options)
      : runtime.executeApplication(async ctx => { await ctx.output.start(); for(let i=0;i<64;i++) await ctx.output.write(chunk); return ctx.output.close(); }, new Request('http://fixture/bulk'), options);
    const observed = executing.then(value => ({ value }), error => ({ error }));
    try {
      if (mode !== 'finish-deadline') {
        await bounded(first.promise, 'controlled first write'); await delay(15);
        assert.equal(writes.length, 1, 'producer advanced past blocked callback/drain');
        if (mode === 'disconnect') abort.abort(new Error('fixture disconnected'));
        if (mode === 'success') release();
      }
      const result = await bounded(observed, 'controlled execution');
      if (mode === 'disconnect' || mode === 'deadline') {
        assert.ok(result.error); assert.equal(sink.destroyed, true);
        release(); await delay(10); assert.equal(writes.length, 1, 'late callback resumed cancelled producer');
      } else {
        if (result.error) throw result.error;
        if (mode === 'finish-deadline') {
          await assert.rejects(output.finish()); assert.equal(sink.destroyed, true);
          releaseFinal(); await delay(10); assert.equal(output.finished, false);
        } else {
          await output.finish(); assert.equal(writes.length, 64);
          assert.equal(output.snapshot().bytes, 1048576);
          if (target === 'native') {
            assert.ok(result.value.memory.bytes <= 64 * 1024 * 1024);
            assert.ok(result.value.guestMemoryBytes <= 4096 * 65536);
            evidence.push({ memory: result.value.memory, guestMemoryBytes: result.value.guestMemoryBytes, wasmSha256: result.value.wasmSha256 });
          }
        }
      }
      evidence.push({ mode, writes: writes.length, phase: output.snapshot().phase });
    } finally { output.dispose(); budget.close(); sink.destroy(); }
  }
  return evidence;
}
async function main() {
  const gates = new Map(); let afterCalls = 0, active;
  const origin = http.createServer((req, res) => {
    if (req.url === '/fail') { res.destroy(); return; }
    if (req.url === '/after') { afterCalls++; res.end('unexpected'); return; }
    const closed = deferred(); res.on('close', () => closed.resolve()); gates.set(req.url, { res, closed });
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  const originUrl = `http://127.0.0.1:${origin.address().port}`;
  const chunk = '😀'.repeat(4096), expectedHash = sha(chunk.repeat(64));
  const route = (name, body) => `app.get('/${name}',async ctx=>{${body}});`;
  const start = "await ctx.output.start({status:201,headers:{'content-type':'application/x-ndjson'}});await ctx.output.write('prefix\\n');";
  const source = "import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});\n" +
    route('health', "return ctx.text('healthy')") +
    ['prefix','disconnect','deadline'].map(name => route(name, start + `const tail=await ctx.fetch('${originUrl}/${name}').text();await ctx.output.write(tail);` + (name === 'prefix' ? '' : `const after=await ctx.fetch('${originUrl}/after').text();`) + 'return ctx.output.close();')).join('\n') +
    route('bulk', `await ctx.output.start();for(let i=0;i<64;i++){await ctx.output.write(${JSON.stringify(chunk)})}return ctx.output.close();`) +
    route('producer', start + `const failed=await ctx.fetch('${originUrl}/fail').text();return ctx.output.close();`) +
    route('missing-close', start + "return ctx.text('replacement')") +
    route('chunk-limit', start + `await ctx.output.write(${JSON.stringify('€'.repeat(5462))});return ctx.output.close();`) +
    route('count-limit', `await ctx.output.start();for(let i=0;i<64;i++){await ctx.output.write('x')}await ctx.output.write('overflow');return ctx.output.close();`) +
    route('bodyless', 'await ctx.output.start({status:204});return ctx.output.close();') +
    route('framing', "await ctx.output.start({headers:{'content-length':'1'}});return ctx.output.close();") +
    "app.head('/head',async ctx=>{await ctx.output.start();return ctx.output.close()});" +
    "app.error(async (error,ctx,next)=>{return ctx.text('error-replacement',{status:599})});export default app;";
  for (const dir of ['src','.pulse','tests']) fs.mkdirSync(dir);
  fs.writeFileSync('src/index.ts', source);
  const config = { pulse: { entry:'src/index.ts',tests:'tests/pulse.harness.ts',defaultProfile:'native',strict:false } };
  for (const target of ['native','javascript']) config[target] = { host:'node',target,outDir:'dist-'+target,node:{generatedOutput:true,maxDurationMs:2000},dev:{networkFetch:true} };
  const writeConfig = () => fs.writeFileSync('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>(${JSON.stringify(config)}));`);
  writeConfig();
  fs.writeFileSync('tests/pulse.harness.ts', 'export default '+JSON.stringify([
    {name:'finite-output',request:{method:'GET',path:'/prefix'},fetches:{[originUrl+'/prefix']:{status:200,text:'tail\n'}},expect:{status:201,text:'prefix\ntail\n'}},
    {name:'ordinary-response',request:{method:'GET',path:'/health'},expect:{status:200,text:'healthy'}}
  ]));
  try {
    for (const target of ['native','javascript']) {
      const record = report.targets[target] = { workflows: [], wire: [] }; save();
      let built;
      for (const cmd of ['doctor','inspect','test','build']) {
        console.log('str03b - '+target+' '+cmd);
        const result = await command([cmd,'--profile',target]);
        if (cmd === 'doctor') assert.equal(result.summary.failed, 0);
        else assert.equal(result.status, cmd === 'inspect' ? 'ok' : cmd === 'build' ? 'built' : 'passed');
        if (cmd === 'test' && target === 'native') record.testExecutions = result.cases.map(entry => entry.executionEvidence);
        if (cmd === 'build') built = result;
        record.workflows.push(cmd);
      }
      let native;
      if (target === 'native') {
        const wasm = fs.readFileSync(built.files.nativeWasm), plan = JSON.parse(fs.readFileSync(built.files.nativePlan)); native = { wasm, plan };
        record.wasmSha256 = sha(wasm); record.wasmBytes = wasm.length;
        assert.equal(record.wasmSha256, built.native.wasm.sha256);
        assert.ok(record.testExecutions.every(e => e.mode === 'native-wasm' && e.automaticFallback === false && e.wasmSha256 === record.wasmSha256));
        assert.ok(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).some(i => i.name === 'output_close'));
      }
      record.controlledWriter = await controlled(target, native, chunk);
      active = await dev(target);
      const incremental = request(active.url+'/prefix');
      const first = await bounded(incremental.first,'prefix'); assert.equal(first.body, 'prefix\n'); assert.equal(first.status, 201);
      const waitGate = async name => { await bounded((async () => { while (!gates.has('/'+name)) await delay(5); })(), 'origin gate'); return gates.get('/'+name); };
      (await waitGate('prefix')).res.end('tail\n');
      const completed = await bounded(incremental.done,'prefix completion'); assert.equal(completed.complete,true); assert.equal(completed.body,'prefix\ntail\n'); gates.delete('/prefix');
      record.wire.push('first-byte-before-producer-completion');
      const bulk = await bounded(request(active.url+'/bulk',{pause:true}).done,'bulk'); assert.equal(bulk.complete,true); assert.equal(Buffer.byteLength(bulk.body),1048576); assert.equal(sha(bulk.body),expectedHash);
      record.bulk = { bytes: 1048576, sha256: expectedHash, pausedClient: true };
      for (const name of ['disconnect','deadline']) {
        const flow = request(active.url+'/'+name); assert.equal((await bounded(flow.first,name+' prefix')).body,'prefix\n');
        const gate = await waitGate(name);
        if (name === 'disconnect') flow.cancel();
        const ended = await bounded(flow.done,name+' completion'); assert.equal(ended.complete,false);
        await bounded(gate.closed.promise,name+' origin cleanup'); gate.res.end('late'); gates.delete('/'+name);
        await delay(20); assert.equal(afterCalls,0); record.wire.push(name+'-cleanup-no-late-effect');
      }
      for (const name of ['producer','missing-close','chunk-limit','count-limit']) {
        const failed = await bounded(request(active.url+'/'+name).done,name);
        assert.equal(failed.complete,false,name); assert.notEqual(failed.status,599); assert.equal(failed.body.includes('replacement'),false);
        if (name !== 'count-limit') assert.equal(failed.body,'prefix\n');
        record.wire.push(name+'-transport-aborted');
        const health = await bounded(request(active.url+'/health').done,'recovery'); assert.equal(health.body,'healthy'); assert.equal(health.complete,true);
      }
      for (const [name,method] of [['bodyless','GET'],['framing','GET'],['head','HEAD']]) {
        const failed = await bounded(request(active.url+'/'+name,{method}).done,name);
        assert.ok(failed.status >= 400,name); assert.equal(failed.complete,true,name);
        record.wire.push(name+'-rejected-before-commit');
      }
      await delay(20);
      if (target === 'native') {
        record.devExecutions = active.events.filter(e => e.event === 'request').map(e => e.executionEvidence);
        assert.ok(record.devExecutions.length >= 6);
        assert.ok(record.devExecutions.every(e => e?.mode === 'native-wasm' && e.wasmSha256 === record.wasmSha256 && e.automaticFallback === false && e.guestMemoryBytes <= 4096*65536));
      }
      await active.stop(); active = undefined;
      delete config[target].node.generatedOutput; writeConfig();
      const disabled = await command(['build','--profile',target],true); assert.match(disabled.text,/PULSE_OUTPUT_UNAVAILABLE|node-generated-output-not-configured/);
      config[target].node.generatedOutput = true; writeConfig(); record.unconfiguredRejected = true; save();
    }
    // Opt-in alone must not mislabel an ordinary canonical-program execution.
    fs.writeFileSync('src/index.ts', "import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.get('/',async ctx=>{return ctx.text('ordinary')});export default app;");
    active = await dev('native');
    assert.equal((await bounded(request(active.url).done,'ordinary opt-in')).body,'ordinary');
    await delay(20);
    const ordinaryEvents = active.events.filter(event => event.event === 'request');
    assert.equal(ordinaryEvents.length,1);
    assert.equal(ordinaryEvents[0].executionEvidence,undefined);
    report.ordinaryOptInDoesNotClaimWasm = true;
    await active.stop(); active = undefined;
    // A separate output-only source avoids unrelated Fastly backend admission.
    fs.writeFileSync('src/index.ts', "import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.get('/',async ctx=>{await ctx.output.start();await ctx.output.write('x');return ctx.output.close()});export default app;");
    report.fastlyRejected = [];
    for (const target of ['native','javascript']) {
      config.fastly = {host:'fastly',target}; writeConfig();
      const rejected = await command(['build','--profile','fastly'],true); assert.match(rejected.text,/PULSE_PROVIDER_CAPABILITY_UNSUPPORTED|response.output|output.start/); report.fastlyRejected.push(target);
    }
    report.status = 'passed';
  } finally { if (active) await active.stop(); origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve)); save(); }
}
main().catch(error => { report.status='failed'; report.error=error.stack; save(); console.error(error); process.exitCode=1; });
