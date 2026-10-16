'use strict';
// Development measurements, deliberately outside deterministic acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {fixture,request,providerOptions}=require('../../provider/assert-fastly-handle-frames.cjs');
const {build}=require('../../provider/assert-fastly-handle-ownership.cjs');
const {diagnosticCompile,diagnosticHost,observer}=require('./mem01-schema-materialization.cjs');
const root=path.resolve(__dirname,'../../../..'),hash=x=>createHash('sha256').update(x).digest('hex');
function timedHost() {
  const file=path.join(root,'packages/provider-fastly/src/testing/native-platform-capabilities-host.js'),source=fs.readFileSync(file,'utf8');
  assert.equal(source.split('try { instance.exports._start(); }').length,2);
  const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source.replace('try { instance.exports._start(); }','try { options.measure(() => instance.exports._start()); }')
    .replace('const module = new WebAssembly.Module(wasm);','const module = options.compiledModule;'),file);
  return loaded.exports.executeFastlyNativePlatformCapabilities;
}
let seed=0x9b081;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
function distribution(a){const s=[...a].sort((a,b)=>a-b);return{median:(s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2,p95:s[Math.ceil(s.length*.95)-1],min:s[0],max:s.at(-1)};}
function paired(rows,field){const d=rows.map(r=>r.traced[field]-r.retained[field]),boot=[];
  for(let i=0;i<2000;i++){let sum=0;for(let j=0;j<d.length;j++)sum+=d[Math.floor(random()*d.length)];boot.push(sum/d.length);}
  boot.sort((a,b)=>a-b);return{meanDelta:d.reduce((a,b)=>a+b,0)/d.length,meanDelta95CI:[boot[50],boot[1949]]};}
async function main(directory) {
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  assert.equal(git(['status','--porcelain']),'','cost campaign requires a clean source');
  const source={commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])};
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'results.json');assert(!fs.existsSync(file));
  const report={task:'MEM9-09B',status:'running',source,providerReality:false,
    environment:{node:process.version,assemblyScript:require(path.join(root,'wasm/node_modules/assemblyscript/package.json')).version,
      lockSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))},
    timingScope:'Fresh-instance _start, injected Fastly host calls included; compilation and instantiation excluded. Fixture delays are simulated clocks, not wall latency. Production artifacts: no forced GC or observation exports.',
    sampling:{seed,warmupPairs:10,pairedSamples:40,bootstrapResamples:2000},cells:[]};
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
  const {cwd,plan}=fixture();
  try {
    const execute=timedHost(),observe=diagnosticHost();
    for(const elideJsonCacheArena of [false,true]) {
      const artifacts={traced:build(plan,{providerOptions,elideJsonCacheArena}),retained:build(plan,{retained:true,providerOptions,elideJsonCacheArena})};
      const modules=Object.fromEntries(Object.entries(artifacts).map(([k,a])=>[k,new WebAssembly.Module(a.wasm)]));
      const diagnostic=Object.fromEntries(Object.entries(artifacts).map(([k,a])=>[k,
        diagnosticCompile(a.source,'traced',path.join(directory,`${elideJsonCacheArena}-${k}`),{elideJsonCacheArena})]));
      for(const n of [0,1,32]) {
        const cell={elideJsonCacheArena,n,artifacts:Object.fromEntries(Object.entries(artifacts).map(([k,a])=>[k,{bytes:a.wasm.length,sha256:hash(a.wasm)}])),samples:[]};
        let expected;
        for(let i=-10;i<40;i++) {
          const row={};
          for(const k of random()<.5?['traced','retained']:['retained','traced']) {
            const r=execute(artifacts[k],{...request('/frames',n),compiledModule:modules[k],measure(call){
              const cpu=process.cpuUsage(),thread=process.threadCpuUsage(),start=process.hrtime.bigint();call();
              const wallMs=Number(process.hrtime.bigint()-start)/1e6,c=process.cpuUsage(cpu),t=process.threadCpuUsage(thread);
              row[k]={wallMs,cpuMs:(c.user+c.system)/1000,threadCpuMs:(t.user+t.system)/1000};}});
            expected||=r.response;assert.deepEqual(r.response,expected);
          }
          if(i>=0)cell.samples.push(row);
        }
        cell.timing=Object.fromEntries(Object.keys(cell.samples[0].traced).map(field=>[field,{
          traced:distribution(cell.samples.map(r=>r.traced[field])),retained:distribution(cell.samples.map(r=>r.retained[field])),...paired(cell.samples,field)}]));
        cell.memory={};
        for(const k of ['traced','retained']) {
          const probe=observer(),r=observe({...artifacts[k],wasm:diagnostic[k]},{...request('/frames',n),mem01:probe});
          assert.deepEqual(r.response,expected);cell.memory[k]={terminal:probe.metrics(),postCollect:probe.collect()};
        }
        report.cells.push(cell);save();console.log(JSON.stringify({n,elideJsonCacheArena,timing:cell.timing.wallMs,memory:cell.memory}));
      }
    }
    fs.rmSync(cwd,{recursive:true,force:true});
    assert.equal(git(['status','--porcelain']),'');assert.equal(git(['rev-parse','HEAD']),source.commit);
    report.status='passed';save();
  } catch(e){report.status='failed';report.error=e.stack;save();throw e;}
  finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
if(require.main===module)main(path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
