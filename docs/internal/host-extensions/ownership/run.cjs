'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const p=require('./prototype.cjs'),{create}=require('./fixture.cjs'),{execute}=require('./host.cjs');
const compiler=require(path.join(p.root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(p.root,'wasm/packages/compiler/src/canonical-native-plan'));
const platform=require(path.join(p.root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const output=path.resolve(process.argv[2]||'/tmp/hex-resource-ownership');fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(p.root,'wasm/.test-results/hex-ownership-')),fixture=create(directory);
const git=(...a)=>execFileSync('git',a,{cwd:p.root,encoding:'utf8'}).trim();
const receipt={version:'hex.resource-ownership.v0',status:'running',revision:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),node:process.version,
  inputs:['prototype.cjs','service.as.ts','fixture.cjs','host.cjs','run.cjs'].map(file=>({file,sha256:p.hash(fs.readFileSync(path.join(__dirname,file)))})),artifacts:[],cases:[]};
const hooks=`
export function ro_peak():i32 { return __ro_peak }
export function ro_owned_count():i32 { return __ro_handles }
export function ro_unresolved():i32 { return __ro_unresolved }
export function ro_cleanup_errors():i32 { return __ro_cleanup_errors }
export function ro_commits():i32 { return __ro_commit_attempts }
export function ro_close():void { __pulse_invocation_close() }
export function ro_exhaust():void { __pulse_invocation_count = 1024 }
export function ro_ticket(index:i32):i32 { return unchecked(__pulse_invocation_tickets[index]) }
export function ro_settle(index:i32,ticket:i32,value:i32):i32 { return __pulse_invocation_settle(index,ticket,value) }
`;
const source=(body,imports=true)=>(imports?`import { cache } from '${p.PACKAGE}';\n`:'')+`export default async function handler(ctx) {\n${body}\n}\n`;
function compile(name,authored,{prototype=true,instrument=true}={}) {
  fixture.write(authored);const c=compiler.compileCanonicalProject(fixture.file,{rootDir:directory,workspaceRoot:directory,target:'native',packageTargetDescriptor:p.TARGET});
  const plan=buildCanonicalNativePlan(c),options={cwd:p.root,canonicalBuild:true,requirePlatformCapability:false,bindings:{},maxDurationMs:1000,realizationArtifacts:compiler.packageRealizationArtifactsForCompiled(c)};
  const native=prototype?p.withPrototype(()=>platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options),instrument?hooks:''):platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
  const row={name,bytes:native.wasm.length,sha256:p.hash(native.wasm),generatedSha256:p.hash(native.source),sourceSha256:p.hash(authored),effectSlots:plan.effects.length,imports:native.inspection.imports,
    instrumentation:instrument&&plan.effects.length>0,bindings:plan.effects.filter(e=>e.kind==='host.extension').map(e=>({siteId:e.id,source:e.source,contributionId:`${p.PACKAGE}:${e.operation}`,capability:p.specs[e.operation].capability,
      target:p.TARGET.targetId,namedBinding:null,resources:p.specs[e.operation].resources,group:e.grouped,continuation:e.continuationId,standardPulseReport:false}))};
  receipt.artifacts.push(row);
  for(const [suffix,data] of [['wasm',native.wasm],['as.ts',native.source],['ts',authored],['manifest.json',JSON.stringify(native.manifest,null,2)],['plan.json',JSON.stringify(plan,null,2)]])fs.writeFileSync(path.join(output,name+'.'+suffix),data);
  return {native,row,plan};
}
function check(name,fn){try{const detail=fn();receipt.cases.push({name,status:'passed',detail});console.log('ok - '+name);}catch(e){receipt.cases.push({name,status:'failed',error:e.stack});throw e;}}
function run(built,options={}) {const r=execute(built.native.wasm,options);delete r.instance;return r;}
function clean(r){assert.equal(r.thrown,null);assert.deepEqual(r.remaining,[]);assert.equal(r.counters.owned,0);assert.equal(r.counters.unresolved,0);}
function success(built,options={}){const r=run(built,options);clean(r);assert.equal(r.error,0);assert.equal(r.status,200);assert.equal(r.trace.filter(x=>x.call==='send').length,1);return r;}
try {
  let read,write,keyed,writes,collection;
  check('Absent and imported-unused controls',()=>{const body="return ctx.text('ok');";const a=compile('baseline',source(body,false),{prototype:false,instrument:false});const b=compile('absent',source(body,false),{instrument:false});const c=compile('unused',source(body),{instrument:false});assert.deepEqual(a.native.wasm,b.native.wasm);assert.equal(a.row.bytes,c.row.bytes);assert(!c.row.imports.some(x=>x.module==='fastly_cache'));return {bytes:a.row.bytes,unusedDelta:0,unusedWholeIdentity:a.row.sha256===c.row.sha256};});
  check('Direct read releases zero-valued cache handle and body before response',()=>{read=compile('read',source("const value=await cache.getText(ctx,'alpha'); return ctx.json(value);"));const r=success(read);assert.deepEqual(r.json,{status:'hit',value:'value:alpha'});assert.equal(r.trace.find(x=>x.call==='acquire').h,0);assert.equal(r.counters.peak,2);return r;});
  check('Uninstrumented direct read size',()=>{const b=compile('read-plain',source("const value=await cache.getText(ctx,'alpha'); return ctx.json(value);"),{instrument:false});const r=run(b);assert.equal(r.error,0);assert.deepEqual(r.remaining,[]);return {bytes:b.row.bytes};});
  check('Direct write handles partial progress and commits once',()=>{write=compile('write',source("const value=await cache.putText(ctx,'alpha','payload'); return ctx.json(value);"));const r=success(write,{chunk:2});assert.equal(r.json.status,'stored');assert.deepEqual(r.committed,[{key:'alpha',value:'payload'}]);assert.equal(r.counters.commitAttempts,1);return r;});
  check('Keyed reads start before waiting and preserve keys',()=>{keyed=compile('keyed-read',source("const value=await ctx.parallel({a:cache.getText(ctx,'alpha'),b:cache.getText(ctx,'beta')}); return ctx.json(value);"));const r=success(keyed);assert.equal(r.json.b.value,'value:beta');assert.equal(r.trace.slice(0,r.trace.findIndex(x=>x.call==='select')).filter(x=>x.call==='lookup').length,2);assert.equal(r.counters.peak,3);return r;});
  check('Keyed writes start before resolution',()=>{writes=compile('keyed-write',source("const value=await ctx.parallel({a:cache.putText(ctx,'alpha','first'),b:cache.putText(ctx,'beta','second')}); return ctx.json(value);"));const r=success(writes);assert.equal(r.committed.length,2);assert.equal(r.trace.slice(0,r.trace.findIndex(x=>x.call==='write')).filter(x=>x.call==='insert').length,2);return r;});
  for(const [op,count,max] of [['getText',2,4],['putText',2,4],['getText',0,4],['getText',7,8],['getText',8,8],['getText',9,16]]) {
    check(`Collection ${op} count ${count} capacity ${max}`,()=>{const call=op==='getText'?"cache.getText(ctx,'alpha')":"cache.putText(ctx,'alpha','payload')";
      const b=compile(`collection-${op}-${count}-${max}`,source(`const inputs=[${Array.from({length:count},(_,i)=>i).join(',')}]; const effects=ctx.effects({max:${max}}); for(const item of inputs){effects.add(${call});} const values=await ctx.parallel(effects); return ctx.json(values);`));
      const r=run(b);clean(r);if(count>=8){assert.notEqual(r.error,0);assert.equal(r.stage,331);assert.equal(r.counters.peak,8);}else{assert.equal(r.error,0);assert.equal(r.json.length,count);}
      if(op==='getText'&&count===2)collection=b;return r;});
  }
  check('Mixed existing time effect and resource operation',()=>{const b=compile('mixed-time',source("const value=await ctx.parallel({time:ctx.time.now(),cache:cache.getText(ctx,'alpha')}); return ctx.json(value);"));const r=success(b);assert.equal(r.json.time.status,'ok');assert.equal(r.json.cache.status,'hit');return r;});
  for(const option of ['miss','stale'])check(option+' is bounded policy miss with lookup disposal',()=>{const r=success(read,{[option]:true});assert.equal(r.json.status,'miss');assert(!r.trace.some(x=>x.call==='body'));return r;});
  for(const [name,built,options] of [
    ['lookup failure',()=>read,{failAt:'lookup'}],['state failure',()=>read,{failAt:'state'}],['body acquisition failure',()=>read,{failAt:'body'}],['read failure',()=>read,{failAt:'read'}],
    ['oversize value',()=>read,{value:'x'.repeat(65)}],['malformed read length',()=>read,{badLength:true}],['bounded read steps',()=>read,{value:'x'.repeat(20),chunk:1}],['unsupported text encoding',()=>read,{value:'\u00ff'}],
    ['insert failure',()=>write,{failAt:'insert'}],['partial write failure',()=>write,{failAt:'write',failNth:2,chunk:2}],['zero progress write',()=>write,{zeroWrite:true}],['bounded write steps',()=>write,{chunk:1}]
  ])check(name,()=>{const r=run(built(),options);clean(r);assert.notEqual(r.error,0);assert.equal(r.committed.length,0);return r;});
  check('Sibling write failure preserves earlier commit and abandons failing writer',()=>{const r=run(writes,{failAt:'write',failNth:2});clean(r);assert.notEqual(r.error,0);assert.deepEqual(r.committed,[{key:'alpha',value:'first'}]);assert(r.trace.some(x=>x.call==='abandon'));return r;});
  check('First write failure abandons already-admitted sibling',()=>{const r=run(writes,{failAt:'write'});clean(r);assert.equal(r.committed.length,0);assert.equal(r.trace.filter(x=>x.call==='abandon').length,2);return r;});
  for(const consumeOnFailure of [false,true])check('Commit failure: host consumes '+consumeOnFailure,()=>{const r=run(write,{failAt:'commit',consumeOnFailure});assert.notEqual(r.error,0);assert.equal(r.counters.unresolved,1);assert.equal(r.counters.commitAttempts,1);assert.equal(r.trace.filter(x=>x.call==='commit').length,1);assert.equal(r.trace.filter(x=>x.call==='abandon').length,0);assert.equal(r.remaining.length,consumeOnFailure?0:1);return r;});
  check('Cache close failure remains unresolved without retry',()=>{const r=run(read,{failAt:'cache.close'});assert.notEqual(r.error,0);assert.equal(r.counters.unresolved,1);assert.equal(r.remaining.length,1);assert.equal(r.trace.filter(x=>x.call==='cache.close').length,1);return r;});
  check('Abandon failure preserves primary write failure and unresolved ownership',()=>{const r=run(write,{failAt:['write','abandon']});assert.equal(r.stage,347);assert.equal(r.counters.cleanupErrors,1);assert.equal(r.counters.unresolved,1);assert.equal(r.remaining.length,1);assert.equal(r.trace.filter(x=>x.call==='abandon').length,1);return r;});
  check('Failed reader disposal still attempts cache disposal',()=>{const r=run(read,{failAt:['read','reader.close']});assert.equal(r.stage,341);assert.equal(r.counters.cleanupErrors,1);assert.equal(r.remaining.length,1);assert.equal(r.remaining[0].kind,'reader');assert(r.trace.some(x=>x.call==='cache.close'));return r;});
  check('Expiry with pending cache does not block on close',()=>{const r=run(read,{timeoutSelect:true,pendingOnCleanup:true});assert.equal(r.status,504);assert.equal(r.counters.unresolved,1);assert.equal(r.remaining.length,1);assert(!r.trace.some(x=>x.call==='cache.close'));return r;});
  check('Expiry with writable body abandons without commit',()=>{const r=run(write,{timeoutSelect:true});clean(r);assert.equal(r.status,504);assert.equal(r.committed.length,0);assert.equal(r.trace.filter(x=>x.call==='abandon').length,1);return r;});
  check('Expiry during read releases known-owned resources',()=>{const r=run(read,{expireAt:'read'});clean(r);assert.equal(r.status,504);return r;});
  check('Expiry after commit cannot undo accepted write',()=>{const r=run(write,{expireAt:'commit'});clean(r);assert.equal(r.status,504);assert.equal(r.committed.length,1);return r;});
  check('Closure and cumulative exhaustion prevent acquisition',()=>{const rows=[];for(const name of ['ro_close','ro_exhaust']){const r=run(read,{onUri:i=>i.exports[name]()});clean(r);assert(!r.trace.some(x=>x.call==='lookup'));rows.push(r);}return rows;});
  check('Forged raw setter rejected while lookup is owned',()=>{let rejected=0;const r=run(read,{after:(i,event)=>{if(event==='lookup'){assert.equal(i.exports.pulse_set_effect_result(0,1),0);rejected++;}}});clean(r);assert.equal(r.error,0);assert.equal(rejected,1);return r;});
  check('Wrong invocation ticket rejects completion',()=>{const r=run(read,{after:(i,event)=>{if(event==='lookup')assert.equal(i.exports.ro_settle(0,i.exports.ro_ticket(0)+1,1),0);}});clean(r);assert.notEqual(r.error,0);return r;});
  check('Duplicate completion after close is rejected without host work',()=>{const r=execute(read.native.wasm);clean(r);const n=r.trace.length;assert.equal(r.instance.exports.ro_settle(0,1,1),0);assert.equal(r.trace.length,n);delete r.instance;return r;});
  check('Trap bypasses guest teardown; host reclamation remains required',()=>{const r=run(read,{trapAt:'read'});assert(r.thrown);assert.equal(r.remaining.length,2);assert.equal(r.counters.owned,2);assert(!r.trace.some(x=>x.call==='send'));return r;});
  check('Dynamic key is explicitly outside fixture admission',()=>{fixture.write(source("const key='alpha'; const value=await cache.getText(ctx,key); return ctx.json(value);"));assert.throws(()=>compiler.compileCanonicalProject(fixture.file,{rootDir:directory,workspaceRoot:directory,target:'native',packageTargetDescriptor:p.TARGET}));return 'No capture/codec qualification';});
  receipt.status='passed';
} catch(e) {receipt.status='failed';receipt.error=e.stack;process.exitCode=1;console.error(e.stack);}
finally {fs.rmSync(directory,{recursive:true,force:true});fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,output}));}
