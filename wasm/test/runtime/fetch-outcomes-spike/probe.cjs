'use strict';
// Opt-in evidence only. Generated-source overlays below are NOT a production
// implementation or an admission path for errors/timing authoring options.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const generator = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
const sha = data => createHash('sha256').update(data).digest('hex');
const modes = ['disabled', 'collect', 'timing', 'both'];
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, 'overlay anchor must occur exactly once: '+before.slice(0,100));
  return source.replace(before, after);
}
function handler(width, mode, projection, timeout) {
  const operation = i => `ctx.fetch('https://origin.test/${i}'${timeout ? ',{timeoutMs:1000}' : ''})${projection === 'text' ? '.text()' : ''}`;
  const fetches = width === 1 ? `const result = await ${operation(0)};` :
    `const result = await ctx.parallel({${Array.from({length:width},(_,i)=>`r${i}:${operation(i)}`).join(',')}});`;
  return `export default async function handler(ctx){${fetches}return ctx.text('done')}`;
}
function overlay(source, mode, projection) {
  const timing = mode==='timing'||mode==='both', collect = mode==='collect'||mode==='both';
  // Identical result observer in every mode. No public authoring admission is
  // bypassed: the handler awaits ordinary fetches and returns a constant reply.
  source = replaceOnce(source,'function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {',
    'function __spike_resolve_original(effectIndex: i32): i32 {');
  source += `
const __spike_results = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
export function spike_value_count(): i32 { return __pulse_fastly_value_count() }
export function spike_outcome(i:i32):i32 {
  const v=__pulse_fastly_value(__spike_results[i])
  ${mode==='disabled' ? 'return 1' : "return __pulse_fastly_string(v.values[__pulse_fastly_find(v,'status')])=='fulfilled'?1:2"}
}
export function spike_error(i:i32):i32 {
  ${mode==='disabled' ? 'return 0' : `if(spike_outcome(i)==1)return 0
  const v=__pulse_fastly_value(__spike_results[i]), error=__pulse_fastly_value(v.values[__pulse_fastly_find(v,'error')])
  return __pulse_fastly_string(error.values[__pulse_fastly_find(error,'code')])=='PULSE_FETCH_TIMEOUT'?1:2`}
}
export function spike_shape(i:i32):i32 {
  let v=__pulse_fastly_value(__spike_results[i])
  ${mode!=='disabled' ? "if(spike_outcome(i)!=1)return 0; v=__pulse_fastly_value(v.values[__pulse_fastly_find(v,'value')])" : ''}
  return v.kind==PULSE_VALUE_FETCH?1:v.kind==PULSE_VALUE_STRING?2:0
}
export function spike_elapsed(i:i32):f64 {
  ${timing ? "const v=__pulse_fastly_value(__spike_results[i]), e=__pulse_fastly_value(v.values[__pulse_fastly_find(v,'elapsedMs')]); return e.kind==PULSE_VALUE_NUMBER?e.number:-1" : 'return -1'}
}
`;
  if(mode==='disabled')return source+`
function __pulse_fastly_resolve_effect(effectIndex:i32):i32 { const r=__spike_resolve_original(effectIndex); __spike_results[effectIndex]=r; return r }
`;
  if (timing) {
    source = replaceOnce(source,'function __pulse_fastly_start_request(effectIndex: i32, url: string, method: string, headers: __PulseFastlyValue, body: string, backend: string): void {',
      'function __pulse_fastly_start_request(effectIndex: i32, url: string, method: string, headers: __PulseFastlyValue, body: string, backend: string): void { __spike_started[effectIndex] = __spike_clock(); __spike_ended[effectIndex] = -1;');
    // Reuse the current deadline poll/select driver, including when no timeout is
    // authored. This is the potential opt-in cost hidden by a two-clock estimate.
    source = replaceOnce(source,'function __pulse_fetch_has_deadlines(): bool {',
      'function __pulse_fetch_has_deadlines(): bool { for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) if(__pulse_fetch_active(i)) return true;');
    source = replaceOnce(source,'function __pulse_fetch_complete(index: i32, outcome: i32, result: i32 = 0): void {',
      'function __pulse_fetch_complete(index: i32, outcome: i32, result: i32 = 0): void { __spike_ended[index] = __spike_clock();');
    source += `
const __spike_started = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
const __spike_ended = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
const __spike_clock_out = new StaticArray<i64>(1)
function __spike_clock(): i64 {
  if(wasi_snapshot_preview1_clock_time_get(1, 1, changetype<usize>(__spike_clock_out)) != 0) return -1
  return __spike_clock_out[0]
}
export function spike_timestamp_payload_bytes(): i32 { return 16 * PULSE_FASTLY_EFFECT_COUNT + 8 }
`;
  }
  source += `
let __spike_wrapper_values: i32 = 0
let __spike_envelopes: i32 = 0
export function spike_wrapper_values(): i32 { return __spike_wrapper_values }
export function spike_envelopes(): i32 { return __spike_envelopes }
function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {
  const result = __spike_resolve_original(effectIndex)
  const code = __pulse_fastly_last_error, stage = __pulse_fastly_error_stage
  const rejected = code != 0
  // Deliberately narrow: already-dispatched transport failure or member timeout.
  // Never clear enclosing deadlines, clock/protocol faults, or decode failures.
  if (rejected) {
    if (!${collect} || code != PULSE_ERROR_TRANSPORT || (stage != 81 && stage != 271)) return 0
    __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1
  } else if(result <= 0) return 0
  ${timing && projection==='text' ? 'if(!rejected) __spike_ended[effectIndex] = __spike_clock();' : ''}
  const before = __pulse_fastly_value_count()
  const envelope = host_value_object()
  host_value_object_set(envelope,__pulse_fastly_string_value('status'),__pulse_fastly_string_value(rejected?'rejected':'fulfilled'))
  if(rejected) {
    const error = host_value_object()
    host_value_object_set(error,__pulse_fastly_string_value('code'),__pulse_fastly_string_value(stage==271?'PULSE_FETCH_TIMEOUT':'PULSE_FETCH_TRANSPORT'))
    host_value_object_set(envelope,__pulse_fastly_string_value('error'),error)
  } else host_value_object_set(envelope,__pulse_fastly_string_value('value'),result)
  ${timing ? `const start = __spike_started[effectIndex], end = __spike_ended[effectIndex]
  host_value_object_set(envelope,__pulse_fastly_string_value('elapsedMs'),start>=0 && end>=start ? host_value_number(f64(end-start)/1000000.0) : host_value_null())` : ''}
  __spike_wrapper_values += __pulse_fastly_value_count() - before; __spike_envelopes++
  __spike_results[effectIndex] = envelope
  return envelope
}
`;
  return source;
}
function compile(directory, width, mode, projection='raw', timeout=false, maxDurationMs, numericReply=false) {
  const authored = handler(width,mode,projection,timeout).replace("return ctx.text('done')",numericReply?"return ctx.json({status:200})":"return ctx.text('done')");
  const plan = buildCanonicalNativePlan(compileCanonicalSource(authored,{fileName:'probe.ts',strict:false}));
  const options = {cwd:root,requirePlatformCapability:false,backends:{'https://origin.test':'origin'},...(maxDurationMs?{maxDurationMs}:{})};
  const generated = generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options);
  const source = overlay(generated.source,mode,projection);
  const key = `${projection}-${width}-${mode}-${timeout?'deadline':'plain'}${maxDurationMs?'-enclosing':''}${numericReply?'-numeric':''}`;
  const dir = path.join(directory,key);fs.mkdirSync(dir,{recursive:true});
  const sourceFile=path.join(dir,'probe.as.ts'), wasmFile=path.join(dir,'probe.wasm');
  const reuse=fs.existsSync(sourceFile)&&fs.existsSync(wasmFile)&&fs.readFileSync(sourceFile,'utf8')===source;
  fs.writeFileSync(sourceFile,source);
  const asc = resolveAsc(root)||resolveAsc(path.join(root,'wasm/packages/compiler'));
  const args=[asc.script,sourceFile,'--outFile',wasmFile,'--runtime','stub','--noAssert','--optimize','--use','abort=probe.as/__pulse_fastly_abort'];
  appendAssemblyScriptOptimizationArgs(args,undefined,{guestLinked:false});
  const start=performance.now();
  if(!reuse){
    const proc=cp.spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
    fs.writeFileSync(path.join(dir,'compiler.log'),proc.stdout+proc.stderr);
    assert.equal(proc.status,0,key+' compilation: '+proc.stderr.slice(-5000));
  }
  const wasm=fs.readFileSync(wasmFile);
  const inspection=generator.inspectFastlyNativePlatformCapabilitiesWasm(wasm);
  return {key,width,mode,projection,timeout,wasm,source,plan,compileMs:reuse?null:performance.now()-start,reused:reuse,
    identity:{bytes:wasm.length,sha256:sha(wasm),sourceSha256:sha(source),imports:inspection.imports.map(x=>x.module+':'+x.name)}};
}
function run(artifact, overrides={}, options={}) {
  const fixtures=Object.fromEntries(Array.from({length:artifact.width},(_,i)=>[`https://origin.test/${i}`,{status:200,body:'ok',...overrides[i]}]));
  const result=execute({wasm:artifact.wasm},{fixtures,...options});
  const counts={};for(const entry of result.trace){const key=entry.module+'.'+entry.name;counts[key]=(counts[key]||0)+1;}
  const exp=result.instance.exports;
  assert(['done','{"status":200}'].includes(result.response.body));
  const output=Object.fromEntries(Array.from({length:artifact.width},(_,i)=>['r'+i,{status:exp.spike_outcome(i)===1?'fulfilled':'rejected',value:exp.spike_error(i)===1?'PULSE_FETCH_TIMEOUT':exp.spike_error(i)===2?'PULSE_FETCH_TRANSPORT':exp.spike_shape(i)===1?'fetch-handle':exp.spike_shape(i)===2?'text':'invalid',elapsedMs:exp.spike_elapsed(i)<0?null:exp.spike_elapsed(i)}]));
  return {output,memoryBytes:exp.memory.buffer.byteLength,values:exp.spike_value_count(),wrapperValues:exp.spike_wrapper_values?.()||0,
    envelopes:exp.spike_envelopes?.()||0,timestampPayloadBytes:exp.spike_timestamp_payload_bytes?.()||0,counts,
    monotonicMs:result.monotonicMs,resources:result.transportResources};
}
async function main() {
  const directory=path.resolve(process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'pulse-fetch-outcomes-')));
  fs.mkdirSync(directory,{recursive:true});
  const asc=resolveAsc(root)||resolveAsc(path.join(root,'wasm/packages/compiler'));
  const report={version:'pulse.fetch-outcomes-viability.v1',status:'running',harnessSha256:sha(fs.readFileSync(__filename)),toolchain:{assemblyscript:JSON.parse(fs.readFileSync(path.join(asc.packageRoot,'package.json'),'utf8')).version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},sourceTree:cp.execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,
    claim:'Generated-Wasm injected-ABI prototype; not public API implementation, production CPU benchmark, or provider reality.',matrix:[],semantics:[],numericControls:[],staggered:[],limitations:[]};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  const artifacts=new Map();
  for(const timeout of [false,true]) for(const width of [1,8,16,32]) for(const mode of modes) {
    const artifact=compile(directory,width,mode,'raw',timeout);artifacts.set(artifact.key,artifact);
    const result=run(artifact);
    for(const value of Object.values(result.output)){assert.equal(value.value,'fetch-handle');assert.equal(value.elapsedMs,['timing','both'].includes(mode)?0:null);}
    assert.equal(result.counts['fastly_http_req.send_async'],width);
    assert.equal(result.counts['fastly_http_body.read']||0,0,'raw metadata does not read bodies');
    report.matrix.push({key:artifact.key,width,mode,timeout,...artifact.identity,...result});
    console.log('measured '+artifact.key+' '+artifact.wasm.length+' bytes');
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
  for(const width of [1,8,16,32])for(const timeout of [false,true]){
    const a=artifacts.get(`raw-${width}-both-${timeout?'deadline':'plain'}`);
    const fixtures=Object.fromEntries(Array.from({length:width},(_,i)=>[i,{delayMs:width-i}]));
    const result=run(a,fixtures);
    for(let i=0;i<width;i++)assert.equal(result.output['r'+i].elapsedMs,width-i);
    const control=run(artifacts.get(`raw-${width}-disabled-deadline`),fixtures);
    assert.equal(result.counts['fastly_http_req.pending_req_poll_v2'],control.counts['fastly_http_req.pending_req_poll_v2']);
    report.staggered.push({width,timeout,...result,existingDeadlineControl:{counts:control.counts,memoryBytes:control.memoryBytes}});
  }
  for(const row of report.matrix){
    const baseline=report.matrix.find(x=>x.width===row.width&&x.timeout===row.timeout&&x.mode==='disabled');
    assert.deepEqual(row.resources,baseline.resources,'successful outcome envelopes preserve host pending/request resource counts');
    assert.equal(row.counts['fastly_http_req.send_async'],baseline.counts['fastly_http_req.send_async']);
  }
  const raw=compile(directory,2,'both','raw',true);
  const reversed=run(raw,{0:{delayMs:100},1:{delayMs:10}});
  assert.equal(reversed.output.r0.elapsedMs,100);assert.equal(reversed.output.r1.elapsedMs,10);
  report.semantics.push({name:'raw reversed completion retains per-member time',passed:true,result:reversed});
  const failure=run(raw,{0:{transportStatus:1},1:{delayMs:10}});
  assert.equal(failure.output.r0.status,'rejected');assert.equal(failure.output.r1.status,'fulfilled');
  report.semantics.push({name:'pending transport failure preserves successful sibling',passed:true,result:failure});
  const timeout=run(raw,{0:{neverHeaders:true},1:{delayMs:10}});
  assert.equal(timeout.output.r0.value,'PULSE_FETCH_TIMEOUT');assert.equal(timeout.output.r1.elapsedMs,10);
  report.semantics.push({name:'member timeout preserves successful sibling',passed:true,result:timeout});
  const timedOnly=compile(directory,2,'timing','raw',true);
  assert.throws(()=>run(timedOnly,{0:{transportStatus:1}}),error=>error.detail?.errorStage===81);
  report.semantics.push({name:'timing without collect still rejects transport failure',passed:true});
  const rawBodies=run(raw,{0:{bodyDelayMs:100},1:{bodyDelayMs:10}});
  assert.equal(rawBodies.output.r0.elapsedMs,0);assert.equal(rawBodies.output.r1.elapsedMs,0);
  report.semantics.push({name:'raw timing does not wait for bodies',passed:true,result:rawBodies});
  const projected=compile(directory,2,'both','text',true);
  try {
    const projectedResult=run(projected,{0:{bodyDelayMs:100},1:{bodyDelayMs:10}});
    report.semantics.push({name:'projection compatibility probe',passed:projectedResult.output.r1.elapsedMs===10,result:projectedResult});
  } catch(error) {
    assert.equal(error.detail?.errorStage,42,'retain the demonstrated projection failure, not an unrelated exception');
    report.semantics.push({name:'projection compatibility probe',passed:false,errorCode:error.code,errorStage:error.detail?.errorStage,
      finding:'Current lowering can leave text projections in resumed continuation expressions; wrapping the raw result at provider settlement breaks host_fetch_text. Requires projection-aware lowering/settlement, not just a timestamp field.'});
  }
  const textControl=compile(directory,2,'disabled','text',true);
  const bodyReadOrder=[];
  const textResult=run(textControl,{0:{bodyDelayMs:100},1:{bodyDelayMs:10}}, {traceBodyIo:true,afterHostcall(c){if(c.module==='fastly_http_body'&&c.name==='read')bodyReadOrder.push({handle:c.args[0],traceIndex:c.trace.length});}});
  report.semantics.push({name:'unmodified projected control succeeds',passed:true,result:textResult,bodyReadOrder,
    limitation:'Body readiness delays are not simulated by every reader path; read order is evidence, not a measured independent-projection duration.'});
  for(const width of [1,32])for(const mode of ['disabled','both']){
    const a=compile(directory,width,mode,'raw',false,undefined,true);
    report.numericControls.push({key:a.key,width,mode,...a.identity,...run(a)});
  }
  // Cancellation is injected at the existing host fence, never collected.
  const controller=new AbortController(), reason=new Error('spike cancellation');
  assert.throws(()=>run(raw,{}, {signal:controller.signal,afterHostcall(c){if(c.name==='send_async')controller.abort(reason);}}),e=>e===reason);
  report.semantics.push({name:'enclosing cancellation remains fatal',passed:true});
  const enclosing=compile(directory,2,'both','raw',true,20);
  let enclosingResult;
  try {enclosingResult=run(enclosing,{0:{neverHeaders:true},1:{delayMs:10}});}
  catch(error){enclosingResult={errorCode:error.code,errorStage:error.detail?.errorStage};}
  assert.equal(enclosingResult.errorStage,260,'enclosing deadline must retain its execution failure');
  report.semantics.push({name:'enclosing deadline remains fatal',passed:true,result:enclosingResult});
  report.limitations=[
    'Overlay bypasses public types/admission/lowering; production API work is not measured.',
    'Collect prototype only converts already-dispatched transport/member-timeout settlement; send failures, pre-dispatch errors and mixed member policies need implementation. Error strings are probe labels, not a canonical error-taxonomy implementation.',
    'Injected host counts and logical times are deterministic. Execution microseconds include JavaScript ABI callbacks and exclude module instantiation; they are not production CPU/network latency. Linear-memory pages are high-water capacity, not allocated bytes.',
    'Timestamp payload excludes AssemblyScript array/object headers; boxed value counts are measured separately.',
    'Projection incompatibility is an explicit failed viability cell; it is not a baseline defect. Full projected-timing semantics need projection-aware lowering/settlement.',
    'No phase-timeout settings, static/dynamic backend policy identity changes, retries, new scheduler or production code changes.',
    'No real-provider reset/stall qualification, JavaScript microbenchmark, JSON decoder-cost proof or full invocation-reuse proof.'
  ];
  // Execution-only injected-ABI sample: excludes module compile/instantiate and
  // post-run observers. Warmups and individual samples remain inspectable.
  for(const row of report.matrix){
    const a=artifacts.get(row.key), samples=[];
    for(let n=0;n<18;n++){
      let start,end;
      run(a,{}, {afterHostcall(c){if(c.module==='fastly_abi'&&c.name==='init')start=performance.now();if(c.module==='fastly_http_resp'&&c.name==='send_downstream')end=performance.now();}});
      assert(Number.isFinite(start)&&Number.isFinite(end));
      if(n>=3)samples.push((end-start)*1000);
    }
    const sorted=[...samples].sort((a,b)=>a-b);
    row.injectedExecutionUs={samples,median:sorted[7],p90:sorted[13],minimum:sorted[0]};
  }
  // Keep retained evidence small: repeated successful outputs and identical
  // import sets are verified above, then represented once instead of duplicated.
  report.importSets={};
  for(const row of [...report.matrix,...report.numericControls]){
    const key=sha(JSON.stringify(row.imports)); report.importSets[key]=row.imports;
    row.importSet=key; delete row.imports;
    row.verifiedMembers=Object.keys(row.output).length; delete row.output;
  }
  for(const row of report.staggered){row.memberElapsedMs=Object.values(row.output).map(x=>x.elapsedMs);delete row.output;}
  report.status='completed';
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log('completed '+path.join(directory,'report.json'));
}
module.exports={main,compile,run,overlay};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
