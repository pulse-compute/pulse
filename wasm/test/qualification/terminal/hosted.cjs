'use strict';
// Read-only service inspection plus explicitly scoped test traffic/publishing.
// Does not create versions, upload packages, enable Fanout, or activate services.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {load,hash,terminalCases,assertCoverage,assertHarness}=require('./bundle.cjs');
const {websocket}=require('./local.cjs');
const {readTarEntries}=require('../../../../scripts/pack-release.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(bundleDir,configFile,output){
 assert(!fs.existsSync(output),'Use a fresh transport receipt path');
 const bundle=load(bundleDir),receipt={version:'pulse.terminal-transport.v1',lane:'hosted',status:'blocked',bundleSha256:bundle.sha256,cases:[],deployments:[],cleanup:true};
 assertHarness(bundle,['hosted.cjs','local.cjs','bundle.cjs','origin.cjs','engines.json']);
 const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
 if(!configFile||!process.env.FASTLY_API_TOKEN){receipt.reason='Scoped configuration and FASTLY_API_TOKEN are required';save();throw Error(receipt.reason);}
 const controller=new AbortController();
 receipt.status='running';save();
 try {
 const config=JSON.parse(fs.readFileSync(configFile));
 assert.deepEqual(config.cases.map(c=>c.id).sort(),[...terminalCases].sort());
 assert.equal(config.version,'pulse.terminal-hosted-config.v1');
 assert.equal(hash(fs.readFileSync(config.cli.file)),config.cli.sha256,'CLI pin mismatch');
 const cliVersion=execFileSync(config.cli.file,['version'],{encoding:'utf8',timeout:10000}).trim();assert.equal(cliVersion,config.cli.version);
 receipt.cli={version:cliVersion,sha256:config.cli.sha256};receipt.configSha256=hash(fs.readFileSync(configFile));
 const api=async(route,options={})=>{
   const response=await fetch('https://api.fastly.com'+route,{...options,redirect:'error',headers:{'Fastly-Key':process.env.FASTLY_API_TOKEN,...options.headers},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   assert(response.ok,'Fastly API request failed: '+response.status);return response;
 };
 const inspect=async c=>{
   assert.match(c.serviceId,/^[a-zA-Z0-9]+$/);assert(Number.isSafeInteger(c.serviceVersion)&&c.serviceVersion>0);
   const version=await (await api(`/service/${c.serviceId}/version/${c.serviceVersion}`)).json();assert.equal(version.active,true,'Expected version is not active');
   const domains=await (await api(`/service/${c.serviceId}/version/${c.serviceVersion}/domain`)).json();
   assert(domains.some(d=>d.name===new URL(c.url).hostname),'Fixture URL is not a domain of the inspected service');
   const pkg=await (await api(`/service/${c.serviceId}/version/${c.serviceVersion}/package`)).json();
   assert.equal(pkg.metadata.files_hash,c.filesHash,'Deployed package differs from exact artifact package');
   return {id:c.id,serviceId:c.serviceId,serviceVersion:c.serviceVersion,filesHash:c.filesHash};
 };
  for(const c of config.cases){
   const artifact=bundle.data.artifacts.find(a=>a.id===c.id),entries=readTarEntries(c.package);
   const wasm=[...entries].filter(([name])=>/(^|\/)bin\/main\.wasm$/.test(name));assert.equal(wasm.length,1);assert.equal(hash(wasm[0][1]),artifact.sha256);
   const packageSha256=hash(fs.readFileSync(c.package));
   const outputHash=execFileSync(config.cli.file,['compute','hash-files','--package',path.resolve(c.package),'--skip-build'],{encoding:'utf8',timeout:30000});
   const matches=outputHash.match(/\b[a-f0-9]{128}\b/g)||[];assert.equal(matches.length,1,'Expected one Fastly SHA-512 files hash');assert.equal(matches[0],c.filesHash);
   const before=await inspect(c);receipt.deployments.push({...before,packageSha256,artifactSha256:artifact.sha256});
   const url=new URL(c.url);assert.equal(url.protocol,'https:');assert(!url.username&&!url.password&&!url.search&&!url.hash);assert.equal(url.pathname,'/');
   const request=async(route,headers={})=>{const r=await fetch(new URL(route,url),{headers,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});return {status:r.status,body:await r.text()};};
   const record=scenario=>receipt.cases.push({id:c.id,scenario,status:'passed',artifactSha256:artifact.sha256});
   assert.deepEqual(await request('/ordinary'),{status:200,body:'ordinary response'});record('ordinary');
   assert.deepEqual(await request('/handoff'),{status:200,body:'terminal-origin'});record('handoff');
   if(c.id.startsWith('websocket')){const ws=new URL('/handoff',url);ws.protocol='wss:';assert.deepEqual(await websocket(ws.href),{status:101,frames:2});record('bidirectional-websocket');}
   else {
    const channel='pulse-terminal-'+crypto.randomBytes(12).toString('hex'),body='published-'+crypto.randomBytes(12).toString('hex');
    let settled=false;const pending=request('/handoff',{'x-pulse-terminal-hold':channel}).then(r=>{settled=true;return r;});pending.catch(()=>{});
    await delay(1000);assert.equal(settled,false,'Response was not held');
    await api(`/service/${c.serviceId}/publish/`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{channel,formats:{'http-response':{body}}}]})});
    assert.deepEqual(await pending,{status:200,body});record('hold-publish');
   }
   assert.deepEqual(await inspect(c),before);assert.equal(hash(fs.readFileSync(c.package)),packageSha256);save();
  }
  assert.equal(load(bundleDir).sha256,bundle.sha256);receipt.status='passed';assertCoverage(receipt,'hosted');
 } catch(error){receipt.status='failed';receipt.reason=error.message;throw error;}finally{controller.abort();save();}
}
if(require.main===module){const [bundle,config,output]=process.argv.slice(2);assert(bundle&&output,'Usage: hosted.cjs BUNDLE CONFIG OUTPUT');run(bundle,config==='-'?null:config,output).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={run};
