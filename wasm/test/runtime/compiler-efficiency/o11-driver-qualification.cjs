#!/usr/bin/env node
'use strict';

// Opt-in Linux evidence. No compiler dependency is loaded in runtime workers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const cp = require('node:child_process');
const os = require('node:os');
const root = path.resolve(__dirname, '../../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baselineRevision = '5142725930ef8c481ad16b5b7ca2e8ebaab4ee6f';
const candidateRevision = '2e08f1eaabcadbf400fc776fb64f55354b6d62e0';
const owners = ['native-platform-capabilities.js', 'native-application-errors.js'].map(n => 'packages/provider-fastly/src/build/' + n);
const hostPath = 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js';
const helperName = 'fastly-native-platform-capabilities.as/__pulse_application_settle_effect';
const protocol = Object.freeze({ buildPairs: 3, runtimePairs: 20, warmInvocations: 10,
  bootstrapResamples: 4000, seed: 11011, materialRatio: 1.05, runtimeAbsoluteFloorMs: 0.1,
  order: 'baseline,candidate on even pairs; candidate,baseline on odd pairs; serial fresh processes',
  profile: 'unchanged provider default; named companion adds only --debug outside timed builds',
  timing: 'construction before any validation; fresh instance; first _start inclusive of imported mock callbacks and lazy compilation; warm median of 10 subsequent fresh instances reusing the same module',
  memory: 'compiler child peak RSS via Linux RUSAGE_CHILDREN of a one-child Python supervisor; runtime host RSS and guest capacity separately; no allocation/live-byte claim',
  verdict: 'paired bootstrap median difference: regression if lower CI exceeds max(5% baseline median, runtime 0.1ms); pass if upper CI does not exceed it; otherwise inconclusive; build n=3 is exploratory',
  negativeControl: 'schemas-16-diverse without error route: source and Wasm must be byte-identical; timing material regression prevents an overall pass' });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const median = values => { const s = [...values].sort((a, b) => a - b), n = s.length; return (s[Math.floor((n - 1) / 2)] + s[Math.floor(n / 2)]) / 2; };
function summary(before, after, floor = 0) {
  const a = median(before), b = median(after), delta = after.map((n, i) => n - before[i]);
  let seed = protocol.seed; const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const boots = Array.from({ length: protocol.bootstrapResamples }, () => median(delta.map(() => delta[Math.floor(random() * delta.length)]))).sort((x, y) => x - y);
  const ci = [boots[100], boots[3899]], threshold = Math.max(a * (protocol.materialRatio - 1), floor);
  return { pairs: before.length, beforeMedian: a, afterMedian: b, ratio: b / a,
    beforeMad: median(before.map(n => Math.abs(n - a))), afterMad: median(after.map(n => Math.abs(n - b))),
    pairedDeltaMedian: median(delta), pairedDelta95CI: ci, materialDelta: threshold,
    verdict: ci[0] > threshold ? 'regression' : ci[1] <= threshold ? 'pass' : 'inconclusive' };
}
function load(file, source, requireOverride) {
  const owner = new Module(file, module); owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
  if (requireOverride) { const original = owner.require.bind(owner); owner.require = id => requireOverride(id, original); }
  owner._compile(source, file); owner.loaded = true; return owner;
}
function census(job) {
  const filename = require.resolve('./o08-wasm-census.cjs');
  let providerSource;
  if (job?.variant === 'baseline') {
    providerSource = cp.execFileSync('git', ['show', `${baselineRevision}:${owners[0]}`], { cwd: root, encoding: 'utf8' });
    const file = path.join(root, owners[1]);
    require.cache[file] = load(file, cp.execFileSync('git', ['show', `${baselineRevision}:${owners[1]}`], { cwd: root, encoding: 'utf8' }));
  }
  return load(filename, fs.readFileSync(filename, 'utf8') + '\nmodule.exports = {compile, inspect};\n', (id, original) => {
    if (id === 'node:fs' && providerSource) return { ...fs, readFileSync(file, ...args) {
      return file === path.join(root, owners[0]) ? providerSource : fs.readFileSync(file, ...args);
    } };
    if (id === 'node:child_process' && job) return { ...cp, spawnSync(executable, args, options) {
      assert.match(args[0], /asc\.js$/);
      return cp.spawnSync('python3', [path.join(__dirname, 'o11-compiler-resource.py'), path.join(job.directory, 'compiler.json'), executable, ...args], options);
    } };
    return original(id);
  }).exports;
}
function compile(job) {
  fs.mkdirSync(job.directory, { recursive: true });
  const started = performance.now(), result = census(job).compile(job);
  return { ...result, compiler: JSON.parse(fs.readFileSync(path.join(job.directory, 'compiler.json'))),
    workerWallMs: performance.now() - started, workerPeakRssBytes: process.resourceUsage().maxRSS * 1024 };
}
function runtime(job) {
  const wasm = fs.readFileSync(job.file), identity = hash(wasm), constructionStart = performance.now();
  const compiled = new WebAssembly.Module(wasm); // No validate/customSections/previous module before this boundary.
  const moduleMs = performance.now() - constructionStart;
  const file = path.join(root, hostPath); let source = fs.readFileSync(file, 'utf8');
  const replace = (a, b) => { assert.equal(source.split(a).length, 2, 'host measurement boundary drift'); source = source.replace(a, b); };
  replace('if (!WebAssembly.validate(wasm))', 'if (false)'); // Constructor already validates this exact artifact.
  replace('const module = new WebAssembly.Module(wasm);', 'const module = options.o11.module;');
  replace('instance = new WebAssembly.Instance(module, imports);', 'instance = options.o11.measure("instanceMs", () => new WebAssembly.Instance(module, imports));');
  replace('try { instance.exports._start(); }', 'try { options.o11.measure("startMs", () => instance.exports._start()); }');
  const execute = load(file, source).exports.executeFastlyNativePlatformCapabilities;
  const config = Object.fromEntries(Array.from({ length: job.effects }, (_, i) => ['GEN' + i, 'v' + i]));
  const options = { request: { method: 'GET', path: '/r0' }, configStore: 'o07', config };
  const samples = []; let semanticSha256, guestCapacityBytes, hostcalls;
  for (let i = 0; i <= protocol.warmInvocations; i++) {
    const timings = {};
    const result = execute(wasm, { ...options, o11: { module: compiled, measure(key, fn) {
      const start = performance.now(); const value = fn(); timings[key] = performance.now() - start; return value;
    } } });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.body, '{"id":"one","tag":"ok"}' + Object.values(config).join(''));
    assert.equal(result.trace.filter(e => e.module === 'fastly_config_store' && e.name === 'get').length, job.effects);
    const semantic = hash(JSON.stringify({ response: result.response, trace: result.trace }));
    if (i) assert.equal(semantic, semanticSha256); else semanticSha256 = semantic;
    guestCapacityBytes = result.instance.exports.memory.buffer.byteLength; hostcalls = result.trace.length;
    samples.push(timings);
  }
  const hostMemory = { hostRssBytes: process.memoryUsage().rss, hostPeakRssBytes: process.resourceUsage().maxRSS * 1024 };
  // Untimed parity with the unmodified host protects the measurement hooks.
  const reference = require(file).executeFastlyNativePlatformCapabilities(wasm, options);
  assert.equal(hash(JSON.stringify({ response: reference.response, trace: reference.trace })), semanticSha256);
  return { wasmSha256: identity, moduleMs, instanceMs: samples[0].instanceMs, startMs: samples[0].startMs,
    warmStartMs: median(samples.slice(1).map(s => s.startMs)), samples, semanticSha256, hostcalls,
    guestCapacityBytes, ...hostMemory };
}
function worker(mode, job) {
  const result = cp.spawnSync(process.execPath, [__filename, '--worker', mode, JSON.stringify(job)], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr); return JSON.parse(result.stdout);
}
function behavior(directory) {
  const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'o09-driver-behavior.cjs')], { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(directory, 'behavior.log'), run.stdout + run.stderr);
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  const file = run.stdout.match(/O-09 passed: (.+)/)?.[1]; assert.ok(file);
  const after = JSON.parse(fs.readFileSync(path.join(root, file))), before = require('./o09-evidence.json');
  assert.equal(after.status, 'passed'); assert.deepEqual(after.source.testSha256, before.source.testSha256);
  const project = r => r.fixtures.map(({ count, topology, fixtureSha256, cases, tickets, priorityProbes }) => ({ count, topology, fixtureSha256, cases, tickets, priorityProbes }));
  assert.deepEqual(project(after), project(before), 'exact O-09 response, diagnostic events, trace and ticket parity');
  return { report: file, reportSha256: hash(fs.readFileSync(path.join(root, file))), exactBaselineParity: true,
    scenarios: after.fixtures.reduce((n, f) => n + f.cases.length, 0), priorityProbes: after.fixtures.reduce((n, f) => n + f.priorityProbes.length, 0) };
}
function dependencyIdentity() {
  const compilerRequire = Module.createRequire(path.join(root, 'wasm/packages/compiler/package.json'));
  const assembly = compilerRequire.resolve('assemblyscript/package.json');
  const manifests = [assembly, compilerRequire.resolve('json-as/package.json'),
    Module.createRequire(assembly).resolve('binaryen/package.json'),
    Module.createRequire(path.join(root, 'wasm/packages/wasm-guest-link/package.json')).resolve('binaryen/package.json')];
  return [...new Set(manifests)].map(file => {
    const base = path.dirname(file), entries = [];
    function visit(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (item.name === 'node_modules') continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) visit(full);
        else if (item.isFile()) entries.push([path.relative(base, full), hash(fs.readFileSync(full))]);
      }
    }
    visit(base); const manifest = JSON.parse(fs.readFileSync(file));
    return { name: manifest.name, version: manifest.version, files: entries.length, contentSha256: hash(JSON.stringify(entries)) };
  });
}
function main() {
  assert.equal(process.platform, 'linux', 'RSS units require Linux');
  const directory = path.join(root, 'wasm/.test-results/compiler-efficiency/o11', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });
  const prior = require('./o08-evidence.json');
  const files = [...new Set([...Object.keys(prior.sourceSha256), ...owners, hostPath, 'pnpm-lock.yaml',
    ...['o11-driver-qualification.cjs', 'o11-compiler-resource.py', 'o09-driver-behavior.cjs', 'o09-driver-fixture.cjs', 'o09-evidence.json'].map(n => path.relative(root, path.join(__dirname, n)))])];
  const report = { version: 'pulse.o11.driver-qualification.v1', status: 'running', protocol,
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--porcelain']), baselineRevision, candidateRevision,
    sourceSha256: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, kernel: os.release(), cpu: os.cpus()[0].model,
      python: cp.execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim(), gzip: cp.execFileSync('gzip', ['--version'], { encoding: 'utf8' }).split('\n')[0] },
    dependencies: dependencyIdentity(), cells: [], limitations: ['Local Node/V8 with synchronous mock imports, not deployed Fastly latency.',
      'Three build pairs give exploratory timing/RSS intervals, not a powered performance guarantee.',
      'Warm results use fresh instances of one reused module; no reused-instance claim.',
      'RSS is process resident memory; guest capacity is linear-memory capacity, neither is allocation or live bytes.',
      'O-09 behavior baseline is the frozen checked-in ledger; candidate is freshly executed.'] };
  const save = () => write(path.join(directory, 'report.json'), report); save();
  try {
    assert.deepEqual(git(['diff', '--name-only', baselineRevision, candidateRevision, '--', 'packages', 'wasm/packages', 'pnpm-lock.yaml']).split('\n').sort(), [...owners].sort(), 'only the two factoring owners differ in production');
    assert.equal(git(['diff', candidateRevision, '--', 'packages', 'wasm/packages', 'pnpm-lock.yaml']), '', 'measured production closure must match the frozen candidate');
    for (const file of files.filter(f => !/\/o11-/.test(f))) {
      assert.equal(report.sourceSha256[file], hash(cp.execFileSync('git', ['show', `${candidateRevision}:${file}`], { cwd: root })), 'candidate source drift: ' + file);
      if (!owners.includes(file)) assert.equal(report.sourceSha256[file], hash(cp.execFileSync('git', ['show', `${baselineRevision}:${file}`], { cwd: root })), 'baseline dependency drift: ' + file);
    }
    report.baselineOwnerSha256 = Object.fromEntries(owners.map(file => [file, hash(cp.execFileSync('git', ['show', `${baselineRevision}:${file}`], { cwd: root }))]));
    report.behavior = behavior(directory); save(); console.log('O-11 exact O-09 behavior parity passed');
    for (const id of ['sites-1-error-route', 'sites-8-error-route', 'sites-32-error-route', 'schemas-16-diverse']) {
      const frozen = prior.cells.find(r => r.cell.id === id); assert.ok(frozen);
      const row = { id, fixture: frozen.cell, builds: [], runtime: [], structure: {} }; report.cells.push(row); save();
      for (let pair = 0; pair < protocol.buildPairs; pair++) {
        const sample = {};
        for (const variant of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          const dir = path.join(directory, id, variant, String(pair));
          const result = worker('compile', { cell: frozen.cell, directory: dir, named: false, variant });
          assert.deepEqual(result.fixtureSha256, frozen.fixtureSha256); assert.deepEqual(result.recipe, frozen.recipe);
          assert.deepEqual(result.assemblyScript, frozen.assemblyScript); assert.deepEqual(result.jsonAs, frozen.jsonAs);
          if (variant === 'baseline') { assert.equal(result.sourceSha256, frozen.sourceSha256); assert.equal(result.wasmSha256, frozen.wasmSha256); }
          if (pair) { assert.equal(result.sourceSha256, row.builds[0][variant].sourceSha256); assert.equal(result.wasmSha256, row.builds[0][variant].wasmSha256); }
          sample[variant] = result;
        }
        row.builds.push(sample); save(); console.log(`O-11 ${id}: build pair ${pair + 1}/${protocol.buildPairs}`);
      }
      for (const variant of ['baseline', 'candidate']) {
        const dir = path.join(directory, id, variant, '0');
        const named = worker('compile', { cell: frozen.cell, directory: dir, named: true, variant });
        assert.equal(named.sourceSha256, row.builds[0][variant].sourceSha256);
        const wasm = fs.readFileSync(path.join(dir, 'production.wasm'));
        const inspected = census().inspect(wasm, fs.readFileSync(path.join(dir, 'named.wasm')), dir);
        const graph = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json')));
        const helpers = graph.functions.filter(f => f.name === helperName);
        if (variant === 'candidate' && frozen.cell.errorRoute) {
          assert.equal(helpers.length, 1); assert.equal(inspected.driver.calls.find(c => c.callee === helperName)?.sites, frozen.cell.effects);
        } else assert.equal(helpers.length, 0);
        row.structure[variant] = { sourceBytes: row.builds[0][variant].sourceBytes, rawBytes: wasm.length,
          gzipBytes: cp.execFileSync('gzip', ['-n', '-9', '-c', path.join(dir, 'production.wasm')]).length,
          namedWasmSha256: named.wasmSha256, functions: inspected.functions, codeBodyBytes: inspected.codeBodyBytes,
          namedCompanionSectionsByteExact: inspected.namedCompanionSectionsByteExact, driver: inspected.driver, helper: helpers[0] || null,
          fullGraphSha256: inspected.fullGraphSha256 };
      }
      if (!frozen.cell.errorRoute) {
        assert.equal(row.builds[0].baseline.sourceSha256, row.builds[0].candidate.sourceSha256);
        assert.equal(row.builds[0].baseline.wasmSha256, row.builds[0].candidate.wasmSha256);
      }
      for (let pair = 0; pair < protocol.runtimePairs; pair++) {
        const sample = {};
        for (const variant of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
          const result = worker('runtime', { file: path.join(directory, id, variant, String(pair % protocol.buildPairs), 'production.wasm'), effects: frozen.cell.effects });
          assert.equal(result.wasmSha256, row.builds[0][variant].wasmSha256);
          if (pair) assert.equal(result.semanticSha256, row.runtime[0][variant].semanticSha256);
          sample[variant] = result;
        }
        assert.equal(sample.baseline.semanticSha256, sample.candidate.semanticSha256); row.runtime.push(sample);
      }
      row.metrics = {};
      for (const key of ['wallMs', 'userMs', 'systemMs', 'peakRssBytes']) row.metrics['compiler.' + key] = summary(row.builds.map(p => p.baseline.compiler[key]), row.builds.map(p => p.candidate.compiler[key]));
      for (const key of ['moduleMs', 'instanceMs', 'startMs', 'warmStartMs', 'hostPeakRssBytes', 'guestCapacityBytes']) row.metrics[key] = summary(row.runtime.map(p => p.baseline[key]), row.runtime.map(p => p.candidate[key]), key.endsWith('Ms') ? protocol.runtimeAbsoluteFloorMs : 0);
      save(); console.log(`O-11 ${id}: runtime pairs complete`);
    }
    const verdicts = report.cells.flatMap(c => Object.values(c.metrics).map(m => m.verdict));
    report.qualification = verdicts.includes('regression') ? 'regression-observed' : verdicts.includes('inconclusive') ? 'inconclusive' : 'pass-with-build-sample-limitation';
    report.status = 'completed'; save();
    if (process.argv.includes('--record')) write(path.join(__dirname, 'o11-evidence.json'), report);
    console.log(`O-11 ${report.qualification}: ${path.relative(root, path.join(directory, 'report.json'))}`);
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; save(); throw error; }
}
if (require.main === module) {
  if (process.argv[2] === '--worker') console.log(JSON.stringify(({ compile, runtime })[process.argv[3]](JSON.parse(process.argv[4]))));
  else main();
}
