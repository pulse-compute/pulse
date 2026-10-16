'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash}=require('node:crypto');
const {candidateIdentity}=require('../../../scripts/release-feature-acceptance.cjs');
const {dependencies,environment}=require('./baseline.cjs');
const root=path.resolve(__dirname,'../../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const digest=f=>hash(fs.readFileSync(f)),read=f=>JSON.parse(fs.readFileSync(f));
const variants=['default','elided'];
function sources(){return Object.fromEntries([
  'wasm/test/performance/mem9.cjs','wasm/test/performance/mem9-worker.cjs','wasm/test/performance/mem9-diagnostic-asc.mjs',
  'wasm/test/provider/assert-fastly-schema-allocation.cjs',
  'packages/provider-fastly/src/build/native-platform-capabilities.js',
  'packages/provider-fastly/src/build/native-value-budget.js',
  'packages/provider-fastly/src/testing/native-platform-capabilities-host.js',
  'wasm/packages/runtime-core-as/src/compiler/canonical-native-support.js',
  'wasm/packages/runtime-core-as/src/compiler/canonical-native-expressions.js',
  'wasm/packages/runtime-core-as/src/compiler/canonical-native-control.js',
  'wasm/packages/host-runtime/src/runtime/canonical-native-host.js'
].map(f=>[f,digest(path.join(root,f))]));}
function validate(r){
  assert.equal(r.schemaVersion,'pulse.mem9-01.v1');assert.equal(r.status,'passed');assert.equal(r.source.workingTree,'');assert.deepEqual(r.sources,sources());
  assert.equal(r.domain,'diagnostic injected Fastly ABI; not timing, Viceroy or deployed evidence');
  assert.deepEqual(r.workers.map(w=>w.variant),variants);
  for(const w of r.workers){
    assert.equal(w.status,'passed');assert.equal(w.rows.length,11);assert.equal(w.recipes.length,1);
    const expected=[...['control','observed'].flatMap(m=>['escaped','unicode','small'].map(s=>m+'/'+s)),...[0,1,64,128,256].map(n=>'reduced/small-'+n)];
    assert.deepEqual(w.rows.map(x=>x.mode+'/'+x.shape),expected);
    assert.equal(w.controlGate.status,w.variant==='default'?'passed':'failed');
    if(w.variant==='elided')assert.match(w.controlGate.error,/^schema allocation used \d+ bytes$/);
    for(const a of w.files)assert.equal(digest(path.join(r.directory,w.variant,a.file)),a.sha256);
    const retained=read(path.join(r.directory,w.variant,'result.json'));
    const {files,...worker}=w;assert.deepEqual(worker,retained);
    for(const row of w.rows){
      assert.equal(row.additions,row.iterations*2048);assert.equal(row.responseFieldsSha256,row.expectedFieldsSha256);
      assert.equal(row.sha256,w.files.find(a=>a.file===row.mode+'.wasm').sha256);
      if(row.mode!=='control'){assert.equal(row.ownershipMask,511);assert(row.managedAfterFullGc>0);assert(row.numericHandles<=row.handles);assert(row.numericHandles>=row.additions);}
    }
    for(const shape of ['escaped','unicode','small']){
      const c=w.rows.find(x=>x.mode==='control'&&x.shape===shape),o=w.rows.find(x=>x.mode==='observed'&&x.shape===shape);
      assert.equal(c.capacityBytes,o.capacityBytes);assert.equal(c.responseSha256,o.responseSha256);
    }
    const reduced=w.rows.filter(x=>x.mode==='reduced');
    assert(reduced[0].handles<400);
    for(let i=2;i<reduced.length;i++){
      const a=reduced[i-1],b=reduced[i];assert.equal(b.handles-a.handles,b.additions-a.additions);assert.equal(b.numericHandles-a.numericHandles,b.additions-a.additions);assert(b.managedAfterFullGc>a.managedAfterFullGc);
    }
    const full=w.rows.find(x=>x.mode==='observed'&&x.shape==='small');
    assert.equal(reduced.at(-1).handles,full.handles);assert.equal(reduced.at(-1).capacityBytes,full.capacityBytes);
  }
  assert.deepEqual(r.workers[0].rows.map(x=>[x.mode,x.shape,x.handles,x.numericHandles,x.responseSha256]),r.workers[1].rows.map(x=>[x.mode,x.shape,x.handles,x.numericHandles,x.responseSha256]));
  return r;
}
function campaign(directory){
  assert(!fs.existsSync(directory),'Choose a new attempt directory');assert(!process.env.NODE_OPTIONS&&!process.env.JSON_CACHE);
  const source=candidateIdentity(root);assert.equal(source.workingTree,'','Commit diagnostics before recording evidence');
  fs.mkdirSync(directory,{recursive:true});
  const r={schemaVersion:'pulse.mem9-01.v1',status:'running',directory,source,sources:sources(),dependencies:dependencies(),environment:environment(),domain:'diagnostic injected Fastly ABI; not timing, Viceroy or deployed evidence',workers:[],startedAt:new Date().toISOString()};
  const persist=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(r,null,2)+'\n');persist();
  try{
    for(const variant of variants){
      const dir=path.join(directory,variant),run=child.spawnSync(process.execPath,[path.join(__dirname,'mem9-worker.cjs'),variant,dir],{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
      fs.writeFileSync(path.join(directory,variant+'.log'),(run.stdout||'')+(run.stderr||''));
      if(fs.existsSync(path.join(dir,'result.json')))r.workers.push({...read(path.join(dir,'result.json')),files:fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).map(file=>({file,sha256:digest(path.join(dir,file))}))});persist();
      assert.equal(run.status,0,run.stderr||run.error?.message);console.log(run.stdout.trim());
    }
    assert.deepEqual(candidateIdentity(root),source);assert.deepEqual(sources(),r.sources);assert.deepEqual(dependencies(),r.dependencies);
    r.status='passed';validate(r);
  }catch(e){r.status='failed';r.error=e.stack||String(e);throw e;}
  finally{r.completedAt=new Date().toISOString();persist();}
  console.log('ok - MEM9-01 report: '+path.join(directory,'report.json'));
}
if(require.main===module){try{const args=process.argv.slice(2);assert.equal(args.length,2);if(args[0]==='--out')campaign(path.resolve(args[1]));else{assert.equal(args[0],'--check');validate(read(args[1]));console.log('ok - MEM9-01 sources, artifacts, complete coverage, responses and retained-root slope');}}catch(e){console.error(e);process.exitCode=1;}}
module.exports={sources,validate};
