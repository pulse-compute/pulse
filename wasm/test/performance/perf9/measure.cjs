#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {performance}=require('node:perf_hooks');
const {candidateIdentity}=require('../../../../scripts/release-feature-acceptance.cjs');
const {environment}=require('../baseline.cjs');
const {protocol,profiles,schedule,summarize,hash}=require('./measurement-protocol.cjs');
const host=require('./measurement-host.cjs');
const receipt=require('./measurement-report.cjs');
const checks=require('./measurement-checks.cjs');
const qualification=require('./qualify.cjs');
const cli=require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root=path.resolve(__dirname,'../../../..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>hash(fs.readFileSync(file));
async function campaign({profile='standard',seed=protocol.seed,parity}={}){
  const planned=schedule(profile,seed);checks.selfTest();const source=candidateIdentity(root);
  const parent=path.join(root,'wasm/.test-results');fs.mkdirSync(parent,{recursive:true});
  const directory=fs.mkdtempSync(path.join(parent,'perf9-01b-')),output=path.join(directory,'measurements.json');
  const report={schemaVersion:'pulse.perf9-01b-measurements.v1',status:'running',profile,seed,protocol,schedule:planned,source,sources:receipt.sources(),
    environmentKind:'local-Viceroy',liveFastly:false,performanceMeasured:profile==='standard',environment:environment(),cells:[],diagnostics:[],artifacts:{},createdAt:new Date().toISOString()};
  const persist=()=>{fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.tmp',output);};
  const controller=new AbortController();const onSignal=()=>controller.abort();process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  const servers={},agents={};let origin,lock,lockOwned=false;
  console.log('PERF9-01B report: '+output);persist();
  try{
    // Excludes another PERF9 campaign in this checkout. Other system activity is
    // not controlled; record the environment and never run unit/build work beside it.
    lock=path.join(parent,'perf9-measurement.lock');const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,output}));fs.closeSync(fd);lockOwned=true;
    let q;
    if(parity){parity=path.resolve(parity);q=qualification.validate(read(parity));}
    else{q=await qualification.qualify();parity=q.output;}
    report.fixtureSource={reportFile:parity,reportSha256:digest(parity),identity:q.source,clean:q.source.workingTree===''};
    assert.deepEqual(candidateIdentity(root),source,'Source changed during preflight');
    const launcher=cli.inspectFastlyComputeLauncher({launcherKind:'viceroy-direct',viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
    assert.equal(launcher.kind,'viceroy-direct');assert.equal(launcher.inspection.version,q.viceroy.version);assert.equal(digest(launcher.inspection.binary),q.viceroy.sha256);
    report.viceroy={version:launcher.inspection.version,sha256:q.viceroy.sha256};report.clockTicksPerSecond=host.tickRate();
    report.cpu={process:{status:'measured',domain:protocol.cpu,resolutionMs:1000/report.clockTicksPerSecond},guest:{status:'unavailable',reason:protocol.guestCpu},hostOnly:{status:'unavailable',reason:protocol.hostOnlyCpu}};
    report.hostQueueBytes={status:'unavailable',reason:'No Viceroy/OS per-request queue instrumentation; external queue observations do not bound host storage'};
    origin=await host.originServer();report.servers={};
    for(const name of planned[0].orders[0]){
      const dir=path.join(directory,name);fs.mkdirSync(dir);const wasmFile=path.join(dir,'main.wasm');fs.copyFileSync(q.cells[0][name].file,wasmFile);
      assert.equal(digest(wasmFile),q.cells[0][name].sha256);
      report.artifacts[name]={file:wasmFile,sha256:digest(wasmFile),bytes:fs.statSync(wasmFile).size,guestLinearMemoryBytes:q.cells[0][name].abi.guestMemoryBytes,payloadScratchBytes:16384};
      const manifestFile=path.join(dir,'fastly.toml');fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'perf9-01b-'+name,backends:{origin:{url:origin.url,useSni:false}}}));
      const launched=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:15000,stopTimeoutMs:3000,env:{RUST_LOG:'error'}});
      servers[name]=launched; // Retain ownership before resolving procfs identity.
      servers[name]={...launched,procPid:host.resolveProcessPid(launched.child.pid)};
      report.servers[name]={args:servers[name].args,manifestSha256:digest(manifestFile),namespacePid:launched.child.pid,procPid:servers[name].procPid,startupResources:host.resources(servers[name].procPid)};
      agents[name]=new http.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:4});
    }
    persist();const started=performance.now();
    for(let i=0;i<planned.length;i++){
      if(controller.signal.aborted)throw Error('Interrupted');const c=planned[i],cell={id:c.id,warmup:[],pairs:[]};report.cells.push(cell);
      for(const name of c.orders[0]){const warm=await host.batch(servers[name],agents[name],origin,c,profiles[profile].warmup,report.clockTicksPerSecond,controller.signal);
        cell.warmup.push({implementation:name,...warm});receipt.validateBlock(warm,{...c,requests:profiles[profile].warmup},report.clockTicksPerSecond);}
      for(let block=0;block<c.blocks;block++){
        const pair={index:block,order:c.orders[block]};cell.pairs.push(pair);
        for(const name of pair.order){const begin=performance.now()-started;
          const measured=await host.batch(servers[name],agents[name],origin,c,c.requests,report.clockTicksPerSecond,controller.signal);
          pair[name]={implementation:name,startedAtMs:begin,finishedAtMs:performance.now()-started,...measured};persist();}
        // Retain both members before rejecting an errored block; no cherry-picked retry.
        for(const name of pair.order)receipt.validateBlock(pair[name],c,report.clockTicksPerSecond);
      }
      cell.summary=summarize(cell,profile,seed+i);persist();
      console.log(`${c.id}: ${c.blocks} paired blocks; Pulse p50 ${cell.summary.pulse.successfulLatencyMs.p50.toFixed(3)} ms, Rust ${cell.summary.rust.successfulLatencyMs.p50.toFixed(3)} ms; ${cell.summary.comparison.oneToThreePercent}`);
    }
    // Disruptive scenarios run after all measured cells; never mix their latencies
    // into throughput/latency inference. Recovery is mandatory after each probe.
    for(let repeat=0;repeat<protocol.diagnosticRepeats;repeat++)for(const name of repeat%2?['rust','pulse']:['pulse','rust'])for(const kind of ['deadline','cancel']){
      origin.begin(kind==='deadline'?'deadline':'echo');let originReached=false;
      const result=await host.request(servers[name].baseUrl,agents[name],{mode:'echo',bytes:kind==='deadline'?65536:1048576},
        {signal:controller.signal,...(kind==='cancel'?{cancelOnPrefix:cancel=>origin.onPrefix(()=>{originReached=true;cancel();})}:{})});
      origin.onPrefix(undefined);await origin.idle();origin.begin('echo');
      const recovery=await host.request(servers[name].baseUrl,agents[name],{mode:'echo',bytes:1024},{signal:controller.signal});await origin.idle();
      report.diagnostics.push({implementation:name,kind,repeat,result,originReached,recovery});persist();
    }
    assert.deepEqual(candidateIdentity(root),source);assert.deepEqual(receipt.sources(),report.sources);assert.equal(digest(parity),report.fixtureSource.reportSha256);
    assert.equal(digest(launcher.inspection.binary),report.viceroy.sha256);
    report.status='passed';receipt.validate(report);checks.rejectionTests(report);
  }catch(error){report.status=controller.signal.aborted?'interrupted':'failed';report.error=error.stack||String(error);throw error;}
  finally{
    const cleanupErrors=[];
    for(const agent of Object.values(agents))agent.destroy();
    for(const [name,server]of Object.entries(servers)){
      try{fs.writeFileSync(path.join(directory,name,'viceroy.stdout.log'),server.logs.stdout);fs.writeFileSync(path.join(directory,name,'viceroy.stderr.log'),server.logs.stderr);}
      catch(error){cleanupErrors.push(String(error));}
      try{await server.stop();}catch(error){cleanupErrors.push(String(error));}
    }
    try{if(origin)await origin.stop();}catch(error){cleanupErrors.push(String(error));}
    try{if(lockOwned)fs.unlinkSync(lock);}catch(error){cleanupErrors.push(String(error));}
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
    if(cleanupErrors.length){report.status='failed';report.cleanupErrors=cleanupErrors;}
    report.completedAt=new Date().toISOString();persist();
    if(cleanupErrors.length)throw Error('Campaign cleanup failed: '+cleanupErrors.join('; '));
  }
  console.log('ok - PERF9-01B '+profile+' campaign: '+output);return report;
}
async function main(args){
  if(args.length===1&&args[0]==='--self-test')return checks.selfTest();
  if(args.length===2&&args[0]==='--check'){const r=receipt.validate(read(path.resolve(args[1])));checks.rejectionTests(r);console.log('ok - PERF9-01B report/artifacts/provenance');return;}
  const options={};for(let i=0;i<args.length;i+=2){assert(['--profile','--seed','--parity'].includes(args[i])&&args[i+1], 'Usage: measure.cjs [--profile standard|smoke] [--seed uint32] [--parity report.json]');options[args[i].slice(2)]=args[i]==='--seed'?Number(args[i+1]):args[i+1];}
  await campaign(options);
}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={campaign};
