#!/usr/bin/env node
'use strict';

// Opt-in final-artifact qualification of B02's existing terminal-body lowering.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { sourceFor } = require('./b02-handler-cost.cjs');
const root = path.resolve(__dirname, '../../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const symbol = name => name.replace(/\\([a-f0-9]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)));
const features = ['--mvp-features', '--enable-mutable-globals', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-bulk-memory'];

function binarySections(bytes) {
  assert.ok(WebAssembly.validate(bytes));
  let at = 8;
  const unsigned = () => {
    let value = 0, shift = 0, byte;
    do { assert.ok(at < bytes.length && shift <= 28); byte = bytes[at++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const sections = {}, bodies = [];
  while (at < bytes.length) {
    const id = bytes[at++], length = unsigned(), end = at + length;
    assert.ok(end <= bytes.length);
    if (id) { assert.ok(!sections[id]); sections[id] = bytes.subarray(at, end); }
    if (id === 10) for (let count = unsigned(); count; count--) {
      const size = unsigned(); bodies.push(size); at += size; assert.ok(at <= end);
    }
    at = end;
  }
  return { sections, bodies };
}

function functionNames(bytes) {
  let at = 0;
  const unsigned = () => {
    let value = 0, shift = 0, byte;
    do { assert.ok(at < bytes.length && shift <= 28); byte = bytes[at++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  const names = new Map();
  while (at < bytes.length) {
    const id = bytes[at++], size = unsigned(), end = at + size; assert.ok(end <= bytes.length);
    if (id === 1) for (let count = unsigned(); count; count--) {
      const index = unsigned(), length = unsigned();
      assert.ok(!names.has(index) && at + length <= end);
      names.set(index, bytes.subarray(at, at + length).toString('utf8')); at += length;
    }
    at = end;
  }
  return names;
}

function inspect(job) {
  const { runTool } = require('../../../packages/wasm-guest-link/src/toolchain');
  const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
  const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
  const bytes = fs.readFileSync(job.file + '.wasm');
  const manifest = read(job.file + '.manifest.json');
  // Text roundtrips can re-stackify code. A named companion must instead match
  // every non-custom binary section exactly before its names can be trusted.
  const directory = job.file + '.named'; fs.mkdirSync(directory, { recursive: true });
  const entry = job.target === 'node' ? 'canonical-native.as' : 'fastly-native-platform-capabilities.as';
  fs.copyFileSync(job.file + '.as.ts', path.join(directory, entry + '.ts'));
  const asc = resolveAsc(path.join(root, 'wasm'));
  const args = [asc.script, entry + '.ts', '--outFile', 'named.wasm', '--runtime', 'stub', '--noAssert', '--optimize', '--debug'];
  appendAssemblyScriptOptimizationArgs(args, job.profile === 'bounded-size' ? 'experimental-native-bounded-size' : undefined);
  if (job.target === 'fastly') args.push('--use', `abort=${entry}/__pulse_fastly_abort`);
  const result = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const named = fs.readFileSync(path.join(directory, 'named.wasm'));
  const binary = binarySections(bytes);
  assert.deepEqual(binary.sections, binarySections(named).sections, 'named companion must preserve every non-custom section byte-for-byte');
  runTool('wasm-dis', [path.join(directory, 'named.wasm'), ...features, '-o', job.file + '.wat']);
  const wat = fs.readFileSync(job.file + '.wat', 'utf8'), module = new WebAssembly.Module(named);
  const nameSections = WebAssembly.Module.customSections(module, 'name'); assert.equal(nameSections.length, 1);
  const names = functionNames(Buffer.from(nameSections[0]));
  const importedFunctions = WebAssembly.Module.imports(module).filter(item => item.kind === 'function').length;
  const functions = [...wat.matchAll(/^ \(func \$([^\s(]+)([\s\S]*?)^ \)/gm)].map((match, index) => ({
    name: symbol(match[1]), bytes: binary.bodies[index], calls: [...new Set([...match[2].matchAll(/\bcall \$([^\s()]+)/g)].map(item => symbol(item[1])))]
  }));
  assert.equal(functions.length, binary.bodies.length);
  // wasm-dis labels an unnamed definition with its definition ordinal.
  for (const [index, item] of functions.entries()) assert.equal(item.name, names.get(importedFunctions + index) ?? String(index), 'exact binary function index attribution');
  assert.ok(!/\b(?:call_indirect|call_ref|return_call)\b/.test(wat), 'the selected fixture keeps direct calls');
  assert.ok(!/\(table\b/.test(wat), 'terminal bodies do not introduce a function table');
  const byName = new Map(functions.map(item => [item.name, item]));
  const imports = new Set([...wat.matchAll(/\(import [^\n]*\(func \$([^\s()]+)/g)].map(match => symbol(match[1])));
  for (const item of functions) for (const name of item.calls) assert.ok(byName.has(name) || imports.has(name), `unresolved call ${name}`);
  const closure = starts => {
    const seen = new Set(), queue = [...starts];
    for (let index = 0; index < queue.length; index++) {
      const name = queue[index]; if (seen.has(name)) continue; seen.add(name);
      queue.push(...(byName.get(name)?.calls || []));
    }
    return seen;
  };
  const exports = [...wat.matchAll(/\(export "[^"]+" \(func \$([^\s()]+)/g)].map(match => symbol(match[1]));
  const reachable = closure(exports), owner = new Map();
  const chunk = index => {
    const found = functions.filter(item => /^(?:canonical-native|fastly-native-platform-capabilities)\.as\/__pulse_chunk_\d+$/.test(item.name)
      && item.name.endsWith(`/__pulse_chunk_${index}`));
    assert.equal(found.length, 1, `retained chunk ${index} survives final optimization`); return found[0];
  };
  for (const handler of manifest.handlerBodies) for (const index of handler.chunks) owner.set(chunk(index).name, handler.id);
  const handlers = manifest.handlerBodies.map(handler => {
    const roots = handler.chunks.map(chunk), reached = closure(roots.map(item => item.name));
    assert.ok(roots.length > 0 && roots.every(item => reachable.has(item.name)), 'each handler boundary is reachable from an export');
    for (const name of reached) if (owner.has(name)) assert.equal(owner.get(name), handler.id, 'one terminal body cannot call another');
    const bodies = functions.filter(item => reached.has(item.name));
    return { id: handler.id, states: handler.stateCount, roots: roots.map(({ name, bytes }) => ({ name, bytes })),
      largestReachableBodyBytes: Math.max(...bodies.map(item => item.bytes)) };
  });
  assert.equal(handlers.length, job.count);
  assert.equal(manifest.dispatcher.oversizedStateCount, 0);
  const largest = [...functions].sort((a, b) => b.bytes - a.bytes)[0];
  assert.ok(largest.bytes <= 16384, 'fixture must not reconstruct a large function');
  return { functions: functions.length, codeBodyBytes: binary.bodies.reduce((a, b) => a + b, 0),
    largestFunction: { name: largest.name, bytes: largest.bytes },
    stepBytes: functions.find(item => item.name.endsWith('/__pulse_step'))?.bytes,
    maxHandlerRootBytes: Math.max(...handlers.flatMap(item => item.roots.map(fn => fn.bytes))),
    largestHandlerReachableBodyBytes: Math.max(...handlers.map(item => item.largestReachableBodyBytes)),
    sharedFunctions: functions.filter(item => item.name.startsWith('byn$mgfn-shared$')).map(({ name, bytes }) => ({ name, bytes })),
    handlerCount: handlers.length, chunkCount: manifest.dispatcher.chunkCount, states: manifest.blockCount,
    locals: manifest.localCount, namedCompanionSectionsByteExact: true, indirectCalls: 0, tables: 0, handlers };
}

function compile(job) {
  const { compileCanonicalProject } = require('../../../packages/compiler/src/canonical-project-compiler');
  const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
  const compiler = job.target === 'node' ? require('../../../packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan
    : require('../../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan;
  const begin = performance.now();
  const plan = buildCanonicalNativePlan(compileCanonicalProject(path.join(job.project, 'src/index.ts'), { rootDir: job.project, workspaceRoot: root }));
  const planningMs = performance.now() - begin;
  const compiled = compiler(plan, { cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false,
    nativeOptimization: job.profile === 'bounded-size' ? 'experimental-native-bounded-size' : undefined,
    bindings: { effectBackends: Object.fromEntries(plan.effects.map(effect => [effect.id, 'proof'])) } });
  const buildMs = performance.now() - begin, workerPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  assert.equal(plan.schemas?.registry?.schemas?.length || 0, 0, 'named companion recipe is scoped to this schema-free fixture');
  assert.equal(compiled.guestUnits?.length || 0, 0, 'named companion recipe is scoped to this unlinked fixture');
  fs.writeFileSync(job.file + '.wasm', compiled.wasm); fs.writeFileSync(job.file + '.as.ts', compiled.source);
  write(job.file + '.plan.json', plan);
  const manifest = job.target === 'node' ? compiled.manifest
    : require('../../../packages/runtime-core-as/src/compiler/canonical-native').generateCanonicalNativeAssemblyScript(plan).manifest;
  write(job.file + '.manifest.json', manifest);
  return { planningMs, buildMs, workerPeakRssBytes, sourceBytes: Buffer.byteLength(compiled.source), sourceSha256: hash(compiled.source),
    planHash: plan.planHash, wasmBytes: compiled.wasm.length, gzipBytes: gzipSync(compiled.wasm, { level: 9 }).length,
    wasmSha256: hash(compiled.wasm), assemblyScript: compiled.assemblyScriptVersion || compiled.manifest.assemblyScript.version,
    optimization: compiled.optimization || compiled.manifest.optimization || null };
}

async function runtime(job) {
  const wasm = fs.readFileSync(job.file + '.wasm'), plan = read(job.file + '.plan.json');
  const native = job.target === 'node';
  const execute = native ? require('../../../packages/host-runtime/src/runtime/canonical-native-host').executeCanonicalNativeModule
    : require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities;
  const createAdapter = native && require('../../../../packages/provider-node/src/runtime/canonical-api-runtime').createNodeProviderAdapter;
  async function request(index, gate = 'go', limited = false) {
    const seen = [], url = `https://proof.test/value/${index}`, request = { method: 'GET', path: index < 0 ? '/missing' : `/route/${index}` };
    let result;
    if (native) {
      const adapter = createAdapter({ fetches: { 'https://proof.test/gate': { body: gate }, [url]: { body: 'done' } } });
      const promise = execute({ wasm, plan }, { request, ...(limited ? { maxEffects: 1 } : {}), providerAdapter: { ...adapter,
        dispatchEffect(effect, context) { seen.push(new URL(effect.parts.url).pathname); return adapter.dispatchEffect(effect, context); } } });
      if (limited) { await assert.rejects(promise, error => error.code === 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED'); assert.deepEqual(seen, ['/gate']); return { limitedEffects: seen }; }
      result = await promise;
    } else result = execute(wasm, { request, fixtures: { proof: { '/gate': { status: 200, body: gate }, [`/value/${index}`]: { status: 200, body: 'done' } } },
      onOutboundRequest(item) { seen.push(new URL(item.url).pathname); } });
    assert.equal(result.response.status, index < 0 ? 404 : 200);
    assert.equal(result.response.body, index < 0 ? 'Not Found' : gate === 'stop' ? 'stopped' : `${index}:16:done`);
    assert.deepEqual(seen, gate === 'stop' || index < 0 ? ['/gate'] : ['/gate', `/value/${index}`]);
    return { status: result.response.status, body: result.response.body, effects: seen,
      ...(native ? { handles: result.valueHandleCount, continuations: result.continuations.map(site => ({ states: site.states, effectId: site.effectId })) } : {}) };
  }
  // No module inspection/compilation occurs in this worker before this request.
  const begin = performance.now(), cold = await request(job.count - 1), coldRequestMs = performance.now() - begin;
  const warm = performance.now();
  for (let index = 0; index < 10; index++) assert.deepEqual(await request(job.count - 1), cold);
  const warmRequestMs = (performance.now() - warm) / 10;
  const routes = [];
  for (let index = 0; index < job.count; index++) routes.push(await request(index));
  const semantics = { routes, stop: await request(0, 'stop'), missing: await request(-1), ...(native ? { budget: await request(job.count - 1, 'go', true) } : {}) };
  return { coldRequestMs, warmRequestMs, workerPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    semanticsSha256: hash(JSON.stringify(semantics)), semantics };
}

function child(mode, job, extraEnv = {}) {
  const result = spawnSync(process.execPath, [__filename, mode, JSON.stringify(job)], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...extraEnv }
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function main() {
  if (process.argv[2]) {
    const job = JSON.parse(process.argv[3]);
    if (process.argv[2] === '--compile') return console.log(JSON.stringify(compile(job)));
    if (process.argv[2] === '--inspect') return console.log(JSON.stringify(inspect(job)));
    if (process.argv[2] === '--runtime') return console.log(JSON.stringify(await runtime(job)));
    if (process.argv[2] === '--module') {
      const bytes = fs.readFileSync(job.file + '.wasm'), begin = performance.now();
      new WebAssembly.Module(bytes);
      return console.log(JSON.stringify({ coldModuleMs: performance.now() - begin }));
    }
    throw Error('unknown worker mode');
  }
  assert.equal(process.platform, 'linux', 'resourceUsage RSS units are Linux KiB');
  const out = path.join(root, 'wasm/.test-results/compiler-efficiency/b03', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-b03-'));
  const reportFile = path.join(out, 'measurements.json');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const report = { version: 'pulse.handler-functions-proof.v1', status: 'running', sourceRevision: git(['rev-parse', 'HEAD']),
    workingTree: git(['status', '--porcelain']), trackedDiffSha256: hash(git(['diff', 'HEAD', '--'])),
    harnessSha256: hash(fs.readFileSync(__filename)), fixtureHarnessSha256: hash(fs.readFileSync(require.resolve('./b02-handler-cost.cjs'))),
    lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), node: process.version,
    binaryen: require('../../../packages/wasm-guest-link/src/toolchain').binaryenIdentity(), pairs: 3, cells: [],
    limits: ['Synthetic terminal-route family only; indivisible pure loops can exceed chunk targets.',
      'Existing B02 lowering is qualified, not a new optimization or a public function feature.',
      'Timed builds omit text/debug output; named inspection builds are separate and must match all non-custom sections.',
      'Fastly uses the injected ABI host; no deployed cold-start claim.',
      'Compiler worker/AssemblyScript peaks are separate processes, not aggregate or guest live memory.',
      'Cold module and cold request use different fresh processes. Warm requests use fresh instances and normal engine cache behavior.'] };
  try {
    const hook = path.join(temporary, 'usage.cjs');
    fs.writeFileSync(hook, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(require('node:path').join(process.env.PULSE_B03_USAGE_DIR, process.pid + '.json'), JSON.stringify({rss:process.resourceUsage().maxRSS*1024})));`);
    for (const count of [1, 8, 32]) for (const target of ['node', 'fastly']) {
      const project = path.join(temporary, `${count}-${target}`); fs.mkdirSync(path.join(project, 'src'), { recursive: true });
      fs.writeFileSync(path.join(project, 'src/index.ts'), sourceFor(count));
      const cells = Object.fromEntries(['default', 'bounded-size'].map(profile => {
        const cell = { count, target, profile, fixtureSha256: hash(sourceFor(count)), builds: [], runtime: [] };
        report.cells.push(cell); return [profile, cell];
      }));
      for (let sample = 0; sample < 3; sample++) for (const profile of sample % 2 ? ['bounded-size', 'default'] : ['default', 'bounded-size']) {
        const cell = cells[profile], file = path.join(out, `${target}-${count}-${profile}`), job = { count, target, profile, project, file };
        const usage = path.join(temporary, `${target}-${count}-${profile}-${sample}`); fs.mkdirSync(usage);
        const built = child('--compile', job, { PULSE_B03_USAGE_DIR: usage, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}` });
        const rss = fs.readdirSync(usage).map(name => read(path.join(usage, name)).rss);
        assert.ok(rss.length); built.assemblyScriptPeakRssBytes = Math.max(...rss);
        if (cell.builds.length) for (const key of ['sourceSha256', 'planHash', 'wasmSha256']) assert.equal(built[key], cell.builds[0][key]);
        cell.builds.push({ sample, ...built });
        if (sample === 0) cell.shape = child('--inspect', job);
        const module = child('--module', job), executed = child('--runtime', job);
        if (cell.runtime.length) assert.equal(executed.semanticsSha256, cell.runtime[0].semanticsSha256);
        if (sample === 0) cell.semantics = executed.semantics;
        delete executed.semantics; cell.runtime.push({ sample, ...module, ...executed });
        write(reportFile, report);
        console.log(JSON.stringify({ count, target, profile, sample, wasmBytes: built.wasmBytes, largestFunctionBytes: cell.shape.largestFunction.bytes,
          buildMs: built.buildMs, coldModuleMs: module.coldModuleMs }));
      }
      assert.deepEqual(cells.default.semantics, cells['bounded-size'].semantics, 'profile parity includes all routes, early termination, 404, continuations and Node budget failure');
      for (const key of ['states', 'locals', 'handlerCount', 'chunkCount']) assert.equal(cells.default.shape[key], cells['bounded-size'].shape[key]);
    }
    for (const target of ['node', 'fastly']) for (const profile of ['default', 'bounded-size']) {
      const cells = report.cells.filter(cell => cell.target === target && cell.profile === profile);
      for (const cell of cells) assert.ok(cell.shape.largestHandlerReachableBodyBytes <= Math.max(4096, 2 * cells[0].shape.largestHandlerReachableBodyBytes), 'handler call closure stays bounded as route count increases');
    }
    report.status = 'passed'; write(reportFile, report);
    console.log(JSON.stringify({ status: report.status, cells: report.cells.length, compileSamples: 36, report: path.relative(root, reportFile) }));
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); write(reportFile, report); throw error; }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
