'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const H=require('./context-quality-harness.cjs'),oracle=require('./context-search-oracle.cjs');
const frozen=require('./context-quality-cases.json'),limits=frozen.budgets;
const mode=process.argv[2]||'actual';assert(['actual','growth','repeat'].includes(mode));
const out=process.env.PULSE_CONTEXT_QUALITY_DIR||path.join(H.root,'wasm/.test-results/context-quality');fs.mkdirSync(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:H.root,encoding:'utf8'}).trim();
const report={schemaVersion:'pulse.context-quality-evidence.v1',mode,status:'running',acceptance:'pending',source:{revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--short'),modifiedFiles:git('ls-files','--modified','--others','--exclude-standard').split('\n').filter(Boolean).map(file=>({path:file,sha256:H.sha(fs.readFileSync(path.join(H.root,file)))}))},frozenCasesSha256:H.sha(fs.readFileSync(path.join(__dirname,'context-quality-cases.json'))),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,lockfileSha256:H.sha(fs.readFileSync(path.join(H.root,'pnpm-lock.yaml')))},budgets:limits,queries:[],failures:[],timing:[],faults:[],executions:0,limitations:['Injected Fastly ABI; not CLI/Viceroy or provider reality.','Warm samples reuse artifacts with fresh request instances; not retained-instance execution.','Node CPU is process CPU for the complete host execution and serialization, not isolated guest instructions.','Committed Wasm pages are monotonic high-water capacity, not live heap.','Retained bytes/values are conservative cumulative budget charges, not exact allocation counts.','Exact internal guest and JS allocation counts and peak live-object heap are unavailable through current evidence surfaces.','Frozen relevance cases are proposed for review; independent human relevance review is not claimed.']};
const save=()=>fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify(report,null,2)+'\n');
const fail=(criterion,detail)=>report.failures.push({criterion,detail});
function outcome(value){return {status:value.status,totalMatches:value.totalMatches,ids:value.results?.map(r=>r.id)||[],scores:value.results?.map(r=>r.score)||[]};}
function relevant(c,value){const ids=value.results?.map(r=>r.id)||[];switch(c.criterion){case 'rank-one':return c.relevantIds.includes(ids[0]);case 'top-five':return ids.slice(0,5).some(id=>c.relevantIds.includes(id));case 'empty':return value.status==='ok'&&value.totalMatches===0;case 'invalid-input':return value.status==='invalid-input';case 'ambiguous':return value.status==='ok'&&value.totalMatches>5;default:throw Error(c.criterion);}}
function decoded(result){
 assert.equal(result.response.status,200,result.response.body);assert(Buffer.byteLength(result.response.body)<=limits.mcpBytes);
 const reply=JSON.parse(result.response.body);assert(!reply.error,JSON.stringify(reply));assert.equal(reply.result.isError,false);assert(Buffer.byteLength(JSON.stringify(reply.result))<=limits.toolBytes);
 assert.deepEqual(JSON.parse(reply.result.content[0].text),reply.result.structuredContent);return reply.result.structuredContent;
}
async function parity(app,input){
 const expected=oracle.search(app.corpus,app.config,input);
 for(const target of ['node','fastly','javascript']){
  const result=await H.execute(app,target,input);assert.deepEqual(decoded(result),expected,JSON.stringify({mode,target,input}));report.executions++;
  if(target!=='javascript'){
   assert(result.memory.bytes<=limits.retainedBytes);assert(result.guestMemoryBytes<=limits.guestCommittedBytes);if(target==='node')assert(result.valueHandleCount<=limits.nodeValueHandles);
  }
 }
 return expected;
}
async function measure(app,input){
 fs.writeFileSync(path.join(app.cwd,'cold.json'),JSON.stringify({plan:app.native.plan,request:H.request(input)}));
 for(const target of ['node','fastly']){
  fs.writeFileSync(path.join(app.cwd,target+'.wasm'),app[target==='node'?'native':'fastly'].wasm);
  const cold=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'context-quality-cold.cjs'),app.cwd,target],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
  assert.equal(cold.status,200);assert(cold.wallMs<limits.requestMs);assert(cold.cpuMs<limits.requestMs);report.executions++;
  const warm=[];
  for(let i=0;i<limits.warmSamples;i++){
   const cpu=process.cpuUsage(),start=performance.now();const r=await H.execute(app,target,input);const elapsed=performance.now()-start,used=process.cpuUsage(cpu);decoded(r);assert.equal(H.sha(r.response.body),cold.responseSha256);report.executions++;
   assert(elapsed<limits.requestMs);assert((used.user+used.system)/1000<limits.requestMs);assert(r.memory.bytes<=limits.retainedBytes);assert(r.guestMemoryBytes<=limits.guestCommittedBytes);
   warm.push({wallMs:elapsed,cpuMs:(used.user+used.system)/1000,memory:r.memory,guestMemoryBytes:r.guestMemoryBytes,valueHandleCount:r.valueHandleCount,responseBytes:Buffer.byteLength(r.response.body)});
  }
  const median=key=>[...warm].sort((a,b)=>a[key]-b[key])[Math.floor(warm.length/2)][key];
  report.timing.push({target,input,cold,warm,medianWallMs:median('wallMs'),medianCpuMs:median('cpuMs')});save();
 }
}
async function phases(app,input){
 const baseline=await H.observe(app,input);if(baseline.error)throw baseline.error;
 assert.deepEqual(decoded(baseline.result),oracle.search(app.corpus,app.config,input));report.observation=baseline.observation;report.observation.faultMethod='Deadline elapsed at named phase entry (checked at next existing checkpoint); allocation ceiling reduced at the next real charge. Production policy unchanged. Request-phase zero-headroom fault preserves any masking diagnostic.';
 // Observe passive equivalence against an unwrapped complete response.
 assert.equal((await H.execute(app,'node',input)).response.body,baseline.result.response.body);
 for(const phase of ['request','callable-input','computation','callable-output','mcp-serialization'])for(const kind of ['deadline','allocation']){
  const attempt=await H.observe(app,input,{phase,kind});
  const code=attempt.error?.code,body=attempt.result?.response?.body;
  const noSuccess=!!attempt.error||attempt.result?.response?.status!==200||!JSON.parse(body).result?.structuredContent;
  const expected=kind==='deadline'?'PULSE_REQUEST_DEADLINE_EXCEEDED':'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED';
  const enforced=attempt.observation.triggered&&noSuccess&&(kind==='allocation'&&!!attempt.error||code===expected||kind==='deadline'&&[408,504].includes(attempt.result?.response?.status));
  report.faults.push({phase,kind,enforced,noPartialSuccess:noSuccess,...attempt.observation});
  if(!enforced)fail('phase-failure-proof',{phase,kind,triggered:attempt.observation.triggered,code});
  assert.deepEqual(decoded(await H.execute(app,'node',input)),oracle.search(app.corpus,app.config,input),'fresh request after fault');
 }
 // Actual Fastly deadline enforcement at fixed fractions of the baseline clock
 // sampling sequence, not a claim of mapping internal guest phases to fractions.
 let samples=0;await H.execute(app,'fastly',input,{monotonicClock:()=>{samples++;return {nanoseconds:0n};}});
 for(const fraction of [0,0.25,0.5,0.75,0.99]){
  let ticks=0,result,error;try{result=await H.execute(app,'fastly',input,{monotonicClock:()=>({nanoseconds:++ticks>Math.max(1,Math.floor(samples*fraction))?5001000000n:0n})});}catch(e){error=e;}
  const status=result?.response.status;const noSuccess=!!error||status!==200||!JSON.parse(result.response.body).result?.structuredContent;
  assert(noSuccess,'Fastly expired request must not return partial success');report.faults.push({target:'fastly',kind:'deadline',fraction,baselineClockChecks:samples,clockChecks:ticks,status,code:error?.code,noPartialSuccess:noSuccess});
 }
 save();
}
async function main(){
 const built=H.B.construct(H.root);assert.equal(H.B.run().changedFiles,0);
 for(const c of frozen.cases)for(const id of c.relevantIds)assert(built.corpus.records.some(r=>r.id===id),'unknown frozen relevant ID '+id);
 assert.equal(frozen.cases.length,24);for(const group of ['exact','workflow','filtered','failure'])assert.equal(frozen.cases.filter(c=>c.group===group).length,6);
 const corpus=mode==='growth'?H.growth(built):built.corpus;
 let app;
 try{
  app=H.build(built,corpus,mode==='repeat'?2:1);report.artifact=app.receipt;
  for(const target of ['node','fastly']){assert(app.receipt[target].bytes<limits.artifactBytes);assert(app.receipt[target].compileMs<limits.compileMs);const text=app.receipt[target].resourceBackings.find(r=>r.id==='context.text');assert.equal(text.physicalFullCopies,1);}
  save();console.log(JSON.stringify({checkpoint:'compiled',mode,nodeBytes:app.receipt.node.bytes,fastlyBytes:app.receipt.fastly.bytes}));
  const input={version:corpus.pulseVersion,query:mode==='growth'?'growth0000 growth0001 growth0002 growth0003 growth0004 growth0005 growth0006 growth0007':'schema',offset:mode==='growth'?55:0,limit:5};
  await measure(app,input);
  if(mode==='actual'){
   for(const c of frozen.cases){
    const args={version:corpus.pulseVersion,...c.input},v1=app.legacy.search(null,args),v2=await parity(app,args),passes=relevant(c,v2),v1Passes=relevant(c,v1);
    const rank=value=>{const n=value.results?.findIndex(r=>c.relevantIds.includes(r.id));return n>=0?n+1:null;};
    const v1Rank=rank(v1),v2Rank=rank(v2);
    const item={v1RelevantRank:v1Rank,v2RelevantRank:v2Rank,id:c.id,group:c.group,input:c.input,criterion:c.criterion,relevantIds:c.relevantIds,v1:outcome(v1),v2:outcome(v2),passes,v1Passes,declined:(v1Passes&&!passes)||(v1Rank!==null&&(v2Rank===null||v2Rank>v1Rank))};report.queries.push(item);if(!passes)fail('relevance',item);
    // Page every admitted query independently at widths 1 and 5, including the
    // empty terminal page and first invalid offset. Exact oracle includes citations.
    if(v2.status==='ok')for(const limit of [1,5]){let offset=0;for(;;){const page=await parity(app,{...args,limit,offset});if(!page.truncated)break;assert(page.nextOffset>offset);offset=page.nextOffset;}
     await parity(app,{...args,limit,offset:v2.totalMatches});await parity(app,{...args,limit,offset:v2.totalMatches+1});}
    save();
   }
   await phases(app,input);
   fail('exact-allocation-telemetry','Current interfaces expose retained charges and Wasm page capacity, not all internal allocations or peak live-object heap. No invented measurement.');
   if(frozen.reviewStatus!=='reviewed')fail('independent-relevance-review','24 cases frozen before runs; external relevance review still required by the reviewed contract.');
  }else if(mode==='growth'){
   assert.equal(corpus.records.length,512);
   for(const args of [input,{...input,offset:0},{...input,offset:59,limit:1},{...input,offset:60},{...input,offset:61},{version:corpus.pulseVersion,query:'growth1199'},{version:corpus.pulseVersion,query:'unknownterm'}])await parity(app,args);
   // No row is dropped to get a reply: oversized first page must fail closed.
   assert.equal((await parity(app,{...input,offset:0})).status,'response-too-large');
   await phases(app,input);
  }else{await parity(app,input);await phases(app,input);}
  report.status='completed';report.acceptance=report.failures.length?'blocked':'passed';save();
  console.log(JSON.stringify({status:report.status,acceptance:report.acceptance,mode,executions:report.executions,failures:report.failures,receipt:path.join(out,mode+'.json')}));
  // Registered execution enforces acceptance. --measure-only is an explicit
  // development evidence mode and cannot be used as an acceptance receipt.
  if(!process.argv.includes('--measure-only'))assert.equal(report.acceptance,'passed',JSON.stringify(report.failures));
 }finally{if(app)fs.rmSync(app.cwd,{recursive:true,force:true});}
}
main().catch(error=>{if(report.status!=='completed')report.status='failed';report.gate='failed';report.error={message:error.message,code:error.code,stack:error.stack,diagnostics:error.diagnostics,detail:error.detail};save();console.error(error,error.diagnostics);process.exitCode=1;});
