'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash}=require('node:crypto');
const {candidateIdentity}=require('../../../scripts/release-feature-acceptance.cjs');
const {dependencies,environment}=require('./baseline.cjs');
const root=path.resolve(__dirname,'../../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f));
function validate(r){
  assert.equal(r.schemaVersion,'pulse.mem9-02.v1');assert.equal(r.status,'passed');assert.equal(r.source.workingTree,'');
  assert.deepEqual(r.workers.map(w=>w.strategy+'/'+w.variant),['boxed/default','numeric/default','boxed/elided','numeric/elided']);
  for(const w of r.workers){
    assert.equal(w.status,'passed');assert.equal(w.rows.length,11);
    assert.deepEqual(w.rows.map(x=>x.mode+'/'+x.shape),[...['control','observed'].flatMap(m=>['escaped','unicode','small'].map(s=>m+'/'+s)),...[0,1,64,128,256].map(n=>'reduced/small-'+n)]);
    assert.equal(w.controlGate.status,w.strategy==='boxed'&&w.variant==='elided'?'failed':'passed');
    for(const a of w.files)assert.equal(hash(fs.readFileSync(path.join(r.directory,w.strategy+'-'+w.variant,a.file))),a.sha256);
    const {files,...receipt}=w;assert.deepEqual(receipt,read(path.join(r.directory,w.strategy+'-'+w.variant,'result.json')));
    for(const x of w.rows){assert.equal(x.responseFieldsSha256,x.expectedFieldsSha256);assert.equal(x.sha256,w.files.find(f=>f.file===x.mode+'.wasm').sha256);if(x.mode!=='control'){assert.equal(x.ownershipMask,511);assert(x.managedAfterFullGc>0);}}
    for(const shape of ['escaped','unicode','small']){
      const c=w.rows.find(x=>x.mode==='control'&&x.shape===shape),o=w.rows.find(x=>x.mode==='observed'&&x.shape===shape);
      assert.equal(c.responseSha256,o.responseSha256);assert.equal(c.capacityBytes,o.capacityBytes);
    }
    const reduced=w.rows.filter(x=>x.mode==='reduced');
    for(let i=2;i<reduced.length;i++){
      const a=reduced[i-1],b=reduced[i];
      if(w.strategy==='boxed'){
        assert.equal(b.handles-a.handles,b.additions-a.additions);
        assert.equal(b.numericHandles-a.numericHandles,b.additions-a.additions);
      } else {
        // Only the accumulator and two final counters can add roots. Counter
        // cache hits differ with the final number; growth is bounded, not flat.
        assert(b.handles<=reduced[0].handles+3);
        assert(b.numericHandles<=reduced[0].numericHandles+3);
      }
    }
    if(w.strategy==='numeric')for(const x of w.rows){assert(x.capacityBytes<=128*1024*1024);if(x.mode!=='control')assert(x.numericHandles<100);}
  }
  for(const w of r.workers)assert.deepEqual(w.rows.map(x=>x.responseSha256),r.workers[0].rows.map(x=>x.responseSha256));
  return r;
}
function campaign(directory){
  assert(!fs.existsSync(directory));assert(!process.env.NODE_OPTIONS&&!process.env.JSON_CACHE);
  const source=candidateIdentity(root);assert.equal(source.workingTree,'','Commit before measuring');fs.mkdirSync(directory,{recursive:true});
  const r={schemaVersion:'pulse.mem9-02.v1',status:'running',directory,source,dependencies:dependencies(),environment:environment(),domain:'injected Fastly ABI diagnostic; not deployed evidence',workers:[]};
  const persist=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(r,null,2)+'\n');persist();
  try{
    for(const variant of ['default','elided'])for(const strategy of ['boxed','numeric']){
      const dir=path.join(directory,strategy+'-'+variant),run=child.spawnSync(process.execPath,[path.join(__dirname,'mem9-02-worker.cjs'),variant,dir,strategy],{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
      fs.writeFileSync(path.join(directory,strategy+'-'+variant+'.log'),(run.stdout||'')+(run.stderr||''));
      if(fs.existsSync(path.join(dir,'result.json')))r.workers.push({...read(path.join(dir,'result.json')),files:fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).map(file=>({file,sha256:hash(fs.readFileSync(path.join(dir,file)))}))});persist();
      assert.equal(run.status,0,run.stderr||run.error?.message);console.log(run.stdout.trim());
    }
    assert.deepEqual(candidateIdentity(root),source);r.status='passed';validate(r);
  }catch(e){r.status='failed';r.error=e.stack;throw e;}finally{persist();}
  console.log('ok - MEM9-02 44 cases; both allocation gates; bounded numeric-root count');
}
if(require.main===module){const [mode,file]=process.argv.slice(2);if(mode==='--check'){validate(read(file));console.log('ok - MEM9-02 evidence verified');}else{assert.equal(mode,'--out');campaign(path.resolve(file));}}
module.exports={validate};
