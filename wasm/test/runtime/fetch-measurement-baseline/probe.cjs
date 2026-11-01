'use strict';
// Opt-in measurement of production authoring/lowering. No source overlays,
// runtime switches, network traffic, or additional resource-accounting claims.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const cp = require('node:child_process'), crypto = require('node:crypto');
const {gzipSync} = require('node:zlib');
const {compileCanonicalSource} = require('../../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan} = require('../../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../../packages/compiler/src/canonical-native-compiler');
const {executeCanonicalNativeModule} = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const fastly = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities: execute} = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const nodeProvider = require('../../../../packages/provider-node/src/runtime/canonical-api-runtime');
const {resolveAsc} = require('../../../packages/build-support/src/assemblyscript-compile');
const root = path.resolve(__dirname, '../../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modes = ['off', 'collect', 'timing', 'both'];
const origin = 'https://measurement.test';
const payload = 'x'.repeat(96);
let randomState = 0x571be11;
function random() { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; }
function shuffle(array) { array = [...array]; for (let i=array.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [array[i],array[j]]=[array[j],array[i]]; } return array; }
function stats(values) {
  const s=[...values].sort((a,b)=>a-b), at=p=>s[Math.min(s.length-1,Math.floor((s.length-1)*p))];
  return {count:s.length,min:s[0],p10:at(.1),median:at(.5),p90:at(.9),max:s.at(-1)};
}
function mean(a) { return a.reduce((s,v)=>s+v,0)/a.length; }
function bootstrap(values) {
  const res=[];
  for(let i=0;i<3000;i++)res.push(mean(values.map(()=>values[Math.floor(random()*values.length)])));
  res.sort((a,b)=>a-b);return {mean:mean(values),low95:res[75],high95:res[2924]};
}
function sourceFor(width, mode, projection, deadline=false, numericReply=false) {
  const init = [mode==='collect'||mode==='both'?"errors:'collect'":'',mode==='timing'||mode==='both'?'timing:true':'',deadline?'timeoutMs:1000':''].filter(Boolean).join(',');
  const effect=i=>`ctx.fetch('${origin}/${i}'${init?',{'+init+'}':''})${projection==='text'?'.text()':''}`;
  const dispatch=width===1?`const result=await ${effect(0)};`:`const result=await ctx.parallel({${Array.from({length:width},(_,i)=>`r${i}:${effect(i)}`).join(',')}});`;
  // Constant response deliberately excludes JSON serialization and consumer
  // field access. The real provider still constructs/settles selected results.
  return `export default async function handler(ctx){${dispatch}return ${numericReply?'ctx.json({status:200})':"ctx.text('done')"}}`;
}
function identity(wasm) { return {bytes:wasm.length,gzipBytes:gzipSync(wasm).length,sha256:hash(wasm)}; }
function compile(out, width, mode, projection, deadline=false, numericReply=false) {
  const key=`${projection}-${width}-${mode}${deadline?'-deadline':''}${numericReply?'-numeric':''}`, directory=path.join(out,key);
  fs.mkdirSync(directory,{recursive:true});
  const authored=sourceFor(width,mode,projection,deadline,numericReply);fs.writeFileSync(path.join(directory,'handler.ts'),authored+'\n');
  const compiled=compileCanonicalSource(authored,{fileName:'measurement.ts',strict:false});
  const plan=buildCanonicalNativePlan(compiled);
  const edge=fastly.compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,emitWat:false,requirePlatformCapability:false,bindings:{backends:{[origin]:'origin'}}});
  fs.writeFileSync(path.join(directory,'fastly.wasm'),edge.wasm);
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(edge.manifest,null,2)+'\n');
  return {key,width,mode,projection,deadline,numericReply,plan,compiled,edge,identity:identity(edge.wasm),handlerSha256:hash(authored),resourceAccounting:edge.manifest.resourceAccounting||null};
}
function fixturesFor(a, scenario, staggered=false) {
  return Object.fromEntries(Array.from({length:a.width},(_,i)=>[origin+'/'+i,{body:payload,status:200,delayMs:staggered?a.width-i:0,headers:[['content-type','application/octet-stream']],...(scenario==='failure'&&i===0?{transportStatus:1}:{})}]));
}
function run(a,scenario,staggered=false) {
  let startWall,endWall,startCpu,endCpu;
  const r=execute(a.edge,{fixtures:fixturesFor(a,scenario,staggered),allowHandledTransportError:true,traceBodyIo:true,afterHostcall(c){
    if(c.module==='fastly_abi'&&c.name==='init'){startCpu=process.cpuUsage();startWall=process.hrtime.bigint();}
    if(c.module==='fastly_http_resp'&&c.name==='send_downstream'){endWall=process.hrtime.bigint();endCpu=process.cpuUsage();}
  }});
  assert(startCpu&&endCpu&&startWall!==undefined&&endWall!==undefined,'Execution bracket must be observed');
  const collected=a.mode==='collect'||a.mode==='both';
  assert.equal(r.response.status,scenario==='failure'&&!collected?502:200);
  if(r.response.status===200)assert.equal(r.response.body,a.numericReply?'{"status":200}':'done');
  assert.equal(r.outboundRequests.length,a.width,'Every intended request dispatches once');
  const counts={};for(const t of r.trace){const key=t.module+'.'+t.name;counts[key]=(counts[key]||0)+1;}
  if(a.projection==='raw')assert.equal(counts['fastly_http_body.read']||0,0,'Raw metadata must not read bodies');
  const e=r.instance.exports;
  return {cpuUs:endCpu.user-startCpu.user+endCpu.system-startCpu.system,wallUs:Number(endWall-startWall)/1000,status:r.response.status,
    linearMemoryBytes:e.memory.buffer.byteLength,retainedValues:e.pulse_fastly_memory_values?.()??null,
    transportResources:r.transportResources,fixtureResiduals:r.forwardingResources,counts};
}
function metric(r) { const {cpuUs,wallUs,...rest}=r;return rest; }
function memorySnapshot() { const m=process.memoryUsage();return {...m,activeResources:process.getActiveResourcesInfo().sort()}; }
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function quiesce() { await tick();if(global.gc)global.gc();await tick();if(global.gc)global.gc();await tick(); }
async function nodeCycles(a,out,cycles) {
  const native=compileCanonicalNativePlan(a.plan,{cwd:root,emitWat:false});
  fs.writeFileSync(path.join(out,a.key,'node.wasm'),native.wasm);
  const state={opened:0,ended:0,cancelled:0,active:0,peak:0,dispatches:0};
  let fail=false;const weakBodies=[];
  const fetchImplementation=async(url)=>{
    state.dispatches++;
    if(fail&&url===origin+'/0')throw new TypeError('controlled transport failure');
    state.opened++;state.active++;state.peak=Math.max(state.peak,state.active);let sent=false,closed=false;
    const close=kind=>{if(closed)return;closed=true;state.active--;state[kind]++;};
    const response=new Response(new ReadableStream({
      pull(c){if(!sent){sent=true;c.enqueue(new TextEncoder().encode(payload));}else {close('ended');c.close();}},
      cancel(){close('cancelled');}
    },{highWaterMark:0}),{headers:{'content-type':'application/octet-stream'}});
    weakBodies.push(new WeakRef(response.body));return response;
  };
  const options={fetchImplementation};
  let successes=0,failures=0,completionValues=[],warmBodies;
  async function invoke(n){
    fail=!!(n%2);
    try {const r=await executeCanonicalNativeModule(native,{...options,providerAdapter:nodeProvider.createNodeProviderAdapter(options)});
      assert.equal(r.response.status,200);assert.equal(r.response.body,'done');
      assert(!fail||a.mode==='collect'||a.mode==='both','Noncollecting failures cannot become ordinary success');
      completionValues.push(r.valueHandleCount);successes++;
    } catch(e) {
      assert(fail&&a.mode!=='collect'&&a.mode!=='both',e.stack);assert.equal(e.code,'PULSE_FETCH_NETWORK');failures++;
    }
    await tick();
  }
  for(let n=0;n<8;n++)await invoke(n);
  warmBodies=state.active;completionValues=[];successes=failures=0;
  await quiesce();const warmReachableBodies=weakBodies.filter(ref=>ref.deref()!==undefined).length;
  const before=memorySnapshot(),checkpoints=[];
  const prior={...state};
  for(let n=0;n<cycles;n++){
    await invoke(n);
    if(n===Math.floor(cycles/2)-1||n===cycles-1){await quiesce();checkpoints.push({cycles:n+1,memory:memorySnapshot(),notExplicitlyFinishedBodies:state.active,reachableBodyWeakRefs:weakBodies.filter(ref=>ref.deref()!==undefined).length,completionValueHandles:stats(completionValues)});}
  }
  assert.equal(state.dispatches-prior.dispatches,cycles*a.width);
  return {key:a.key,identity:identity(native.wasm),cycles,successes,failures,transport:'Real Node adapter with controlled Web Response/ReadableStream; no sockets or remote network',
    warmUnfinishedBodies:warmBodies,warmReachableBodies,unfinishedBodiesAfter:state.active,bodies:{opened:state.opened-prior.opened,ended:state.ended-prior.ended,cancelled:state.cancelled-prior.cancelled},
    peakUnfinishedBodies:state.peak,completionValueHandles:stats(completionValues),before,checkpoints};
}
async function main(out,quick=false) {
  out=path.resolve(out);fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'Use a fresh evidence directory');
  assert(global.gc,'Run with --expose-gc for explicit memory checkpoints');
  const widths=quick?[1,8]:[1,8,16,32],rounds=quick?3:7,batch=quick?2:12,warmups=quick?3:40,cycles=quick?4:64;
  const asc=resolveAsc(root)||resolveAsc(path.join(root,'wasm/packages/compiler')), git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  assert(asc,'Restore the existing lockfile-pinned AssemblyScript dependency');
  const report={version:'pulse.fetch-measurement-baseline.v1',status:'running',candidate:{revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),workingTree:git('status','--porcelain=v1')},
    harnessSha256:hash(fs.readFileSync(__filename)),toolchain:{node:process.version,assemblyscript:JSON.parse(fs.readFileSync(path.join(asc.packageRoot,'package.json'))).version,cpu:os.cpus()[0]?.model,platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,loadStart:os.loadavg()},
    design:{widths,stressWidth:32,projections:['raw','text'],modes,rounds,batch,warmups,cycles,seed:'0x571be11',failure:'first dispatched member returns transport error; others succeed',
      cpuBracket:'post-init host callback through response-handoff host callback; excludes Wasm compile/instantiate, result extraction and post-handoff guest work; includes instrumented JS ABI host callbacks',
      repetition:'fresh supported HTTP instances, compiled bytes reused; no single-use _start replay',memory:'Wasm linear high-water capacity and Node process GC checkpoints; not exact retained heap accounting'},
    matrix:[],cpu:[],deadlineControls:[],numericControls:[],staggered:[],nodeCycles:[],limitations:[
      'Controlled generated Wasm plus injected ABI CPU; not production Fastly CPU, network latency or a throughput/SLA claim.',
      'Constant response excludes result serialization/consumer field access; semantic option coverage remains owned by existing fetch outcome/timing regressions.',
      'Success mode deltas use within-round disabled pairs and a repeated-disabled noise control. Bootstrap intervals describe these process samples, not machine/host generalization.',
      'Failure modes have different intentional semantics (ordinary 502 versus collected 200); do not interpret their cost difference as equivalent-work speedup.',
      'Fresh HTTP invocation resources are measured. This does not qualify same-instance reuse, dynamic-sized collections or unknown pending-request timeout teardown.',
      'Fixture residual body/response counts include host-retained input and assertion snapshots; compare with controls, not an assumed zero.',
      'Existing resource-accounting admission is reported as-is. This measurement does not certify new envelope allocations or expand the contract.',
      'Node body lifecycle uses the real adapter with controlled streams; GC/RSS checkpoints and completion-time value-handle counts are observations, not byte-accurate leak certification.',
      'Unfinished-body counters mean no explicit EOF/cancel callback, not live retained handles. WeakRef reachability is sampled after two GC/event-loop turns to distinguish collection from explicit disposal.'
    ]};
  const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');save();
  try {
    const artifacts=new Map();
    for(const projection of ['raw','text'])for(const width of widths)for(const mode of modes){
      const a=compile(out,width,mode,projection);artifacts.set(a.key,a);
      const success=run(a,'success'),failure=run(a,'failure');
      report.matrix.push({key:a.key,width,mode,projection,...a.identity,handlerSha256:a.handlerSha256,resourceAccounting:a.resourceAccounting,success:metric(success),failure:metric(failure)});
      console.log('compiled',a.key,a.identity.bytes);save();
    }
    for(const a of artifacts.values())for(const scenario of ['success','failure'])for(let n=0;n<warmups;n++)run(a,scenario);
    for(const projection of ['raw','text'])for(const width of widths)for(const scenario of ['success','failure']){
      const blocks=[];
      for(let round=0;round<rounds;round++){
        const block={round,order:shuffle([...modes,'off-repeat']),values:{}};
        for(const mode of block.order){
          const a=artifacts.get(`${projection}-${width}-${mode==='off-repeat'?'off':mode}`);
          if(global.gc)global.gc();
          const samples=Array.from({length:batch},()=>run(a,scenario));
          block.values[mode]={cpuUs:mean(samples.map(s=>s.cpuUs)),wallUs:mean(samples.map(s=>s.wallUs))};
        }
        blocks.push(block);
      }
      report.cpu.push({projection,width,scenario,blocks,summary:Object.fromEntries([...modes,'off-repeat'].map(mode=>{
        const delta=blocks.map(b=>b.values[mode].cpuUs-b.values.off.cpuUs);
        return [mode,{cpuUs:stats(blocks.map(b=>b.values[mode].cpuUs)),wallUs:stats(blocks.map(b=>b.values[mode].wallUs)),pairedCpuDeltaUs:bootstrap(delta),pairedCpuDeltaPercent:bootstrap(blocks.map(b=>100*(b.values[mode].cpuUs/b.values.off.cpuUs-1)))}];}))});
      console.log('sampled',projection,width,scenario);save();
    }
    // Existing deadline controls isolate activation of the established poll path.
    for(const width of widths)for(const mode of ['off','both']){
      const a=compile(out,width,mode,'raw',true);
      report.deadlineControls.push({key:a.key,width,mode,...a.identity,success:metric(run(a,'success'))});
      report.staggered.push({key:a.key,width,mode,...metric(run(a,'success',true))});save();
    }
    for(const width of [widths[0],widths.at(-1)])for(const mode of ['off','both']){
      const a=compile(out,width,mode,'raw',false,true);
      report.numericControls.push({key:a.key,width,mode,...a.identity,success:metric(run(a,'success'))});save();
    }
    for(const projection of ['raw','text'])for(const width of widths)for(const mode of modes){
      const a=artifacts.get(`${projection}-${width}-${mode}`),maxima={linearMemoryBytes:0,retainedValues:0},states=new Set();
      for(let i=0;i<cycles;i++){
        const r=run(a,i%2?'failure':'success');maxima.linearMemoryBytes=Math.max(maxima.linearMemoryBytes,r.linearMemoryBytes);maxima.retainedValues=Math.max(maxima.retainedValues,r.retainedValues||0);
        states.add(JSON.stringify({status:r.status,transport:r.transportResources,fixture:r.fixtureResiduals}));
      }
      report.matrix.find(x=>x.key===a.key).repeatedCycles={cycles,maxima,states:[...states].map(JSON.parse)};
      report.nodeCycles.push(await nodeCycles(a,out,cycles));console.log('cycles',a.key);save();
    }
    for(const row of report.matrix){
      const base=report.matrix.find(x=>x.width===row.width&&x.projection===row.projection&&x.mode==='off');row.wasmDeltaBytes=row.bytes-base.bytes;row.gzipDeltaBytes=row.gzipBytes-base.gzipBytes;
      row.successResourceDelta={transport:JSON.stringify(row.success.transportResources)!==JSON.stringify(base.success.transportResources),fixture:JSON.stringify(row.success.fixtureResiduals)!==JSON.stringify(base.success.fixtureResiduals)};
    }
    assert.equal(git('rev-parse','HEAD'),report.candidate.revision,'Candidate changed during measurement');
    assert.equal(git('status','--porcelain=v1'),report.candidate.workingTree,'Source tree changed during measurement');
    assert.equal(hash(fs.readFileSync(__filename)),report.harnessSha256,'Harness changed during measurement');
    report.toolchain.loadEnd=os.loadavg();report.status='passed';save();console.log('completed',path.join(out,'report.json'));
  } catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};save();throw error;}
}
module.exports={main,sourceFor,stats,bootstrap};
if(require.main===module){const out=process.argv[2];assert(out,'Usage: node --expose-gc probe.cjs FRESH_OUTPUT [--quick]');main(out,process.argv.includes('--quick')).catch(e=>{console.error(e);process.exitCode=1;});}
