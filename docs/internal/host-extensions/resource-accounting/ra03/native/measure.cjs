'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto'),os=require('node:os');
const {performance}=require('node:perf_hooks'),b=require('./build.cjs');
const ledgerDir=path.resolve(process.argv[2]),driverDir=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]||'/tmp/hex-ra03-native-costs');fs.mkdirSync(output,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),median=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
const stats=s=>({medianUs:median(s),minUs:Math.min(...s),maxUs:Math.max(...s),samplesUs:s});
const receipt={version:'hex.ra03-native-costs.v1',status:'running',node:process.version,cpu:os.cpus()[0]?.model,scope:'Wasm ledger batches and matched synthetic Fastly-driver fixtures under Node WebAssembly; not real Fastly latency or physical memory qualification.',ledgerReceiptSha256:hash(fs.readFileSync(path.join(ledgerDir,'receipt.json'))),driverReceiptSha256:hash(fs.readFileSync(path.join(driverDir,'receipt.json'))),rows:[]};
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
(async()=>{
 try{
  assert.equal(JSON.parse(fs.readFileSync(path.join(ledgerDir,'receipt.json'))).status,'passed');assert.equal(JSON.parse(fs.readFileSync(path.join(driverDir,'receipt.json'))).status,'passed');
  const binaryen=(await import(require.resolve('binaryen',{paths:[b.asc.packageRoot]}))).default;
  const hostFile=path.join(driverDir,'injected-host.cjs');let host=fs.readFileSync(hostFile,'utf8');const anchor='new WebAssembly.Module(wasm)';assert.equal(host.split(anchor).length-1,1);host=host.replace(anchor,'(wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm))');
  fs.writeFileSync(path.join(output,'benchmark-host.cjs'),host);const mod=new Module(hostFile);mod.filename=hostFile;mod.paths=Module._nodeModulePaths(path.dirname(hostFile));mod._compile(host,hostFile);const execute=mod.exports.execute;
  for(const n of [8,16,32]){
   const bytes=fs.readFileSync(path.join(ledgerDir,'ledger-'+n+'.wasm')),module=new WebAssembly.Module(bytes),ir=binaryen.readBinary(bytes),wat=ir.emitText();ir.dispose();fs.writeFileSync(path.join(output,'ledger-'+n+'.wat'),wat);
   assert.equal(WebAssembly.Module.imports(module).length,0);assert(!/\(memory\.grow\b/.test(wat),'ledger must not grow memory');
   const first=new WebAssembly.Instance(module).exports;
   const row={width:n,ledgerWasmBytes:bytes.length,ledgerSha256:hash(bytes),bankBytes:first.na_bytes(),memoryBytes:first.memory.buffer.byteLength,noImports:true,noMemoryGrowInstruction:true,ledgerCycles:[]};
   for(const [mode,scenario]of ['hit','miss','full-cleanup','unknown-disposal'].entries()){
    const e=new WebAssembly.Instance(module).exports,repetitions=3000;assert(e.na_bench(1000,mode)>0);const wall=[],cpu=[],before=e.memory.buffer.byteLength;
    for(let sample=0;sample<9;sample++){const start=performance.now(),c=process.cpuUsage(),sum=e.na_bench(repetitions,mode),cost=process.cpuUsage(c);wall.push((performance.now()-start)*1000/repetitions);cpu.push((cost.user+cost.system)/repetitions);assert.equal(sum,n*(mode===0?1:mode===1?3:4)*repetitions);assert.equal(e.memory.buffer.byteLength,before);}
    row.ledgerCycles.push({scenario,repetitions,wall:stats(wall),processCpu:stats(cpu)});
   }
   const baseBytes=fs.readFileSync(path.join(driverDir,'base-'+n+'.wasm')),activeBytes=fs.readFileSync(path.join(driverDir,'plain-'+n+'.wasm')),base=new WebAssembly.Module(baseBytes),active=new WebAssembly.Module(activeBytes);
   assert.deepEqual(WebAssembly.Module.imports(base),WebAssembly.Module.imports(active),'No added host import');
   const run=m=>{const r=execute(m);assert.equal(r.thrown,null);assert.equal(r.error,0);assert.equal(r.status,200);assert.equal(r.trace.filter(x=>x.call==='wall-clock').length,n);return r;};
   assert.deepEqual(run(base).trace,run(active).trace,'Same host-call sequence');
   for(let warm=0;warm<10;warm++){run(base);run(active);}
   const off=[],on=[],offCpu=[],onCpu=[],reps=25;
   for(let sample=0;sample<7;sample++)for(const enabled of sample%2?[true,false]:[false,true]){const m=enabled?active:base,start=performance.now(),c=process.cpuUsage();for(let i=0;i<reps;i++)run(m);const cost=process.cpuUsage(c);(enabled?on:off).push((performance.now()-start)*1000/reps);(enabled?onCpu:offCpu).push((cost.user+cost.system)/reps);}
   row.driver={baseRequestMemoryBytes:run(base).instance.exports.memory.buffer.byteLength,enabledRequestMemoryBytes:run(active).instance.exports.memory.buffer.byteLength,baseBytes:baseBytes.length,enabledBytes:activeBytes.length,addedBytes:activeBytes.length-baseBytes.length,baseline:stats(off),enabled:stats(on),differenceOfMediansUs:median(on)-median(off),baselineCpu:stats(offCpu),enabledCpu:stats(onCpu),sameHostSequence:true,extraHostImports:0,scope:'Cached compilation; fresh Wasm instance plus complete handler, injected host tracing and response validation per iteration; no deployment latency claim.'};
   receipt.rows.push(row);save();console.log(JSON.stringify({width:n,bankBytes:row.bankBytes,addedWasm:row.driver.addedBytes,missUs:row.ledgerCycles[1].wall.medianUs,cleanupUs:row.ledgerCycles[2].wall.medianUs}));
  }
  receipt.status='passed';
 }catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;}
 receipt.sourceSha256=hash(fs.readFileSync(__filename));save();console.log(JSON.stringify({status:receipt.status,error:receipt.error,output}));
})();
