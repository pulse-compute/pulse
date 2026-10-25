'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),b=require('./build.cjs'),h=require('./host.cjs'),oracle=require('../ra08/host.cjs'),{project}=require('../ra08/report.cjs');
const {paired}=require('./stats.cjs');
const out=path.resolve(process.argv[2]||'/tmp/hex-ra09');assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const files=['build.cjs','host.cjs','stats.cjs','check.cjs','measure.cjs','../ra08/build.cjs','../ra08/host.cjs','../ra08/observer.as.ts','../ra08/report.cjs','../ra08/schema.cjs','../ra07/build.cjs','../ra07/service.as.ts','../ra07/host.cjs','../ra03/native/build.cjs','../ra03/native/service.as.ts','../ra05/adapter.as.ts','../ra06/service.as.ts','../../composition/prototype.cjs','../../composition/service.as.ts','../../composition/fixture.cjs','../../ownership/prototype.cjs','../../ownership/fixture.cjs'].map(f=>path.resolve(__dirname,f));
const inputs=()=>files.map(f=>({file:path.relative(b.root,f),sha256:hash(fs.readFileSync(f))}));
const git=(...args)=>execFileSync('git',args,{cwd:b.root,encoding:'utf8'}).trim();
const receipt={version:'hex.ra09.check.v1',status:'running',base:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),node:process.version,compiler:{version:JSON.parse(fs.readFileSync(path.join(path.dirname(b.asc.script),'../package.json'))).version,sha256:hash(fs.readFileSync(b.asc.script))},inputs:inputs(),artifacts:[],cases:[],workloads:[]};
for(const f of files){const dest=path.join(out,'inputs',path.relative(b.root,f));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(f,dest);}
const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
function test(name,fn){try{fn();receipt.cases.push({name,status:'passed'});save();console.log('ok - '+name);}catch(e){receipt.failedCase=name;throw e;}}
const scenarios={hit:{},miss:{miss:true},cleanup:{miss:true,failAt:'write'},timeout:{miss:true,timeoutKind:'fetch-pending'}};
function strip(r){const {cost,calls,diagnostics,trace,...behavior}=r;return behavior;}
function calls(trace){const o={};for(const x of trace)o[x.call]=(o[x.call]||0)+1;return o;}
function artifact(name,a,extra={}){receipt.artifacts.push({name,...extra,bytes:a.wasm.length,sha256:hash(a.wasm),sourceSha256:hash(a.source)});save();}
try{
 test('paired statistics retain sign and uncertainty',()=>{const zeros=Array(12).fill(0),mixed=Array.from({length:12},(_,i)=>i%2?1:-1);assert.equal(paired(zeros,mixed).signal,'inconclusive');assert.equal(paired(zeros,Array(12).fill(2)).signal,'positive-local-delta');assert.equal(paired(zeros,Array(12).fill(-2)).productionSpeedupClaim,false);assert.throws(()=>paired([1],[1]));});
 for(const width of [1,8,16,32]){
  const dir=path.join(out,'width-'+width),family=b.family(dir,width);
  for(const [name,a] of Object.entries(family))artifact('width-'+width+'/'+name,a,{width,variant:name});
  for(const [scenario,options] of Object.entries(scenarios)){
   const control=oracle.execute(family.off.wasm,{...options,slots:width*4});
   fs.writeFileSync(path.join(dir,scenario+'-oracle.json'),JSON.stringify(control,null,2)+'\n');
   for(const [name,a] of Object.entries(family))test('matched '+width+'/'+scenario+'/'+name,()=>{
    const full=oracle.execute(a.wasm,{...options,slots:width*4});assert.deepEqual(strip(full),strip(control));assert.deepEqual(full.trace,control.trace);
    const quiet=h.execute(new WebAssembly.Module(a.wasm),{...options,slots:width*4,quiet:true,collect:true});assert.deepEqual(strip(quiet),strip(full));assert.deepEqual(quiet.calls,calls(full.trace));assert.deepEqual(quiet.diagnostics,full.diagnostics);
    assert(quiet.cost.executionNs>0&&quiet.cost.instantiationNs>0);assert(quiet.cost.finalMemory>=quiet.cost.initialMemory);assert.equal(quiet.cost.finalMemory%65536,0);
    const report=project(a,quiet);fs.writeFileSync(path.join(dir,name,scenario+'.report.json'),JSON.stringify(report,null,2)+'\n');
    receipt.workloads.push({width,scenario,variant:name,options,wasm:path.relative(out,path.join(dir,name,'module.wasm')),sha256:hash(a.wasm),expected:strip(quiet),calls:quiet.calls,memory:{initial:quiet.cost.initialMemory,final:quiet.cost.finalMemory},diagnosticBankBytes:quiet.diagnostics?.meta[13]??0});
   });
  }
  const ledger=b.ledger(path.join(dir,'ledger'),width);artifact('ledger-'+width,ledger,{width});
  test('ledger fixed profile cycles '+width,()=>{const e=new WebAssembly.Instance(new WebAssembly.Module(ledger.wasm),{}).exports;assert.equal(e.banks(),680*width+192);for(const mode of [0,1,2]){assert.equal(e.cycle(10,mode),width*(mode===0?1:mode===1?3:4)*10);assert.equal(e.records(),0);}assert.equal(e.memory.buffer.byteLength,65536);});
  console.log('checkpoint width '+width);
 }
 const absent=b.unused(path.join(out,'unused'),'absent'),production=b.unused(path.join(out,'unused'),'production'),unused=b.unused(path.join(out,'unused'),'unused');
 for(const [name,a] of Object.entries({absent,production,unused}))artifact(name,a);
 test('absent implementation equals production bytes',()=>{assert.equal(absent.source,production.source);assert.deepEqual(absent.wasm,production.wasm);});
 test('unused import changes only plan identity and no size/import authority',()=>{const omit=s=>s.replace(/const PULSE_PLAN_HASH: string = "[a-f0-9]+"/,'const PULSE_PLAN_HASH: string = "IDENTITY"');assert.equal(omit(absent.source),omit(unused.source));assert.equal(absent.wasm.length,unused.wasm.length);assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(absent.wasm)),WebAssembly.Module.imports(new WebAssembly.Module(unused.wasm)));assert(!unused.source.includes('function rd_state('));assert(!unused.source.includes('function na_prepare('));});
 for(const [name,a] of Object.entries({absent,production,unused}))test('unused behavior '+name,()=>{const r=h.execute(new WebAssembly.Module(a.wasm),{quiet:true});assert.equal(r.body,'ok');assert.equal(r.thrown,null);receipt.workloads.push({width:0,scenario:'unused',variant:name,options:{},wasm:'unused/'+name+'/module.wasm',sha256:hash(a.wasm),expected:strip(r),calls:r.calls,memory:{initial:r.cost.initialMemory,final:r.cost.finalMemory},diagnosticBankBytes:0});});
 receipt.unused={absentWasmIdentical:true,unusedBytesIdentical:hash(absent.wasm)===hash(unused.wasm),unusedSizeDelta:unused.wasm.length-absent.wasm.length};
 receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;console.error(e.stack);process.exitCode=1;}
if(JSON.stringify(inputs())!==JSON.stringify(receipt.inputs)){receipt.status='failed';receipt.error='inputs changed';process.exitCode=1;}save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,output:out}));
