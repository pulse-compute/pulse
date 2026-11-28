'use strict';
// Isolated measured process: no compiler or load-generator objects are retained.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const http = require('node:http'), { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createRequire } = require('node:module'), { union } = require('./metrics.cjs');
const installed = createRequire(path.join(process.cwd(), 'package.json'));
const { createNodeJavascriptHandler } = installed('@pulse-compute/provider-node/javascript/node-adapter');
const { loadBuild } = installed(path.join(path.dirname(installed.resolve('@pulse-compute/provider-node/server')), 'build.js'));
const { createNodeKvReference } = installed(path.join(path.dirname(installed.resolve('@pulse-compute/provider-node/runtime/canonical-api-runtime')), 'conditional-kv.js'));
const context = new AsyncLocalStorage(), sockets = new Set(), frames = new Set();
const counters = { commandCommits: 0, projectionCommits: 0, lostAcknowledgements: 0, outageRejections: 0, rejectedAdmission: 0, peakActive: 0 };
let mode = 'normal', phase = 'warmup', active = 0, waits = 0, server, reference, sampler, profiler;
let peak = {}, sampleCount = 0;
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
const send = value => process.send?.(value);
function sample() { const memory = process.memoryUsage(); for (const [key, value] of Object.entries(memory)) peak[key] = Math.max(peak[key] || 0, value); sampleCount++; }
function snapshot() {
  const resources = {}; for (const name of process.getActiveResourcesInfo()) resources[name] = (resources[name] || 0) + 1;
  return { atMs: performance.now(), memory: process.memoryUsage(), resources, activeRequests: active, sockets: sockets.size,
    pendingEffects: [...frames].reduce((s, f) => s + f.pending.size, 0), injectedWaits: waits,
    records: [...reference.legacyStores()].filter(([name]) => name !== 'static').reduce((s, [, rows]) => s + rows.size, 0), counters: { ...counters } };
}
function observation(event) {
  const f = context.getStore(); if (!f || !event.effect) return;
  const id = event.effect.id;
  if (event.type === 'effect-dispatched') f.pending.set(id, { at: performance.now(), kind: event.effect.kind });
  if (event.type === 'effect-settled') {
    const start = f.pending.get(id); assert(start, 'settlement without dispatch'); f.pending.delete(id);
    const end = performance.now(); f.intervals.push([start.at, end]);
    f.effectMs[start.kind] = (f.effectMs[start.kind] || 0) + end - start.at;
  }
}
async function start(input) {
  const build = loadBuild({ buildDir: input.buildDir, target: 'javascript' });
  reference = createNodeKvReference({ kv: { static: { '/index.html': input.asset } }, kvHooks: {
    async prepare(effect, execution) {
      const f = context.getStore();
      if (f.mode === 'outage' && effect.namespace === 'views' && effect.kind === 'kv.insertIfAbsent') {
        counters.outageRejections++; throw Error('fixture projection store unavailable');
      }
      if (f.mode === 'contention') {
        const at = performance.now(); waits++;
        try { await delay(10, undefined, { signal: execution.signal }); }
        finally { waits--; f.injectedMs += performance.now() - at; }
      }
    },
    afterCommit(effect) {
      if (effect.kind !== 'kv.insertIfAbsent') return;
      if (effect.namespace === 'views') counters.projectionCommits++;
      if (effect.namespace === 'commands') {
        counters.commandCommits++;
        if (context.getStore().mode === 'outage' && counters.commandCommits % 8 === 0) {
          counters.lostAcknowledgements++; throw Error('fixture acknowledgement lost after commit');
        }
      }
    }
  } });
  const handler = createNodeJavascriptHandler(build.application, { schemaCodecs: build.schemaCodecs, packageArtifacts: build.packageArtifacts,
    secrets: input.secrets, config: { VIEW_PREFIX: 'qualified' }, kvReference: reference, strict: false,
    maxDurationMs: 1000, maxEffects: 128, onEffectObservation: observation });
  server = http.createServer((req, res) => {
    if (active >= 8) { counters.rejectedAdmission++; res.writeHead(503, { connection: 'close' }); res.end('fixture admission limit'); return; }
    const frame = { phase, mode, pending: new Map(), intervals: [], effectMs: {}, injectedMs: 0 };
    const at = performance.now(); active++; frames.add(frame); counters.peakActive = Math.max(counters.peakActive, active);
    context.run(frame, async () => {
      try { await handler(req, res); }
      catch (error) { send({ type: 'error', error: error.stack }); if (!res.headersSent) res.writeHead(500); res.end(); }
      finally {
        const totalMs = performance.now() - at, effectUnionMs = union(frame.intervals);
        if (frame.pending.size) send({ type: 'error', error: 'unsettled effects after request' });
        send({ type: 'request', id: req.headers['x-sample-id'], phase: frame.phase, route: req.url, status: res.statusCode,
          totalMs, effectUnionMs, residualMs: Math.max(0, totalMs - effectUnionMs), effectMs: frame.effectMs, injectedMs: frame.injectedMs });
        frames.delete(frame); active--;
      }
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  sampler = setInterval(sample, 100); sample();
  send({ type: 'ready', port: server.address().port });
}
async function profileStart() {
  const { Session } = require('node:inspector'); profiler = new Session(); profiler.connect();
  const post = method => new Promise((resolve, reject) => profiler.post(method, (error, value) => error ? reject(error) : resolve(value)));
  await post('Profiler.enable'); await post('Profiler.start');
}
async function profileStop() {
  const { profile } = await new Promise((resolve, reject) => profiler.post('Profiler.stop', (error, value) => error ? reject(error) : resolve(value)));
  profiler.disconnect(); profiler = null;
  const nodes = new Map(profile.nodes.map(n => [n.id, n.callFrame])), categories = {};
  for (let i = 0; i < profile.samples.length; i++) {
    const f = nodes.get(profile.samples[i]), url = f.url || '';
    const category = f.functionName === '(idle)' ? 'idle' : f.functionName === '(garbage collector)' ? 'gc'
      : url.includes('/out/') ? 'application-build' : url.includes('/@pulse-compute/runtime/') ? 'runtime'
      : url.includes('/@pulse-compute/provider-node/') ? 'provider' : url.includes('/@pulse-compute/') ? 'other-pulse-package'
      : url.endsWith('/server.cjs') ? 'measurement-host' : 'platform-or-unattributed';
    const c = categories[category] ||= { samples: 0, sampledUs: 0 }; c.samples++; c.sampledUs += profile.timeDeltas[i];
  }
  return { samples: profile.samples.length, categories, method: 'separate post-campaign Inspector leaf-frame sampling; not exclusive wall-time accounting' };
}
process.on('message', async message => {
  try {
    if (message.op === 'start') return await start(message);
    let result;
    if (message.op === 'phase') { mode = message.mode; phase = message.phase; result = snapshot(); }
    if (message.op === 'snapshot') {
      assert.equal(active, 0); await new Promise(resolve => setImmediate(resolve)); global.gc();
      await new Promise(resolve => setImmediate(resolve)); global.gc(); result = snapshot();
    }
    if (message.op === 'profile-start') { await profileStart(); result = {}; }
    if (message.op === 'profile-stop') result = await profileStop();
    if (message.op === 'close') {
      clearInterval(sampler); await new Promise(resolve => server.close(resolve)); loop.disable();
      await new Promise(resolve => setImmediate(resolve)); result = { ...snapshot(), peak, sampleCount,
        eventLoopDelayMs: { p50: loop.percentile(50) / 1e6, p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 }, cpu: process.cpuUsage() };
    }
    send({ type: 'reply', token: message.token, result });
    if (message.op === 'close') process.disconnect();
  } catch (error) { send({ type: 'error', error: error.stack }); process.exitCode = 1; }
});
