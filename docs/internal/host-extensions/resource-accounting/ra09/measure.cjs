'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const h=require('./host.cjs'),{summary,paired}=require('./stats.cjs'),{project}=require('../ra08/report.cjs');
const input=path.resolve(process.argv[2]||'/tmp/hex-ra09'),file=path.join(input,'measurements.json');
assert(!fs.existsSync(file),'retain each measurement attempt');assert.equal(typeof global.gc,'function','run node --expose-gc');
const proof=JSON.parse(fs.readFileSync(path.join(input,'receipt.json')));assert.equal(proof.status,'passed');
const root=require('./build.cjs').root,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
for(const row of proof.inputs)assert.equal(hash(fs.readFileSync(path.join(root,row.file))),row.sha256,'same tested inputs');
const settings={rounds:12,warmupRounds:3,rootsPerBatch:64,ledgerCycles:3000,ledgerWarmup:1000,bootstrapReplicates:2000,seed:12909,wallLimitSeconds:120};
const receipt={version:'hex.ra09.measure.v1',status:'running',proofSha256:hash(fs.readFileSync(path.join(input,'receipt.json'))),base:proof.base,inputs:proof.inputs,settings,
 environment:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,os:os.release(),execArgv:process.execArgv},
 method:{freshInstance:true,compiledModulesCached:true,quietHost:true,realNetwork:false,garbageCollection:'before each batch, outside phase timers',order:'rotating balanced order; 12 recorded rounds',timingUnit:'microseconds per request; each sample is a batch mean',cpu:'whole batch including host harness and post-run checks',reportTiming:'read-only diagnostic capture, projection including source reads/hashes, JSON serialization separately',rssMeasured:false,accountingWithoutOwnershipBaseline:false},applications:[],ledger:[],reports:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');save();const started=Date.now();
function guard(){assert(Date.now()-started<settings.wallLimitSeconds*1000,'measurement wall limit; partial evidence retained');}
function strip(r){const {cost,calls,diagnostics,trace,...behavior}=r;return JSON.parse(JSON.stringify(behavior));}
function load(row){const bytes=fs.readFileSync(path.join(input,row.wasm));assert.equal(hash(bytes),row.sha256);return {...row,bytes,module:new WebAssembly.Module(bytes)};}
function batch(row,iterations){
 global.gc();const cpu=process.cpuUsage(),wall=process.hrtime.bigint();let instantiate=0,execute=0;
 for(let i=0;i<iterations;i++){
  const r=h.execute(row.module,{...row.options,slots:row.width?row.width*4:4,quiet:true});
  instantiate+=r.cost.instantiationNs;execute+=r.cost.executionNs;
  assert.deepEqual(strip(r),row.expected);assert.deepEqual(r.calls,row.calls);
  assert.equal(r.cost.initialMemory,row.memory.initial);assert.equal(r.cost.finalMemory,row.memory.final);
 }
 const elapsed=Number(process.hrtime.bigint()-wall)/1000,used=process.cpuUsage(cpu);
 return {instantiationUs:instantiate/1000/iterations,executionUs:execute/1000/iterations,combinedUs:(instantiate+execute)/1000/iterations,batchWallUs:elapsed/iterations,batchCpuUs:(used.user+used.system)/iterations};
}
try{
 const groups=new Map();for(const row of proof.workloads){const key=row.width+'/'+row.scenario;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(load(row));}
 for(const [key,rows] of groups){
  const width=rows[0].width,iterations=Math.max(2,Math.floor(settings.rootsPerBatch/(width||1))),samples=[];
  for(let round=-settings.warmupRounds;round<settings.rounds;round++){
   guard();const start=((round%rows.length)+rows.length)%rows.length,order=Array.from({length:rows.length},(_,i)=>rows[(i+start)%rows.length]);
   const values={};for(const row of order)values[row.variant]=batch(row,iterations);
   if(round>=0)samples.push({round,order:order.map(r=>r.variant),values});
  }
  const control=width?'off':'production',aggregates={},comparisons={};
  for(const row of rows){aggregates[row.variant]=Object.fromEntries(Object.keys(samples[0].values[row.variant]).map(k=>[k,summary(samples.map(s=>s.values[row.variant][k]))]));if(row.variant!==control)comparisons[row.variant]=paired(samples.map(s=>s.values[control].executionUs),samples.map(s=>s.values[row.variant].executionUs));}
  receipt.applications.push({key,width,scenario:rows[0].scenario,iterations,artifacts:rows.map(r=>({variant:r.variant,sha256:r.sha256,memory:r.memory,diagnosticBankBytes:r.diagnosticBankBytes})),samples,aggregates,comparisons});save();console.log('measured - '+key);
 }
 for(const width of [1,8,16,32]){
  const bytes=fs.readFileSync(path.join(input,'width-'+width,'ledger/module.wasm')),record=proof.artifacts.find(a=>a.name==='ledger-'+width);assert.equal(hash(bytes),record.sha256);
  const e=new WebAssembly.Instance(new WebAssembly.Module(bytes),{}).exports;
  for(const mode of [0,1,2]){
   assert.equal(e.cycle(settings.ledgerWarmup,mode),width*(mode===0?1:mode===1?3:4)*settings.ledgerWarmup);
   const samples=[];for(let round=0;round<settings.rounds;round++){
    guard();global.gc();const before=process.hrtime.bigint(),cpu=process.cpuUsage();const checksum=e.cycle(settings.ledgerCycles,mode);const wall=Number(process.hrtime.bigint()-before)/1000,used=process.cpuUsage(cpu);
    assert.equal(checksum,width*(mode===0?1:mode===1?3:4)*settings.ledgerCycles);assert.equal(e.records(),0);assert.equal(e.memory.buffer.byteLength,65536);
    samples.push({wallUsPerCohort:wall/settings.ledgerCycles,cpuUsPerCohort:(used.user+used.system)/settings.ledgerCycles,checksum});
   }
   receipt.ledger.push({width,mode,sha256:record.sha256,bankBytes:e.banks(),memoryBytes:e.memory.buffer.byteLength,samples,summary:summary(samples.map(s=>s.wallUsPerCohort))});save();
  }
  console.log('measured - ledger '+width);
 }
 for(const width of [1,8,16,32])for(const variant of ['counts','sampled','events']){
  const row=load(proof.workloads.find(r=>r.width===width&&r.variant===variant&&r.scenario==='miss'));
  const dir=path.join(input,'width-'+width,'generated');const artifact={wasm:row.bytes,plan:JSON.parse(fs.readFileSync(path.join(dir,'fixture.plan.json'))),canonicalPlan:JSON.parse(fs.readFileSync(path.join(dir,'fixture.canonical-plan.json'))),control:{wasm:fs.readFileSync(path.join(input,'width-'+width,'off/module.wasm'))}};
  const samples=[];for(let round=-3;round<settings.rounds;round++){
   guard();global.gc();const raw=h.execute(row.module,{miss:true,slots:width*4,quiet:true,collect:true});const begin=process.hrtime.bigint(),report=project(artifact,raw),middle=process.hrtime.bigint(),json=JSON.stringify(report),end=process.hrtime.bigint();assert(report.runtime);if(round>=0)samples.push({captureUs:raw.cost.captureNs/1000,projectionUs:Number(middle-begin)/1000,serializationUs:Number(end-middle)/1000,serializedBytes:Buffer.byteLength(json)});
  }
  receipt.reports.push({width,variant,samples,summary:Object.fromEntries(['captureUs','projectionUs','serializationUs','serializedBytes'].map(k=>[k,summary(samples.map(s=>s[k]))]))});save();
 }
 assert.equal(receipt.applications.length,17);assert.equal(receipt.ledger.length,12);assert.equal(receipt.reports.length,12);
 receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;console.error(e.stack);process.exitCode=1;}
receipt.elapsedSeconds=(Date.now()-started)/1000;save();console.log(JSON.stringify({status:receipt.status,applications:receipt.applications.length,ledger:receipt.ledger.length,reports:receipt.reports.length,elapsedSeconds:receipt.elapsedSeconds}));
