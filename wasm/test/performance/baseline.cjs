#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { fixtures } = require('./fixtures.cjs');
const { SCHEMA, hash, statistics, compare } = require('./report.cjs');
const { runCommand } = require('../../../scripts/release-process.cjs');
const { atomicJson } = require('../../../scripts/release-recovery.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const protocol = Object.freeze({
  version: 'pulse.performance-protocol.v1', serial: true, buildSamples: 3, coldProcesses: 3, warmup: 10, warmSamplesPerProcess: 30,
  cache: { build: 'fresh process, empty output directory', load: 'fresh process, built artifact',
    warm: 'same process after warmup; fresh request lifecycle', dependencies: 'preinstalled workspace build',
    os: 'uncontrolled filesystem/page caches; not flushed' },
  timing: { buildMs: 'CLI imports, project resolution and buildProject; excludes fixture setup and worker startup',
    coldLoadMs: 'artifact reads and runtime imports; JavaScript application/codecs import; Native instantiation occurs in requests',
    firstRequestMs: 'first complete provider-host request including request construction/body materialization, Native validation/compilation/instantiation and mandatory request disposal',
    warmRequestMs: 'same complete request after warmup, including request construction, body materialization and mandatory disposal; correctness assertions outside timer',
    cleanupMs: 'delete per-cell project and build outputs after all samples; excluded from build/load/request',
    compilerPeakRssBytes: 'maximum individual ASC process resourceUsage.maxRSS, including its source-map re-exec; never summed; Native only; JavaScript compiler/build worker high-water RSS (includes imports/writer)',
    artifactBytes: 'Native executable Wasm; JavaScript emitted executable .js/.cjs modules and schema codecs; dependencies/inspection excluded' },
  request: 'fixtures.cases[0]; in-memory Node provider fixture fetch, no network or HTTP server',
  runtime: 'workspace Node provider host, generated JavaScript source package / canonical Native Wasm',
  instrumentation: 'test-owned spawnSync wrapper preloads resourceUsage exit recorder into ASC; no production source hooks',
});

function prepareProject(directory, fixture, target) {
  fs.mkdirSync(path.join(directory, '.pulse'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'src'));
  write(path.join(directory, 'package.json'), { name: 'pulse-performance-fixture', version: '0.0.0', private: true });
  fs.writeFileSync(path.join(directory, 'src/index.ts'), fixture.source);
  if (fixture.schema) fs.writeFileSync(path.join(directory, 'src/schemas.ts'), fixture.schema);
  fs.writeFileSync(path.join(directory, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({ pulse: { entry: 'src/index.ts', strict: true, defaultProfile: 'node',
${fixture.schema ? "schema: 'src/schemas.ts'," : ''} }, node: { host: 'node', target: '${target}', outDir: 'dist' } }));\n`);
  const scope = path.join(directory, 'node_modules/@pulse-compute');
  fs.mkdirSync(scope, { recursive: true });
  for (const [name, owner] of [['pulse', 'packages/pulse'], ['runtime', 'packages/runtime'], ['provider-node', 'packages/provider-node'], ['wasm-contracts', 'wasm/packages/contracts']]) {
    fs.symlinkSync(path.join(root, owner), path.join(scope, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
}

function buildWorker(directory, outName, resultFile) {
  const recipes = [];
  const original = child.spawnSync;
  // Install before production modules destructure spawnSync, as in O-03. Only
  // ASC is observed; all production options and output semantics are preserved.
  child.spawnSync = function(executable, args, options) {
    if (!String(args?.[0]).replace(/\\/g, '/').endsWith('/assemblyscript/bin/asc.js')) return original.call(this, executable, args, options);
    const rssFile = resultFile + '.rss';
    assert(!fs.existsSync(rssFile), 'Refusing stale compiler resource observations');
    const normalize = value => String(value).replaceAll(root, '<repo>').replaceAll(options.cwd, '<staging>');
    const flags = args.slice(1).map((arg, index, list) => ['--outFile', '--textFile'].includes(list[index - 1]) ? '<output>' : normalize(arg));
    const env = Object.fromEntries(['JSON_STRICT', 'JSON_USE_FAST_PATH', 'JSON_MODE'].map(key => [key, options.env?.[key] ?? null]));
    const result = original.call(this, executable, ['--require', path.join(__dirname, 'compiler-rss.cjs'), ...args],
      { ...options, env: { ...options.env, PS08_COMPILER_RSS_FILE: rssFile } });
    const peaks = fs.existsSync(rssFile) ? fs.readFileSync(rssFile, 'utf8').trim().split('\n').map(line => JSON.parse(line).peakBytes) : [];
    recipes.push({ flags, env, peakBytes: peaks.length && peaks.every(value => value > 0) ? Math.max(...peaks) : null });
    return result;
  };
  const started = performance.now();
  const execution = require('../../packages/cli/src/project-execution.js');
  const project = require('../../packages/cli/src/project-config.js').resolveProject({ cwd: directory });
  const built = execution.buildProject(project, { outDir: path.join(directory, outName), emitWat: false });
  const buildMs = performance.now() - started;
  assert.equal(built.status, 'built');
  const native = project.target === 'native';
  if (native) assert.equal(recipes.length, 1, 'Review RSS attribution if Native gains additional compiler children');
  else assert.equal(recipes.length, 0);
  let artifactBytes, artifactSha256;
  if (native) {
    const bytes = fs.readFileSync(path.join(built.outDir, built.manifest.portable.wasm.file));
    artifactBytes = bytes.length; artifactSha256 = hash(bytes);
  } else {
    const names = ['index.cjs', ...built.sourcePackage.modules.map(module => module.output),
      ...(built.files.schemaCodecs ? [path.basename(built.files.schemaCodecs)] : [])].sort();
    const files = names.map(name => ({ file: name, bytes: fs.readFileSync(path.join(built.outDir, name)) }));
    artifactBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
    artifactSha256 = hash(JSON.stringify(files.map(file => [file.file, hash(file.bytes)])));
  }
  let workerRss = null;
  try { const value = process.resourceUsage().maxRSS * 1024; if (value > 0) workerRss = value; } catch (_) { /* unavailable on this host */ }
  write(resultFile, { buildMs, compilerPeakRssBytes: native ? recipes[0].peakBytes : workerRss,
    artifactBytes, artifactSha256, outDir: built.outDir,
    settings: { provider: 'node', target: project.target, strict: true, reporting: project.reporting,
      emitWat: false, optimization: native ? (built.manifest.portable.optimization || { mode: 'default', assemblyScript: '--optimize' }) : { mode: 'source-package', minified: false },
      compiler: native ? { flags: recipes[0].flags, env: recipes[0].env } : { flags: [], env: {} } } });
}

async function runtimeWorker(outDir, fixture, target, mode, resultFile) {
  const started = performance.now();
  const manifest = read(path.join(outDir, 'pulse-build.json'));
  let execute;
  if (target === 'native') {
    const native = { wasm: fs.readFileSync(path.join(outDir, manifest.portable.wasm.file)), plan: read(path.join(outDir, manifest.portable.plan)) };
    const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
    const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
    execute = request => executeCanonicalNativeModule(native, { request,
      providerAdapter: createNodeProviderAdapter({ fetches: fixture.fetches || {} }) });
  } else {
    const application = require(path.join(outDir, manifest.application.entry));
    const schemaCodecs = manifest.schemas?.active ? require(path.join(outDir, manifest.schemas.codecs)) : undefined;
    const { executeNodeJavascriptApplication, createNodeJavascriptFixtureFetch } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
    const fetchImplementation = createNodeJavascriptFixtureFetch(fixture.fetches || {});
    execute = request => executeNodeJavascriptApplication(application,
      new Request('https://bench.example.test' + request.path, request), { strict: true, schemaCodecs, fetchImplementation });
  }
  const coldLoadMs = performance.now() - started;
  async function request(testCase) {
    const response = await execute(structuredClone(testCase.request));
    return target === 'native' ? response.response : { status: response.status, body: await response.text() };
  }
  function check(response, testCase) {
    assert.equal(response.status, testCase.expected.status);
    if (testCase.expected.json) assert.deepEqual(JSON.parse(response.body), testCase.expected.json);
    else assert.equal(response.body, testCase.expected.text);
  }
  if (mode === 'check') {
    for (const testCase of fixture.cases) check(await request(testCase), testCase);
    write(resultFile, { status: 'passed', cases: fixture.cases.length });
    return;
  }
  const timedRequest = async () => {
    const before = performance.now();
    const response = await request(fixture.cases[0]);
    const ms = performance.now() - before;
    check(response, fixture.cases[0]);
    return ms;
  };
  const firstRequestMs = await timedRequest();
  for (let n = 0; n < protocol.warmup; n++) await timedRequest();
  const warmRequestMs = [];
  for (let n = 0; n < protocol.warmSamplesPerProcess; n++) warmRequestMs.push(await timedRequest());
  write(resultFile, { coldLoadMs, firstRequestMs, warmRequestMs });
}

function dependencies() {
  const compiler = path.join(root, 'wasm/packages/compiler');
  const packages = {};
  for (const name of ['typescript', 'assemblyscript', 'json-as']) {
    const file = require.resolve(name + '/package.json', { paths: [compiler, root] });
    packages[name] = { version: read(file).version, manifestSha256: hash(fs.readFileSync(file)) };
  }
  return { lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    installedLockfileSha256: hash(fs.readFileSync(path.join(root, 'node_modules/.pnpm/lock.yaml'))), packages,
    workspacePreparation: 'lockfile install with scripts disabled; pnpm build required before run' };
}
function environment() {
  return { node: process.version, versions: process.versions, executableSha256: hash(fs.readFileSync(process.execPath)),
    nodeOptions: process.env.NODE_OPTIONS || '', execArgv: process.execArgv,
    os: { platform: process.platform, release: os.release(), arch: os.arch() },
    hardware: { cpu: os.cpus()[0]?.model || 'unavailable', logicalCpus: os.cpus().length,
      availableParallelism: os.availableParallelism(), hostMemoryBytes: os.totalmem(),
      cgroupCpuMax: readLimit('/sys/fs/cgroup/cpu.max'), cgroupMemoryMax: readLimit('/sys/fs/cgroup/memory.max') } };
}
function readLimit(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return 'unavailable'; } }

async function baseline(output) {
  const campaignStarted = performance.now();
  assert(output, 'Usage: node wasm/test/performance/baseline.cjs --out <new-report.json> | --compare <before.json> <after.json>');
  output = path.resolve(output);
  assert(!fs.existsSync(output + '.log'), 'Refusing to overwrite a worker log');
  assert(!fs.existsSync(output), 'Refusing to overwrite a report');
  const source = candidateIdentity(root); // Never silently time uncommitted source.
  const deps = dependencies();
  const harnessSha256 = hash(JSON.stringify(['baseline.cjs', 'fixtures.cjs', 'report.cjs', 'compiler-rss.cjs'].map(name => [name, hash(fs.readFileSync(path.join(__dirname, name)))])));
  const report = { schemaVersion: SCHEMA, status: 'running', createdAt: new Date().toISOString(), source,
    dependencies: deps, environment: environment(), protocol: { ...protocol, harnessSha256 }, validation: [], cells: [] };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const scratch = path.join(root, 'wasm/.test-results'); fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'performance-'));
  const controller = new AbortController();
  const stop = signal => controller.abort(signal);
  const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const projects = [];
  fs.closeSync(fs.openSync(output + '.log', 'wx'));
  const persist = () => atomicJson(output, report);
  async function worker(args, file) {
    const result = await runCommand(process.execPath, [__filename, '--worker', ...args, file], { cwd: root, signal: controller.signal,
      timeoutMs: 180000, termGraceMs: 1000, killGraceMs: 1000,
      onOutput(stream, chunk) { fs.appendFileSync(output + '.log', chunk); } });
    assert(result.status === 0 && !result.timedOut && !result.interruptedBy && !result.error,
      `Worker failed: ${JSON.stringify(result)}; see ${output}.log`);
    return read(file);
  }
  try {
    persist();
    // Verify every semantic case on both targets before starting the timed campaign.
    for (const fixture of fixtures) for (const target of ['javascript', 'native']) {
      const project = path.join(directory, fixture.id + '-' + target);
      prepareProject(project, fixture, target);
      const built = await worker(['build', project, 'preflight'], path.join(project, 'preflight.json'));
      const checked = await worker(['runtime', built.outDir, fixture.id, target, 'check'], path.join(project, 'check.json'));
      report.validation.push({ fixture: fixture.id, target, ...checked });
      projects.push({ project, fixture, target }); persist();
    }
    for (const { project, fixture, target } of projects) {
      console.log(`Measuring ${fixture.id} / node-${target}`);
      const builds = [], runtimes = [];
      for (let n = 0; n < protocol.buildSamples; n++) builds.push(await worker(['build', project, 'sample-' + n], path.join(project, `build-${n}.json`)));
      for (const built of builds) assert.deepEqual(built.settings, builds[0].settings, 'Build settings drift');
      for (let n = 0; n < protocol.coldProcesses; n++) runtimes.push(await worker(['runtime', builds.at(-1).outDir, fixture.id, target, 'measure'], path.join(project, `runtime-${n}.json`)));
      const cleanupStarted = performance.now(); fs.rmSync(project, { recursive: true, force: true });
      const cleanupMs = performance.now() - cleanupStarted;
      report.cells.push({ fixture: { id: fixture.id, sha256: hash(JSON.stringify(fixture)), verifiedCases: fixture.cases.length },
        target: 'node-' + target, settings: builds[0].settings, artifactKind: target === 'native' ? 'executable-wasm' : 'emitted-javascript-and-codecs',
        artifactSha256: builds.map(built => built.artifactSha256),
        metrics: { buildMs: statistics(builds.map(b => b.buildMs)), compilerPeakRssBytes: statistics(builds.map(b => b.compilerPeakRssBytes), 'Compiler process did not supply resourceUsage RSS'),
          artifactBytes: statistics(builds.map(b => b.artifactBytes)), coldLoadMs: statistics(runtimes.map(r => r.coldLoadMs)),
          firstRequestMs: statistics(runtimes.map(r => r.firstRequestMs)), warmRequestMs: statistics(runtimes.flatMap(r => r.warmRequestMs)),
          cleanupMs: statistics([cleanupMs]), requestCleanupMs: statistics([], 'Mandatory request disposal is inside the provider invocation; no separate public timing hook') },
        coldSamples: { buildMs: builds.map(b => b.buildMs), coldLoadMs: runtimes.map(r => r.coldLoadMs), firstRequestMs: runtimes.map(r => r.firstRequestMs) },
        warmProcesses: runtimes.map(r => statistics(r.warmRequestMs)) });
      persist();
    }
    assert.deepEqual(candidateIdentity(root), source, 'Source changed during baseline');
    assert.deepEqual(dependencies(), deps, 'Dependencies changed during baseline');
    report.status = 'passed';
  } catch (error) {
    report.status = controller.signal.aborted ? 'interrupted' : 'failed'; report.error = error.message; throw error;
  } finally {
    const started = performance.now(); fs.rmSync(directory, { recursive: true, force: true });
    report.finalCleanupMs = performance.now() - started;
    report.completedAt = new Date().toISOString(); report.elapsedMs = performance.now() - campaignStarted; persist();
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
  console.log(`Saved ${output} (${report.cells.length} validated cells)`);
}
async function main(args) {
  if (args[0] === '--worker') {
    if (args[1] === 'build') return buildWorker(path.resolve(args[2]), args[3], args[4]);
    assert.equal(args[1], 'runtime');
    const fixture = fixtures.find(item => item.id === args[3]); assert(fixture);
    return runtimeWorker(args[2], fixture, args[4], args[5], args[6]);
  }
  if (args[0] === '--compare') {
    assert.equal(args.length, 3);
    console.log(JSON.stringify(compare(read(args[1]), read(args[2])), null, 2)); return;
  }
  assert.equal(args[0], '--out'); assert.equal(args.length, 2);
  await baseline(args[1]);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { protocol, prepareProject, buildWorker, runtimeWorker, baseline, environment, dependencies };
