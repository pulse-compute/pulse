#!/usr/bin/env node
'use strict';
// Opt-in evidence: serial build and request processes, never product hooks.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const o04 = require('./o04-copy-chain.cjs');
const p02 = require('./p02-memory-trace.cjs');
const mem = require('./mem01-schema-materialization.cjs');
const host = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const previous = require('./o05-evidence.json');
const { policy } = require('../../../../packages/provider-fastly/src/build/native-value-budget');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const BUILD_PAIRS = 3, MIN_PAIRS = 5, MAX_PAIRS = 10, PAGES = 64;
const provenance = ['response', 'status', 'traceSha256', 'outboundRequests', 'chargeBytes', 'chargeValues'];

function fixtureOptions(count) {
  return { clockUnixSeconds: 1790294400,
    request: { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
      headers: [['x-start', count ? 'p1' : '']], body: '' },
    secrets: p02.secrets, secretStore: 'app_secrets',
    fixtures: Object.fromEntries(Object.entries(p02.pageBodies(count)).map(([url, body]) => ['GET ' + url,
      { status: 200, headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]], body }])) };
}
function resultFacts(result) {
  return { response: result.response.body, status: result.response.status,
    traceSha256: sha(JSON.stringify(result.trace)), outboundRequests: result.outboundRequests.length,
    chargeBytes: Number(result.instance.exports.pulse_fastly_memory_bytes()),
    chargeValues: Number(result.instance.exports.pulse_fastly_memory_values()),
    capacityBytes: result.instance.exports.memory.buffer.byteLength };
}
function rss() {
  return { currentBytes: process.memoryUsage().rss, lifetimePeakBytes: process.resourceUsage().maxRSS * 1024 };
}
function build(dir, name, project) {
  const base = o04.loadBaseline();
  const compiler = name === 'baseline' ? base.compiler : platform;
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
  const { resolveProject } = require('../../../packages/cli/src/project-config');
  const options = { cwd: project, canonicalBuild: true,
    bindings: resolveProject({ cwd: project, profile: 'fastly' }).providerConfig.bindings };
  const artifact = compiler.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  const target = path.join(dir, name); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'production.wasm'), artifact.wasm);
  const staged = mem.diagnosticCompile(o04.instrument(artifact.source), 'staged', target,
    { maximumMemoryPages: policy.maximumMemoryPages });
  fs.writeFileSync(path.join(target, 'staged.wasm'), staged);
  return { name, sourceSha256: sha(artifact.source), wasmSha256: sha(artifact.wasm),
    stagedSha256: sha(staged), wasmBytes: artifact.wasm.length,
    assemblyScript: artifact.manifest.assemblyScript, jsonAs: artifact.manifest.jsonAs,
    baselineOwnerSha256: base.sourceSha256 };
}
function sample(dir, count) {
  const wasm = fs.readFileSync(path.join(dir, 'production.wasm'));
  const options = fixtureOptions(count);
  const before = rss(), start = process.hrtime.bigint();
  const result = host.executeFastlyNativePlatformCapabilities(wasm, options);
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6, after = rss();
  const facts = resultFacts(result);
  assert.equal(facts.response, `${count}:${count - 1}`); assert.equal(facts.status, 200);
  assert.equal(facts.outboundRequests, count);
  const suspended = result.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async').length;
  const resumed = result.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'pending_req_wait').length;
  assert.equal(suspended, count); assert.equal(resumed, count);
  return { ...facts, durationMs, rssBeforeBytes: before.currentBytes, rssAfterBytes: after.currentBytes,
    processPeakRssBytes: after.lifetimePeakBytes, pendingSends: suspended, pendingWaits: resumed };
}
function control(dir, kind) {
  const wasm = fs.readFileSync(path.join(dir, 'production.wasm'));
  const options = fixtureOptions(2);
  const first = 'GET https://objects.example.invalid/pages/p1';
  if (kind === 'malformed') {
    const body = '{"index":0,"next":"p2","payload":"unterminated';
    options.fixtures[first] = { ...options.fixtures[first], body,
      headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]] };
  } else if (kind === 'transport') options.fixtures[first].transportStatus = 1;
  else throw new Error('Unknown control ' + kind);
  try {
    const result = host.executeFastlyNativePlatformCapabilities(wasm, options);
    const facts = resultFacts(result);
    assert.ok(facts.status >= 400, kind + ' must reject');
    assert.equal(facts.outboundRequests, 1, kind + ' must not fetch the second page');
    return { kind, ...facts };
  } catch (error) {
    if (!error.code?.startsWith('PULSE_FASTLY_')) throw error;
    const trace = error.detail?.trace || [];
    assert.equal(trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async').length, 1);
    return { kind, error: error.code, lastError: error.detail?.lastError,
      errorStage: error.detail?.errorStage, errorEffect: error.detail?.errorEffect,
      traceSha256: sha(JSON.stringify(trace)) };
  }
}
function child(mode, args) {
  if (mode === 'build') return build(...args);
  if (mode === 'staged') return o04.runCase(args[0], 'staged', PAGES);
  if (mode === 'sample') return sample(args[0], PAGES);
  if (mode === 'control') return control(...args);
  throw new Error('Unknown worker mode ' + mode);
}
function worker(mode, ...args) {
  const processResult = spawnSync(process.execPath, [__filename, '--worker', mode, ...args],
    { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(processResult.status, 0, `${mode}/${args.join('/')}: ${processResult.error?.message || processResult.stderr}`);
  return JSON.parse(processResult.stdout);
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}
function timing(pairs) {
  const base = pairs.map(p => p.baseline.durationMs), candidate = pairs.map(p => p.candidate.durationMs);
  const ratios = pairs.map(p => p.candidate.durationMs / p.baseline.durationMs);
  // Fixed-seed paired bootstrap; pairing limits slow drift across alternating processes.
  let state = 0x06a11c06;
  const boot = Array.from({ length: 4000 }, () => {
    const drawn = Array.from({ length: ratios.length }, () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return ratios[(state >>> 0) % ratios.length];
    });
    return median(drawn);
  });
  const baselineMedianMs = median(base), candidateMedianMs = median(candidate);
  const ratio = candidateMedianMs / baselineMedianMs;
  const upper = quantile(boot, .975), lower = quantile(boot, .025);
  return { pairs: pairs.length, baselineMedianMs, candidateMedianMs, ratio,
    pairedRatioMedian: median(ratios), pairedRatioBootstrap95: [lower, upper],
    baselineMadMs: median(base.map(x => Math.abs(x - baselineMedianMs))),
    candidateMadMs: median(candidate.map(x => Math.abs(x - candidateMedianMs))),
    decision: ratio <= 1.05 && upper <= 1.05 ? 'pass' : ratio > 1.05 && lower > 1.05 ? 'fail' : 'inconclusive' };
}
function same(a, b) { for (const key of provenance) assert.deepEqual(a[key], b[key], key); }
function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o06-'));
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/o06'); fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, 'measurements.json');
  const base = o04.loadBaseline();
  assert.equal(previous.baselineRevision, base.revision, 'O-04 historical baseline');
  const hashes = Object.fromEntries([
    'packages/provider-fastly/src/build/native-platform-capabilities.js', 'pnpm-lock.yaml',
    'wasm/test/runtime/compiler-efficiency/o06-memory-qualification.cjs',
    'wasm/test/runtime/compiler-efficiency/o04-copy-chain.cjs',
    'wasm/test/runtime/compiler-efficiency/p02-memory-trace.cjs',
    'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
    ...['src/index.ts','src/types.ts','src/schemas.ts','.pulse/config.ts']
      .map(p => `wasm/test/fixtures/projects/compiler-efficiency-memory/${p}`)
  ].map(p => [p, sha(fs.readFileSync(path.join(root, p)))]));
  assert.equal(hashes['pnpm-lock.yaml'], previous.sourceHashes['pnpm-lock.yaml']);
  assert.equal(hashes['packages/provider-fastly/src/build/native-platform-capabilities.js'],
    previous.sourceHashes['packages/provider-fastly/src/build/native-platform-capabilities.js']);
  const report = { schemaVersion: 'pulse.memory-qualification-o06.v1', status: 'running',
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--short']),
    baselineRevision: base.revision, sourceHashes: hashes,
    protocol: { buildPairs: BUILD_PAIRS, pages: PAGES, initialAlternatingProcessPairsPerBuild: MIN_PAIRS,
      maximumAlternatingProcessPairsPerBuild: MAX_PAIRS, primaryReductionMinimum: .10,
      maximumMedianRuntimeRatio: 1.05, bootstrapResamples: 4000,
      runtimeTiming: 'hrtime around injected Fastly ABI execution, including Wasm instantiation and host callbacks; excludes process startup and fixture preparation',
      rss: 'fresh host process current RSS before/after invocation, plus Linux lifetime high-water from process.resourceUsage; includes module loading',
      peak: 'rtrace TLSF outstanding block peak in a staged diagnostic module, not guest capacity or RSS' },
    builds: [], controls: [], samples: [], qualification: null,
    limitations: ['Injected Fastly ABI, not Viceroy or deployed performance.',
      'RSS includes host/module setup and V8 collection noise. Fresh-process timings include host callbacks.',
      'Guest peak/retained figures are instrumented allocator blocks, not operating-system RSS.',
      'Fixed 64-page workload; no broad workload or generic speedup claim.'] };
  write(file, report);
  try {
    const project = path.join(dir, 'project'); fs.mkdirSync(project); p02.prepareFixture(project);
    p02.compileWorker('node', project, dir);
    const expected = Object.fromEntries(previous.variants.map(v => [v.name, v]));
    for (let index = 0; index < BUILD_PAIRS; index++) {
      const pair = { index, modes: {} }; report.builds.push(pair);
      for (const name of ['baseline', 'candidate']) {
        const target = path.join(dir, `build-${index}`); fs.mkdirSync(target, { recursive: true });
        fs.copyFileSync(path.join(dir, 'plan.json'), path.join(target, 'plan.json'));
        const built = worker('build', target, name, project);
        assert.equal(built.baselineOwnerSha256, previous.baselineOwnerSha256);
        for (const key of ['sourceSha256','wasmSha256','wasmBytes']) assert.deepEqual(built[key], expected[name][key], `${index}/${name}/${key}`);
        const measured = worker('staged', path.join(target, name));
        same(measured, expected[name].cases.find(c => c.pages === PAGES).production);
        assert.equal(measured.decode.calls, PAGES);
        const prior = expected[name].cases.find(c => c.pages === PAGES);
        assert.deepEqual(measured.decode, prior.decode);
        assert.equal(measured.terminal.allocatedBytes, prior.terminal.allocatedBytes);
        assert.equal(measured.terminal.peakOutstandingBytes, prior.terminal.peakOutstandingBytes);
        assert.equal(measured.postCollect.outstandingBytes, prior.postCollect.outstandingBytes);
        pair.modes[name] = { build: built, guest: measured }; write(file, report);
      }
      const a = pair.modes.baseline.guest, b = pair.modes.candidate.guest;
      same(a,b);
      pair.primaryReduction = 1 - b.decode.allocatedBytes / a.decode.allocatedBytes;
      assert.ok(pair.primaryReduction >= .10, 'at least 10% less decode allocation');
      assert.equal(a.postCollect.outstandingBytes, b.postCollect.outstandingBytes);
      assert.equal(b.copies.filter(x => x.kind === 'parser-string').length, 0);
      const target = path.join(dir, `build-${index}`);
      for (const kind of ['malformed','transport']) {
        const first = worker('control', path.join(target, 'baseline'), kind);
        const second = worker('control', path.join(target, 'candidate'), kind);
        assert.deepEqual(second, first, `${index}/${kind} failure/trace parity`);
        report.controls.push({ build: index, ...second }); write(file, report);
      }
      console.log(JSON.stringify({ build: index, primaryReduction: pair.primaryReduction, status: 'verified' }));
    }
    for (let sample = 0; sample < MAX_PAIRS; sample++) {
      if (sample === MIN_PAIRS) {
        report.qualification = timing(report.samples);
        if (report.qualification.decision !== 'inconclusive') break;
        console.log(JSON.stringify({ pairs: report.samples.length, decision: 'inconclusive', extending: true }));
      }
      for (let build = 0; build < BUILD_PAIRS; build++) {
        const order = build % 2 ? ['candidate','baseline'] : ['baseline','candidate'];
        const row = { build, sample, order };
        for (const name of order) {
          const target = path.join(dir, `build-${build}`, name);
          const result = worker('sample', target);
          same(result, report.builds[build].modes[name].guest);
          assert.equal(result.capacityBytes, report.builds[build].modes[name].guest.capacityBytes);
          row[name] = result;
        }
        report.samples.push(row); write(file, report);
      }
    }
    report.qualification = timing(report.samples);
    report.qualification.primaryReduction = median(report.builds.map(x => x.primaryReduction));
    report.qualification.hostRss = Object.fromEntries(['baseline','candidate'].map(name => [name, {
      beforeMedianBytes: median(report.samples.map(x => x[name].rssBeforeBytes)),
      afterMedianBytes: median(report.samples.map(x => x[name].rssAfterBytes)),
      processPeakMedianBytes: median(report.samples.map(x => x[name].processPeakRssBytes)) }]));
    report.status = report.qualification.decision === 'pass' ? 'qualified' : report.qualification.decision;
    write(file, report);
    console.log(JSON.stringify({ status: report.status, report: path.relative(root,file), qualification: report.qualification }));
    assert.equal(report.status, 'qualified', 'O-06 runtime gate needs follow-up');
  } catch (error) { if (report.status === 'running') report.status = 'failed'; report.error = error.stack; write(file, report); throw error; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { if (process.argv[2] === '--worker') console.log(JSON.stringify(child(process.argv[3], process.argv.slice(4)))); else main(); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
module.exports = { main, timing };
