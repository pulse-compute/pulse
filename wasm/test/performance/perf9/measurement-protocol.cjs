'use strict';
const assert = require('node:assert/strict');
const contract = require('./contract.json');
const { hash } = require('../../support/fastly-forwarding-qualification.cjs');
const profiles = Object.freeze({
  standard: { blocks: 30, requests: 16, slowBlocks: 12, slowRequests: 4, warmup: 8 },
  smoke: { blocks: 2, requests: 4, slowBlocks: 2, slowRequests: 4, warmup: 1 }
});
const protocol = Object.freeze({
  version: 'pulse.perf9-measurement-protocol.v1', seed: 90102, profiles,
  payloadBytes: contract.payloadSweep, concurrency: [1, 4], slowPayloadBytes: 1048576,
  chunkBytes: 16384, slowDelayMs: 2, deadlineOriginDelayMs: 1700,
  requestTimeoutMs: 5000, sampleRssIntervalMs: 10, settleMs: 20,
  diagnosticRepeats: 3, bootstrapReplicates: 4000, confidence: 0.95,
  minimumInferenceBlocks: 20, resolutionMaxWidthPercentagePoints: 2,
  connection: 'HTTP/1.1 keep-alive; separate client agent per guest, maxSockets 4; closed-loop fixed-count lanes',
  order: 'seeded shuffled cells; balanced shuffled AB/BA paired blocks; both members always retained',
  latency: 'client request creation through complete body/abort/error; byte validation included; warmup excluded',
  throughput: 'successful completed requests and response bytes divided by block workload wall time; concurrency fixed, no open-loop claim',
  cpu: 'Linux /proc/<viceroy-pid>/stat utime+stime ticks: all Viceroy threads, guest + host + runtime; excludes Node client/origin; includes post-batch settle window; compilation/startup excluded',
  guestCpu: 'unavailable: unchanged guests expose no per-request CPU counter',
  hostOnlyCpu: 'unavailable: process CPU cannot subtract guest execution',
  memory: 'Viceroy VmRSS sampled every 10 ms plus boundary samples; VmHWM is process-lifetime high-water including startup; neither is per-request guest memory',
  buffering: 'observe client readable/upload writable and origin writable queue lengths; Viceroy/OS queues unavailable; no host memory bound claim',
  inference: 'paired-block percentile bootstrap of mean block-p50 difference and ratio of mean block-p50s; local exploratory interval, serial/environment correlation may remain; never pool environments',
  environment: 'local Linux Viceroy only; no deployed Fastly, no Node ABI timing'
});
function rng(seed) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function shuffle(values, random) { const a = [...values]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cells(profile) {
  assert(profiles[profile], 'Unknown measurement profile'); const p = profiles[profile];
  return [...contract.payloadSweep.flatMap(bytes => [1, 4].map(concurrency => ({ id: `echo-${bytes}-c${concurrency}`, mode: 'echo', bytes, concurrency, blocks: p.blocks, requests: p.requests }))),
    ...['slow-origin', 'slow-client'].flatMap(mode => [1, 4].map(concurrency => ({ id: `${mode}-1048576-c${concurrency}`, mode, bytes: 1048576, concurrency, blocks: p.slowBlocks, requests: p.slowRequests })))];
}
function schedule(profile, seed) {
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'Seed must be uint32');
  const random = rng(seed);
  return shuffle(cells(profile), random).map(cell => ({ ...cell,
    orders: shuffle(Array.from({ length: cell.blocks }, (_, i) => i % 2 ? ['rust', 'pulse'] : ['pulse', 'rust']), random) }));
}
function stats(values) {
  assert(values.length && values.every(x => Number.isFinite(x)), 'Finite nonempty sample required');
  const a = [...values].sort((x, y) => x - y), at = p => a[Math.max(0, Math.ceil(p * a.length) - 1)];
  return { count: a.length, min: a[0], p50: at(.5), p95: at(.95), max: a.at(-1), mean: a.reduce((x, y) => x + y, 0) / a.length };
}
function interval(values) { const a = [...values].sort((x, y) => x-y); return [a[Math.floor(.025*a.length)], a[Math.ceil(.975*a.length)-1]]; }
function paired(pairs, { seed, profile, errors = 0 }) {
  const p = pairs.map(x => stats(x.pulse.requests.map(r => r.elapsedMs)).p50);
  const r = pairs.map(x => stats(x.rust.requests.map(r => r.elapsedMs)).p50);
  assert(p.every(x => x > 0) && r.every(x => x > 0));
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const absolute = mean(p)-mean(r), relative = 100*(mean(p)/mean(r)-1);
  const random = rng(seed), abs = [], rel = [];
  for (let b=0;b<protocol.bootstrapReplicates;b++) {
    let ps=0, rs=0; for(let i=0;i<p.length;i++) { const j=Math.floor(random()*p.length); ps+=p[j];rs+=r[j]; }
    abs.push((ps-rs)/p.length); rel.push(100*(ps/rs-1));
  }
  const ms95=interval(abs), pct95=interval(rel);
  const eligible=profile==='standard' && p.length>=protocol.minimumInferenceBlocks && errors===0;
  const resolved=eligible && pct95[1]-pct95[0]<=protocol.resolutionMaxWidthPercentagePoints;
  return { estimand:'mean paired block-p50 (Pulse minus Rust)', blocks:p.length, absoluteMs:absolute, relativePercent:relative,
    absoluteMs95:ms95, relativePercent95:pct95,
    direction:!eligible?'insufficient evidence':ms95[0]>0?'Rust lower latency':ms95[1]<0?'Pulse lower latency':'inconclusive at this resolution',
    oneToThreePercent:!resolved?'inconclusive at this resolution':pct95[0]>=1&&pct95[1]<=3?'interval within 1–3%':pct95[1]<1||pct95[0]>3?'interval outside 1–3%':'inconclusive at this resolution' };
}
function summarize(cell, profile, seed) {
  const summary = {};
  let errors=0;
  for (const name of ['pulse','rust']) {
    const blocks=cell.pairs.map(p=>p[name]), requests=blocks.flatMap(b=>b.requests);
    const failures=requests.filter(r=>r.outcome!=='ok'); errors+=failures.length;
    const successful=requests.filter(r=>r.outcome==='ok');
    summary[name]={ attempts:requests.length, successes:successful.length, errors:failures.length,errorRate:failures.length/requests.length,
      outcomes:Object.fromEntries([...new Set(requests.map(r=>r.outcome))].sort().map(k=>[k,requests.filter(r=>r.outcome===k).length])),
      allCompletionMs:stats(requests.map(r=>r.elapsedMs)),
      successfulLatencyMs:successful.length?stats(successful.map(r=>r.elapsedMs)):null,
      timeToHeadersMs:requests.some(r=>r.headersMs!==null)?stats(requests.filter(r=>r.headersMs!==null).map(r=>r.headersMs)):null,
      requestsPerSecond:stats(blocks.map(b=>1000*b.requests.filter(r=>r.outcome==='ok').length/b.workloadMs)),
      responseBytesPerSecond:stats(blocks.map(b=>1000*b.requests.filter(r=>r.outcome==='ok').reduce((s,r)=>s+r.receivedBytes,0)/b.workloadMs)),
      processCpuMsPerAttempt:stats(blocks.map(b=>(b.resources.userMs+b.resources.systemMs)/b.requests.length)),
      processCpuUserMs:stats(blocks.map(b=>b.resources.userMs)),processCpuSystemMs:stats(blocks.map(b=>b.resources.systemMs)),
      sampledRssBytes:stats(blocks.map(b=>b.resources.sampledPeakRssBytes)),lifetimeHwmBytes:stats(blocks.map(b=>b.resources.after.hwmBytes)),
      clientReadableBytesMax:Math.max(...requests.map(r=>r.readableBytesMax)),clientUploadWritableBytesMax:Math.max(...requests.map(r=>r.uploadWritableBytesMax)),
      originWritableBytesMax:Math.max(...blocks.map(b=>b.origin.writableBytesMax)),originDrainWaits:blocks.reduce((s,b)=>s+b.origin.drainWaits,0) };
  }
  return { ...summary, comparison:paired(cell.pairs,{seed,profile,errors}) };
}
module.exports={protocol,profiles,rng,shuffle,cells,schedule,stats,paired,summarize,hash};
