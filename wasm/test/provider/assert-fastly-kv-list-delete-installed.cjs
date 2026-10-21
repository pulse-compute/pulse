#!/usr/bin/env node
'use strict';
// Opt-in exact packed kv-list-delete ABI evidence on real Viceroy; never deploys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-kv-list-delete-installed-'));
const consumer = path.join(temporary, 'consumer');
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pulse-kv-list-delete-proof-' + process.pid + '-' + Date.now()));
const pack = path.join(output, 'packages');
const identity = {source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache') };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE']) delete env[key];
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', error = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut=true; try { process.platform==='win32' ? child.kill('SIGKILL') : process.kill(-child.pid,'SIGKILL'); } catch {} },180000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve(output) : reject(new Error(`${command} failed (${code}): ${error.slice(-6000)}`)); });
  });
}
function verifyInstalled(manifest) {
  const files = [];
  for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
    const entry = manifest.packages.find(item => item.name === '@pulse-compute/' + name);
    assert.ok(entry);
    const directory = path.join(consumer, 'node_modules', entry.name);
    assert.ok(fs.realpathSync(directory).startsWith(consumer + path.sep));
    const tarball = path.join(pack, entry.tarball);
    assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      let target = path.join(directory, file.replace(/^package\//, ''));
      if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
      assert.deepEqual(fs.readFileSync(target), bytes, `installed candidate changed: ${entry.name}/${file}`);
      files.push([entry.name + '/' + file, hash(bytes)]);
    }
  }
  return hash(JSON.stringify(files));
}
async function main() {
  let registry, server; let proof = {status:'failed',...identity,deployed:false};
  assert(!fs.existsSync(output),'Use a fresh proof directory');fs.mkdirSync(output,{recursive:true});
  try {
    assert.ok(process.env.PULSE_VICEROY_BIN, 'Installed KV list/delete qualification requires explicit PULSE_VICEROY_BIN');
    const launcher = fastly.inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
    assert.equal(identity.workingTree,'','Use committed clean source');
    execFileSync('npm',['run','build'],{cwd:root,stdio:'pipe',timeout:180000});
    const packed = packRelease({ repoRoot: root, outDir: pack, build:false, fresh:true });
    fs.mkdirSync(consumer, { recursive: true });
    const version = packed.manifest.packages[0].version;
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: Object.fromEntries(['pulse', 'cli', 'provider-fastly'].map(name => ['@pulse-compute/' + name, version])) }));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(entry => path.join(pack, entry.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(registry.requests.missing, 0);
    assert.equal(registry.requests.rejected, 0);
    const installedHash = verifyInstalled(packed.manifest);
    fs.mkdirSync(path.join(consumer, '.pulse'));
    fs.mkdirSync(path.join(consumer, 'src'));
    fs.writeFileSync(path.join(consumer, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(scope => ({pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},'node-native':{host:'node',target:'native'},'node-javascript':{host:'node',target:'javascript'},native:{host:'fastly',target:'native',outDir:'dist',fastly:{bindings:{kv:{catalog:'catalog'}}}}}));`);
    fs.copyFileSync(path.join(__dirname, '../kv/list-delete/consumer.ts'), path.join(consumer, 'src/index.ts'));
    const nodeProbe = path.join(consumer, 'installed-node.cjs');
    fs.copyFileSync(path.join(__dirname, '../kv/list-delete/installed-node.cjs'), nodeProbe);
    const nodeParity = JSON.parse(await run(process.execPath, [nodeProbe, output]));
    assert.equal(nodeParity.status, 'passed'); assert.equal(nodeParity.workspaceProductModules, 0);
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
    const built = JSON.parse(await run(process.execPath, [cli, 'build', '--json']));
    assert.equal(built.status, 'built');
    const dist = path.join(consumer, 'dist'), wasmFile = path.join(dist, 'bin/main.wasm');
    const wasm = fs.readFileSync(wasmFile), imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    for (const name of ['list', 'list_wait', 'delete', 'delete_wait']) assert.ok(imports.some(entry => entry.module === 'fastly_kv_store' && entry.name === name));
    assert.ok(!imports.some(entry => ['pulse_host','js_compute'].includes(entry.module)));
    const manifestFile = path.join(dist, 'fastly.toml');
    const wire = value => JSON.stringify({ __pulseKv: 1, value });
    fs.writeFileSync(manifestFile, fastly.renderFastlyLocalConfig({ name: 'kv-list-delete-installed', kvStores: { catalog: { 'user/a': wire(1), 'user/b': wire(2), 'user/雪': wire(3), other: wire(4) } } }));
    server = await fastly.startFastlyComputeServe({ launcher, packageRoot: dist, wasmFile, manifestFile, startTimeoutMs: 60000 });
    const scenarios = [], simulatorLimitations = [];
    const pinnedViceroy = /0\.21\.1/.test(launcher.inspection.version);
    async function invoke(command) {
      const response = await fastly.requestFastlyCompute(server, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(command) });
      assert.equal(response.status, 200); const result = JSON.parse(response.body.toString());
      scenarios.push({ command, result }); return result;
    }
    const first = await invoke({ operation:'list', options:{limit:2,prefix:'user/'} });
    assert.equal(first.status,'listed'); assert.equal(first.keys.length,2); assert.equal(typeof first.cursor,'string');
    const final = await invoke({ operation:'list', options:{limit:2,prefix:'user/',cursor:first.cursor} });
    assert.equal(final.status,'listed'); assert.equal(final.cursor,null);
    assert.deepEqual([...first.keys,...final.keys].sort(),['user/a','user/b','user/雪'].sort());
    assert.deepEqual(await invoke({operation:'list',options:{limit:1,prefix:'empty/'}}),{status:'listed',keys:[],cursor:null});
    assert.deepEqual(await invoke({operation:'list',options:{limit:100,prefix:''}}),{status:'listed',keys:['other','user/a','user/b','user/雪'],cursor:null});
    assert.deepEqual(await invoke({operation:'delete',key:'user/a'}),{status:'deleted'});
    const repeated = await invoke({operation:'delete',key:'user/a'});
    const absent = await invoke({operation:'delete',key:'missing'});
    if (pinnedViceroy) {
      assert.deepEqual(repeated,{status:'deleted'}); assert.deepEqual(absent,{status:'deleted'});
      simulatorLimitations.push({id:'viceroy-0.21.1-delete-absence',observed:[repeated,absent],explanation:'Pinned Viceroy delete_wait discards Ok(bool), returning KvError::Ok for an absent key. Explicit NotFound normalization is covered by the enforcing ABI host and requires hosted verification.',source:'https://github.com/fastly/Viceroy/blob/v0.21.1/src/wiggle_abi/kv_store_impl.rs#L291-L312'});
    } else {
      assert.deepEqual(repeated,{status:'not-found'}); assert.deepEqual(absent,{status:'not-found'});
    }
    assert.deepEqual(await invoke({operation:'get',key:'user/a'}),{status:'not-found'});
    assert.deepEqual(await invoke({operation:'list',options:{limit:0}}),{status:'failed',reason:'invalid-options'});
    assert.deepEqual(await invoke({operation:'list',options:{limit:1,cursor:'!invalid-cursor!'}}),{status:'failed',reason:'invalid-cursor'});
    assert.deepEqual(await invoke({operation:'delete',key:''}),{status:'not-deleted',reason:'invalid-key'});
    assert.deepEqual(await invoke({operation:'put',key:'user/a',value:{revision:2}}),{stored:true});
    assert.deepEqual((await invoke({operation:'get',key:'user/a'})).value,{revision:2});
    const page = await invoke({operation:'list',options:{limit:100,prefix:'user/'}});
    assert.deepEqual(page.keys,['user/a','user/b','user/雪']);
    await server.stop();
    assert.equal(verifyInstalled(packed.manifest), installedHash); assert.equal(hash(fs.readFileSync(wasmFile)),hash(wasm));
    fs.writeFileSync(path.join(output,'main.wasm'),wasm);
    fs.writeFileSync(path.join(output,'scenarios.json'),JSON.stringify(scenarios,null,2)+'\n');
    proof={status:'passed',...identity,packages:packed.manifest.packages.map(p=>({name:p.name,sha256:p.sha256})),installedHash,wasmSha256:hash(wasm),engine:launcher.inspection.version,engineSha256:hash(fs.readFileSync(launcher.inspection.binary)),lifecycleScripts:false,localKvAbi:true,scenarioCount:scenarios.length,nodeParity,simulatorLimitations,registry:{...registry.requests},deployed:false,hostedSemantics:'not-qualified; verify configured KV binding, prefix pages, rejected cursor, delete absence and observed concurrent mutations on the service'};
    assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
    console.log('ok - installed Fastly KV list/delete '+JSON.stringify(proof));
  } finally {
    if (server) await server.stop();
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
    proof.cleanup={status:fs.existsSync(temporary)?'failed':'passed',consumersRemoved:!fs.existsSync(temporary)};
    fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
