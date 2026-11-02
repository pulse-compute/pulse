'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {hash, load} = require('./bundle.cjs');
const root = path.resolve(__dirname, '../../../..');
const {packRelease, readTarEntries} = require(path.join(root, 'scripts/pack-release.cjs'));
const {candidateIdentity} = require(path.join(root, 'scripts/release-feature-acceptance.cjs'));
const {verifyClosure} = require('../../release/assert-request-deadline-packages.cjs');
const {catalogFromTarballs, createReadOnlyRegistry} = require('../../release/read-only-npm-registry.cjs');
async function prepare(output) {
  output = path.resolve(output);
  assert(!output.startsWith(root + path.sep) && output !== root, 'Evidence must be outside the checkout');
  fs.mkdirSync(output, {recursive:true}); assert.equal(fs.readdirSync(output).length, 0, 'Use a fresh evidence directory');
  const candidate = candidateIdentity(root), pack = path.join(output, 'packages');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-terminal-consumer-'));
  const consumer = path.join(temporary, 'consumer'); fs.mkdirSync(consumer);
  const env = {...process.env, npm_config_ignore_scripts:'true', npm_config_audit:'false', npm_config_fund:'false'};
  for(const key of ['NODE_PATH','NODE_OPTIONS','npm_config_registry','NPM_CONFIG_REGISTRY'])delete env[key];
  const run = (command,args,cwd=consumer) => promisify(execFile)(command,args,{cwd,env,timeout:300000,maxBuffer:16*1024*1024});
  let registry, fixture;
  try {
    const {manifest} = packRelease({repoRoot:root,outDir:pack});
    fixture = require('../../support/host-extension-fixture.cjs')({name:'@independent/rc-terminal',version:'91.7.3',abi:'fastly_http_req',abiName:'redirect_to_grip_proxy_v2'});
    const packed = JSON.parse((await run('npm',['pack','--ignore-scripts','--json','--pack-destination',output],fixture.pkg)).stdout)[0];
    const fixtureTar = path.join(output,packed.filename);
    fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'terminal-consumer',private:true,dependencies:{
      ...Object.fromEntries(manifest.packages.map(p=>[p.name,p.version])),[fixture.name]:'file:'+fixtureTar}}));
    registry=createReadOnlyRegistry(catalogFromTarballs(manifest.packages.map(p=>path.join(pack,p.tarball))));
    await new Promise(resolve=>registry.server.listen(0,'127.0.0.1',resolve));
    fs.writeFileSync(path.join(consumer,'.npmrc'),`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
    assert.equal(registry.requests.missing,0);assert.equal(registry.requests.rejected,0);
    const verify=()=>{
      verifyClosure(consumer,pack,manifest);
      const fixtureRoot=path.join(consumer,'node_modules',fixture.name);
      assert.equal(fs.realpathSync(fixtureRoot),fixtureRoot);
      const expected=new Set();
      for(const [file,bytes] of readTarEntries(fixtureTar)){
        expected.add(file.replace(/^package\//,''));
        const target=path.join(fixtureRoot,file.replace(/^package\//,''));
        assert(target.startsWith(fixtureRoot+path.sep));assert.equal(fs.realpathSync(target),target);assert.deepEqual(fs.readFileSync(target),bytes);
      }
      function visit(directory,prefix=''){for(const file of fs.readdirSync(directory,{withFileTypes:true})){assert(!file.isSymbolicLink());const relative=prefix+file.name;if(file.isDirectory())visit(path.join(directory,file.name),relative+'/');else assert(expected.has(relative),'Unsealed independent package file');}}
      visit(fixtureRoot);
    };
    verify();
    for(const file of ['installed-worker.cjs','bundle.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(consumer,file));
    fs.copyFileSync(path.join(__dirname,'../../support/terminal-host.cjs'),path.join(consumer,'terminal-host.cjs'));
    const result=await run(process.execPath,['installed-worker.cjs',output]);
    fs.writeFileSync(path.join(output,'installed.log'),result.stdout+result.stderr);
    verify();assert.deepEqual(candidateIdentity(root),candidate);
    const worker=JSON.parse(fs.readFileSync(path.join(output,'worker.json')));assert.equal(worker.status,'passed');
    const receipt={version:'pulse.terminal-installed.v1',status:'passed',candidate,packageClosureVerified:true,outsideCheckout:true,
      harness:Object.fromEntries(['prepare.cjs','installed-worker.cjs','bundle.cjs','local.cjs','hosted.cjs','origin.cjs','verify.cjs','engines.json'].map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))])),
      packages:manifest.packages.map(p=>({name:p.name,version:p.version,file:'packages/'+p.tarball,sha256:p.sha256})),
      fixture:{name:fixture.name,version:'91.7.3',file:packed.filename,sha256:hash(fs.readFileSync(fixtureTar))},
      ...worker,injected:{file:'injected.json',sha256:hash(fs.readFileSync(path.join(output,'injected.json')))}};
    fs.writeFileSync(path.join(output,'installed.json'),JSON.stringify(receipt,null,2)+'\n');
    load(output);return receipt;
  } catch(error) {
    fs.writeFileSync(path.join(output,'failed-attempt.json'),JSON.stringify({status:'failed',candidate,error:String(error),stdout:error.stdout,stderr:error.stderr},null,2)+'\n');throw error;
  } finally {
    if(registry)await new Promise(resolve=>registry.server.close(resolve));
    fixture?.close();fs.rmSync(temporary,{recursive:true,force:true});
  }
}
if(require.main===module){assert.equal(process.argv.length,3,'Usage: prepare.cjs FRESH_OUTSIDE_CHECKOUT_DIR');prepare(process.argv[2]).then(r=>console.log(JSON.stringify({status:r.status,output:path.resolve(process.argv[2]),packages:r.packages}))).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={prepare};
