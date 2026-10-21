#!/usr/bin/env node
'use strict';
// Opt-in exact packed transport-details diagnostic evidence on real Viceroy; never deploys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-transport-details-installed-'));
const consumer = path.join(temporary, 'consumer');
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pulse-transport-details-proof-' + process.pid + '-' + Date.now()));
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
  let registry;
  let proof = {status:'failed',...identity,deployed:false};
  assert(!fs.existsSync(output),'Use a fresh proof directory');
  fs.mkdirSync(output,{recursive:true});
  try {
    assert.ok(process.env.PULSE_VICEROY_BIN,'Set PULSE_VICEROY_BIN for installed local-host evidence');
    assert.equal(identity.workingTree,'','Use committed clean source');
    execFileSync('npm',['run','build'],{cwd:root,stdio:'pipe',timeout:180000});
    const packed = packRelease({repoRoot:root,outDir:pack,build:false,fresh:true});
    fs.mkdirSync(consumer,{recursive:true});
    const version = packed.manifest.packages[0].version;
    fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module',dependencies:
      Object.fromEntries(['pulse','cli','provider-fastly','provider-node','s3'].map(name=>['@pulse-compute/'+name,version]))}));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(entry=>path.join(pack,entry.tarball))));
    await new Promise(resolve=>registry.server.listen(0,'127.0.0.1',resolve));
    fs.writeFileSync(path.join(consumer,'.npmrc'),`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
    assert.equal(registry.requests.missing,0);assert.equal(registry.requests.rejected,0);
    const installedHash = verifyInstalled(packed.manifest);
    const replay = await require('./assert-fastly-transport-details.cjs').main({packedRoot:consumer,artifactDir:output,quiet:true});
    assert.equal(replay.status,'passed');assert.equal(replay.local.length,4);
    assert.equal(verifyInstalled(packed.manifest),installedHash);
    assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
    proof = {...proof,status:'passed',node:process.version,packages:packed.manifest.packages.map(p=>({name:p.name,sha256:p.sha256})),
      installedHash,lifecycleScripts:false,registry:{...registry.requests},replay};
    console.log('ok - exact installed transport details: '+JSON.stringify(proof));
  } catch(error) {
    proof.error={message:error.message,code:error.code};throw error;
  } finally {
    if(registry)await new Promise(resolve=>registry.server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
    proof.cleanup={status:fs.existsSync(temporary)?'failed':'passed'};
    fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
