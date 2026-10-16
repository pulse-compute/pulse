'use strict';
// Development cost/retention campaign, separate from deterministic acceptance.
// Production artifacts are timed; RTRACE/full-GC artifacts are observed only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { planFor, build, retentionBody } = require('../../provider/assert-fastly-handle-ownership.cjs');
const { diagnosticCompile, diagnosticHost, observer } = require('./mem01-schema-materialization.cjs');
const root = path.resolve(__dirname, '../../../..');
const hash = b => createHash('sha256').update(b).digest('hex');
const request = n => ({ clockUnixSeconds: 1700000000, request: { method: 'POST', path: '/', headers: [['content-type','application/json']], body: JSON.stringify({ n }) } });
function timedHost() {
  const file = path.join(root,'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
  const source = fs.readFileSync(file,'utf8'), needle = 'try { instance.exports._start(); }';
  assert.equal(source.split(needle).length,2);
  const loaded = new Module(file,module); loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source.replace(needle,'try { options.measure(() => instance.exports._start()); }')
    .replace('const module = new WebAssembly.Module(wasm);','const module = options.compiledModule;'),file);
  return loaded.exports.executeFastlyNativePlatformCapabilities;
}
let seed=0x9a081;
function random() {seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
const median = a => {const s=[...a].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
function distribution(a) {const s=[...a].sort((a,b)=>a-b);return {median:median(s),p95:s[Math.ceil(s.length*.95)-1],min:s[0],max:s.at(-1)};}
function pairedCI(rows,field) {
  const deltas=rows.map(r=>r.traced[field]-r.retained[field]),boot=[];
  for(let i=0;i<2000;i++){let total=0;for(let j=0;j<deltas.length;j++)total+=deltas[Math.floor(random()*deltas.length)];boot.push(total/deltas.length);}
  boot.sort((a,b)=>a-b);return {meanDelta:deltas.reduce((a,b)=>a+b,0)/deltas.length,meanDelta95CI:[boot[50],boot[1949]]};
}
async function main(directory) {
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'results.json');
  const sourceFiles=()=>Object.fromEntries([...new Set([
    ...execFileSync('git',['diff','HEAD','--name-only','-z'],{cwd:root,encoding:'utf8'}).split('\0'),
    ...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0')
  ].filter(Boolean))].sort().map(p=>[p,fs.existsSync(path.join(root,p))?hash(fs.readFileSync(path.join(root,p))):null]));
  const report={task:'MEM9-09A',status:'running',providerReality:false,source:{commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:sourceFiles(),
    diffSha256:hash(execFileSync('git',['diff','HEAD'],{cwd:root})),workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})},
    environment:{node:process.version,platform:process.platform,arch:process.arch,
      assemblyScript:require(path.join(root,'wasm/node_modules/assemblyscript/package.json')).version,
      lockSha256:hash(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))},
    timingScope:'Fresh-instance _start including injected host calls; precompiled modules, compilation/instantiation excluded. Main-thread and process CPU reported separately; no concurrent measurement workers. Not deployed-provider latency.',
    sampling:{seed,pairedSamples:40,warmupPairs:10,bootstrapResamples:2000},cells:[]};
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
  try {
    const execute=timedHost(), observe=diagnosticHost();
    for(const elideJsonCacheArena of [false,true]) {
      const retained=build(planFor(retentionBody),{retained:true,elideJsonCacheArena});
      for(const interval of [1024,256,4096]) {
      const artifacts={traced:build(planFor(retentionBody),{elideJsonCacheArena,interval}),retained};
      const modules=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,new WebAssembly.Module(a.wasm)]));
      const wasm={};
      for(const [name,a] of Object.entries(artifacts)) {
        // Reuse the pinned allocator observer; no table enumeration is used.
        const dest=path.join(directory,`arena-${elideJsonCacheArena}-interval-${interval}-${name}`);fs.mkdirSync(dest,{recursive:true});
        // Production scheduling has allocator observations for both arenas.
        // Alternate intervals are cost-only diagnostics, never public options.
        if (interval === 1024) wasm[name]=diagnosticCompile(a.source,'traced',dest,{elideJsonCacheArena});
      }
      for(const iterations of [0,1,32]) {
        const cell={elideJsonCacheArena,interval,iterations,artifacts:Object.fromEntries(Object.entries(artifacts).map(([k,a])=>[k,{bytes:a.wasm.length,sha256:hash(a.wasm)}])),samples:[]};
        let expected;
        for(let i=-10;i<40;i++) {
          const pair={};
          for(const name of random()<.5?['traced','retained']:['retained','traced']) {
            const r=execute(artifacts[name],{...request(iterations),compiledModule:modules[name],measure(call){
              const cpu=process.cpuUsage(),thread=process.threadCpuUsage?.(),start=process.hrtime.bigint();call();
              const wall=Number(process.hrtime.bigint()-start)/1e6,used=process.cpuUsage(cpu),main=thread&&process.threadCpuUsage(thread);
              pair[name]={wallMs:wall,cpuMs:(used.user+used.system)/1000,...(main?{threadCpuMs:(main.user+main.system)/1000}:{})};}});
            expected ||= r.response;assert.deepEqual(r.response,expected);
          }
          if(i>=0)cell.samples.push(pair);
        }
        cell.timing=Object.fromEntries(Object.keys(cell.samples[0].traced).map(field=>[field,{traced:distribution(cell.samples.map(r=>r.traced[field])),retained:distribution(cell.samples.map(r=>r.retained[field])),...pairedCI(cell.samples,field)}]));
        if(interval === 1024) {
          cell.memory={};
          for(const name of ['traced','retained']) {
            const probe=observer();const r=observe({...artifacts[name],wasm:wasm[name]},{...request(iterations),mem01:probe});
            assert.deepEqual(r.response,expected);cell.memory[name]={terminal:probe.metrics(),postCollect:probe.collect()};
          }
        }
        report.cells.push(cell);save();console.log(JSON.stringify({arenaElided:elideJsonCacheArena,interval,iterations,timing:cell.timing,memory:cell.memory}));
      }
      }
    }
    assert.deepEqual(sourceFiles(),report.source.files,'source files stayed fixed throughout measurement');
    report.status='passed';save();return report;
  }catch(error){report.status='failed';report.error=error.stack;save();throw error;}
}
if(require.main===module)main(path.resolve(process.argv[2]||path.join(root,'wasm/.test-results/mem9-09'))).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
