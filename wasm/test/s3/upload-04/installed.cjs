'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process'),{createRequire}=require('node:module');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='--consumer'){
  const dir=process.argv[3],out=process.argv[4],installed=createRequire(path.join(dir,'package.json'));
  assert.equal(process.env.NODE_PATH,undefined);
  const s3=installed('@pulse-compute/s3').s3;assert.equal(s3.putBody,undefined);assert.equal(typeof s3.putText,'function');
  const ts=installed('typescript');const file=path.join(dir,'upload.ts');fs.writeFileSync(file,"import {s3} from '@pulse-compute/s3'; const missing=s3.putBody;\n");
  const p=ts.createProgram([file],{noEmit:true,strict:true,skipLibCheck:true,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext});
  const diagnostics=ts.getPreEmitDiagnostics(p).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
  assert(diagnostics.some(d=>d.code===2339&&d.message.includes('putBody')));
  const loaded=Object.keys(require.cache).filter(f=>f.includes('/node_modules/@pulse-compute/'));
  assert(loaded.length);assert(loaded.every(f=>fs.realpathSync(f).startsWith(dir+'/node_modules/')));
  const sourceRoot=path.resolve(__dirname,'../../../..');assert(!Object.keys(require.cache).some(f=>f.startsWith(sourceRoot+'/packages/')||f.startsWith(sourceRoot+'/wasm/packages/')));
  fs.writeFileSync(out,JSON.stringify({status:'blocked',gate:'installed-public-upload',reason:'No public putBody facade/type admission exists in the exact installed artifacts',existingPutTextPresent:true,diagnostics,typescript:ts.version,workspaceProductModulesLoaded:false,loadedPulseFiles:loaded.length},null,2)+'\n');
}else{
  const [packDir,consumer,out]=process.argv.slice(2);assert(!fs.existsSync(consumer)&&!fs.existsSync(out),'Use a new consumer and receipt path');fs.mkdirSync(consumer,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(packDir,'pulse-release-manifest.json')));
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'upload04-installed-probe',version:'0.0.0',private:true,dependencies:Object.fromEntries(manifest.packages.map(p=>[p.name,'file:'+path.join(packDir,p.tarball)]))},null,2));
  const result=cp.spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:consumer,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(consumer,'install.log'),result.stdout+'\n'+result.stderr);assert.equal(result.status,0,(result.error?.message||result.stderr).slice(-4000));
  const {readTarEntries}=require('../../../../scripts/pack-release.cjs');let verifiedFiles=0;
  const verify=()=>{for(const p of manifest.packages){const tarball=path.join(packDir,p.tarball);assert.equal(hash(fs.readFileSync(tarball)),p.sha256);const root=path.join(consumer,'node_modules',p.name);for(const [entry,bytes]of readTarEntries(tarball)){const name=entry.replace(/^package\//,'').replace(/(^|\/)\.gitignore$/,'$1.npmignore'),file=path.join(root,name);assert(fs.realpathSync(file).startsWith(root+'/'));assert.deepEqual(fs.readFileSync(file),bytes);verifiedFiles++;}}};
  verify();const child=cp.spawnSync(process.execPath,[__filename,'--consumer',consumer,path.join(consumer,'result.json')],{cwd:consumer,encoding:'utf8',timeout:30000,env:{...process.env,NODE_PATH:undefined}});assert.equal(child.status,0,child.stderr);verify();
  const report=JSON.parse(fs.readFileSync(path.join(consumer,'result.json')));fs.writeFileSync(out,JSON.stringify({...report,packValidation:'passed',exactInstalledBytes:'passed-before-and-after',verifiedFiles:verifiedFiles/2,releaseVersion:manifest.releaseVersion,lockfileSha256:hash(fs.readFileSync(path.join(consumer,'package-lock.json'))),packages:manifest.packages.map(({name,version,sha256})=>({name,version,sha256}))},null,2)+'\n');console.log('Exact package installation verified; public upload gate blocked as expected');
}
