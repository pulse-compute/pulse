'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const b=require('./build.cjs'),host=require('./host.cjs'),controlHost=require('../ra07/host.cjs');
const {project,compare,canonical,hash}=require('./report.cjs'),{validate}=require('./schema.cjs');
const output=path.resolve(process.argv[2]||'/tmp/hex-ra08');
assert(!fs.existsSync(output),'fresh output directory required');fs.mkdirSync(output,{recursive:true});
const inputFiles=['build.cjs','host.cjs','observer.as.ts','report.cjs','schema.cjs','cli.cjs','check.cjs',
 '../ra07/build.cjs','../ra07/host.cjs','../ra07/service.as.ts','../ra07/check.cjs',
 '../ra03/native/build.cjs','../ra03/native/service.as.ts','../ra05/adapter.as.ts','../ra06/service.as.ts',
 '../../composition/prototype.cjs','../../composition/service.as.ts','../../composition/fixture.cjs',
 '../../ownership/prototype.cjs','../../ownership/fixture.cjs'].map(f=>path.resolve(__dirname,f));
const git=(...args)=>execFileSync('git',args,{cwd:b.root,encoding:'utf8'}).trim();
const inputs=()=>inputFiles.map(file=>({file:path.relative(b.root,file),sha256:hash(fs.readFileSync(file))}));
const receipt={version:'hex.ra08.check.v1',status:'running',base:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),node:process.version,
 compiler:{version:JSON.parse(fs.readFileSync(path.join(path.dirname(b.asc.script),'../package.json'))).version,sha256:hash(fs.readFileSync(b.asc.script))},
 inputs:inputs(),artifacts:[],cases:[],mutations:[]};
for(const file of inputFiles){const dest=path.join(output,'inputs',path.relative(b.root,file));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);}
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
function test(name,run){try{run();receipt.cases.push({name,status:'passed'});save();console.log('ok - '+name);}catch(e){receipt.failedCase=name;throw e;}}
function compile(name,width=1,options={}){
 const a=b.build(output,name,width,options);
 const {controlArtifact,...recordedOptions}=options;
 receipt.artifacts.push({name,width,options:recordedOptions,bytes:a.wasm.length,sha256:hash(a.wasm),sourceSha256:hash(a.source),controlBytes:a.control.wasm.length,controlSha256:hash(a.control.wasm),importsUnchanged:true});save();console.log('built - '+name);return a;
}
function run(name,a,options={},verify=()=>{}){
 let report,result;
 test(name,()=>{
  result=host.execute(a.wasm,{slots:a.plan.effects.length,...options});
  const control=controlHost.execute(a.control.wasm,{slots:a.plan.effects.length,...options});
  const {diagnostics,...behavior}=result;
  assert.deepEqual(behavior,control,'observer does not alter complete host behavior');
  report=project(a,result);validate(JSON.parse(JSON.stringify(report)));verify(report,result);
  fs.writeFileSync(path.join(output,name+'.report.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(output,name+'.trace.json'),JSON.stringify({result,control},null,2)+'\n');
 });return report;
}
function miss(report,n=1){
 const r=report.runtime;assert.equal(r.termination,'closed');assert.equal(r.coverage.aggregates,'complete');
 assert.deepEqual(r.totals.charged,{handles:0,backingBytes:n*262785,records:n*3});
 assert.equal(r.totals.uncertainHostClaims,0);assert.equal(r.totals.retired.consumed,n);assert.equal(r.totals.retired.transferred,n*2);
 assert(r.roots.every(x=>x.logicalState==='logically-finished'));assert.equal(r.records.length,3*n);
 const caps=r.records.map(x=>report.static.bindings.find(b=>b.id===x.binding).capability).sort();
 assert.deepEqual(caps,Array.from({length:n},()=>['cache.read','cache.write','fetch.text']).flat().sort(),'child attribution');
}
try{
 const direct=compile('direct');
 const hit=run('hit',direct,{},p=>{assert.equal(p.runtime.totals.retainedBackingBytes,257);assert.equal(p.runtime.totals.uncertainHostClaims,0);assert.equal(p.runtime.totals.retired.released,2);assert.equal(p.static.bindings.filter(b=>b.conditional).length,2);assert(!p.runtime.samples.some(s=>p.static.bindings.find(b=>b.id===s.binding).capability==='fetch.text'));});
 const loaded=run('miss',direct,{miss:true},p=>miss(p));
 test('hit and miss retain identical static capability demand',()=>assert.deepEqual(hit.static,loaded.static));
 test('matched comparison reports backing delta without reclamation claim',()=>{const c=compare(hit,loaded);assert.equal(c.runtime.status,'available');assert.deepEqual(c.runtime.chargedDelta,{handles:0,backingBytes:262528,records:2});assert.equal(c.runtime.claimIdentity,'execution-scoped-not-compared');});
 run('repeat-close',direct,{miss:true,repeatClose:true,postResponders:true},p=>{miss(p);assert.deepEqual(p.runtime.collection,loaded.runtime.collection);});
 for(const [name,options] of [['handles',{short:true}],['backingBytes',{shortBytes:true}],['effects',{effectLimit:3}]])run('short-'+name,direct,options,p=>{assert.equal(p.runtime.admission.status,'rejected');assert.deepEqual(p.runtime.admission.dimensions.filter(d=>d.shortfall).map(d=>d.name),[name]);assert.equal(p.runtime.collection.total,0);assert.deepEqual(p.runtime.totals.charged,{handles:0,backingBytes:0,records:0});});
 for(const consumeOnFailure of [false,true])for(const allocateOnFailure of [false,true])run('unknown-wait-'+consumeOnFailure+'-'+allocateOnFailure,direct,{miss:true,failAt:'fetch.wait',consumeOnFailure,allocateOnFailure},p=>{assert.equal(p.runtime.totals.uncertainHostClaims,3);assert.equal(p.runtime.totals.charged.handles,3);assert.equal(p.runtime.totals.retainedBackingBytes,257);assert.equal(p.runtime.coverage.aggregates,'complete');});
 for(const options of [{failAt:'write'},{failAt:'commit'},{failAt:['write','abandon']},{failAt:'fetch.body.close'},{timeoutKind:'fetch-pending'},{expireAt:'commit'},{cancelAt:'fetch.read'}])run('failure-'+receipt.cases.length,direct,{miss:true,...options},p=>{assert.equal(p.runtime.termination,'closed');assert.equal(p.runtime.coverage.records,'complete');});
 let trapped;
 for(const trapAt of ['lookup','fetch.send','fetch.wait','write','commit'])trapped=run('trap-'+trapAt,direct,{miss:true,trapAt},p=>{assert.equal(p.runtime.termination,'trapped');assert.equal(p.runtime.coverage.aggregates,'partial');assert.equal(p.runtime.coverage.records,'partial');assert.equal(compare(loaded,p).runtime.chargedDelta,null);});
 run('containment',direct,{startHandle:1000000},p=>{assert.equal(p.runtime.coverage.containment,true);assert.equal(p.runtime.coverage.records,'partial');});
 run('redacted-values',direct,{miss:true,fetchValue:'SECRET_RUNTIME_CANARY'},p=>{const text=JSON.stringify(p);for(const forbidden of ['SECRET_RUNTIME_CANARY','https://origin','value:k','payload','address','rawHandle'])assert(!text.includes(forbidden));});
 test('execution identifiers are fresh even for identical outcomes',()=>assert.notEqual(project(direct,host.execute(direct.wasm)).runtime.scope,hit.runtime.scope));
 const disabled=compile('disabled',1,{enabled:false});
 test('disabled observer is byte-identical to RA-07',()=>{assert.equal(disabled.source,disabled.control.source);assert.deepEqual(disabled.wasm,disabled.control.wasm);});
 const missing=run('not-observed',disabled,{miss:true},p=>assert.equal(p.runtime,null));
 test('missing observations never compare as zero',()=>{assert.equal(compare(missing,loaded).runtime.reason,'missing-observation');assert.equal(compare(missing,loaded).runtime.chargedDelta,null);});
 const unused=compile('unused',1,{unused:true});run('unused',unused,{},p=>{assert.equal(p.static.bindings.length,0);assert.equal(p.runtime,null);assert.deepEqual(unused.wasm,unused.control.wasm);});
 const absent=compile('absent',1,{unused:true,absent:true});test('absent observation is byte-identical',()=>assert.deepEqual(absent.wasm,absent.control.wasm));
 for(const [name,options] of [['sampled',{sampleEvery:4}],['truncated',{capacity:8}],['count-only',{capacity:0}],['saturated',{counterLimit:8}]]){
  const a=compile(name,1,{...options,controlArtifact:direct.control});
  run(name,a,{miss:true},p=>{
   assert.equal(p.runtime.coverage.samples,'partial');assert.equal(p.runtime.totals.charged.backingBytes,262785);
   if(name==='saturated'){assert.equal(p.runtime.coverage.saturated,true);assert.equal(p.runtime.coverage.aggregates,'partial');assert.equal(p.runtime.coverage.records,'complete');assert.equal(compare(loaded,p).runtime.status,'unavailable');}
   else {miss(p);assert.deepEqual(p.runtime.transitions,loaded.runtime.transitions);assert.equal(compare(loaded,p).runtime.status,'available');}
  });
 }
 for(const width of [2,8,16,32]){
  const a=compile('width-'+width,width);
  run('width-'+width+'-hit',a,{},p=>assert.equal(p.runtime.totals.retainedBackingBytes,width*257));
  run('width-'+width+'-miss',a,{miss:true},p=>{miss(p,width);assert(p.runtime.samples.length<=256);assert.equal(p.runtime.collection.storageBytes,width*128+256+256*28);if(width>=8)assert(p.runtime.collection.dropped>0);});
  run('width-'+width+'-short',a,{short:true},p=>{assert.equal(p.runtime.admission.bindings.length,width);assert.equal(p.runtime.admission.dimensions[0].shortfall,1);assert.equal(p.runtime.collection.total,0);});
 }
 const full=compile('full-events',32,{capacity:4096});run('full-events',full,{miss:true},p=>{miss(p,32);assert.equal(p.runtime.coverage.samples,'complete');assert.equal(p.runtime.collection.total,1376);});
 const mixed=compile('mixed',2,{core:true});run('core-sibling',mixed,{miss:true},p=>{assert.equal(p.static.rootIds.length,3);assert.equal(p.runtime.totals.charged.backingBytes,787906);assert.equal(p.static.bindings.filter(b=>b.phase==='core').length,1);});
 test('different child graphs are not silently aligned',()=>assert.equal(compare(loaded,project(mixed)).runtime.status,'unavailable'));
 for(const [name,change] of [
  ['unknown-schema',p=>p.version='pulse.report-resource.v99'],['extra-sensitive-field',p=>p.runtime.records[0].rawHandle=123],
  ['wrong-binding',p=>p.runtime.records[0].binding='binding-0000000000000000'],['raw-use-site',p=>p.static.bindings[0].useSite='secret key'],
  ['duplicate-record',p=>p.runtime.records.push(p.runtime.records[0])],['hidden-backing',p=>p.runtime.totals.retainedBackingBytes=0],
  ['bad-conservation',p=>p.runtime.totals.charged.records++],['false-static-demand',p=>p.runtime.admission.dimensions[0].requested++],
  ['wrong-profile-hash',p=>p.artifact.profile='0'.repeat(64)],['conditional-erasure',p=>p.static.bindings.find(b=>b.phase==='loader').conditional=false],
  ['forged-shortfall',p=>p.runtime.admission.dimensions[0].shortfall=2],['duplicate-transition',p=>p.runtime.transitions.push(p.runtime.transitions[0])],['wrong-record-state',p=>p.runtime.records[0].state='owned']
 ])test('schema rejects '+name,()=>{const p=structuredClone(loaded);change(p);assert.throws(()=>validate(p),assert.AssertionError);});
 test('trap cannot claim complete coverage',()=>{const p=structuredClone(trapped);p.runtime.coverage.aggregates='complete';assert.throws(()=>validate(p),assert.AssertionError);});
 test('different execution artifact cannot be compared as matched',()=>{const p=structuredClone(loaded);p.artifact.execution='0'.repeat(64);assert.equal(compare(loaded,p).runtime.reason,'incompatible-static-evidence');});
 test('report profiles are independent mutable values',()=>{const p=project(direct);p.static.profile.work.handles++;assert.equal(project(direct).static.profile.work.handles,3);assert.equal(loaded.static.profile.work.handles,3);});
 test('a retired ordinal cannot start another resource lifetime',()=>{const p=structuredClone(loaded);for(const s of p.runtime.samples)if(s.record===6)s.record=3;assert.throws(()=>validate(p),assert.AssertionError);});
 test('schema is canonical-order independent',()=>{const p=JSON.parse(canonical(loaded));validate(p);assert.deepEqual(compare(p,loaded).runtime.chargedDelta,{handles:0,backingBytes:0,records:0});});
 test('CLI validates and compares sidecars',()=>{const cli=path.join(__dirname,'cli.cjs');const valid=JSON.parse(execFileSync(process.execPath,[cli,'validate',path.join(output,'miss.report.json')],{encoding:'utf8'}));assert.equal(valid.status,'valid');const c=JSON.parse(execFileSync(process.execPath,[cli,'compare',path.join(output,'hit.report.json'),path.join(output,'miss.report.json')],{encoding:'utf8'}));assert.equal(c.runtime.chargedDelta.backingBytes,262528);fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify(c,null,2)+'\n');});
 for(const mutation of ['no-events','wrong-site','hide-overflow','hide-backing','hide-saturation']){
  const a=compile('mutation-'+mutation,1,{diagnosticMutation:mutation,...(mutation==='hide-overflow'?{capacity:8}:{}),...(mutation==='hide-saturation'?{counterLimit:8}:{})});
  let detected;
  try{const p=project(a,host.execute(a.wasm,{miss:true}));miss(p);if(mutation==='hide-saturation')assert.equal(p.runtime.coverage.saturated,true);}
  catch(e){if(!(e instanceof assert.AssertionError))throw e;detected=e.message;}
  assert(detected,'mutation must fail behavioral oracle');receipt.mutations.push({name:mutation,detected:true,assertion:detected});save();console.log('ok - mutation '+mutation);
 }
 receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;console.error(e.stack);process.exitCode=1;}
if(canonical(inputs())!==canonical(receipt.inputs)){receipt.status='failed';receipt.error='input changed during run';process.exitCode=1;}
save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,mutations:receipt.mutations.length,output}));
