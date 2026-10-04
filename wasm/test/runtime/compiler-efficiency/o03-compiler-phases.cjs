#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const probe = require('./o03-compiler-probe.cjs');
const root = path.resolve(__dirname, '../../../..');
const probePath = require.resolve('./o03-compiler-probe.cjs');
const retentionPath = path.join(root, 'wasm/packages/build-support/src/native-retention-transform.cjs');
const sha = input => crypto.createHash('sha256').update(input).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const asc = () => require('../../../packages/build-support/src/assemblyscript-compile').resolveAsc(path.join(root, 'wasm/packages/compiler'));
const run = (args, options = {}) => {
  const result = child.spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000,
    maxBuffer: 4 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result;
};

function prepare(directory) {
  // Capture the production invocation before loading compilers that destructure
  // spawnSync. Copy only compiler inputs and the three json-as configuration keys.
  const spawn = child.spawnSync;
  const recipes = {};
  child.spawnSync = function(executable, args, options) {
    if (args[0] !== asc().script) return spawn.call(this, executable, args, options);
    const target = args[1] === 'canonical-native.as.ts' ? 'node' : 'fastly';
    assert.ok(['canonical-native.as.ts', 'fastly-native-platform-capabilities.as.ts'].includes(args[1]));
    assert.ok(!recipes[target], 'exactly one production compiler child per target');
    const targetDir = path.join(directory, target); fs.mkdirSync(targetDir);
    const source = fs.readFileSync(path.join(options.cwd, args[1]));
    fs.writeFileSync(path.join(targetDir, args[1]), source);
    const compilerArgs = args.slice(1);
    compilerArgs[compilerArgs.indexOf('--outFile') + 1] = 'module.wasm';
    recipes[target] = { executable, script: args[0], productionArgv: args,
      productionCwd: options.cwd, args: compilerArgs,
      env: Object.fromEntries(['JSON_STRICT', 'JSON_USE_FAST_PATH', 'JSON_MODE'].map(key => [key, options.env[key]])),
      sourceBytes: source.length, sourceSha256: sha(source) };
    const result = spawn.call(this, executable, args, options);
    assert.equal(result.status, 0, result.stderr);
    const wasm = fs.readFileSync(args[args.indexOf('--outFile') + 1]);
    fs.writeFileSync(path.join(targetDir, 'production.wasm'), wasm);
    Object.assign(recipes[target], { wasmBytes: wasm.length, wasmSha256: sha(wasm) });
    return result;
  };
  const p02 = require('./p02-memory-trace.cjs');
  const project = path.join(directory, 'project'); fs.mkdirSync(project); p02.prepareFixture(project);
  p02.compileWorker('node', project, directory);
  p02.compileWorker('fastly', project, directory);
  const { resolveProject } = require('../../../packages/cli/src/project-config');
  write(path.join(directory, 'bindings.json'), resolveProject({ cwd: project, profile: 'fastly' }).providerConfig.bindings);
  write(path.join(directory, 'recipes.json'), recipes);
}

function generate(directory, target, output) {
  const start = probe.snapshot();
  const plan = read(path.join(directory, 'plan.json'));
  const options = { cwd: path.join(directory, 'project'), canonicalBuild: true,
    bindings: read(path.join(directory, 'bindings.json')) };
  const generator = target === 'node'
    ? require('../../../packages/runtime-core-as/src/compiler/canonical-native').generateCanonicalNativeAssemblyScript
    : require('../../../../packages/provider-fastly/src/build/native-platform-capabilities').generateFastlyNativePlatformCapabilitiesAssemblyScript;
  const before = probe.snapshot();
  const generated = generator(plan, options);
  const after = probe.snapshot();
  assert.equal(sha(generated.source), read(path.join(directory, 'recipes.json'))[target].sourceSha256,
    'isolated source generation exactly matches production');
  write(output, { pid: process.pid, setup: probe.interval(start, before), generation: probe.interval(before, after),
    sourceBytes: Buffer.byteLength(generated.source), sourceSha256: sha(generated.source) });
}

async function profile(directory, target, output) {
  const start = probe.snapshot(), recorder = probe.createRecorder();
  // A thread can sample process-wide RSS while ASC/Binaryen block the main
  // event loop. Keep its memory/CPU overhead visible through paired controls.
  const sampler = new Worker(`const {parentPort}=require('node:worker_threads');
    const samples=[];const sample=()=>samples.push([performance.now(),process.memoryUsage.rss()]);
    sample();const timer=setInterval(sample,5);parentPort.postMessage('ready');
    parentPort.once('message',()=>{clearInterval(timer);sample();parentPort.postMessage(samples)});`, { eval: true });
  await new Promise((resolve, reject) => { sampler.once('message', resolve); sampler.once('error', reject); });
  try {
    recorder.record('sampler-setup', probe.interval(start));
    const loadStart = probe.snapshot();
    const tool = asc();
    assert.equal(require(path.join(tool.packageRoot, 'package.json')).version, '0.28.18', 'review Stats boundaries on ASC upgrade');
    const api = await import(pathToFileURL(path.join(tool.packageRoot, 'dist/asc.js')).href);
    recorder.record('compiler-load', probe.interval(loadStart));
    const recipe = read(path.join(directory, 'recipes.json'))[target];
    const args = recipe.args.map(arg => arg === retentionPath ? probePath : arg);
    assert.equal(args.filter(arg => arg === probePath).length, 1);
    process.chdir(path.join(directory, target));
    const stats = probe.instrumentStats(new api.Stats(), recorder);
    const result = await api.main(args, { stats, stdout: process.stdout, stderr: process.stderr });
    assert.ok(!result.error, result.error?.stack);
    const end = probe.snapshot();
    assert.ok(recorder.lastEmitEnd, 'emission boundary must be observed');
    recorder.record('asc-finalization', probe.interval(recorder.lastEmitEnd, end));
    const samples = await new Promise((resolve, reject) => {
      sampler.once('message', resolve); sampler.once('error', reject); sampler.postMessage('stop');
    });
    for (const phase of ['asc-parse', 'asc-initialize', 'asc-compile', 'retention-total', 'asc-optimize',
      'binaryen-default-optimization', 'binaryen-post-passes', 'asc-emit', 'asc-finalization'])
      assert.ok(recorder.phases.has(phase), 'missing phase ' + phase);
    const phases = [...recorder.phases.values()];
    for (const phase of phases) {
      const windows = recorder.windows.filter(w => w.phase === phase.phase);
      const observed = samples.filter(([time]) => windows.some(w => time >= w.start && time <= w.end));
      phase.rssSamples = observed.length;
      phase.sampledPeakRssBytes = observed.length ? Math.max(...observed.map(row => row[1])) : null;
      assert.ok(phase.wallMs >= 0 && phase.userCpuMs >= 0 && phase.systemCpuMs >= 0, 'monotonic phase metrics');
    }
    for (const name of ['asc-parse', 'asc-compile', 'binaryen-default-optimization'])
      assert.ok(recorder.phases.get(name).rssSamples > 0, name + ': RSS sampler must observe the phase');
    assert.equal(recorder.groups.filter(row => row.phase === 'binaryen-post-passes').length, 1,
      'default-optimization attribution assumes one trailing runPasses call');
    const retention = recorder.phases.get('retention-total'), passes = recorder.phases.get('retention-no-inline-passes');
    write(output, { pid: process.pid, actualArgv: args, total: probe.interval(start, end), phases,
      sampling: { method: '5ms same-process worker thread; process.memoryUsage.rss()',
        samples: samples.length, sampledPeakRssBytes: Math.max(...samples.map(row => row[1])),
        maximumGapMs: Math.max(...samples.slice(1).map((row, i) => row[0] - samples[i][0])) },
      selectedNames: recorder.selectedNames, retentionGroups: recorder.groups,
      derivedTiming: {
        // Nested spans: subtraction gives time only, never a phase-specific RSS.
        retentionGroupingAndWrapperWallMs: retention.wallMs - (passes?.wallMs || 0)
      }, wasmSha256: sha(fs.readFileSync('module.wasm')) });
  } finally { await sampler.terminate(); }
}

async function main() {
  assert.equal(process.platform, 'linux', 'resourceUsage.maxRSS conversion assumes Linux KiB');
  const directory = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-o03-'));
  const reportDir = path.join(root, 'wasm/.test-results/compiler-efficiency/o03'); fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'measurements.json');
  try {
    run([__filename, '--prepare', directory]);
    const recipes = read(path.join(directory, 'recipes.json'));
    // The CLI normally respawns for source maps. Enable them explicitly so this
    // preload belongs to the actual compiler, with no launcher overwrite.
    const usageHook = path.join(directory, 'usage.cjs');
    fs.writeFileSync(usageHook, `const p=require(${JSON.stringify(probePath)});const start=p.snapshot();process.once('exit',code=>require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'control.json'))},JSON.stringify({pid:process.pid,argv:process.argv,exitCode:code,total:p.interval(start)})));\n`);
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const target of ['node', 'fastly']) {
      const recipe = recipes[target], targetDir = path.join(directory, target);
      const generationFile = path.join(directory, 'generation.json');
      run([__filename, '--generate', directory, target, generationFile]);
      const sample = { target, repeat, generation: read(generationFile) };
      for (const mode of repeat % 2 ? ['profile', 'control'] : ['control', 'profile']) {
        const output = path.join(directory, mode + '.json');
        const started = performance.now();
        const env = { ...process.env, ...recipe.env };
        if (mode === 'control') run(['--enable-source-maps', '--require', usageHook, recipe.script, ...recipe.args], { cwd: targetDir, env });
        else run(['--enable-source-maps', __filename, '--profile', directory, target, output], { env });
        sample[mode] = { ...read(output), parentWallMs: performance.now() - started };
        assert.ok(sample[mode].total.processPeakAfterBytes > 0, 'actual child RSS must be available');
        const hash = sha(fs.readFileSync(path.join(targetDir, 'module.wasm')));
        assert.equal(hash, recipe.wasmSha256, `${target}/${repeat}/${mode}: exact production Wasm parity`);
        sample[mode].wasmSha256 = hash;
      }
      samples.push(sample);
      console.log(JSON.stringify({ target, repeat, status: 'passed', compilerPeakRssBytes: sample.profile.total.processPeakAfterBytes }));
    }
    const tool = asc();
    const report = { schemaVersion: 'pulse.compiler-efficiency-o03.v1', status: 'passed',
      sourceRevision: child.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTree: child.execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
      assemblyScript: require(path.join(tool.packageRoot, 'package.json')).version,
      repeats: 3, order: 'serial; control/profile order alternates by repeat',
      identities: Object.fromEntries(['pnpm-lock.yaml', path.relative(root, __filename), path.relative(root, probePath),
        path.relative(root, retentionPath), path.relative(root, tool.packageRoot + '/dist/asc.js'),
        'wasm/test/runtime/compiler-efficiency/p02-memory-trace.cjs']
        .map(file => [file, sha(fs.readFileSync(path.join(root, file)))])),
      fixtureSourceSha256: sha(['src/index.ts', 'src/schemas.ts', 'src/types.ts', '.pulse/config.ts']
        .map(file => fs.readFileSync(path.join(root, 'wasm/test/fixtures/projects/compiler-efficiency-memory', file))).join('')),
      recipes, samples, limitations: [
        'Generic O-01 fixture only; no claim about a larger application or guest memory.',
        'resourceUsage peak RSS is process lifetime high-water. A rise localizes a new peak; if it does not rise, the interval peak is unknown. RSS is not additive or exclusive memory owned by a phase.',
        'The profiling child includes a 5ms RSS sampling thread. Sampled peaks are lower bounds; short phases may have zero samples (null peak). CPU totals include the sampler and all compiler threads.',
        'ASC compile is lowering to Binaryen IR. Parse excludes parser work inside json-as transforms, which is included in ASC transform time.',
        'ASC optimize includes default Binaryen optimization plus post-passes. Default optimization ends at the first post-pass call. Retention/post-pass spans overlap ASC transform/optimize totals; never sum nested rows. Finalization follows emission and includes output I/O and module disposal.',
        'Checkpoints add overhead. Profile and control artifacts match byte-for-byte; three fresh-process pairs measure attribution, not a performance improvement.',
        'Source generation uses the same plan and public emitter in a separate process, excluding plan construction. Source hashes must match production.'
      ] };
    // Keep exact commands in local evidence; replace ephemeral roots in the
    // portable report without changing hashes or measured values.
    write(path.join(reportDir, 'measurements.raw.json'), report);
    let portableText = JSON.stringify(report);
    for (const [target, recipe] of Object.entries(recipes)) portableText = portableText.split(recipe.productionCwd).join(`<production-${target}>`);
    const portable = JSON.parse(portableText.split(directory).join('<work>').split(root).join('<repo>'));
    write(reportFile, portable);
    console.log(JSON.stringify({ status: 'passed', report: path.relative(root, reportFile), samples: samples.length }));
  } catch (error) {
    write(path.join(reportDir, 'failure.json'), { status: 'failed', error: error.stack }); throw error;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const [mode, directory, target, output] = process.argv.slice(2);
if (require.main === module) Promise.resolve().then(() => {
  if (mode === '--prepare') return prepare(directory);
  if (mode === '--generate') return generate(directory, target, output);
  if (mode === '--profile') return profile(directory, target, output);
  return main();
}).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
