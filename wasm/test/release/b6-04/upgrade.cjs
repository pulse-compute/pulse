#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {root,hash,json,write,run,identity,snapshot}=require('./common.cjs');
const {packRelease,readTarEntries}=require('../../../../scripts/pack-release.cjs');
const {verifyClosure}=require('../assert-request-deadline-packages.cjs');
const {catalogFromTarballs,createReadOnlyRegistry}=require('../read-only-npm-registry.cjs');
const output=fs.mkdtempSync(path.join(root,'wasm/.test-results/b6-04-upgrade-'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-b6-04-upgrade-'));
const report={schema:'pulse.b6-04.upgrade.v1',status:'running',source:identity(),node:process.version,oracleSha256:hash(Buffer.concat(['common.cjs','upgrade.cjs','installed-worker.cjs'].map(f=>fs.readFileSync(path.join(__dirname,f))))),steps:[],publicationPerformed:false};
const save=()=>write(path.join(output,'report.json'),report);
const env={...process.env,npm_config_cache:path.join(temporary,'npm-cache'),npm_config_audit:'false',npm_config_fund:'false',npm_config_fetch_retries:'0'};
for(const key of ['NODE_PATH','NODE_OPTIONS','PULSE_PROFILE','npm_config_registry','NPM_CONFIG_REGISTRY'])delete env[key];
async function command(cwd,args){
 return await new Promise((resolve,reject)=>{
  const child=spawn('npm',args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000);
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`npm ${args[0]} failed (${code}): ${err.slice(-4000)}`));});
 });
}
function setup(dir){
 fs.mkdirSync(path.join(dir,'src'),{recursive:true});fs.mkdirSync(path.join(dir,'.pulse'),{recursive:true});fs.mkdirSync(path.join(dir,'data'),{recursive:true});
 write(path.join(dir,'package.json'),{name:'b6-upgrade-consumer',version:'0.0.0',private:true});
 fs.copyFileSync(path.join(root,'examples/13-jwt-es256/src/index.ts'),path.join(dir,'src/guest.ts'));
 fs.writeFileSync(path.join(dir,'src/index.ts'),"import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.get('/health',async ctx=>{const name=await ctx.config.get('name');return ctx.text(name||'missing');});export default app;\n");
 fs.writeFileSync(path.join(dir,'.pulse/config.ts'),"import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},app:{host:'node',target:'native',outDir:'dist-app'},guest:{host:'node',target:'native',outDir:'dist-guest',crypto:{ES256:{realization:'guest-linked:pulse-es256-rustcrypto-p256'}}}}));\n");
 write(path.join(dir,'data/records.json'),{generation:7,records:[{id:'keep',value:'application-owned-state'}]});
 fs.writeFileSync(path.join(dir,'.pulse/user-state'),'must survive');
 fs.copyFileSync(path.join(__dirname,'installed-worker.cjs'),path.join(dir,'installed-worker.cjs'));
}
function preserved(dir){return {source:snapshot(path.join(dir,'src')),data:snapshot(path.join(dir,'data')),config:hash(fs.readFileSync(path.join(dir,'.pulse/config.ts'))),state:hash(fs.readFileSync(path.join(dir,'.pulse/user-state')))};}
function verifyTarballs(dir,entries,pack){
 return entries.map(p=>{const file=path.join(pack,p.filename||p.tarball),bytes=fs.readFileSync(file);if(p.integrity)assert.equal('sha512-'+require('node:crypto').createHash('sha512').update(bytes).digest('base64'),p.integrity);const installed=path.join(dir,'node_modules',p.name);assert.equal(fs.realpathSync(installed),installed);
 for(const [name,content]of readTarEntries(file)){const relative=name.replace(/^package\//,'').replace(/(^|\/)\.gitignore$/,'$1.npmignore');assert.deepEqual(fs.readFileSync(path.join(installed,relative)),content,`${p.name}/${relative}`);}
 assert.equal(json(path.join(installed,'package.json')).version,p.version);return {name:p.name,version:p.version,sha256:hash(bytes),integrity:p.integrity};});
}
function build(dir,profile){
 const cli=path.join(dir,'node_modules/@pulse-compute/cli/bin/pulse.js');
 const configFile=path.join(dir,'.pulse/config.ts'),config=fs.readFileSync(configFile,'utf8');
 let result;try{if(profile==='guest')fs.writeFileSync(configFile,config.replace("entry:'src/index.ts'","entry:'src/guest.ts'"));result=JSON.parse(run(process.execPath,[cli,'build','--profile',profile,'--json'],{cwd:dir,env}));assert.equal(result.status,'built');}finally{fs.writeFileSync(configFile,config);}
 const out=path.join(dir,'dist-'+profile),manifest=json(path.join(out,'pulse-build.json'));
 const wasm=fs.readFileSync(path.join(out,'canonical-native.wasm'));assert.equal(WebAssembly.validate(wasm),true);
 return {wasmSha256:hash(wasm),wasmBytes:wasm.length,planSha256:hash(fs.readFileSync(path.join(out,'canonical-native-plan.json'))),compilerVersion:json(path.join(out,'canonical-native-manifest.json')).compilerVersion,buildVersion:manifest.version};
}
function qualify(dir,label,production){
 console.log(`upgrade - ${label}: cold/warm build and guest reuse`);
 const before=preserved(dir),guestBefore=fs.existsSync(path.join(dir,'.pulse/guests'))?snapshot(path.join(dir,'.pulse/guests')):[];
 const cold={app:build(dir,'app')},warm={app:build(dir,'app')};
 if(!production && !fs.existsSync(path.join(dir,'node_modules/@pulse-compute/crypto/guests/es256-rustcrypto/pulse.guest-unit.json'))){
  let failure;try{build(dir,'guest');}catch(error){failure=error.message;}
  assert.match(failure||'',/PULSE_GUEST_UNIT_INVALID/);
  const row={label,status:'partial',cold,warm,preservedState:true,guest:{status:'blocked',code:'PULSE_GUEST_UNIT_INVALID',reason:'Published beta.5 crypto tarball contains no ES256 guest payload; a fresh published install cannot populate that guest cache.'}};
  assert.deepEqual(cold,warm);assert.deepEqual(preserved(dir),before);report.steps.push(row);save();return row;
 }
 cold.guest=build(dir,'guest');warm.guest=build(dir,'guest');assert.deepEqual(warm,cold);
 const evidence=JSON.parse(run(process.execPath,['installed-worker.cjs',...(production?['--production']:[])],{cwd:dir,env}));
 assert.deepEqual(preserved(dir),before);
 for(const [file,digest]of guestBefore)assert.equal(hash(fs.readFileSync(path.join(dir,'.pulse/guests',file))),digest,'populated old guest bytes retained');
 const row={label,status:'passed',cold,warm,evidence,preservedState:true,previousGuestFilesRetained:guestBefore.length,guestFiles:snapshot(path.join(dir,'.pulse/guests'))};report.steps.push(row);save();return row;
}
async function installCandidate(dir,packed){
 const registry=createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p=>path.join(packed.outDir,p.tarball))));
 await new Promise(resolve=>registry.server.listen(0,'127.0.0.1',resolve));
 try{fs.writeFileSync(path.join(dir,'.npmrc'),`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
 await command(dir,['install','--ignore-scripts','--no-audit','--no-fund',...packed.manifest.packages.map(p=>path.join(packed.outDir,p.tarball))]);assert.equal(registry.requests.missing,0);assert.equal(registry.requests.rejected,0);
 }finally{await new Promise(resolve=>registry.server.close(resolve));}
 verifyClosure(dir,packed.outDir,packed.manifest);
}
async function main(){save();console.log('upgrade - pack candidate and fetch immutable published beta.5');
 const candidateDir=path.join(temporary,'candidate'),packed=packRelease({repoRoot:root,outDir:candidateDir});
 report.candidatePackages=packed.manifest.packages.map(({name,version,sha256})=>({name,version,sha256}));
 const priorDir=path.join(temporary,'beta5');fs.mkdirSync(priorDir);
 const prior=JSON.parse(await command(priorDir,['pack','--ignore-scripts','--json',...packed.manifest.packages.map(p=>p.name+'@1.0.0-beta.5')]));assert.equal(prior.length,packed.manifest.packages.length);assert.deepEqual(prior.map(p=>p.name).sort(),packed.manifest.packages.map(p=>p.name).sort());assert.ok(prior.every(p=>p.version==='1.0.0-beta.5'));
 const upgrade=path.join(temporary,'upgrade');setup(upgrade);
 await command(upgrade,['install','--ignore-scripts','--no-audit','--no-fund',...prior.map(p=>path.join(priorDir,p.filename))]);report.previousPackages=verifyTarballs(upgrade,prior,priorDir);
 const beta=qualify(upgrade,'published-beta5',false),state=preserved(upgrade),cacheBefore=snapshot(env.npm_config_cache).filter(([p])=>p.startsWith('_cacache/content-v2/'));
 await installCandidate(upgrade,packed);assert.deepEqual(preserved(upgrade),state);for(const [p,d]of cacheBefore)assert.equal(hash(fs.readFileSync(path.join(env.npm_config_cache,p))),d);
 const upgraded=qualify(upgrade,'upgraded-candidate',true);verifyClosure(upgrade,candidateDir,packed.manifest);
 env.npm_config_cache=path.join(temporary,'fresh-npm-cache');
 const fresh=path.join(temporary,'fresh');setup(fresh);await installCandidate(fresh,packed);const installed=qualify(fresh,'fresh-candidate',true);verifyClosure(fresh,candidateDir,packed.manifest);
 assert.deepEqual(installed.cold,upgraded.cold);assert.equal(installed.evidence.guest.directory,upgraded.evidence.guest.directory);
 report.oldGuestAddress=beta.evidence?.guest.directory||null;report.publishedBeta5Guest=beta.guest||{status:'passed'};report.candidateGuestAddress=upgraded.evidence.guest.directory;
 report.npmCacheContentFilesPreserved=cacheBefore.length;assert.ok(cacheBefore.length>0);
 report.versionTransition={from:'1.0.0-beta.5',to:packed.manifest.packages[0].version,method:'exact tarball replacement; no cache or application-state deletion',finalBeta6SnapshotReplayRequired:true};
 assert.deepEqual(report.steps.map(s=>s.label),['published-beta5','upgraded-candidate','fresh-candidate']);assert.equal(upgraded.status,'passed');assert.equal(installed.status,'passed');
 report.status=beta.status==='partial'?'partial':'passed';report.upgradeStatus='passed';report.freshInstallStatus='passed';report.populatedPublishedGuestUpgrade=beta.status==='partial'?'blocked':'passed';if(report.status!=='passed')process.exitCode=1;
}
main().catch(e=>{report.status='failed';report.failure=e.stack;report.diagnosticDirectory=temporary;console.error(e);process.exitCode=1;}).finally(()=>{report.completedAt=new Date().toISOString();save();console.log(`upgrade report: ${path.join(output,'report.json')}`);if(report.status!=='failed')fs.rmSync(temporary,{recursive:true,force:true});});
