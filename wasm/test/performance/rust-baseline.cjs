#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { perf8Fixtures } = require('./fixtures.cjs');
const { prepareProject, dependencies, environment, perf8Protocol } = require('./baseline.cjs');
const { prepareRust } = require('./rust-fixtures.cjs');
const { hash, statistics } = require('./report.cjs');
const { runCommand } = require('../../../scripts/release-process.cjs');
const { atomicJson } = require('../../../scripts/release-recovery.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const protocol = Object.freeze({ version: 'pulse.rust-comparison-protocol.v1', buildSamples: 3, runtimeWorkers: 3,
  runtime: perf8Protocol, order: 'Per fixture: alternate Pulse/Rust, reversing each sample; all behavior preflights before measurements',
  rustTarget: 'wasm32-unknown-unknown', rustBuild: 'cargo release --locked --offline -j1; empty target directory including dependencies',
  buildBoundary: 'Pulse: existing CLI build timer, including report production. Rust: Python startup + Cargo command, including Rust dependencies; excludes fixture/plan preparation. These are different build workflows, not isolated compiler throughput.',
  compilerRssBoundary: 'Pulse: maximum individual ASC process RSS. Rust: Linux wait4 Cargo/descendant high-water RSS, not simultaneous process-tree RSS. Boundaries differ; no compiler-RSS ratio.',
  support: 'Same Pulse plan, Node provider and host lifecycle. Rust ABI/UTF-16 glue and serde codecs included in Wasm. Plan preparation uses an untimed Pulse preflight build. No Rust standalone server or product backend.',
  threshold: 'Descriptive only; no significance or regression gate' });
function exec(command, args) {
  const result = child.spawnSync(command, args, { encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, command + ': ' + (result.error?.message || result.stderr));
  return result.stdout.trim();
}
function rustIdentity() {
  assert.equal(process.platform, 'linux', 'Rust build RSS receipt requires Linux wait4');
  for (const key of Object.keys(process.env)) if (/^(RUSTFLAGS|RUSTDOCFLAGS|RUSTC|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_|CARGO_PROFILE_|CARGO_TARGET_)/.test(key)) throw Error('Unset Rust build override ' + key);
  const configDirectories = [process.env.CARGO_HOME || path.join(require('node:os').homedir(), '.cargo')];
  for (let directory = root; ; directory = path.dirname(directory)) {
    configDirectories.push(path.join(directory, '.cargo'));
    if (directory === path.dirname(directory)) break;
  }
  for (const directory of configDirectories) for (const name of ['config', 'config.toml']) assert(!fs.existsSync(path.join(directory, name)), 'Cargo config overrides are not admitted: ' + path.join(directory, name));
  const sysroot = exec('rustc', ['--print', 'sysroot']);
  const libs = path.join(sysroot, 'lib/rustlib/wasm32-unknown-unknown/lib');
  const libraryHashes = fs.readdirSync(libs).filter(name => name.endsWith('.rlib')).sort().map(name => [name, hash(fs.readFileSync(path.join(libs, name)))]);
  assert(libraryHashes.length, 'Install the wasm32-unknown-unknown Rust target');
  return { rustc: exec('rustc', ['-vV']), cargo: exec('cargo', ['-V']),
    rustcSha256: hash(fs.readFileSync(path.join(sysroot, 'bin/rustc'))), cargoSha256: hash(fs.readFileSync(path.join(sysroot, 'bin/cargo'))),
    targetLibrariesSha256: hash(JSON.stringify(libraryHashes)), manifestSha256: hash(fs.readFileSync(path.join(__dirname, 'rust/Cargo.toml'))),
    lockfileSha256: hash(fs.readFileSync(path.join(__dirname, 'rust/Cargo.lock'))) };
}
function rustBuild(project, fixture, name, resultFile) {
  const target = path.join(project, 'builds', name), outDir = path.join(project, 'outputs', name);
  assert(!fs.existsSync(target) && !fs.existsSync(outDir), 'Rust build must start empty');
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['build', '--release', '--locked', '--offline', '-j1', '--target', protocol.rustTarget,
    '--target-dir', target, '--manifest-path', path.join(project, 'Cargo.toml'), ...(fixture.schema ? ['--features', 'schemas'] : [])];
  const started = performance.now();
  exec('python3', [path.join(__dirname, 'rust-build.py'), resultFile + '.usage', 'cargo', ...args]);
  const buildMs = performance.now() - started;
  const usage = read(resultFile + '.usage'); assert.equal(usage.exitCode, 0); assert(usage.peakRssBytes > 0);
  const bytes = fs.readFileSync(path.join(target, protocol.rustTarget, 'release/pulse_perf8_rust.wasm'));
  fs.writeFileSync(path.join(outDir, 'rust.wasm'), bytes);
  fs.copyFileSync(path.join(project, 'plan.json'), path.join(outDir, 'plan.json'));
  write(path.join(outDir, 'pulse-build.json'), { portable: { wasm: { file: 'rust.wasm' }, plan: 'plan.json' } });
  write(resultFile, { buildMs, compilerCommandMs: usage.elapsedMs, compilerPeakRssBytes: usage.peakRssBytes,
    artifactBytes: bytes.length, artifactSha256: hash(bytes), outDir,
    settings: { target: protocol.rustTarget, release: { optLevel: 3, lto: 'thin', codegenUnits: 1, panic: 'abort', strip: 'symbols' },
      features: fixture.schema ? ['schemas'] : [], jobs: 1, locked: true, offline: true, freshDependencyBuild: true } });
}
const runtimeNames = ['coldLoadMs', 'firstRequestMs', 'warmRequestMs', 'firstRequestCpuUserUs', 'firstRequestCpuSystemUs', 'warmRequestCpuUserUs', 'warmRequestCpuSystemUs', 'runtimePeakRssBytes'];
function summarize(builds, runtimes) {
  return Object.fromEntries([
    ...['buildMs', 'compilerPeakRssBytes', 'artifactBytes'].map(name => [name, statistics(builds.map(row => row[name]))]),
    ...runtimeNames.map(name => [name, statistics(runtimes.flatMap(row => row[name]), runtimes.length ? 'Runtime process RSS unavailable' : 'Compile-only fixture')])]);
}
function comparisons(cells) {
  return perf8Fixtures.map(f => {
    const pulse = cells.find(c => c.fixture.id === f.id && c.implementation === 'pulse'), rust = cells.find(c => c.fixture.id === f.id && c.implementation === 'rust');
    return { fixture: f.id, metrics: Object.fromEntries(Object.keys(pulse.metrics).map(name => {
      const a = pulse.metrics[name], b = rust.metrics[name];
      const measured = a.status === 'measured' && b.status === 'measured';
      return [name, { pulse: a, rust: b, unit: name.endsWith('Bytes') ? 'bytes' : name.endsWith('Us') ? 'microseconds' : 'milliseconds',
        ...(name === 'compilerPeakRssBytes' ? { status: 'different-boundaries', reason: protocol.compilerRssBoundary }
          : measured ? { status: 'observed', rustMinusPulseMedian: b.p50 - a.p50, rustVsPulsePercent: a.p50 === 0 ? null : 100 * (b.p50 / a.p50 - 1) }
            : { status: 'unavailable' }) }];
    })) };
  });
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.rust-comparison.v1'); assert.equal(report.status, 'passed');
  assert.equal(report.source.workingTree, ''); assert.deepEqual(report.protocol, protocol);
  for (const key of ['sourceRevision', 'sourceTree']) assert.match(report.source[key], /^[a-f0-9]{40}$/);
  for (const key of ['rustcSha256', 'cargoSha256', 'targetLibrariesSha256', 'manifestSha256', 'lockfileSha256']) assert.match(report.rust[key], /^[a-f0-9]{64}$/);
  assert(report.environment.node && report.dependencies.lockfileSha256);
  assert.equal(report.validation.length, 4); assert.equal(report.cells.length, 8);
  for (const f of perf8Fixtures) {
    const behavior = report.validation.filter(v => v.fixture === f.id); assert.equal(behavior.length, 1); assert.equal(behavior[0].status, 'passed');
    assert.equal(behavior[0].cases, require('./rust-behavior.cjs').cases(f).length);
    assert.equal(behavior[0].results.length, behavior[0].cases); assert(behavior[0].results.every(r => r.status === 'passed'));
    const behaviorCases = require('./rust-behavior.cjs').cases(f);
    behavior[0].results.forEach((row, index) => {
      assert.equal(row.name, behaviorCases[index].name);
      require('./rust-behavior.cjs').assertParity(row.pulse, row.rust, behaviorCases[index], f);
      if (!behaviorCases[index].reject) assert.equal(row.wireBodyEqual, row.pulse.response.body === row.rust.response.body);
    });
    for (const implementation of ['pulse', 'rust']) {
      const matches = report.cells.filter(c => c.fixture.id === f.id && c.implementation === implementation); assert.equal(matches.length, 1);
      const c = matches[0]; assert.equal(c.fixture.sha256, hash(JSON.stringify(f)));
      assert.equal(c.buildSamples.length, 3); assert.equal(c.runtimeSamples.length, f.runtime === false ? 0 : 3);
      for (const b of c.buildSamples) { assert.match(b.artifactSha256, /^[a-f0-9]{64}$/); assert(b.artifactBytes > 0); assert.deepEqual(b.settings, c.buildSamples[0].settings); }
      for (const r of c.runtimeSamples) {
        for (const name of ['warmRequestMs', 'warmRequestCpuUserUs', 'warmRequestCpuSystemUs']) assert.equal(r[name].length, 30);
        for (const phase of ['beforeLoad', 'afterLoad', 'afterFirst', 'afterWarmup', 'afterWarm']) for (const name of ['rss','heapTotal','heapUsed','external','arrayBuffers']) assert(Number.isSafeInteger(r.memory[phase][name]) && r.memory[phase][name] >= 0);
      }
      assert.deepEqual(c.metrics, summarize(c.buildSamples, c.runtimeSamples));
      assert.deepEqual(c.warmWorkerMedians, statistics(c.runtimeSamples.map(r => statistics(r.warmRequestMs).p50), 'Compile-only fixture'));
      assert.equal(new Set(c.buildSamples.map(b => b.artifactSha256)).size, 1, 'Non-deterministic artifacts');
    }
  }
  assert.deepEqual(report.comparisons, comparisons(report.cells));
  return report;
}
async function campaign(output) {
  assert(!fs.existsSync(output) && !fs.existsSync(output + '.log'), 'Choose a new output filename');
  const source = candidateIdentity(root); assert.equal(source.workingTree, '', 'Commit source before measuring');
  const rust = rustIdentity(), deps = dependencies();
  const report = { schemaVersion: 'pulse.rust-comparison.v1', status: 'running', source, environment: environment(),
    dependencies: deps, rust, protocol, validation: [], cells: [], createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.closeSync(fs.openSync(output + '.log', 'wx'));
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/perf803-'));
  const controller = new AbortController(), onInt = () => controller.abort('SIGINT'), onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const started = performance.now(), persist = () => atomicJson(output, report), prepared = [];
  async function worker(script, args, file) {
    const result = await runCommand(process.execPath, [script, ...args], { cwd: root, signal: controller.signal,
      timeoutMs: 180000, termGraceMs: 1000, killGraceMs: 1000, onOutput(_stream, chunk) { fs.appendFileSync(output + '.log', chunk); } });
    assert(result.status === 0 && !result.error && !result.timedOut && !result.interruptedBy, 'Worker failed: ' + JSON.stringify(result) + '; see ' + output + '.log');
    return read(file);
  }
  const baselineFile = path.join(__dirname, 'baseline.cjs');
  const pulseBuild = (project, name, receipt) => worker(baselineFile, ['--worker', 'build', project, name, receipt, 'beta8'], receipt);
  const buildRust = (project, f, name, receipt) => worker(__filename, ['--rust-build', project, f.id, name, receipt], receipt);
  const runtime = (built, f, receipt) => worker(baselineFile, ['--worker', 'runtime', built.outDir, f.id, 'native', 'measure', receipt, 'beta8'], receipt);
  try {
    persist();
    for (const f of perf8Fixtures) {
      const project = path.join(directory, f.id), rustProject = project + '-rust';
      prepareProject(project, f, 'native');
      const built = await pulseBuild(project, 'preflight', project + '-preflight.json');
      const manifest = read(path.join(built.outDir, 'pulse-build.json')), planFile = path.join(built.outDir, manifest.portable.plan);
      const plan = read(planFile); prepareRust(rustProject, f, plan); fs.copyFileSync(planFile, path.join(rustProject, 'plan.json'));
      const rustBuilt = await buildRust(rustProject, f, 'preflight', rustProject + '-preflight.json');
      const receipt = project + '-behavior.json';
      report.validation.push(await worker(__filename, ['--behavior', built.outDir, rustBuilt.outDir, f.id, receipt], receipt));
      prepared.push({ f, project, rustProject, planBytes: fs.statSync(planFile).size, planSha256: hash(fs.readFileSync(planFile)), preflight: { pulse: built.artifactSha256, rust: rustBuilt.artifactSha256 } });
      persist(); console.log('Behavior passed: ' + f.id);
    }
    for (const { f, project, rustProject, planBytes, planSha256, preflight } of prepared) {
      const builds = { pulse: [], rust: [] }, runtimes = { pulse: [], rust: [] };
      console.log('Measuring pair: ' + f.id);
      for (let n = 0; n < 3; n++) for (const implementation of n % 2 ? ['rust', 'pulse'] : ['pulse', 'rust']) {
        const receipt = path.join(directory, f.id + '-' + implementation + '-build-' + n + '.json');
        const b = implementation === 'pulse' ? await pulseBuild(project, 'sample-' + n, receipt) : await buildRust(rustProject, f, 'sample-' + n, receipt);
        assert.equal(b.artifactSha256, preflight[implementation], 'Measured artifact differs from behavior preflight'); builds[implementation].push(b);
      }
      if (f.runtime !== false) for (let n = 0; n < 3; n++) for (const implementation of n % 2 ? ['rust', 'pulse'] : ['pulse', 'rust']) {
        const receipt = path.join(directory, f.id + '-' + implementation + '-runtime-' + n + '.json');
        runtimes[implementation].push(await runtime(builds[implementation].at(-1), f, receipt));
      }
      for (const implementation of ['pulse', 'rust']) report.cells.push({ fixture: { id: f.id, sha256: hash(JSON.stringify(f)) }, implementation,
        support: { planBytes, planSha256, host: 'unchanged Pulse Node canonical Native host; dependencies excluded from artifact bytes' },
        buildSamples: builds[implementation].map(({ outDir, ...sample }) => sample), runtimeSamples: runtimes[implementation],
        metrics: summarize(builds[implementation], runtimes[implementation]),
        warmWorkerMedians: statistics(runtimes[implementation].map(r => statistics(r.warmRequestMs).p50), 'Compile-only fixture') });
      persist();
    }
    assert.deepEqual(candidateIdentity(root), source); assert.deepEqual(dependencies(), deps); assert.deepEqual(rustIdentity(), rust);
    report.comparisons = comparisons(report.cells); report.status = 'passed'; validate(report);
  } catch (error) { report.status = controller.signal.aborted ? 'interrupted' : 'failed'; report.error = error.message; throw error; }
  finally { fs.rmSync(directory, { recursive: true, force: true }); report.elapsedMs = performance.now() - started; report.completedAt = new Date().toISOString(); persist(); process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
  console.log('Saved ' + output + ' (4 behavior pairs, 8 measured cells)');
}
async function main(args) {
  if (args[0] === '--rust-build') { assert.equal(args.length, 5); return rustBuild(args[1], perf8Fixtures.find(f => f.id === args[2]), args[3], args[4]); }
  if (args[0] === '--behavior') { assert.equal(args.length, 5); return write(args[4], await require('./rust-behavior.cjs').verifyBehavior(args[1], args[2], perf8Fixtures.find(f => f.id === args[3]))); }
  if (args[0] === '--check') { assert.equal(args.length, 2); validate(read(args[1])); console.log('ok - Rust comparison report'); return; }
  assert.equal(args[0], '--out'); assert.equal(args.length, 2); await campaign(path.resolve(args[1]));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { protocol, summarize, comparisons, validate, prepareRust, rustIdentity };
