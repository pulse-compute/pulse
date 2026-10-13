#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveProject } = require('../../../packages/cli/src/project-config.js');
const { buildProject } = require('../../../packages/cli/src/project-execution.js');
const { candidateIdentity } = require('../../../../scripts/release-feature-acceptance.cjs');
const { dependencies, environment } = require('../baseline.cjs');
const { qualifyAbi, hash } = require('../../support/fastly-forwarding-qualification.cjs');
const { qualifyViceroy } = require('../../support/fastly-forwarding-viceroy.cjs');
const { qualifyPair, scenarios } = require('./parity.cjs');
const cli = require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const contract = require('./contract.json');
const root = path.resolve(__dirname, '../../../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const exec = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 120000, ...options }).trim();
const digestFile = file => hash(fs.readFileSync(file));
function rustIdentity() {
  for (const key of Object.keys(process.env))
    if (/^(RUSTFLAGS|RUSTDOCFLAGS|RUSTC|RUSTUP_TOOLCHAIN|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_|CARGO_PROFILE_|CARGO_TARGET_)/.test(key))
      throw Error('Unset Rust build override ' + key);
  const rustc = exec('rustc', ['-vV']), cargo = exec('cargo', ['-V']);
  assert(rustc.includes('\nrelease: ' + contract.rust.version + '\n'), 'Expected Rust ' + contract.rust.version);
  assert(cargo.startsWith('cargo ' + contract.rust.version + ' '), 'Expected Cargo ' + contract.rust.version);
  const sysroot = exec('rustc', ['--print', 'sysroot']);
  const libs = path.join(sysroot, 'lib/rustlib', contract.rust.target, 'lib');
  const targetLibraries = Object.fromEntries(fs.readdirSync(libs).filter(n => n.endsWith('.rlib')).sort().map(n => [n, digestFile(path.join(libs, n))]));
  assert(Object.keys(targetLibraries).length > 0, 'Install the pinned wasm32 Rust target');
  return { rustc, cargo, sysroot, rustcSha256: digestFile(path.join(sysroot, 'bin/rustc')),
    cargoSha256: digestFile(path.join(sysroot, 'bin/cargo')), targetLibraries, targetLibrariesSha256: hash(JSON.stringify(targetLibraries)) };
}
function fixtureSources() {
  return Object.fromEntries(['contract.json', 'pulse.ts', 'parity.cjs', 'qualify.cjs', 'rust/abi.rs', 'rust/lib.rs',
    'rust/Cargo.toml', 'rust/Cargo.lock', 'rust/rust-toolchain.toml', '../../support/fastly-forwarding-qualification.cjs',
    '../../support/fastly-forwarding-viceroy.cjs', '../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js']
    .map(file => [file, digestFile(path.join(__dirname, file))]));
}
function artifact(file) {
  const bytes = fs.readFileSync(file), module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map(({ module, name, kind }) => ({ module, name, kind }));
  for (const [module, name] of [['fastly_http_req', 'send_async_streaming'], ['fastly_http_req', 'pending_req_poll_v2'],
    ['fastly_http_body', 'read'], ['fastly_http_body', 'write'], ['fastly_http_body', 'abandon'], ['fastly_async_io', 'select'], ['wasi_snapshot_preview1', 'clock_time_get']])
    assert(imports.some(x => x.module === module && x.name === name), 'Required forwarding import ' + module + '.' + name);
  assert(!imports.some(x => x.module === 'pulse_host' || /^(send|send_async|pending_req_wait)$/.test(x.name)), 'No alternate transport or Pulse host shim');
  return { file, sha256: hash(bytes), bytes: bytes.length, imports };
}
function pulseBuild(directory, c) {
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true }); fs.mkdirSync(path.join(directory, '.pulse'));
  fs.copyFileSync(path.join(__dirname, 'pulse.ts'), path.join(directory, 'src/index.ts'));
  write(path.join(directory, 'package.json'), { name: 'perf9-01a-pulse', private: true, type: 'module' });
  const fastly = { maxDurationMs: c.maxDurationMs, bodyForwarding: { requestMaxBytes: c.requestMaxBytes, responseMaxBytes: c.responseMaxBytes }, bindings: { backends: { [new URL(c.url).origin]: c.backend } } };
  const config = `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:${JSON.stringify(fastly)}}}));\n`;
  fs.writeFileSync(path.join(directory, '.pulse/config.ts'), config);
  const built = buildProject(resolveProject({ cwd: directory, profile: 'proof' })); assert.equal(built.status, 'built');
  const result = artifact(path.join(built.outDir, 'bin/main.wasm'));
  return { ...result, configurationSha256: hash(config), profile: 'proof', normalProviderBuild: true };
}
function rustBuild(directory, c, toolchain) {
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'lib.rs', 'abi.rs']) fs.copyFileSync(path.join(__dirname, 'rust', file), path.join(directory, file));
  const config = `const REQUEST_CAP: i32 = ${c.requestMaxBytes};\nconst RESPONSE_CAP: i32 = ${c.responseMaxBytes};\nconst TOTAL_MS: i64 = ${c.maxDurationMs};\nconst FETCH_MS: i64 = ${c.fetchTimeoutMs};\nconst URL: &[u8] = b${JSON.stringify(c.url)};\nconst BACKEND: &[u8] = b${JSON.stringify(c.backend)};\n`;
  fs.writeFileSync(path.join(directory, 'fixture.rs'), config);
  // Cargo configuration is searched from cwd upwards, even with --manifest-path.
  // Isolated CARGO_HOME plus checked ancestors prevents ambient build overrides.
  for (let dir = directory; ; dir = path.dirname(dir)) {
    for (const name of ['config', 'config.toml']) assert(!fs.existsSync(path.join(dir, '.cargo', name)), 'Cargo configuration override at ' + dir);
    if (dir === path.dirname(dir)) break;
  }
  const env = { ...process.env, CARGO_HOME: path.join(directory, 'cargo-home'), RUSTC: path.join(toolchain.sysroot, 'bin/rustc') };
  const command = ['build', '--release', '--locked', '--offline', '-j1', '--target', c.rust.target, '--target-dir', path.join(directory, 'target')];
  const log = execFileSync(path.join(toolchain.sysroot, 'bin/cargo'), command, { cwd: directory, env, timeout: 120000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(directory, 'build.stdout.log'), log);
  return { ...artifact(path.join(directory, 'target', c.rust.target, 'release/pulse_perf9_forwarding.wasm')), configurationSha256: hash(config), command, configuration: c.rust, noDependencies: true };
}
function validate(report) {
  assert.equal(report.schemaVersion, 'pulse.perf9-01a-parity.v1'); assert.equal(report.status, 'passed');
  assert.deepEqual(report.contract, contract); assert.deepEqual(report.sources, fixtureSources());
  assert.equal(report.source.workingTree, ''); assert.match(report.source.sourceRevision, /^[a-f0-9]{40}$/);
  assert.equal(report.cells.length, contract.variants.length);
  for (const [index, cell] of report.cells.entries()) {
    const c = { ...contract, ...contract.variants[index] }; assert.equal(cell.id, c.id);
    for (const name of ['pulse', 'rust']) {
      const a = cell[name]; assert.deepEqual(artifact(a.file), { file: a.file, sha256: a.sha256, bytes: a.bytes, imports: a.imports });
      assert.equal(a.abi.status, 'passed'); assert.equal(a.abi.wasmSha256, a.sha256);
      assert.equal(a.abi.cases.length, index === 1 ? 88 : 90);
    }
    assert.deepEqual(cell.pulse.abi.cases, cell.rust.abi.cases);
    assert.deepEqual(cell.parity.map(x => x.name), scenarios(c).map(x => x.name));
    for (const row of cell.parity) { assert.equal(row.status, 'passed'); assert.deepEqual(row.pulse, row.rust); }
  }
  const cell = report.cells[0];
  for (const name of ['pulse', 'rust']) {
    assert.equal(cell[name].wire.status, 'passed'); assert.equal(cell[name].wire.wasmSha256, cell[name].sha256);
    assert.equal(cell[name].wire.engine, contract.viceroyVersion); assert.equal(cell[name].wire.engineSha256, report.viceroy.sha256);
    assert.equal(cell[name].wire.cases.length, 19); assert.equal(report.rebuild[name].sha256, cell[name].sha256);
  }
  assert.deepEqual(cell.pulse.wire.cases, cell.rust.wire.cases);
  assert.equal(report.performanceMeasured, false); assert.equal(report.liveFastly, false);
  return report;
}
async function qualify() {
  const parent = path.join(root, 'wasm/.test-results'); fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'perf9-01a-')), output = path.join(directory, 'parity.json');
  const report = { schemaVersion: 'pulse.perf9-01a-parity.v1', status: 'running', contract, cells: [],
    performanceMeasured: false, liveFastly: false, createdAt: new Date().toISOString(), output };
  // Keep each report/artifact, including failures. Build files stay under the
  // ignored results root; the committed source must stay unchanged throughout.
  const persist = () => { write(output + '.tmp', report); fs.renameSync(output + '.tmp', output); };
  console.log('PERF9-01A report: ' + output);
  try {
    report.source = candidateIdentity(root); report.sources = fixtureSources(); report.dependencies = dependencies();
    report.environment = environment(); report.rust = rustIdentity();
    const launcher = cli.inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
    assert.equal(launcher.inspection.version, contract.viceroyVersion);
    report.viceroy = { version: launcher.inspection.version, sha256: digestFile(launcher.inspection.binary) }; persist();
    for (const variant of contract.variants) {
      const c = { ...contract, ...variant }, cell = { id: variant.id }; report.cells.push(cell); persist();
      cell.pulse = pulseBuild(path.join(directory, variant.id + '-pulse'), c); persist();
      cell.rust = rustBuild(path.join(directory, variant.id + '-rust'), c, report.rust); persist();
      for (const name of ['pulse', 'rust']) {
        cell[name].abi = qualifyAbi(fs.readFileSync(cell[name].file), { requestCap: c.requestMaxBytes, responseCap: c.responseMaxBytes, deadline: Math.min(c.maxDurationMs, c.fetchTimeoutMs) });
        if (name === 'rust') {
          // Shared oracle labels Pulse's 128-byte output area, not Rust's locals.
          delete cell[name].abi.metadataScratchBytes;
          cell[name].abi.rawMetadataStorageBytes = 16384 + 64 * 16;
          cell[name].abi.abiOutputStorage = 'Rust stack locals; not included in rawMetadataStorageBytes';
        }
        persist();
        console.log(variant.id + ' ' + name + ': ' + cell[name].abi.cases.length + ' ABI cases passed');
      }
      cell.parity = qualifyPair(fs.readFileSync(cell.pulse.file), fs.readFileSync(cell.rust.file), c); persist();
      if (variant.id === 'default') for (const name of ['pulse', 'rust']) {
        const wireDir = path.join(directory, name + '-wire'); fs.mkdirSync(wireDir);
        cell[name].wire = await qualifyViceroy(cell[name].file, wireDir); persist();
        console.log(name + ': ' + cell[name].wire.cases.length + ' Viceroy cases passed');
      }
    }
    report.rebuild = { pulse: pulseBuild(path.join(directory, 'rebuild-pulse'), contract), rust: rustBuild(path.join(directory, 'rebuild-rust'), contract, report.rust) };
    assert.deepEqual(candidateIdentity(root), report.source); assert.deepEqual(fixtureSources(), report.sources);
    assert.deepEqual(dependencies(), report.dependencies); assert.deepEqual(rustIdentity(), report.rust);
    assert.equal(digestFile(launcher.inspection.binary), report.viceroy.sha256);
    report.status = 'passed'; validate(report);
    console.log('ok - PERF9-01A pinned artifacts, paired ABI/wire qualification and deterministic rebuilds');
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); throw error; }
  finally { report.completedAt = new Date().toISOString(); persist(); }
  return report;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--check') { validate(read(path.resolve(args[1]))); console.log('ok - PERF9-01A report and retained artifacts'); }
  else { assert.equal(args.length, 0, 'Usage: qualify.cjs [--check report.json]'); qualify().catch(error => { console.error(error); process.exitCode = 1; }); }
}
module.exports = { qualify, validate, artifact, rustIdentity, pulseBuild, rustBuild };
