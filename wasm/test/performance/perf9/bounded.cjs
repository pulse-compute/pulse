#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {candidateIdentity}=require('../../../../scripts/release-feature-acceptance.cjs');
const {environment,dependencies}=require('../baseline.cjs');
const old=require('./measurement-protocol.cjs'), receipt=require('./measurement-report.cjs');
const q=require('./qualify.cjs'), contract=require('./contract.json'), host=require('./measurement-host.cjs');
const {qualifyAbi}=require('../../support/fastly-forwarding-qualification.cjs');
const {qualifyViceroy}=require('../../support/fastly-forwarding-viceroy.cjs');
const {qualifyPair,scenarios}=require('./parity.cjs');
const cli=require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {protocol,names,schedule,summarize,selfTest}=require('./bounded-protocol.cjs');
const profiling=require('./bounded-profile.cjs');
const root=path.resolve(__dirname,'../../../..'), read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const digest=f=>old.hash(fs.readFileSync(f)), write=(f,value)=>fs.writeFileSync(f,JSON.stringify(value,null,2)+'\n');
const originalHashes={default:'3d45684127ee2900318f55be5e3057902f6fdac3863468db143b3de2fbbfdc38',rust:'28069f4c4065bb4b04fd6550903a99bb02475163354e8bf13388951b14e8bb32'};
function sources(){return {...receipt.sources(),...Object.fromEntries(['bounded.cjs','bounded-protocol.cjs','bounded-profile.cjs','bounded-build.cjs','bounded-perf-probe.py','bounded-process-metrics.py','qualify.cjs','parity.cjs','contract.json','pulse.ts','rust/lib.rs','rust/abi.rs','rust/Cargo.toml','rust/Cargo.lock','rust/rust-toolchain.toml','../compiler-rss.cjs','../../support/fastly-forwarding-qualification.cjs','../../support/fastly-forwarding-viceroy.cjs','../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js'].map(f=>[f,digest(path.join(__dirname,f))]))};}
function build(name,directory,variant) {
  fs.mkdirSync(directory,{recursive:true});
  const resultFile=path.join(directory,'build.json'), metricsFile=path.join(directory,'process.json');
  const result=spawnSync('python3',[path.join(__dirname,'bounded-process-metrics.py'),metricsFile,process.execPath,path.join(__dirname,'bounded-build.cjs'),name,path.join(directory,'project'),variant,resultFile],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  fs.writeFileSync(path.join(directory,'stdout.log'),result.stdout||'');fs.writeFileSync(path.join(directory,'stderr.log'),result.stderr||'');
  assert.equal(result.status,0,`${name}/${variant} build failed: ${result.stderr||result.error}`);
  return {...read(resultFile),resultFile,resultSha256:digest(resultFile),process:read(metricsFile)};
}
function validate(r) {
  selfTest();assert.equal(r.schemaVersion,'pulse.perf9-02.v1');assert.equal(r.status,'passed');assert.equal(r.profiledTiming,false);
  assert.equal(r.environmentKind,'local-Viceroy');assert.equal(r.liveFastly,false);assert.equal(r.source.workingTree,'');
  assert.deepEqual(r.protocol,protocol);assert.deepEqual(r.sources,sources());assert.deepEqual(r.schedule,schedule());
  assert.equal(r.builds.length,9);assert.equal(r.qualifications.length,3);assert.equal(r.cells.length,3);
  for(const name of names) {
    const builds=r.builds.filter(b=>b.name===name);assert.equal(builds.length,3);
    for(const b of builds) {
      assert.equal(digest(b.resultFile),b.resultSha256);assert(b.buildMs>0&&b.compilerMemory.peakIndividualRssBytes>0);
      const retained=read(b.resultFile);
      for(const key of ['name','variant','buildMs','recipes','compilerMemory','options','rust','generatedSource','noCacheArenaElision'])assert.deepEqual(b[key],retained[key]);
      assert.equal(b.artifact.sha256,r.artifacts[name].sha256);assert.equal(digest(b.artifact.file),b.artifact.sha256);
      assert.deepEqual(b.options,name==='bounded'?{experimentalNativeBoundedSize:true}:{});
    }
    assert.equal(digest(r.artifacts[name].file),r.artifacts[name].sha256);
    if(originalHashes[name])assert.equal(r.artifacts[name].sha256,originalHashes[name],'Frozen reference artifact changed');
  }
  for(let i=0;i<3;i++) {
    const v=r.qualifications[i],c={...contract,...contract.variants[i]};assert.equal(v.id,c.id);
    for(const name of names) {
      const a=v[name];assert.equal(digest(a.file),a.sha256);assert.equal(a.abi.status,'passed');assert.equal(a.abi.wasmSha256,a.sha256);
      assert.equal(a.abi.cases.length,i===1?88:90);assert.deepEqual(a.abi.cases,v.rust.abi.cases);
      if(i===0){assert.equal(a.sha256,r.artifacts[name].sha256);assert.equal(a.abi.guestMemoryBytes,r.artifacts[name].guestLinearMemoryBytes);assert.equal(a.wire.status,'passed');assert.equal(a.wire.wasmSha256,a.sha256);assert.equal(a.wire.cases.length,19);assert.equal(a.wire.engineSha256,r.viceroy.sha256);assert.deepEqual(a.wire.cases,v.rust.wire.cases);}
    }
    for(const pair of ['defaultVsRust','boundedVsRust']){
      assert.deepEqual(v[pair].map(x=>x.name),scenarios(c).map(x=>x.name));
      for(const row of v[pair]){assert.equal(row.status,'passed');assert.deepEqual(row.pulse,row.rust);}
    }
  }
  let finish=0;
  for(let i=0;i<3;i++){
    const cell=r.cells[i],c=r.schedule[i];assert.equal(cell.id,c.id);assert.equal(cell.blocks.length,30);assert.equal(cell.warmup.length,3);
    for(const name of names){const warm=cell.warmup.filter(x=>x.implementation===name);assert.equal(warm.length,1);receipt.validateBlock(warm[0],{...c,requests:8},r.clockTicksPerSecond);}
    for(let j=0;j<30;j++){
      const b=cell.blocks[j];assert.equal(b.index,j);assert.deepEqual(b.order,c.orders[j]);
      for(const name of b.order){const arm=b[name];assert.equal(arm.implementation,name);receipt.validateBlock(arm,c,r.clockTicksPerSecond);assert(arm.startedAtMs>=finish);assert(arm.finishedAtMs>arm.startedAtMs);finish=arm.finishedAtMs;}
    }
    assert.deepEqual(cell.summary,summarize(cell,protocol.seed+i*10));
  }
  assert.equal(r.attribution.viceroySha256,r.viceroy.sha256);
  for(const name of names){assert(!r.servers[name].args.some(x=>x.startsWith('--profile')));assert.equal(digest(r.servers[name].config),r.servers[name].configurationSha256);}
  for(const key of ['guestCpu','hostCpu','kernelCpu','unknownCpu'])assert.equal(r.attribution[key].status,'unavailable');
  assert.equal(r.attribution.samplingDenominator,null);assert.equal(r.attribution.calibratedCpuMilliseconds,false);assert.equal(r.profiles.length,3);
  for(const name of names){const p=r.profiles.find(x=>x.name===name);assert(p&&p.status==='passed'&&p.profiled);assert.equal(p.artifactSha256,r.artifacts[name].sha256);assert.equal(p.requests.length,32);assert(p.requests.every(x=>x.outcome==='ok'));assert.equal(p.files.length,32);for(const f of p.files){assert.equal(digest(f.file),f.sha256);assert.equal(f.samples,(read(f.file).threads||[]).reduce((n,t)=>n+(t.samples?.length||0),0));}assert.equal(p.sampleCount,p.files.reduce((n,f)=>n+f.samples,0));}
  return r;
}
async function campaign() {
  selfTest();const source=candidateIdentity(root);assert.equal(source.workingTree,'','Commit the experiment before measuring');
  const parent=path.join(root,'wasm/.test-results');fs.mkdirSync(parent,{recursive:true});
  const directory=fs.mkdtempSync(path.join(parent,'perf9-02-')),output=path.join(directory,'bounded.json');
  const r={schemaVersion:'pulse.perf9-02.v1',status:'running',output,source,sources:sources(),environment:environment(),dependencies:dependencies(),
    environmentKind:'local-Viceroy',liveFastly:false,profiledTiming:false,protocol,schedule:schedule(),builds:[],qualifications:[],cells:[],artifacts:{},profiles:[],createdAt:new Date().toISOString()};
  const persist=()=>{write(output+'.tmp',r);fs.renameSync(output+'.tmp',output);};persist();console.log('PERF9-02 report: '+output);
  const controller=new AbortController(),signal=()=>controller.abort();process.once('SIGINT',signal);process.once('SIGTERM',signal);
  const servers={},agents={};let origin,lockOwned=false;const lock=path.join(parent,'perf9-measurement.lock');
  const stopServers=async()=>{const errors=[];for(const agent of Object.values(agents))agent.destroy();for(const [name,s] of Object.entries(servers)){try{await s.stop();fs.writeFileSync(path.join(directory,name,'viceroy.stderr.log'),s.logs.stderr);delete servers[name];}catch(e){errors.push(String(e));}}if(errors.length)throw Error(errors.join('; '));};
  try {
    const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,output}));fs.closeSync(fd);lockOwned=true;
    const launcher=cli.inspectFastlyComputeLauncher({launcherKind:'viceroy-direct',viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
    assert.equal(launcher.inspection.version,'0.21.1');r.viceroy={version:launcher.inspection.version,sha256:digest(launcher.inspection.binary)};
    r.attribution=profiling.feasibility(launcher.inspection.binary);persist();
    r.buildOrder=Array.from({length:3},(_,round)=>names.map((_,i)=>names[(round+i)%3]));
    for(let round=0;round<3;round++)for(const name of r.buildOrder[round]){
      if(controller.signal.aborted)throw Error('Interrupted');
      const b=build(name,path.join(directory,`build-${round}-${name}`),'default');r.builds.push({...b,round});
      r.artifacts[name]??=b.artifact;persist();console.log(`build ${round} ${name}: ${b.artifact.bytes} bytes, ${b.buildMs.toFixed(0)} ms`);
    }
    for(const name of ['default','rust'])assert.equal(r.artifacts[name].sha256,originalHashes[name]);
    for(const variant of contract.variants){
      const c={...contract,...variant},cell={id:variant.id};r.qualifications.push(cell);
      for(const name of names){
        cell[name]=variant.id==='default'?{...r.artifacts[name]}:build(name,path.join(directory,`${variant.id}-${name}`),variant.id).artifact;
        cell[name].abi=qualifyAbi(fs.readFileSync(cell[name].file),{requestCap:c.requestMaxBytes,responseCap:c.responseMaxBytes,deadline:Math.min(c.maxDurationMs,c.fetchTimeoutMs)});
        if(name==='rust'){delete cell[name].abi.metadataScratchBytes;cell[name].abi.rawMetadataStorageBytes=17408;}
        if(variant.id==='default'){
          const dir=path.join(directory,`wire-${name}`);fs.mkdirSync(dir);cell[name].wire=await qualifyViceroy(cell[name].file,dir);
          r.artifacts[name].guestLinearMemoryBytes=cell[name].abi.guestMemoryBytes;r.artifacts[name].payloadScratchBytes=16384;
        }
        persist();console.log(`${variant.id} ${name}: ${cell[name].abi.cases.length} ABI cases qualified`);
      }
      for(const name of ['default','bounded'])cell[name+'VsRust']=qualifyPair(fs.readFileSync(cell[name].file),fs.readFileSync(cell.rust.file),c);
      persist();
    }
    assert.deepEqual(candidateIdentity(root),source);r.clockTicksPerSecond=host.tickRate();r.servers={};
    origin=await host.originServer();
    for(const name of names){
      const dir=path.join(directory,name);fs.mkdirSync(dir);const config=path.join(dir,'fastly.toml');
      fs.writeFileSync(config,cli.renderFastlyLocalConfig({name:'perf9-02-'+name,backends:{origin:{url:origin.url,useSni:false}}}));
      servers[name]=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile:r.artifacts[name].file,manifestFile:config,env:{RUST_LOG:'error'}});
      servers[name]={...servers[name],procPid:host.resolveProcessPid(servers[name].child.pid)};
      agents[name]=new http.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:4});
      r.servers[name]={args:servers[name].args,config,configurationSha256:digest(config),procPid:servers[name].procPid};
      assert(!servers[name].args.some(x=>x.startsWith('--profile')));
    }
    r.measurementStartedAt=new Date().toISOString();const began=performance.now();
    for(let i=0;i<r.schedule.length;i++){
      const c=r.schedule[i],cell={id:c.id,warmup:[],blocks:[]};r.cells.push(cell);
      for(const name of c.orders[0]){const b=await host.batch(servers[name],agents[name],origin,c,8,r.clockTicksPerSecond,controller.signal);cell.warmup.push({implementation:name,...b});receipt.validateBlock(b,{...c,requests:8},r.clockTicksPerSecond);}
      for(let index=0;index<30;index++){
        const b={index,order:c.orders[index]};cell.blocks.push(b);
        for(const name of b.order){const startedAtMs=performance.now()-began;const measured=await host.batch(servers[name],agents[name],origin,c,16,r.clockTicksPerSecond,controller.signal);b[name]={implementation:name,startedAtMs,finishedAtMs:performance.now()-began,...measured};persist();}
        for(const name of b.order)receipt.validateBlock(b[name],c,r.clockTicksPerSecond);
      }
      cell.summary=summarize(cell,protocol.seed+i*10);persist();console.log(`${c.id}: 30 three-arm blocks complete`);
    }
    r.measurementCompletedAt=new Date().toISOString();persist();await stopServers();await origin.stop();origin=null;
    console.log('Unprofiled measurement complete; starting separate guest-stack diagnostics');
    r.profiles=await profiling.diagnostic(launcher,r.artifacts,path.join(directory,'profiled'),rows=>{r.profiles=rows;persist();},controller.signal);
    assert.deepEqual(candidateIdentity(root),source);assert.deepEqual(sources(),r.sources);assert.deepEqual(dependencies(),r.dependencies);assert.equal(digest(launcher.inspection.binary),r.viceroy.sha256);
    r.status='passed';validate(r);
  }catch(error){r.status=controller.signal.aborted?'interrupted':'failed';r.error=error.stack||String(error);throw error;}
  finally{
    const errors=[];try{await stopServers();}catch(e){errors.push(String(e));}try{if(origin)await origin.stop();}catch(e){errors.push(String(e));}
    try{if(lockOwned)fs.unlinkSync(lock);}catch(e){errors.push(String(e));}
    process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
    if(errors.length){r.status='failed';r.cleanupErrors=errors;}r.completedAt=new Date().toISOString();persist();
    if(errors.length)throw Error('Cleanup failed: '+errors.join('; '));
  }
  console.log('ok - PERF9-02 campaign: '+output);return r;
}
if(require.main===module){const args=process.argv.slice(2);if(args.length===2&&args[0]==='--check'){validate(read(args[1]));console.log('ok - PERF9-02 report, sources, recipes, artifacts, coverage and summaries');}else if(args.length===1&&args[0]==='--self-test'){selfTest();console.log('ok - PERF9-02 balanced three-arm schedule');}else{assert.equal(args.length,0,'Usage: bounded.cjs [--check report.json|--self-test]');campaign().catch(e=>{console.error(e);process.exitCode=1;});}}
module.exports={campaign,validate,sources};
