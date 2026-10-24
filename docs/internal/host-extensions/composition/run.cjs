'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const p=require('./prototype.cjs'),{create}=require('./fixture.cjs'),{execute}=require('./host.cjs');
const compiler=require(path.join(p.root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(p.root,'wasm/packages/compiler/src/canonical-native-plan'));
const platform=require(path.join(p.root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const output=path.resolve(process.argv[2]||'/tmp/hex-bounded-composition');fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(p.root,'wasm/.test-results/hex-composition-')),fixture=create(directory);
const git=(...a)=>execFileSync('git',a,{cwd:p.root,encoding:'utf8'}).trim();
const receipt={version:'hex.bounded-composition.v0',status:'running',revision:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),node:process.version,inputs:['prototype.cjs','service.as.ts','fixture.cjs','host.cjs','run.cjs','../ownership/prototype.cjs','../ownership/service.as.ts'].map(file=>({file,sha256:p.hash(fs.readFileSync(path.join(__dirname,file)))})),artifacts:[],cases:[]};
const hooks=`
export function ro_peak():i32{return __ro_peak}
export function ro_owned_count():i32{return __ro_handles}
export function ro_unresolved():i32{return __ro_unresolved}
export function ro_cleanup_errors():i32{return __ro_cleanup_errors}
export function ro_commits():i32{return __ro_commit_attempts}
export function ro_close():void{__pulse_invocation_close()}
export function ro_count(n:i32):void{__pulse_invocation_count=n}
export function ro_ticket(i:i32):i32{return unchecked(__pulse_invocation_tickets[i])}
export function ro_settle(i:i32,t:i32,v:i32):i32{return __pulse_invocation_settle(i,t,v)}
`;
const compositionHooks=`
export function bc_passes():i32{return __bc_passes}
export function bc_invocations():i32{return __pulse_invocation_count}
export function bc_progress():i32{return __bc_progress}
export function bc_dispatch(i:i32,p:i32):void{__bc_dispatch(i,p)}
`;
const source=(body,imports=true)=>(imports?`import { cache } from '${p.PACKAGE}';\n`:'')+`export default async function handler(ctx){\n${body}\n}\n`;
function canonical(authored){fixture.write(authored);return compiler.compileCanonicalProject(fixture.file,{rootDir:directory,workspaceRoot:directory,target:'native',packageTargetDescriptor:p.TARGET});}
let fetchTemplate;
function compile(name,authored,{prototype=true,instrument=true}={}){
  const c=canonical(authored),canonicalPlan=buildCanonicalNativePlan(c),plan=p.expand(canonicalPlan,fetchTemplate);
  const options={cwd:p.root,canonicalBuild:true,requirePlatformCapability:false,bindings:{backends:{'https://origin.example':'origin'}},maxDurationMs:1000,realizationArtifacts:p.artifacts()};
  const native=prototype?p.withPrototype(()=>platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options),instrument?hooks+(plan.composition.roots.length?compositionHooks:''):''):platform.compileFastlyNativePlatformCapabilitiesPlan(canonicalPlan,options);
  const row={name,bytes:native.wasm.length,sha256:p.hash(native.wasm),sourceSha256:p.hash(authored),generatedSha256:p.hash(native.source),canonicalSlots:canonicalPlan.effects.length,expandedSlots:plan.effects.length,roots:plan.composition.roots,imports:native.inspection.imports,instrumented:instrument,
    bindings:plan.effects.map((e,index)=>({siteId:e.id,index,parent:e.composition?.parent??null,phase:e.composition?.phase??'root',capability:e.kind==='host.extension'?p.specs[e.operation].capability:e.capability,conditional:e.composition?.phase==='loader'||e.composition?.phase==='insert',source:e.source,synthetic:e.composition?.synthetic??false,backend:e.kind==='fetch'?'origin':null,standardPulseReport:false}))};receipt.artifacts.push(row);
  for(const [suffix,data] of [['wasm',native.wasm],['as.ts',native.source],['ts',authored],['manifest.json',JSON.stringify(native.manifest,null,2)],['canonical-plan.json',JSON.stringify(canonicalPlan,null,2)],['plan.json',JSON.stringify(plan,null,2)]])fs.writeFileSync(path.join(output,name+'.'+suffix),data);
  return {native,row,plan};
}
function check(name,fn){try{const detail=fn();receipt.cases.push({name,status:'passed',detail});console.log('ok - '+name);}catch(e){receipt.cases.push({name,status:'failed',error:e.stack});throw e;}}
function run(built,options={}){const r=execute(built.native.wasm,options);delete r.instance;return r;}
function success(built,options={}){const r=run(built,options);assert.equal(r.thrown,null);assert.equal(r.error,0);assert.equal(r.status,200);assert.equal(r.counters?.owned??0,0);return r;}
const count=(r,call)=>r.trace.filter(x=>x.call===call).length;
function failed(built,options={}){const r=run(built,options);assert.equal(r.thrown,null);assert(r.status>=400,JSON.stringify(r));assert.equal(r.counters.owned,0);return r;}
function noCall(r,...calls){for(const call of calls)assert.equal(count(r,call),0,call);}
try{
  const fc=canonical(source("const value=await ctx.fetch('https://origin.example/value').text(); return ctx.text(value);",false));
  fetchTemplate=buildCanonicalNativePlan(fc).effects[0];fs.writeFileSync(path.join(output,'fetch-template.json'),JSON.stringify(fetchTemplate,null,2));
  const call="cache.getOrSetText(ctx,'alpha','https://origin.example/value')";
  const direct=compile('direct',source(`const value=await ${call};return ctx.json(value);`));
  check('Direct hit skips loader and insert',()=>{const r=success(direct);assert.deepEqual(r.json,{status:'hit',value:'value:alpha'});assert.equal(r.composition.invocations,2);return r;});
  check('Direct miss runs fetch and insert',()=>{const r=success(direct,{miss:true});assert.deepEqual(r.json,{status:'stored',value:'loaded'});assert.equal(r.composition.invocations,4);assert.equal(r.committed.length,1);return r;});
  check('Reused fetch retains host resources outside cache ledger',()=>{const r=success(direct,{miss:true});assert.deepEqual(r.remaining.map(x=>x.kind),['fetch-response','fetch-body']);assert.equal(r.counters.owned,0);return r;});
  const keyed=compile('keyed',source(`const value=await ctx.parallel({first:${call},second:cache.getOrSetText(ctx,'beta','https://origin.example/other')});return ctx.json(value);`));
  check('Keyed misses dispatch both loaders before either waits',()=>{const r=success(keyed,{miss:true});assert.deepEqual(Object.keys(r.json),['first','second']);assert.equal(r.composition.invocations,8);const firstWait=r.trace.findIndex(x=>x.call==='fetch.wait');assert.equal(count({trace:r.trace.slice(0,firstWait)},'fetch.send'),2);assert.equal(count({trace:r.trace.slice(0,r.trace.findIndex(x=>x.call==='select'))},'lookup'),2);return r;});
  check('Mixed hit and miss preserve distinct parent outcomes',()=>{const r=success(keyed,{missKeys:['beta']});assert.equal(r.json.first.status,'hit');assert.equal(r.json.second.status,'stored');assert.equal(count(r,'fetch.send'),1);assert.equal(r.composition.invocations,6);return r;});
  for(const [n,max] of [[0,4],[2,4],[2,8],[8,8]]){
    const b=compile(`collection-${n}-${max}`,source(`const inputs=[${Array.from({length:n},(_,i)=>i).join(',')}];const effects=ctx.effects({max:${max}});for(const item of inputs){effects.add(${call});}const value=await ctx.parallel(effects);return ctx.json(value);`));
    check(`Collection ${n}/${max} flush preserves parent count and bounded children`,()=>{const r=success(b,{miss:true});assert.equal(r.json.length,n);assert.equal(r.composition.invocations,n*4);assert.equal(count(r,'fetch.send'),n);if(n){const firstWait=r.trace.findIndex(x=>x.call==='fetch.wait');assert.equal(count({trace:r.trace.slice(0,firstWait)},'fetch.send'),n);}else noCall(r,'lookup','fetch.send','insert');return r;});
    if(n===8)check('Eight hits still expose inherited handle admission limit',()=>{const r=failed(b);assert.equal(r.stage,331);noCall(r,'fetch.send','insert');return r;});
  }
  const mixed=compile('mixed',source(`const value=await ctx.parallel({item:${call},clock:ctx.time.now()});return ctx.json(value);`));
  check('Ordinary core sibling settles once across child passes',()=>{const r=success(mixed,{miss:true});assert.equal(r.json.clock.status,'ok');assert.equal(r.json.item.status,'stored');assert.equal(r.composition.invocations,5);return r;});
  for(const call of ['lookup','state','body','read','cache.close'])check(`Cache ${call} failure never invokes loader`,()=>{const r=failed(direct,{failAt:call});noCall(r,'fetch.send','insert');return r;});
  for(const call of ['fetch.send','fetch.wait','fetch.read'])check(`Loader ${call} failure never inserts`,()=>{const r=failed(direct,{miss:true,failAt:call});noCall(r,'insert');assert.equal(count(r,'fetch.send'),1);return r;});
  for(const call of ['insert','write','commit'])check(`Insert ${call} failure is explicit without retry`,()=>{const r=failed(direct,{miss:true,failAt:call});assert.equal(count(r,'fetch.send'),1);assert.equal(count(r,'insert'),1);assert(count(r,'commit')<=1);return r;});
  check('Consumed failed commit remains committed and unresolved',()=>{const r=failed(direct,{miss:true,failAt:'commit',consumeOnFailure:true});assert.equal(r.committed.length,1);assert.equal(r.counters.unresolved,1);noCall(r,'abandon');return r;});
  check('Loader result exceeding fixture byte limit fails before insert',()=>{const r=failed(direct,{miss:true,fetchValue:'x'.repeat(65)});assert.equal(r.stage,344);noCall(r,'insert');return r;});
  check('Failure in first loader drains admitted sibling but starts no inserts',()=>{const r=failed(keyed,{miss:true,failAt:'fetch.wait',failNth:1});assert.equal(count(r,'fetch.send'),2);assert.equal(count(r,'fetch.wait'),2);noCall(r,'insert');return r;});
  check('Later lookup failure suppresses earlier admitted loader follow-on',()=>{const r=failed(keyed,{miss:true,failAt:'state',failNth:2});assert.equal(count(r,'fetch.send'),1);assert.equal(count(r,'fetch.wait'),1);noCall(r,'insert');return r;});
  check('Earlier commit survives later sibling write failure',()=>{const r=failed(keyed,{miss:true,failAt:'write',failNth:2});assert.equal(r.committed.length,1);assert.equal(count(r,'abandon'),1);return r;});
  for(const kind of ['cache','fetch-pending','writer'])check(`Inherited deadline stops children at ${kind}`,()=>{const r=failed(direct,{miss:true,timeoutKind:kind,pendingOnCleanup:true});assert.equal(r.status,504);assert.equal(r.committed.length,0);if(kind==='cache')noCall(r,'fetch.send');if(kind==='fetch-pending')noCall(r,'insert');return r;});
  check('Expiry after commit cannot claim rollback',()=>{const r=failed(direct,{miss:true,expireAt:'commit'});assert.equal(r.status,504);assert.equal(r.committed.length,1);return r;});
  for(const seed of [1024,1023,1022,1021])check(`Cumulative budget ${seed} is shared by parent and children`,()=>{const r=failed(direct,{miss:true,onUri:i=>i.exports.ro_count(seed)});if(seed>=1023)noCall(r,'lookup');if(seed>=1022)noCall(r,'fetch.send');if(seed>=1021)noCall(r,'insert');assert.equal(r.composition.invocations,1024);return r;});
  check('Raw parent and child result forgery is fenced',()=>{let tested=0;const r=success(direct,{after:(i,event)=>{if(event==='lookup'){for(const slot of [0,1,2,3])assert.equal(i.exports.pulse_set_effect_result(slot,1),0);tested++;}}});assert.equal(tested,1);return r;});
  check('Wrong child ticket rejects settlement',()=>{const r=failed(direct,{after:(i,event)=>{if(event==='lookup')assert.equal(i.exports.ro_settle(1,i.exports.ro_ticket(1)+1,1),0);}});noCall(r,'fetch.send','insert');return r;});
  check('Closed parent cannot dispatch a deferred child',()=>{const r=failed(direct,{miss:true,after:(i,event)=>{if(event==='cache.close')i.exports.ro_close();}});noCall(r,'fetch.send','insert');return r;});
  check('Repeated phase dispatch while live is rejected',()=>{const r=failed(direct,{after:(i,event)=>{if(event==='lookup')i.exports.bc_dispatch(0,0);}});assert.equal(count(r,'lookup'),1);noCall(r,'fetch.send','insert');return r;});
  check('Post-close child dispatch creates no host work',()=>{const r=execute(direct.native.wasm,{miss:true});const before=r.trace.length;r.instance.exports.bc_dispatch(0,1);assert.equal(r.trace.length,before);delete r.instance;return r;});
  check('Trap still bypasses all guest cleanup',()=>{const r=run(direct,{trapAt:'read'});assert(r.thrown);assert.equal(r.counters.owned,2);noCall(r,'fetch.send','send');return r;});
  check('Callback and nested composition syntax remains rejected',()=>{for(const loader of ["()=>ctx.fetch('https://origin.example/value').text()","()=>cache.getOrSetText(ctx,'nested','https://origin.example/value')"]){assert.throws(()=>canonical(source(`const value=await cache.getOrSetText(ctx,'alpha',${loader});return ctx.json(value);`)),/literal/);}return 'No arbitrary callbacks, nesting or recursion admitted';});
  check('Child backend authority is checked before execution',()=>{assert.throws(()=>compile('unbound',source("const value=await cache.getOrSetText(ctx,'alpha','https://unbound.example/value');return ctx.json(value);")),/backend/i);return 'Unbound child URL rejected';});
  check('Absent and unused controls add no execution machinery',()=>{const body="return ctx.text('ok');";const baseline=compile('baseline',source(body,false),{prototype:false,instrument:false});const absent=compile('absent',source(body,false),{instrument:false});const unused=compile('unused',source(body),{instrument:false});assert.deepEqual(baseline.native.wasm,absent.native.wasm);assert.equal(unused.row.bytes,baseline.row.bytes);assert(!unused.row.imports.some(i=>i.module==='fastly_cache'));return {bytes:baseline.row.bytes,unusedDelta:unused.row.bytes-baseline.row.bytes,wholeUnusedIdentity:unused.row.sha256===baseline.row.sha256};});
  check('Uninstrumented compound artifact executes',()=>{const b=compile('direct-plain',source(`const value=await ${call};return ctx.json(value);`),{instrument:false});return success(b,{miss:true});});
  check('Primitive-only control omits composition driver bridges',()=>{const b=compile('primitive',source("const value=await cache.getText(ctx,'alpha');return ctx.json(value);"),{instrument:false});assert(!b.native.source.includes('__BC_WAIT_CHILD'));return success(b);});
  check('Core fetch control has the same retained response and body',()=>{const b=compile('fetch-control',source("const value=await ctx.fetch('https://origin.example/value').text();return ctx.text(value);",false),{instrument:false});const r=success(b);assert.equal(r.body,'loaded');assert.deepEqual(r.remaining.map(x=>x.kind),['fetch-response','fetch-body']);return r;});
  receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;console.error(e.stack);}
finally{fs.rmSync(directory,{recursive:true,force:true});fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,output}));}
