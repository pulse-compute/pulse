'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const p=require('./prototype.cjs'),{create}=require('./fixture.cjs'),{execute}=require('./host.cjs');
const compiler=require(path.join(p.root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(p.root,'wasm/packages/compiler/src/canonical-native-plan'));
const platform=require(path.join(p.root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const directory=fs.mkdtempSync(path.join(p.root,'wasm/.test-results/hex-nonterminal-'));
const fixture=create(directory);
const output=path.resolve(process.argv[2]||'/tmp/hex-nonterminal-run');fs.mkdirSync(output,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:p.root,encoding:'utf8'}).trim();
const receipt={version:'hex.nonterminal-spike.v0',status:'running',scope:'Native prototype; injected ABI; no production contract changes',
  revision:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),node:process.version,cases:[],artifacts:[],bindingEvidence:[]};
const sources=['prototype.cjs','fixture.cjs','host.cjs','run.cjs'];
receipt.inputs=sources.map(file=>({file,sha256:p.hash(fs.readFileSync(path.join(__dirname,file)))}));
const check=(name,fn)=>{try{const detail=fn();receipt.cases.push({name,status:'passed',detail});console.log('ok - '+name);}catch(e){receipt.cases.push({name,status:'failed',error:e.message});throw e;}};
const prefix=`import { metrics, downstream } from '${p.PACKAGE}';\n`;
function section(wasm,wanted){let at=8;const read=()=>{let v=0,shift=0,b;do{b=wasm[at++];v+=(b&127)*2**shift;shift+=7;}while(b&128);return v;};while(at<wasm.length){const id=wasm[at++],size=read(),start=at;at+=size;if(id===wanted)return wasm.subarray(start,at);}return Buffer.alloc(0);}
function source(body,imports=true){return (imports?prefix:'')+`export default async function handler(ctx) {\n${body}\n}\n`;}
function compile(name,authored,{prototype=true,testSource='',duration}={}){
  fixture.write(authored);
  const c=compiler.compileCanonicalProject(fixture.file,{rootDir:directory,workspaceRoot:directory,target:'native',packageTargetDescriptor:p.TARGET});
  const plan=buildCanonicalNativePlan(c),options={cwd:p.root,canonicalBuild:true,requirePlatformCapability:false,bindings:{},
    realizationArtifacts:compiler.packageRealizationArtifactsForCompiled(c),...(duration?{maxDurationMs:duration}:{})};
  const start=performance.now();
  const native=prototype?p.withPrototype(()=>platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options),testSource):platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const row={name,bytes:native.wasm.length,sha256:p.hash(native.wasm),sourceSha256:p.hash(authored),
    generatedSourceSha256:p.hash(native.source),codeSha256:p.hash(section(native.wasm,10)),dataSha256:p.hash(section(native.wasm,11)),compileMs:Math.round(performance.now()-start),effectSlots:plan.effects.length,
    valueKinds:[...new Set(plan.effects.map(e=>e.result.valueKind))],imports:native.inspection.imports,
    policySha256:native.manifest.hostExtensionPolicy?.sha256??null};
  receipt.artifacts.push(row);
  for(const [suffix,data] of [['wasm',native.wasm],['ts',authored],['as.ts',native.source],['manifest.json',JSON.stringify(native.manifest,null,2)]])fs.writeFileSync(path.join(output,`${name}.${suffix}`),data);
  const bindingRows=plan.effects.filter(e=>e.kind==='host.extension').map(e=>({operation:e.operation,capability:p.layout[e.operation].capability,
    package:e.package,target:p.TARGET.targetId,authority:p.layout[e.operation].access,namedBinding:null,source:e.source,
    group:e.grouped,continuationId:e.continuationId,siteId:e.id,fields:p.layout[e.operation].fields,
    contributionId:`${p.PACKAGE}:${e.operation}`,resultLayoutSha256:p.hash(JSON.stringify(p.layout[e.operation]))}));
  receipt.bindingEvidence.push({artifact:name,version:'hex.proposed-capability-bindings.v0',standardPulseReport:false,rows:bindingRows});
  return {native,plan,options,row};
}
const successful=n=>{const result=execute(n.native.wasm);assert.equal(result.thrown,null);assert.equal(result.error,0);assert.equal(result.status,200);assert.equal(result.trace.filter(e=>e.call==='send').length,1);return result;};
function reportRead(n,name){return require(path.join(p.root,'wasm/packages/cli/src/internal/report/host-extensions')).readHostExtensions(
  {plan:n.plan,providerNativeManifest:path.join(output,name+'.manifest.json')},output,{file:name+'.wasm',sha256:n.row.sha256,id:'artifact-probe'});}
try{
  let baseline,absent,unused,snapshot,tls,keyed,collection;
  check('Absent is byte-identical; imported-unused has equal size and code',()=>{
    const plain=source("return ctx.text('ok');",false);
    baseline=compile('baseline',plain,{prototype:false});absent=compile('absent',plain);unused=compile('unused',source("return ctx.text('ok');"));
    assert.deepEqual(absent.native.wasm,baseline.native.wasm);assert.equal(unused.row.bytes,baseline.row.bytes);
    assert.equal(unused.row.codeSha256,baseline.row.codeSha256);assert.equal(unused.plan.effects.length,0);
    assert(!unused.row.imports.some(i=>['fastly_compute_runtime','fastly_http_downstream'].includes(i.module)));
    successful(unused);return {bytes:baseline.row.bytes,unusedDelta:unused.row.bytes-baseline.row.bytes,
      unusedWholeArtifactIdentical:unused.row.sha256===baseline.row.sha256};
  });
  check('Direct snapshot returns field observations',()=>{
    snapshot=compile('snapshot',source('const value = await metrics.snapshot(ctx); return ctx.json(value);'));
    const r=successful(snapshot);assert.deepEqual(r.json,{vcpuMs:{status:'available',value:1},memoryMiB:{status:'available',value:12}});
    assert.equal(r.trace.filter(e=>e.call==='vcpu').length,1);return r.json;
  });
  check('Direct downstream TLS uses current request without body ownership',()=>{
    tls=compile('tls',source('const value = await downstream.tls(ctx); return ctx.json(value);'));
    const r=successful(tls);assert.equal(r.json.protocol.value,'TLSv1.3');assert.equal(r.json.cipher.status,'available');return r.json;
  });
  check('Keyed snapshot and TLS share ordinary group continuation',()=>{
    keyed=compile('keyed',source('const value = await ctx.parallel({ metrics: metrics.snapshot(ctx), tls: downstream.tls(ctx) }); return ctx.json(value);'));
    const r=successful(keyed);assert.equal(r.json.metrics.vcpuMs.value,1);assert.equal(r.json.tls.protocol.value,'TLSv1.3');
    assert(keyed.plan.effects.every(e=>e.grouped));return r.trace;
  });
  for(const [operation,max,length] of [['snapshot',1,1],['snapshot',4,2],['snapshot',16,2],['snapshot',32,2],['tls',4,2],['snapshot',4,0]]){
    const name=`collection-${operation}-${max}-${length}`;
    check(name,()=>{
      const call=operation==='snapshot'?'metrics.snapshot(ctx)':'downstream.tls(ctx)';
      const body=`const inputs = [${Array.from({length},(_,i)=>i).join(',')}];\nconst effects = ctx.effects({ max: ${max} });\nfor (const item of inputs) { effects.add(${call}); }\nconst values = await ctx.parallel(effects);\nreturn ctx.json(values);`;
      const built=compile(name,source(body));const r=successful(built);assert.equal(r.json.length,length);
      assert.equal(r.trace.filter(e=>e.call===(operation==='snapshot'?'vcpu':'tls.protocol')).length,length);
      assert.equal(built.plan.effects.length,max);if(operation==='snapshot'&&max===4&&length===2)collection=built;
      return {capacity:max,executed:length,bytes:built.row.bytes};
    });
  }
  check('Mixed core time and package observation',()=>{
    const n=compile('mixed-time',source('const value = await ctx.parallel({ sample: metrics.snapshot(ctx), time: ctx.time.now() }); return ctx.json(value);'));
    const r=successful(n);assert.equal(r.json.time.status,'ok');assert.equal(r.json.sample.vcpuMs.value,1);return r.trace;
  });
  check('Sequential sampling preserves independent dispatch',()=>{
    const n=compile('sequential',source('const first = await metrics.snapshot(ctx); const second = await metrics.snapshot(ctx); return ctx.json({ first, second });'));
    const r=successful(n);assert.equal(r.json.first.vcpuMs.value,1);assert.equal(r.json.second.vcpuMs.value,2);return r.trace;
  });
  check('Unavailable field remains separate from host failure',()=>{
    const r=execute(tls.native.wasm,{tlsUnavailable:true});assert.equal(r.error,0);assert.equal(r.json.protocol.status,'unavailable');assert.equal(r.json.cipher.status,'available');
    const failed=execute(tls.native.wasm,{failureStatus:3});assert.notEqual(failed.error,0);assert.equal(failed.stage,310);return {unavailable:r.json,failedStage:failed.stage};
  });
  for(const [option,built,stage] of [['badLength',()=>tls,312],['badAscii',()=>tls,313],['largeInteger',()=>snapshot,311]])check(`Reject ${option}`,()=>{
    const r=execute(built().native.wasm,{[option]:true});assert.notEqual(r.error,0);assert.equal(r.stage,stage);return {stage:r.stage,status:r.status};
  });
  check('Host trap never becomes successful observation',()=>{const r=execute(snapshot.native.wasm,{trap:true});assert(r.thrown);assert.equal(r.trace.some(e=>e.call==='send'),false);return {thrown:r.thrown};});
  check('Current contribution reader accepts single site',()=>{const rows=reportRead(snapshot,'snapshot');assert.equal(rows.length,1);return rows.map(r=>({id:r.id,operation:r.operation}));});
  check('Current contribution reader exposes repeated-site census limitation',()=>{
    assert.throws(()=>reportRead(collection,'collection-snapshot-4-2'),e=>e.code==='REPORT_IDENTITY');
    return 'Expected rejection: per-site manifest rows versus unique contribution census. Standard report not qualified.';
  });
  const hooks=`\nexport function nt_close(): void { __pulse_invocation_close() }
export function nt_ticket(): i32 { return unchecked(__pulse_invocation_tickets[0]) }
export function nt_settle(ticket:i32, value:i32): i32 { return __pulse_invocation_settle(0,ticket,value) }
export function nt_count(): i32 { return __pulse_invocation_count }
export function nt_budget_exhaust(): void { __pulse_invocation_count = 1024 }
`;
  let observed;
  check('Observed artifact preserves success with shared deadline',()=>{observed=compile('observed',source('const value = await metrics.snapshot(ctx); return ctx.json(value);'),{testSource:hooks,duration:1000});successful(observed);return {bytes:observed.row.bytes};});
  check('Closed before dispatch and exhausted cumulative budget perform no observations',()=>{
    for(const method of ['nt_close','nt_budget_exhaust']){const r=execute(observed.native.wasm,{onUri:i=>i.exports[method]()});assert.equal(r.trace.some(e=>e.call==='vcpu'),false);assert.notEqual(r.error,0);}return 'Both fenced';
  });
  check('Raw setter cannot forge observation completion',()=>{
    let count=0;const r=execute(observed.native.wasm,{beforeObservation:i=>{assert.equal(i.exports.pulse_set_effect_result(0,1),0);count++;}});
    assert.equal(count,2);assert.equal(r.error,0);assert.equal(r.json.vcpuMs.value,1);assert.equal(r.instance.exports.pulse_set_effect_result(0,1),0);return {rejectedDuringDispatch:count,rejectedAfterClose:true};
  });
  check('Closure during host call fences result',()=>{const r=execute(observed.native.wasm,{afterObservation:i=>i.exports.nt_close()});assert.notEqual(r.error,0);assert.equal(r.stage,314);return {stage:r.stage};});
  check('Deadline before dispatch and after host return fences results',()=>{
    let expired=false;const before=execute(observed.native.wasm,{onUri:()=>{expired=true;},clock:()=>expired?1000000000n:0n});assert.equal(before.trace.some(e=>e.call==='vcpu'),false);assert.equal(before.status,504);
    expired=false;const after=execute(observed.native.wasm,{afterObservation:()=>{expired=true;},clock:()=>expired?1000000000n:0n});assert.equal(after.status,504);assert.notEqual(after.json?.vcpuMs?.status,'available');return {before:before.status,after:after.status};
  });
  check('Unsupported target rejects contribution',()=>{
    fixture.write(source('const value = await metrics.snapshot(ctx); return ctx.json(value);'));
    const target=require(path.join(p.root,'packages/provider-node/src/toolchain.js')).createDriver().targets.native;
    assert.throws(()=>compiler.compileCanonicalProject(fixture.file,{rootDir:directory,workspaceRoot:directory,target:'native',packageTargetDescriptor:target}),e=>e.code==='PULSE_HOST_EXTENSION_TARGET');
    return 'No fallback';
  });
  receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;console.error(e.stack);}
finally{fs.rmSync(directory,{recursive:true,force:true});fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,output}));}
