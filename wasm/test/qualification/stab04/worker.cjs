'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), http = require('node:http'), { fork } = require('node:child_process');
const { createRequire } = require('node:module'), { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { write, asset } = require('./fixture.cjs');
const { distribution, trend, validate } = require('./metrics.cjs');
const root = fs.realpathSync(process.cwd()), output = path.resolve(process.argv[2]);
const installed = createRequire(path.join(root, 'package.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const secrets = { INGRESS_KEY: crypto.randomBytes(32).toString('hex'), WORKER_KEY: crypto.randomBytes(32).toString('hex') };
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000);
const signed = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ iss: 'composed-fixture', aud: 'consumer', sub: 'reader', iat: now - 60, exp: now + 3600 })).toString('base64url');
const bearer = 'Bearer ' + signed + '.' + crypto.sign('sha256', Buffer.from(signed), keys.privateKey).toString('base64url');
const phaseMs = 10000, cycles = 3, cadenceMs = 200, maxPending = 256;
let child, fatal, stopped = false, origin, agent, sequence = 0, currentPhase = 'warmup', mode = 'normal';
const rpcs = new Map(), clientRows = [], serverRows = [], pending = new Map(), foreground = new Set();
const counts = { offered: 0, dropped: 0, skippedAssets: 0, accepted: 0, projected: 0, reconciled: 0, workerFailures: 0, peakBacklog: 0 };
const progress = [], completionMs = [], quiet = [], phases = [];
let recoveryWatch;
function check() { if (fatal) throw fatal; }
function rpc(op, fields = {}) {
  check(); const token = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { rpcs.delete(token); reject(Error('Host control timeout: ' + op)); }, 10000);
    rpcs.set(token, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    child.send({ op, token, ...fields });
  });
}
async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
  check(); const id = String(++sequence), phase = currentPhase, url = origin + route, issued = String(Date.now());
  const worker = route === '/worker', scope = worker ? 'worker' : 'ingress';
  const proof = crypto.createHmac('sha256', secrets[worker ? 'WORKER_KEY' : 'INGRESS_KEY']).update(scope + '\n' + method + '\n' + url + '\n' + issued).digest('hex');
  const bytes = body === undefined ? undefined : JSON.stringify(body), at = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, agent, timeout: 3000, headers: { 'x-sample-id': id, 'x-proof-issued': issued, 'x-proof': proof, authorization: bearer,
      ...(bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes) }) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; if (text.length > 4096) req.destroy(Error('oversized response')); });
      res.on('error', reject); res.on('end', () => {
        clientRows.push({ id, phase, route, method, status: res.statusCode, ms: performance.now() - at });
        let value; try { value = JSON.parse(text); } catch { value = text; }
        resolve({ status: res.statusCode, body: value });
      });
    });
    req.on('timeout', () => req.destroy(Error('client timeout'))); req.on('error', reject); req.end(bytes);
  });
}
async function submit(job) {
  job.submissions++;
  try {
    for (let attempt = 0; attempt < 5 && !job.accepted; attempt++) {
      const result = await request('/api/command', { id: job.id, value: job.value });
      if (result.status === 202 || result.status === 200) {
        assert(['accepted', 'replayed'].includes(result.body.status));
        if (!job.accepted) { job.accepted = true; counts.accepted++; if (job.uncertain) counts.reconciled++; }
      } else { assert.equal(result.status, 503); if (result.body.status === 'unknown') job.uncertain = true; await delay(25); }
    }
  } finally { job.submissions--; }
}
function launch(fn) {
  if (foreground.size >= 8) { counts.skippedAssets++; return; }
  const task = fn().catch(error => { fatal ||= error; }).finally(() => foreground.delete(task)); foreground.add(task);
}
function offer(id, value) {
  counts.offered++;
  if (!pending.has(id) && pending.size >= maxPending) { counts.dropped++; return; }
  if (foreground.size >= 8) { counts.dropped++; return; }
  let job = pending.get(id);
  if (!job) { job = { id, value, at: performance.now(), accepted: false, busy: false, submissions: 0 }; pending.set(id, job); }
  launch(() => submit(job)); counts.peakBacklog = Math.max(counts.peakBacklog, pending.size);
}
async function background() {
  while (!stopped && !fatal) {
    const job = [...pending.values()].find(j => !j.busy && !j.submissions);
    if (!job) { await delay(10); continue; }
    job.busy = true;
    try {
      if (!job.accepted) await submit(job);
      if (!job.accepted) continue;
      const result = await request('/worker', { id: job.id });
      if (result.status === 503) { counts.workerFailures++; await delay(100); continue; }
      assert([200, 202].includes(result.status), JSON.stringify(result));
      assert(['projected', 'replayed'].includes(result.body.status));
      const read = await request('/api/read', { id: job.id });
      if (read.status === 503) { await delay(25); continue; }
      assert.equal(read.status, 200); assert.deepEqual(read.body, { value: job.value, prefix: 'qualified' });
      const removed = await request('/api/command', { id: job.id }, 'DELETE');
      if (removed.status === 503) { await delay(25); continue; }
      assert.equal(removed.status, 200); assert.equal(removed.body, 'removed');
      pending.delete(job.id); counts.projected++; completionMs.push(performance.now() - job.at);
      if (recoveryWatch?.remaining.delete(job.id) && recoveryWatch.remaining.size === 0) recoveryWatch.elapsedMs = performance.now() - recoveryWatch.at;
    } catch (error) { fatal ||= error; }
    finally { job.busy = false; }
  }
}
async function drain() {
  await Promise.all(foreground); const deadline = performance.now() + 20000;
  while (pending.size && performance.now() < deadline) { check(); await delay(20); }
  check(); assert.equal(pending.size, 0, 'accepted work did not recover within 20 seconds');
}
async function quiesce(label) {
  await drain(); agent.destroy(); await delay(100);
  const result = await rpc('snapshot'); quiet.push({ label, ...result });
  agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
}
async function runPhase(name, duration, cycle, record = true) {
  mode = name === 'contention' || name === 'outage' ? name : 'normal'; currentPhase = `${cycle}/${name}`;
  await rpc('phase', { mode, phase: currentPhase });
  const before = { ...counts }, start = performance.now(), backlogStart = pending.size;
  recoveryWatch = name === 'recovery' ? { at: start, remaining: new Set(pending.keys()), elapsedMs: pending.size ? null : 0 } : null;
  let tick = 0;
  while (performance.now() - start < duration) {
    check(); const due = start + tick * cadenceMs, lagMs = Math.max(0, performance.now() - due);
    for (let slot = 0; slot < 4; slot++) {
      const id = `${cycle}-${name}-${tick}-${name === 'contention' ? 0 : slot}`;
      offer(id, `value-${id}`);
    }
    for (const method of ['GET', 'HEAD']) launch(async () => {
      const r = await request('/static/index.html', undefined, method);
      assert([200, 503].includes(r.status)); if (r.status === 200) assert.equal(r.body, method === 'HEAD' ? '' : asset);
    });
    progress.push({ phase: currentPhase, atMs: performance.now(), lagMs, backlog: pending.size, accepted: counts.accepted, projected: counts.projected, foreground: foreground.size });
    tick++; const wait = start + tick * cadenceMs - performance.now(); if (wait > 0) await delay(wait);
  }
  if (record) phases.push({ cycle, name, id: currentPhase, elapsedMs: performance.now() - start, offered: counts.offered - before.offered,
    dropped: counts.dropped - before.dropped, accepted: counts.accepted - before.accepted, projected: counts.projected - before.projected,
    workerFailures: counts.workerFailures - before.workerFailures, backlogStart, backlogEnd: pending.size,
    recoveredBacklogMs: recoveryWatch?.elapsedMs ?? null });
}
function prepare(jwk) {
  write(root, jwk);
  let source = fs.readFileSync(path.join(root, 'app.ts'), 'utf8');
  source = source.replace('app.error(', `app.post('/api/read',async ctx=>{const input=await ctx.req.json<{id:string}>('worker.Input');const result=await ctx.kv<{value:string;prefix:string}>('views').getVersioned(input.id);if(result.status!=='found')return ctx.text('pending',{status:404});return ctx.json({value:result.value.value,prefix:result.value.prefix});});
app.delete('/api/command',async ctx=>{const input=await ctx.req.json<{id:string}>('worker.Input');const result=await ctx.parallel({command:ctx.kv('commands').delete(input.id),view:ctx.kv('views').delete(input.id)});if(result.command.status!=='deleted'||result.view.status!=='deleted')return ctx.text('cleanup failed',{status:503});return ctx.text('removed');});
app.error(`);
  fs.writeFileSync(path.join(root, 'app.ts'), source);
  const execution = installed('@pulse-compute/cli/project-execution');
  const { resolveProject } = installed('@pulse-compute/cli/project-config');
  const project = resolveProject({ cwd: root, profile: 'node-javascript' });
  const result = execution.buildProject(project); assert.equal(result.status, 'built'); return result;
}
async function main() {
  const build = prepare({ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture' });
  const buildFiles = [];
  function visitBuild(dir, prefix='') { for(const e of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,e.name), name=prefix+e.name; if(e.isDirectory())visitBuild(file,name+'/');else buildFiles.push({file:name,sha256:hash(fs.readFileSync(file))}); } }
  visitBuild(build.outDir);
  const started = performance.now();
  child = fork(path.join(root, 'server.cjs'), [], { cwd: root, execArgv: ['--expose-gc'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = ''; child.stdout.on('data', b => { log = (log + b).slice(-65536); }); child.stderr.on('data', b => { log = (log + b).slice(-65536); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { if (code !== 0 || signal) fatal ||= Error(`host exited ${code}/${signal}: ${log}`); resolve({ code, signal }); }));
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message.type === 'ready') resolve(message.port);
      if (message.type === 'request') serverRows.push(message);
      if (message.type === 'reply') { const pending = rpcs.get(message.token); rpcs.delete(message.token); pending?.resolve(message.result); }
      if (message.type === 'error') { fatal ||= Error(message.error); reject(fatal); }
    });
    child.once('exit', () => reject(fatal || Error('host exited before ready')));
  });
  const tasks = [];
  try {
    child.send({ op: 'start', buildDir: build.outDir, asset, secrets }); origin = `http://127.0.0.1:${await ready}`;
    agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
    tasks.push(background(), background());
    await runPhase('normal', 3000, 'warmup', false); await quiesce('baseline');
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (const name of ['normal', 'contention', 'outage', 'recovery']) await runPhase(name, phaseMs, cycle);
      await quiesce(`cycle-${cycle}`);
      console.log(JSON.stringify({ cycle, accepted: counts.accepted, projected: counts.projected, backlog: pending.size }));
    }
    await runPhase('normal', 5000, 'cooldown', false); await quiesce('cooldown');
    await rpc('profile-start'); await runPhase('normal', 5000, 'attribution', false); await drain();
    const cpuProfile = await rpc('profile-stop');
    stopped = true; await Promise.all(tasks); agent.destroy(); await delay(100);
    const cleanup = await rpc('close'); const exit = await exited; assert.equal(exit.code, 0); check();
    const report = { status: 'passed', target: 'node-javascript', cycles, phaseMs, cadenceMs, elapsedMs: performance.now() - started,
      limits: { foreground: 8, workers: 2, serverAdmission: 8, pending: maxPending, requestBudgetMs: 1000 },
      phases, jobs: { ...counts, remaining: pending.size, completionMs: distribution(completionMs) },
      quiet, memoryTrend: trend(quiet), host: cleanup.counters, cleanup, cpuProfile, nativeQualified: false, hostedQualified: false,
      measurement: { transport: 'loopback HTTP through installed Node JavaScript adapter; fixture admission and KV authority',
        memory: 'isolated server process; 100ms peak sampling; post-GC equal-state quiet points; excludes compiler/client; no leak-free guarantee',
        attribution: 'effect interval union avoids parallel double counting; residual includes application/runtime/HTTP/GC; CPU leaf sampling is a separate window' } };
    for (const phase of phases) {
      const client = clientRows.filter(r => r.phase === phase.id), host = serverRows.filter(r => r.phase === phase.id);
      phase.latency = Object.fromEntries(['/api/command', '/worker', '/static/index.html'].map(route => [route, Object.fromEntries([['all',()=>true],['success',r=>r.status<400],['failure',r=>r.status>=400]].map(([name,filter])=>[name,distribution(client.filter(r=>r.route===route&&r.method!=='DELETE'&&filter(r)).map(r=>r.ms))]))]));
      phase.statuses = {}; for (const r of client) phase.statuses[r.status] = (phase.statuses[r.status] || 0) + 1;
      phase.serverMs = distribution(host.map(r => r.totalMs)); phase.effectUnionMs = distribution(host.map(r => r.effectUnionMs)); phase.residualMs = distribution(host.map(r => r.residualMs));
      phase.injectedWaitMs = distribution(host.map(r => r.injectedMs));
    }
    validate(report);
    fs.writeFileSync(path.join(output, 'requests.json'), JSON.stringify({ client: clientRows, server: serverRows, progress }));
    fs.writeFileSync(path.join(output, 'campaign.json'), JSON.stringify(report, null, 2) + '\n');
    for(const item of buildFiles)assert.equal(hash(fs.readFileSync(path.join(build.outDir,item.file))),item.sha256,'build mutated during execution');
    fs.cpSync(build.outDir,path.join(output,'build'),{recursive:true});
    const artifacts = ['requests.json', 'campaign.json'].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(output, file))) }));
    artifacts.push(...buildFiles.map(item=>({...item,file:'build/'+item.file})));
    for (const file of ['app.ts', 'schemas.ts', '.pulse/config.ts']) { const name = path.basename(file); fs.copyFileSync(path.join(root, file), path.join(output, name)); artifacts.push({ file: name, sha256: hash(fs.readFileSync(path.join(output, name))) }); }
    const bytes = JSON.stringify({ report, clientRows, serverRows }); for (const secret of [...Object.values(secrets), bearer, keys.privateKey.export({ format: 'jwk' }).d]) assert(!bytes.includes(secret));
    fs.writeFileSync(path.join(output, 'worker.json'), JSON.stringify({ ...report, artifacts }, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', jobs: counts.projected, requests: clientRows.length, nativeQualified: false, hostedQualified: false }));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failed-campaign.json'), JSON.stringify({ status: 'failed', error: error.stack, counts, phases, quiet, clientRows, serverRows, log }, null, 2)); throw error;
  } finally { stopped = true; agent?.destroy(); if (child?.connected) child.kill('SIGKILL'); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
