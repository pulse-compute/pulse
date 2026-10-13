'use strict';
// Uninstrumented timing only. Each sample owns a process; every request creates
// a fresh instance. Includes the injected host, validation/instantiation and
// response assertions, not Fastly engine/service latency. No forced GC.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {candidateIdentity}=require('../../../scripts/release-feature-acceptance.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const root=path.resolve(__dirname,'../../..');
const quantile=(values,p)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))];};
const [mode,input,output]=process.argv.slice(2);
if(mode==='--sample') {
  const job=JSON.parse(fs.readFileSync(input)),wasm=fs.readFileSync(job.wasm);
  assert.equal(hash(wasm),job.sha256);
  const {executeFastlyNativePlatformCapabilities:execute}=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
  const rows=[];const initialRss=process.memoryUsage().rss;
  const cpu=process.cpuUsage(),started=performance.now();
  for(let i=0;i<job.count;i++){
    const t=performance.now(),c=process.cpuUsage();
    const result=execute(wasm,{request:{method:'POST',path:'/encode',headers:[['content-type','application/json']],body:'{"text":"a"}'}});
    assert.equal(result.response.status,200);assert.equal(hash(result.response.body),job.responseSha256);
    rows.push({wallMs:performance.now()-t,cpuUs:Object.values(process.cpuUsage(c)).reduce((a,b)=>a+b,0),capacityBytes:result.instance.exports.memory.buffer.byteLength,rssBytes:process.memoryUsage().rss});
  }
  fs.writeFileSync(output,JSON.stringify({status:'passed',job,initialRss,peakRssBytes:process.resourceUsage().maxRSS*1024,wallMs:performance.now()-started,cpuUs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0),rows},null,2)+'\n');
} else {
  assert.equal(mode,'--out');assert(!fs.existsSync(output));
  const source=candidateIdentity(root);assert.equal(source.workingTree,'');
  const diagnostic=JSON.parse(fs.readFileSync(path.join(input,'report.json')));assert.equal(diagnostic.status,'passed');
  fs.mkdirSync(output,{recursive:true});
  const report={schemaVersion:'pulse.mem9-02-cost.v1',status:'running',source,domain:'injected Fastly ABI; fresh-instance process sweeps, small payload, includes host and instantiation',counts:[1,11,41,128,256],repeats:3,samples:[]};
  const persist=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
  try {
    for(let repeat=0;repeat<3;repeat++)for(const count of report.counts)for(const variant of ['default','elided']) {
      // Counterbalance each pair and reverse across repeats/counts.
      const order=(repeat+report.counts.indexOf(count))%2?['numeric','boxed']:['boxed','numeric'];
      for(const strategy of order){
        const worker=diagnostic.workers.find(w=>w.variant===variant&&w.strategy===strategy),row=worker.rows.find(r=>r.mode==='control'&&r.shape==='small');
        const name=`${repeat}-${count}-${strategy}-${variant}`,job={repeat,count,strategy,variant,wasm:path.resolve(input,strategy+'-'+variant,'control.wasm'),sha256:row.sha256,responseSha256:row.responseSha256};
        const jobFile=path.join(output,name+'.job.json'),resultFile=path.join(output,name+'.json');fs.writeFileSync(jobFile,JSON.stringify(job));
        const run=child.spawnSync(process.execPath,[__filename,'--sample',jobFile,resultFile],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
        fs.writeFileSync(path.join(output,name+'.log'),(run.stdout||'')+(run.stderr||''));assert.equal(run.status,0,run.stderr||run.error?.message);
        const result=JSON.parse(fs.readFileSync(resultFile));assert.equal(result.status,'passed');assert.equal(result.rows.length,count);assert.deepEqual(result.job,job);
        report.samples.push({file:path.basename(resultFile),sha256:hash(fs.readFileSync(resultFile)),...result});persist();
      }
      console.log(`ok - cost ${repeat+1}/3 count ${count} ${variant}`);
    }
    assert.equal(report.samples.length,60);assert.deepEqual(candidateIdentity(root),source);
    report.summary=['default','elided'].flatMap(variant=>report.counts.flatMap(count=>['boxed','numeric'].map(strategy=>{
      const samples=report.samples.filter(s=>s.job.variant===variant&&s.job.count===count&&s.job.strategy===strategy),rows=samples.flatMap(s=>s.rows);
      return {variant,count,strategy,samples:samples.length,requests:rows.length,wallMedianMs:quantile(rows.map(r=>r.wallMs),0.5),wallP95Ms:quantile(rows.map(r=>r.wallMs),0.95),cpuMedianUs:quantile(rows.map(r=>r.cpuUs),0.5),cpuP95Us:quantile(rows.map(r=>r.cpuUs),0.95),peakRssMedianBytes:quantile(samples.map(s=>s.peakRssBytes),0.5)};
    })));
    report.status='passed';
  }catch(e){report.status='failed';report.error=e.stack;throw e;}finally{persist();}
}
