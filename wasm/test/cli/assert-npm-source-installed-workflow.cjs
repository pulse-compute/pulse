#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const { verifyClosure } = require('../release/assert-request-deadline-packages.cjs');
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');

const repo = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-npm-installed-'));
const consumer = path.join(temporary, 'consumer');
const packages = path.join(temporary, 'packages');
const name = '@fixture/tick';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (root, file, text) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const resultRoot = path.join(repo, 'wasm/.test-results');
fs.mkdirSync(resultRoot, { recursive: true });
const reportFile = installedAcceptanceReport(path.join(fs.mkdtempSync(path.join(resultRoot, 'npm-source-')), 'acceptance.json'));
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const report = {
  version: 'pulse.npm-source-installed-acceptance.v1', status: 'running',
  source: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  workingTree: git(['status', '--porcelain']), workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: repo })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)), node: process.version,
  startedAt: new Date().toISOString(), providerRealityValidated: false, commands: [], cells: []
};
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0',
  npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const clean = value => value.replaceAll(temporary, '<acceptance>').replaceAll(repo, '<checkout>');
function save() { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); }
function run(command, args, { cwd = consumer, expected = 0, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure;
    const stop = message => {
      failure ||= message;
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => stop('command timeout'), timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length + stderr.length > 8 * 1024 * 1024) stop('output limit'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stdout.length + stderr.length > 8 * 1024 * 1024) stop('output limit'); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      report.commands.push({ command: path.basename(command), args: args.map(clean), code, signal }); save();
      if (failure || signal || code !== expected) reject(new Error(clean(`${failure || 'command failed'} (${code}): ${args.join(' ')}\n${stdout}\n${stderr}`)));
      else resolve({ stdout, stderr });
    });
  });
}

const entry = `import {Pulse} from '@pulse-compute/pulse';
import {tickHandler,middleware} from '@fixture/tick/worker';
import {lookup} from '@fixture/tick/helper';
const app=new Pulse({auto:true});
app.use(middleware);app.post('/tick',tickHandler);
app.get('/lookup',async(ctx)=>{const value=await lookup(ctx,ctx.req.header('x-input')||'');return ctx.text(ctx.state.get('prefix')+':'+value);});
export default app;
`;

async function packFixture(version, pulseVersion, unsupported = false) {
  const root = path.join(temporary, 'authored-' + version);
  write(root, 'package.json', JSON.stringify({ name, version, type: 'module',
    files: ['*.js', '*.ts', 'compiler.cjs'], exports: { './worker': './worker.js', './helper': './helper.ts' },
    dependencies: { '@pulse-compute/crypto': pulseVersion },
    pulsewasm: { manifest: './compiler.cjs' }, pulse: { contract: './compiler.cjs' }
  }));
  write(root, 'worker.js', `export {tickHandler,middleware} from './handlers.js';`);
  write(root, 'handlers.js', `import {crypto} from '@pulse-compute/crypto';
export async function middleware(ctx,next){
 const value=await crypto.digestText(ctx,'middleware');
 if(value.status!=='ok')return ctx.text('digest failed',{status:503});
 ctx.state.set('prefix',''+value.sha256);return next();
}
export async function tickHandler(ctx){
 const value=await crypto.digestText(ctx,'route');
 if(value.status!=='ok')return ctx.text('digest failed',{status:503});
 return ctx.text('${version}:'+ctx.state.get('prefix')+':'+value.sha256,{status:202});
}
${unsupported ? "globalThis.__PULSE_NPM_SOURCE_EXECUTED=true;" : ''}`);
  write(root, 'helper.ts', `import {crypto} from '@pulse-compute/crypto';
export async function lookup(ctx,input:string){
 const remote=await ctx.fetch('https://source.test/value').text();
 const first=await crypto.digestText(ctx,input+remote);
 if(first.status!=='ok')return 'digest failed';
 const second=await crypto.digestText(ctx,first.sha256);
 if(second.status!=='ok')return 'digest failed';
 return '${version}:'+second.sha256;
}`);
  // Executable third-party metadata must not run during compilation.
  write(root, 'compiler.cjs', "require('node:fs').writeFileSync('plugin-executed','bad');throw new Error('third-party compiler executed');");
  const packed = JSON.parse((await run('npm', ['pack', '--ignore-scripts', '--json'], { cwd: root })).stdout);
  return path.join(root, packed[0].filename);
}

function verifyFixture(tarball, version, catalog) {
  const root = path.join(consumer, 'node_modules', name);
  assert.equal(fs.realpathSync(root), root, 'dependency is installed, not linked');
  assert.equal(json(path.join(root, 'package.json')).version, version);
  for (const [file, bytes] of readTarEntries(tarball)) {
    const installed = path.join(root, file.slice('package/'.length));
    assert.equal(fs.realpathSync(installed), installed);
    assert.deepEqual(fs.readFileSync(installed), bytes, file);
  }
  const lock = json(path.join(consumer, 'package-lock.json'));
  const record = catalog.records.find(row => row.name === name && row.version === version);
  assert.equal(lock.packages[''].dependencies[name], version, 'consumer pins an exact version');
  assert.equal(lock.packages['node_modules/' + name].version, version);
  assert.equal(lock.packages['node_modules/' + name].integrity, record.integrity);
  assert.equal(fs.existsSync(path.join(consumer, 'plugin-executed')), false);
  return { version, sha256: hash(fs.readFileSync(tarball)), integrity: record.integrity };
}

async function main() {
  let registry;
  try {
    assert.ok(!consumer.startsWith(repo + path.sep));
    console.log('IMP9-02: pack candidate and independent dependency versions');
    const packed = packRelease({ repoRoot: repo, outDir: packages });
    report.packages = packed.manifest.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 }));
    const versions = ['1.0.0', '1.0.1', '1.0.2'];
    const fixtures = [];
    for (const version of versions) fixtures.push(await packFixture(version, packed.manifest.releaseVersion, version === '1.0.2'));
    const catalog = catalogFromTarballs([...packed.manifest.packages.map(row => path.join(packages, row.tarball)), ...fixtures]);
    registry = createReadOnlyRegistry(catalog);
    await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
    write(consumer, '.npmrc', `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\n@fixture:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    write(consumer, 'package.json', JSON.stringify({ name: 'independent-consumer', private: true,
      dependencies: { ...Object.fromEntries(packed.manifest.packages.map(row => [row.name, row.version])), [name]: versions[0] } }));
    write(consumer, 'src/index.ts', entry);
    const config = { pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', strict: false, crypto: ['SHA-256'] } };
    for (const host of ['node', 'fastly']) config[host] = { host, target: 'native', outDir: 'dist-' + host,
      ...(host === 'fastly' ? { fastly: { bindings: { backends: { 'https://source.test': 'source_backend' }, dynamicBackends: false } } } : {}) };
    for (const host of ['node', 'fastly']) config[host + '-denied'] = { ...config[host], crypto: [] };
    write(consumer, '.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const pulse = async (args, expected = 0) => {
      const result = await run(process.execPath, [cli, ...args, '--json'], { expected });
      return JSON.parse(expected ? result.stderr.trim() || result.stdout : result.stdout);
    };
    for (const [index, version] of versions.entries()) {
      console.log(`IMP9-02: install ${name}@${version}`);
      if (index === 0) await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180000 });
      else await run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', name + '@' + version], { timeout: 180000 });
      verifyClosure(consumer, packages, packed.manifest);
      const dependency = verifyFixture(fixtures[index], version, catalog);
      if (index === 2) {
        for (const host of ['node', 'fastly']) {
          const failure = await pulse(['build', '--profile', host], 3);
          assert.equal(failure.error.code, 'PULSE_NATIVE_IMPORT_UNSUPPORTED');
          assert.match(JSON.stringify(failure), /handlers\.js/);
          report.cells.push({ version, host, status: 'rejected', code: 'PULSE_NATIVE_IMPORT_UNSUPPORTED' });
        }
        break;
      }
      const prefix = hash('middleware');
      const cases = [{ name: 'imported-route', request: { method: 'POST', path: '/tick' }, expect: { status: 202, text: `${version}:${prefix}:${hash('route')}` } }];
      for (const input of ['alpha', 'different']) cases.push({ name: 'awaited-helper-' + input,
        request: { path: '/lookup', headers: { 'x-input': input } }, fetches: { 'https://source.test/value': { text: 'remote' } },
        expect: { status: 200, text: `${prefix}:${version}:${hash(hash(input + 'remote'))}` } });
      write(consumer, 'tests/pulse.harness.ts', 'export default ' + JSON.stringify({ cases }));
      if (index === 0) {
        for (const host of ['node', 'fastly']) {
          const failure = await pulse(['build', '--profile', host + '-denied'], 3);
          assert.equal(failure.error.code, 'PULSE_CRYPTO_CONFIG_REQUIRED', 'source imports cannot grant undeclared crypto authority');
          report.cells.push({ version, host: host + '-denied', status: 'rejected', code: failure.error.code });
        }
      }
      for (const host of ['node', 'fastly']) {
        console.log(`IMP9-02: ${version} ${host} Native test/build`);
        const tests = await pulse(['test', '--profile', host]);
        assert.deepEqual(tests.summary, { total: 3, passed: 3, failed: 0 });
        const built = await pulse(['build', '--profile', host]);
        assert.equal(built.status, 'built');
        const out = path.join(consumer, 'dist-' + host);
        const manifest = json(path.join(out, 'pulse-build.json'));
        assert.equal(manifest.configuredTarget, 'native');
        const wasm = fs.readFileSync(path.join(out, host === 'node' ? 'canonical-native.wasm' : 'bin/main.wasm'));
        const plan = json(path.join(out, host === 'node' ? 'canonical-native-plan.json' : 'fastly-native-plan.json'));
        const sourcePrefix = `npm/${name}@${version}/`;
        assert.ok(plan.handlers.some(row => row.source.file.startsWith(sourcePrefix) && row.source.file.endsWith('/handlers.js')), 'route attribution');
        assert.ok(plan.helpers.some(row => row.source.file.startsWith(sourcePrefix) && row.source.file.endsWith('/helper.ts')), 'helper attribution');
        assert.ok(plan.effects.some(row => row.source.file.startsWith(sourcePrefix)), 'effect attribution');
        assert.ok(plan.continuations.length >= 4, 'trusted and fetch effects retain continuation boundaries');
        for (const test of tests.cases) {
          assert.equal(test.executionEvidence.wasmSha256, hash(wasm));
          if (host === 'node') assert.equal(test.executionEvidence.automaticFallback, false);
          else assert.equal(test.executionEvidence.kind, 'fastly-native-fixture-abi');
        }
        const prior = report.cells.find(row => row.host === host);
        if (prior) { assert.notEqual(plan.planHash, prior.planHash); assert.notEqual(hash(wasm), prior.wasmSha256); }
        report.cells.push({ version, host, status: 'passed', executions: tests.summary.passed, dependency, planHash: plan.planHash, wasmSha256: hash(wasm) }); save();
      }
      verifyClosure(consumer, packages, packed.manifest);
      verifyFixture(fixtures[index], version, catalog);
    }
    assert.deepEqual(fs.readdirSync(path.join(consumer, 'src')), ['index.ts'], 'no generated source copies');
    assert.equal(fs.readFileSync(path.join(consumer, 'src/index.ts'), 'utf8'), entry, 'dependency updates require no application edits');
    assert.equal(fs.existsSync(path.join(consumer, 'plugin-executed')), false);
    verifyClosure(consumer, packages, packed.manifest);
    assert.equal(report.cells.filter(row => row.status === 'passed').length, 4);
    assert.equal(report.cells.filter(row => row.status === 'rejected').length, 4);
    assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
    report.registry = registry.requests;
    report.status = 'passed';
    console.log('ok - exact installed dependency pin/update, 12 Native executions, attribution and four explicit rejections');
  } catch (error) {
    report.status = 'failed'; report.error = clean(error.stack || String(error)); throw error;
  } finally {
    if (registry?.server.listening) await new Promise(resolve => registry.server.close(resolve));
    report.finishedAt = new Date().toISOString(); save();
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log(`acceptance report - ${reportFile}`);
  }
}
main().catch(error => { console.error(clean(error.stack || String(error))); process.exitCode = 1; });
