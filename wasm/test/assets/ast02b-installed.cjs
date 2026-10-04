'use strict';
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-embedded-'));
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const reportFile = installedAcceptanceReport(path.join(fs.mkdtempSync(path.join(root, 'wasm/.test-results/ast02b-')), 'acceptance.json'));
  const report = { status:'running', source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(), diffSha256:hash(execFileSync('git',['diff','HEAD'],{cwd:root})), scriptSha256:hash(fs.readFileSync(__filename)) };
  try {
    const consumer=path.join(temporary,'consumer'); fs.mkdirSync(consumer);
    const packed=packRelease({repoRoot:root,outDir:path.join(temporary,'pack')});
    const packages=packed.manifest.packages.filter(p=>['assets','s3','runtime','wasm-contracts'].includes(p.name.replace('@pulse-compute/','')));
    assert.equal(packages.length,4);
    report.packages=packages.map(({name,version,sha256})=>({name,version,sha256}));
    const env={...process.env,npm_config_cache:path.join(temporary,'cache')}; delete env.NODE_PATH; delete env.NODE_OPTIONS;
    fs.writeFileSync(path.join(consumer,'package.json'),'{"private":true,"type":"module"}\n');
    execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',...packages.map(p=>path.join(packed.outDir,p.tarball))],{cwd:consumer,env,stdio:'pipe',timeout:30000});
    const verify=()=>{
      let files=0;
      for(const p of packages) {
        const target=path.join(consumer,'node_modules',p.name);
        assert.ok(fs.realpathSync(target).startsWith(consumer+path.sep));
        const tar=path.join(packed.outDir,p.tarball);assert.equal(hash(fs.readFileSync(tar)),p.sha256);
        for(const [name,bytes] of readTarEntries(tar)) if(name.startsWith('package/')&&!name.endsWith('/')) {assert.deepEqual(fs.readFileSync(path.join(target,name.slice(8))),bytes);files++;}
      }
      return files;
    };
    report.verifiedFiles=verify();
    fs.writeFileSync(path.join(consumer,'check.mjs'),`
      import assert from 'node:assert/strict';
      import {createEmbeddedManifest,createAssets} from '@pulse-compute/assets';
      const bytes=new Uint8Array([0,255,192,128]);
      const manifest=await createEmbeddedManifest([{path:'/image',bytes}]);
      const middleware=createAssets({mode:'embedded',manifest:JSON.parse(JSON.stringify(manifest))});
      const call=(method,headers={})=>middleware({request:new Request('https://app.invalid/image',{method,headers})});
      const get=await call('GET'); assert.deepEqual(new Uint8Array(await get.arrayBuffer()),bytes);
      assert.equal(await (await call('HEAD')).text(),'');
      const range=await call('GET',{range:'bytes=1-2'});assert.equal(range.status,206);assert.deepEqual(new Uint8Array(await range.arrayBuffer()),bytes.slice(1,3));
      assert.equal((await call('GET',{'if-none-match':get.headers.get('etag')})).status,304);
      console.log('passed');
    `);
    assert.equal(execFileSync(process.execPath,['check.mjs'],{cwd:consumer,env,encoding:'utf8',timeout:10000}).trim(),'passed');
    fs.writeFileSync(path.join(consumer,'check.ts'),`import {createEmbeddedManifest,createAssets,type EmbeddedAssetsConfig,type EmbeddedAssetManifest} from '@pulse-compute/assets';
      const manifest:EmbeddedAssetManifest=await createEmbeddedManifest([{path:'/x',bytes:new Uint8Array([1])}]);
      const config:EmbeddedAssetsConfig={mode:'embedded',manifest};createAssets(config);`);
    execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--module','NodeNext','--target','ES2022','--lib','ES2022,DOM,DOM.Iterable','check.ts'],{cwd:consumer,env,stdio:'pipe',timeout:30000});
    assert.equal(verify(),report.verifiedFiles);report.status='passed';report.installedTypes='passed';
  } catch(error) {report.status='failed';report.error=String(error.stack||error);throw error;}
  finally {fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');fs.rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({...report,reportFile}));
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);if(error.stderr)console.error(String(error.stderr));process.exitCode=1;});
