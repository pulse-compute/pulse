'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash}=require('node:crypto');
const {candidateIdentity}=require('../../../scripts/release-feature-acceptance.cjs');
const {dependencies,environment}=require('./baseline.cjs');
const {cells,name}=require('./mem9-06a-fixtures.cjs');
const root=path.resolve(__dirname,'../../..'),hash=x=>createHash('sha256').update(x).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f));
function validate(r,directory=r.directory){
  assert.equal(r.schemaVersion,'pulse.mem9-06a.v1');assert.equal(r.status,'passed');assert.equal(r.source.workingTree,'');assert.deepEqual(r.sourceAfter,r.source);
  assert.deepEqual(r.workers.map(({runtime,iterations,arena})=>({runtime,iterations,arena})),cells);
  for(const w of r.workers){
    assert.equal(w.status,'passed');const dir=path.join(directory,name(w)),{files,...receipt}=w;
    assert.deepEqual(receipt,read(path.join(dir,'result.json')));
    assert.deepEqual(files.map(f=>f.file),fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).sort());
    for(const f of files)assert.equal(hash(fs.readFileSync(path.join(dir,f.file))),f.sha256);
    assert.deepEqual(w.rows.map(r=>`${r.strategy}/${r.mode}`),['production/ordinary','production/observed','prototype/ordinary','prototype/observed']);
    if(w.disposition==='blocked-existing-schema-runtime'){
      assert.equal(w.runtime,'schema-linked');assert.equal(w.arena,'default');
      for(const row of w.rows){assert.equal(row.status,'blocked');assert.equal(row.blocker,'existing-schema-runtime-trap');assert.equal(row.wasmSha256,files.find(f=>f.file===`${row.strategy}-${row.mode}.wasm`).sha256);}
      continue;
    }
    assert.equal(w.disposition,'eligible-for-follow-up');
    for(const row of w.rows){
      assert.equal(row.status,'passed');assert.equal(row.wasmSha256,files.find(f=>f.file===`${row.strategy}-${row.mode}.wasm`).sha256);
      assert.equal(row.selected>0,row.strategy==='prototype');assert.equal(row.executions.length,3);
      for(let i=0;i<3;i++){
        const e=row.executions[i];assert.equal(e.responseSha256,w.rows[0].executions[i].responseSha256);assert(e.capacityBytes>0);
        if(w.runtime!=='stub')assert.equal(e.capacityBytes,2097152);
        if(row.mode==='ordinary'){assert.equal(e.handles,null);assert.equal(e.allocatorSpanBytes,null);}
        else{assert(e.handles>0&&e.numbers>0&&e.allocatorSpanBytes>0);if(w.runtime==='stub')assert.equal(e.managedAfterFullGc,null);else assert(e.managedAfterFullGc>0);}
      }
      assert.deepEqual(row.executions[0],row.executions[1]);
    }
  }
  for(const runtime of ['stub','ES256','RS256']){
    const pair=r.workers.filter(w=>w.runtime===runtime),low=pair[0],high=pair[1];
    assert(high.rows[1].executions[0].numbers-low.rows[1].executions[0].numbers>=1280,'Five 256-addition regions must be a retaining positive control');
    assert(high.rows[3].executions[0].numbers<=low.rows[3].executions[0].numbers+16,'Prototype roots must stay bounded');
    if(runtime==='stub')assert(high.rows[3].executions[0].allocatorSpanBytes<high.rows[1].executions[0].allocatorSpanBytes);
    else assert(high.rows[3].executions[0].managedAfterFullGc<high.rows[1].executions[0].managedAfterFullGc);
  }
  return r;
}
async function campaign(directory){
  assert(!fs.existsSync(directory));assert(!process.env.NODE_OPTIONS&&!process.env.JSON_CACHE);
  const source=candidateIdentity(root);fs.mkdirSync(directory,{recursive:true});
  const r={schemaVersion:'pulse.mem9-06a.v1',status:'running',directory,source,dependencies:dependencies(),environment:environment(),domain:'Fastly test host, real linked guest bytes. No latency, RSS, deployed Fastly or Viceroy claim. Allocator span is not live bytes.',workers:[]};
  const persist=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(r,null,2)+'\n');persist();
  let next=0,failed=false;
  async function lane(){while(next<cells.length&&!failed){
    const cell=cells[next++],dir=path.join(directory,name(cell)),fd=fs.openSync(path.join(directory,name(cell)+'.log'),'wx');let outcome;
    try{outcome=await new Promise(resolve=>{const p=child.spawn(process.execPath,[path.join(__dirname,'mem9-06a-worker.cjs'),cell.runtime,String(cell.iterations),cell.arena,dir],{stdio:['ignore',fd,fd],timeout:240000});p.on('error',e=>resolve({error:e.message}));p.on('close',(code,signal)=>resolve({code,signal}));});}finally{fs.closeSync(fd);}
    if(fs.existsSync(path.join(dir,'result.json'))){r.workers.push({...read(path.join(dir,'result.json')),files:fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).sort().map(file=>({file,sha256:hash(fs.readFileSync(path.join(dir,file)))}))});r.workers.sort((a,b)=>cells.findIndex(c=>name(c)===name(a))-cells.findIndex(c=>name(c)===name(b)));persist();}
    if(outcome.code!==0){failed=true;throw Error(`${name(cell)} failed: ${JSON.stringify(outcome)}`);}console.log(`ok - ${name(cell)}`);
  }}
  try{const results=await Promise.allSettled([lane(),lane()]);const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;r.sourceAfter=candidateIdentity(root);r.status='passed';validate(r);}
  catch(e){r.status='failed';r.error=e.stack;throw e;}finally{persist();}
  // Negative validation checks: incomplete coverage, altered source and changed bytes cannot pass.
  for(const mutate of [x=>x.workers.pop(),x=>x.sourceAfter.sourceTree='0'.repeat(40),x=>x.workers[0].files[0].sha256='0'.repeat(64)]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>validate(bad));}
  console.log('ok - MEM9-06A coverage, identity, bytes, parity and retention checks');
}
if(require.main===module){const[mode,file]=process.argv.slice(2);if(mode==='--check'){validate(read(file),path.dirname(path.resolve(file)));console.log('ok - MEM9-06A evidence verified');}else{assert.equal(mode,'--out');campaign(path.resolve(file)).catch(e=>{console.error(e.stack);process.exitCode=1;});}}
module.exports={validate};
