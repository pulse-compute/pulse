'use strict';
// Local JS prototype measurements. No Native, host throughput or latency claim.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks'),{execFileSync}=require('node:child_process');
const {Ledger}=require('./service.cjs'),{config,profile,v,bind,release,admitted}=require('./check.cjs');
const {executionHooks,providerCall}=require('./provider-hooks.cjs'),{bridge}=require('./javascript-bridge.cjs');
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
function stats(samples){return{medianUs:median(samples),minUs:Math.min(...samples),maxUs:Math.max(...samples),samplesUs:samples};}
function cycle(n,scenario){
  const l=new Ledger(config(n)),roots=admitted(l,n),claims=[];
  const light=scenario==='hit'||scenario==='retained';
  for(let i=0;i<n;i++){
    const r=roots[i];for(let j=0;j<(light?1:3);j++){const c=l.child(r);l.settleChild(r,c);}
    const row=[];for(let j=0;j<(light?1:3);j++)row.push(bind(l,r,i*10+j,v(1,64,j===2?2:1)));claims.push(row);
  }
  l.chargeExit(v(2,64,2));
  if(['cleanup','unknown','mixed'].includes(scenario)){
    if(scenario==='cleanup')l.stop();
    const cleanup=roots.map((r,i)=>bind(l,r,i*10+3,v(2,64,2),'cleanup'));
    cleanup.forEach(t=>release(l,t,v(2,64,2)));
  }
  for(let i=0;i<n;i++){
    const unknown=scenario==='unknown'||(scenario==='mixed'&&i%2===0);
    if(unknown)l.observe(claims[i][0],'unresolved','unknown');else if(scenario!=='retained')release(l,claims[i][0]);
    for(let j=1;j<claims[i].length;j++)release(l,claims[i][j],v(1,64,j===2?2:1));
    l.finish(roots[i]);
  }
  if(scenario==='retained'){
    const cleanup=roots.map((r,i)=>bind(l,r,i*10+3,v(2,64,2),'cleanup'));
    for(let i=0;i<n;i++){release(l,cleanup[i],v(2,64,2));release(l,claims[i][0]);}
  }
  l.end();return l;
}
function memory(n){
  if(!global.gc)throw Error('memory worker requires --expose-gc');
  // One fresh process per sample: reclaiming a previous batch can overlap the
  // next GC and corrupt an ArrayBuffer delta even while heap GC has completed.
  const keep=[],batch=256;global.gc();global.gc();const before=process.memoryUsage();
  for(let i=0;i<batch;i++)keep.push(new Ledger(config(n)));
  global.gc();const after=process.memoryUsage();
  const exact=keep[0].storage();if(keep.length!==batch)throw Error('strong retention missing');
  return{width:n,batch,heapBytesPerLedger:(after.heapUsed-before.heapUsed)/batch,
    arrayBufferBytesPerLedger:(after.arrayBuffers-before.arrayBuffers)/batch,exactBackingBytes:exact.backingBytes,
    caveat:'Heap delta is a local GC estimate including first-use effects, not a layout guarantee; backing bytes are exact. Neither includes host resource backing storage.'};
}
async function main(){
  const output=path.resolve(process.argv[2]||'/tmp/hex-ra03-measure.json');
  const receipt={version:'hex.ra03-measure.v1',status:'running',sourceBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,widths:[8,16,32],warmups:60,samples:7,repetitions:120,rows:[],scope:'Local JavaScript internal prototype. Synthetic handles/host calls; no production Native size, memory, Fastly quota, workload latency or throughput qualification.'};
  const inputFiles=['service.cjs','provider-hooks.cjs','javascript-bridge.cjs','check.cjs','measure.cjs','../ra02/policy.json','../../../../../packages/runtime/src/internal/effect-adapter.js'];
  const hashInputs=()=>inputFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')}));
  receipt.inputs=hashInputs();receipt.workingTree=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});
  const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');save();
  const enabledApi=bridge(true).api,disabledApi=bridge(false).api;
  const time=()=>({status:'ok',unixEpochMs:1000,iso8601:'1970-01-01T00:00:01.000Z'});
  async function execution(n,enabled){
    const api=enabled?enabledApi:disabledApi,l=enabled?new Ledger(config(n,{profiles:[{...profile,effects:1}]})):null;
    let hostCalls=0;
    const adapter=api.createJavascriptEffectAdapter({id:'ra03-matched-control',async dispatch(d,x){
      const invoke=()=>({outputs:[++hostCalls]});
      if(l){const ts=await providerCall(l,x.accountingRoot,[v(1,64,1)],invoke);for(const t of ts)release(l,t);}else await invoke();
      return time();
    }});
    const e=api.createJavascriptEffectExecution({effectAdapter:adapter,...(l?{resourceAccounting:executionHooks(l,()=>0)}:{})});
    const group={};for(let i=0;i<n;i++)group['k'+i]=e.dispatch({kind:'time.now'});
    const result=await e.parallel(group);await e.close();if(Object.keys(result).length!==n||hostCalls!==n)throw Error('unmatched host work');
  }
  try{
    for(const n of receipt.widths){
      const memorySamples=Array.from({length:5},()=>JSON.parse(execFileSync(process.execPath,['--expose-gc',__filename,'--memory',String(n)],{encoding:'utf8'})));
      const row={width:n,storage:new Ledger(config(n)).storage(),cycles:[],memory:{samples:memorySamples,medianHeapBytesPerLedger:median(memorySamples.map(s=>s.heapBytesPerLedger)),medianArrayBufferBytesPerLedger:median(memorySamples.map(s=>s.arrayBufferBytesPerLedger))}};
      for(const scenario of ['hit','miss','cleanup','unknown','retained','mixed']){
        for(let i=0;i<receipt.warmups;i++)cycle(n,scenario);
        const samples=[],cpuSamples=[];
        for(let sample=0;sample<receipt.samples;sample++){const start=performance.now(),cpuStart=process.cpuUsage();for(let i=0;i<receipt.repetitions;i++)cycle(n,scenario);const cpu=process.cpuUsage(cpuStart);cpuSamples.push((cpu.user+cpu.system)/receipt.repetitions);samples.push((performance.now()-start)*1000/receipt.repetitions);}
        row.cycles.push({scenario,...stats(samples),processCpu:stats(cpuSamples),allocations:cycle(n,scenario).storage()});
      }
      for(let i=0;i<receipt.warmups;i++){await execution(n,false);await execution(n,true);}
      const off=[],on=[],offCpu=[],onCpu=[];
      for(let sample=0;sample<receipt.samples;sample++)for(const enabled of sample%2?[true,false]:[false,true]){
        const start=performance.now(),cpuStart=process.cpuUsage();for(let i=0;i<receipt.repetitions;i++)await execution(n,enabled);const cpu=process.cpuUsage(cpuStart);
        (enabled?onCpu:offCpu).push((cpu.user+cpu.system)/receipt.repetitions);
        (enabled?on:off).push((performance.now()-start)*1000/receipt.repetitions);
      }
      row.executor={disabled:stats(off),enabled:stats(on),differenceOfMediansUs:median(on)-median(off),disabledProcessCpu:stats(offCpu),enabledProcessCpu:stats(onCpu),differenceOfCpuMediansUs:median(onCpu)-median(offCpu),control:'Same real JS executor, keyed cohort, synthetic time result and host stub; ledger construction and private hooks included; bridge compilation excluded.'};
      receipt.rows.push(row);save();console.log(JSON.stringify({width:n,backingBytes:row.storage.backingBytes,missUs:row.cycles.find(c=>c.scenario==='miss').medianUs,executorDeltaUs:row.executor.differenceOfMediansUs}));
    }
    receipt.status='passed';
  }catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;}
  if(JSON.stringify(hashInputs())!==JSON.stringify(receipt.inputs)){receipt.status='failed';receipt.error='Measurement inputs changed during execution';process.exitCode=1;}save();console.log(JSON.stringify({status:receipt.status,output,error:receipt.error}));
}
if(process.argv[2]==='--memory')process.stdout.write(JSON.stringify(memory(Number(process.argv[3]))));else main();
