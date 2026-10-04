#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {resolveAsc}=require('../../packages/build-support/src/assemblyscript-compile.js');
const {inspectFastlyComputeLauncher,renderFastlyLocalConfig,startFastlyComputeServe}=require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root=path.resolve(__dirname,'../../..');
const source=path.join(__dirname,'fixtures/str02c/hostcalls.as.ts');
const digest=b=>createHash('sha256').update(b).digest('hex');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),5000);})]);}finally{clearTimeout(timer);}}
function assertAdmission(){
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-str02c-admission-'));
  try{
    fs.mkdirSync(path.join(project,'src'));fs.mkdirSync(path.join(project,'.pulse'));
    fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'str02c-admission',private:true,type:'module'}));
    fs.writeFileSync(path.join(project,'src/index.ts'),"import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/',async ctx=>{return ctx.fetch('https://origin.example/upload',{method:'POST',body:ctx.req.body()})});export default app;");
    fs.writeFileSync(path.join(project,'.pulse/config.ts'),"import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_scope=>({pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},native:{host:'fastly',target:'native',fastly:{maxDurationMs:1000,bindings:{backends:{'https://origin.example':'origin'}}}},javascript:{host:'fastly',target:'javascript',fastly:{bindings:{backends:{'https://origin.example':'origin'}}}}}));");
    for(const target of ['native','javascript']){
      const result=spawnSync(process.execPath,[path.join(root,'wasm/scripts/pulse.cjs'),'build','--profile',target,'--json'],{cwd:project,encoding:'utf8',timeout:20000});
      assert.equal(result.error,undefined);assert.notEqual(result.status,0);
      assert.match(result.stdout+result.stderr,target==='native'?/PULSE_PROVIDER_CAPABILITY_UNSUPPORTED/:/fastly-incoming-body-forwarding-unavailable/);
    }
  }finally{fs.rmSync(project,{recursive:true,force:true});}
}
async function main(){
  assertAdmission();
  const launcher=inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  assert.equal(launcher.inspection.version,'0.20.1','This observation is pinned to Viceroy 0.20.1; review newer engines separately.');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-str02c-'));
  fs.mkdirSync(path.join(root,'wasm/.test-results'),{recursive:true});
  const reportDir=fs.mkdtempSync(path.join(root,'wasm/.test-results/str02c-'));
  const report={version:'pulse.str02c-feasibility.v1',status:'running',source:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),tree:spawnSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).stdout.trim(),workingTree:spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim(),applicationIntegration:false,livePlatform:false,engine:launcher.inspection.version,engineSha256:digest(fs.readFileSync(launcher.inspection.binary)),probeSourceSha256:digest(fs.readFileSync(source)),runnerSha256:digest(fs.readFileSync(__filename)),admission:{native:'blocked',javascript:'blocked'},cases:{}};
  let server,first=deferred();const receipts=new Map(),receiptReady=new Map(['direct','close','abandon'].map(mode=>[mode,deferred()]));
  const origin=http.createServer((req,res)=>{
    req.on('error',()=>{});
    const url=new URL(req.url,'http://origin');
    if(url.pathname==='/receipt'){const data=Object.fromEntries(url.searchParams);receipts.set(data.mode,data);receiptReady.get(data.mode)?.resolve();res.end('ok');return;}
    if(url.pathname==='/early'){req.once('data',()=>res.end('early'));return;}
    let count=0;const hash=createHash('sha256');
    req.on('data',chunk=>{count+=chunk.length;hash.update(chunk);first.resolve();});
    req.on('end',()=>res.end(JSON.stringify({count,sha256:hash.digest('hex')})));
  });
  function client(route){
    const result=deferred(),req=http.request(server.baseUrl+route,{method:'POST'},res=>{
      let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);
      res.on('end',()=>result.resolve({complete:true,status:res.statusCode,text}));
      res.on('error',e=>result.resolve({complete:false,text,error:e.code}));
    });req.on('error',e=>result.resolve({complete:false,error:e.code}));req.setTimeout(5000,()=>req.destroy(new Error('probe timeout')));return {req,result:result.promise};
  }
  try{
    origin.listen(0,'127.0.0.1');await once(origin,'listening');
    const asc=resolveAsc(path.join(root,'wasm'));assert.ok(asc,'AssemblyScript is required');
    const wasmFile=path.join(temporary,'probe.wasm'),manifestFile=path.join(temporary,'fastly.toml');
    const compile=spawnSync(asc.executable,[asc.script,source,'--outFile',wasmFile,'--runtime','stub','--use','abort=','--optimize','--noAssert'],{cwd:root,encoding:'utf8',timeout:30000});
    assert.equal(compile.status,0,compile.stderr);
    const wasm=fs.readFileSync(wasmFile);report.wasmSha256=digest(wasm);report.wasmBytes=wasm.length;
    report.imports=WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    fs.writeFileSync(manifestFile,renderFastlyLocalConfig({name:'str02c-abi-feasibility',backends:{origin:{url:`http://127.0.0.1:${origin.address().port}`,useSni:false}}}));
    server=await startFastlyComputeServe({launcher,packageRoot:temporary,wasmFile,manifestFile,startTimeoutMs:15000,stopTimeoutMs:3000});
    const direct=client('/direct'),prefix=Buffer.from([0,255,7,2]);direct.req.write(prefix);
    await bounded(first.promise,'origin first byte');direct.req.end('tail');
    const received=await bounded(direct.result,'direct transfer');assert.equal(received.status,200);
    assert.deepEqual(JSON.parse(received.text),{count:8,sha256:digest(Buffer.concat([prefix,Buffer.from('tail')]))});
    report.cases.direct={firstByteBeforeEof:true,...receipts.get('direct')};
    const early=client('/early');early.req.end();const earlyResult=await bounded(early.result,'early response');assert.equal(earlyResult.status,200,earlyResult.text);report.cases.early=JSON.parse(earlyResult.text);
    for(const route of ['close','abandon']){const active=client('/'+route);active.req.end();const result=await bounded(active.result,route);await bounded(receiptReady.get(route).promise,route+' receipt');report.cases[route]={...receipts.get(route),...result};}
    assert.equal(digest(fs.readFileSync(wasmFile)),report.wasmSha256);
    // Observations are intentionally not an eligibility assertion. A different
    // result is a reason to revisit the decision, never automatic promotion.
    assert.equal(report.cases.direct.readAfterTransfer,'3');
    assert.equal(report.cases.close.terminalStatus,'0');
    assert.equal(report.cases.close.readyAfterTerminal,'3');
    assert.equal(report.cases.close.complete,true);
    assert.deepEqual(report.cases.early,{selectStatus:0,selectedIndex:0,pollStatus:0,done:1,abandonStatus:0});
    assert.equal(report.cases.abandon.terminalStatus,'0');
    assert.equal(report.cases.abandon.readyAfterTerminal,'3');
    assert.equal(report.cases.abandon.complete,false);
    report.status='passed';console.log(JSON.stringify(report.cases));
  }catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
  finally{
    if(server)await server.stop();origin.closeAllConnections();await new Promise(r=>origin.close(r));
    fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2)+'\n');
    fs.rmSync(temporary,{recursive:true,force:true});console.log('STR-02C report: '+path.join(reportDir,'report.json'));
  }
}
module.exports={assertAdmission};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
