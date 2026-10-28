'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Ledger}=require('./service.cjs'),{config,profile,v,demand,release}=require('./check.cjs');
const {executionHooks,providerCall}=require('./provider-hooks.cjs'),{bridge,file}=require('./javascript-bridge.cjs');
const time=()=>({status:'ok',unixEpochMs:1000,iso8601:'1970-01-01T00:00:01.000Z'});
const cases=[];async function check(name,fn){const detail=await fn();cases.push({name,status:'passed',detail});}
function setup(n,{capacity=demand(n),enabled=true,invoke,source,deadline=100000,clock=()=>0,signal}={}){
  const b=bridge(enabled);let dispatches=0,admissions=[],teardowns=0;
  const ledger=enabled?new Ledger(config(n,{capacity,deadline,clock,profiles:[{...profile,effects:1}]})):null;
  const hooks=enabled?executionHooks(ledger, d => { if (d.kind !== 'time.now') throw Error('unqualified descriptor'); return 0; }):null;
  const observed=hooks?{...hooks,admit(roots){hooks.admit(roots);admissions.push({width:roots.length,dispatches,committed:ledger.snapshot().committed});}}:null;
  const adapter=b.api.createJavascriptEffectAdapter({id:'ra03-fixture',async dispatch(effect,execution){
    dispatches++;
    if(enabled){
      const tickets=await providerCall(ledger,execution.accountingRoot,[v(1,64,1)],()=>invoke?invoke(effect,execution):{outputs:[dispatches]}, {containExecution(){teardowns++;}});
      for(const t of tickets){ // Disposal is an explicit qualified fixture outcome.
        if(!ledger.snapshot().ended && !execution.signal.aborted) release(ledger,t);
      }
    }
    return time();
  }});
  const execution=b.api.createJavascriptEffectExecution({effectAdapter:adapter,maxEffects:1024,signal,deadlineMonotonicMs:deadline,...(observed?{resourceAccounting:observed}:{})});
  return {execution,ledger,admissions,bridge:b,get dispatches(){return dispatches;},get teardowns(){return teardowns;}};
}
const dispatch=e=>e.dispatch({kind:'time.now'});
async function run(){
  for(const n of [8,16,32])for(const form of ['keyed','collection']){
    await check(`${form} width ${n} reserves entire cohort before dispatch`,async()=>{
      const s=setup(n),e=s.execution;let group;
      if(form==='keyed')group=Object.fromEntries(Array.from({length:n},(_,i)=>['k'+i,dispatch(e)]));
      else {group=e.effects({max:n});for(let i=0;i<n;i++)group.add(dispatch(e));}
      await e.parallel(group);assert.equal(s.admissions.length,1);assert.equal(s.admissions[0].dispatches,0);assert.equal(s.admissions[0].width,n);assert.equal(s.dispatches,n);assert.deepEqual(s.ledger.snapshot().committed,v(2,64,2));await e.close();return{dispatches:s.dispatches,admission:s.admissions[0],storage:s.ledger.storage()};
    });
    await check(`${form} width ${n} shortage fences every member`,async()=>{
      const cap=demand(n);cap.handles--;const s=setup(n,{capacity:cap}),e=s.execution;let group;
      if(form==='keyed')group=Object.fromEntries(Array.from({length:n},(_,i)=>['k'+i,dispatch(e)]));else{group=e.effects({max:n});for(let i=0;i<n;i++)group.add(dispatch(e));}
      assert.throws(()=>e.parallel(group),x=>x.code==='RA03_RESOURCE_CAPACITY');await e.close();assert.equal(s.dispatches,0);assert.equal(s.ledger.snapshot().usedEffects,n);assert.deepEqual(s.ledger.snapshot().committed,v(2,64,2));return{dispatches:0};
    });
  }
  await check('Direct effect uses same pre-dispatch hook',async()=>{const s=setup(1);await dispatch(s.execution);assert.equal(s.admissions[0].dispatches,0);assert.equal(s.admissions[0].width,1);await s.execution.close();});
  await check('Already-started keyed member rejects; no retroactive admission claim',async()=>{let resolve;const wait=new Promise(r=>resolve=r);const s=setup(2,{invoke:()=>wait}),a=dispatch(s.execution);await Promise.resolve();await Promise.resolve();assert.equal(s.dispatches,1);const b=dispatch(s.execution);assert.throws(()=>s.execution.parallel({a,b}),x=>x.code==='RA03_ADMISSION_BOUNDARY');resolve({outputs:[4]});await s.execution.close();assert.equal(s.dispatches,1);});
  await check('Unknown descriptor rejects before any host dispatch',async()=>{const b=bridge(),l=new Ledger(config(1)),hooks=executionHooks(l,()=>99);let calls=0;const e=b.api.createJavascriptEffectExecution({effectAdapter:b.api.createJavascriptEffectAdapter({dispatch(){calls++;return time();}}),resourceAccounting:hooks});assert.throws(()=>dispatch(e),x=>x.code==='RA03_BOUND');await e.close();assert.equal(calls,0);});
  await check('Host throw retains prepared claims as unknown, without retry',async()=>{const s=setup(1,{invoke:()=>{throw Error('fixture host error');}});await assert.rejects(dispatch(s.execution));assert.equal(s.dispatches,1);const before=s.ledger.snapshot();assert.equal(before.unresolved,1);assert.equal(before.retainedRoots,1);await s.execution.close();assert.deepEqual(s.ledger.snapshot().committed,before.committed);});
  await check('Unexpected returned output quarantines and invokes containment once',async()=>{const s=setup(1,{invoke:()=>({outputs:[1,2,3,4]})});await assert.rejects(dispatch(s.execution),x=>x.code==='RA03_PROVIDER_CONTRACT');assert.equal(s.dispatches,1);assert.equal(s.teardowns,1);const snap=s.ledger.snapshot();assert.equal(snap.emergency,2);assert.equal(snap.coverageLost,true);assert.equal(snap.accountingComplete,false);await s.execution.close();return snap;});
  await check('Known missing output requires explicit provider proof',async()=>{const b=bridge(),l=new Ledger(config(1)),hooks=executionHooks(l,()=>0);let calls=0;const e=b.api.createJavascriptEffectExecution({resourceAccounting:hooks,effectAdapter:b.api.createJavascriptEffectAdapter({async dispatch(d,x){calls++;await providerCall(l,x.accountingRoot,[v(1,64,1)],()=>({outputs:[],noOutputProof:'provider-proved-no-output'}));return time();}})});await dispatch(e);assert.equal(calls,1);assert.equal(l.storage().activeRecords,0);await e.close();});
  await check('Cancellation preserves pending registration and late output',async()=>{const c=new AbortController();let resolve;const s=setup(1,{signal:c.signal,invoke:()=>new Promise(r=>resolve=r)});const effect=dispatch(s.execution);await Promise.resolve();await Promise.resolve();assert.equal(s.dispatches,1);c.abort(Error('stop'));await assert.rejects(effect);assert.equal(s.ledger.snapshot().prepared,1);await s.execution.close();resolve({outputs:[55]});await new Promise(r=>setImmediate(r));const snap=s.ledger.snapshot();assert.equal(snap.unresolved,1);assert.equal(snap.prepared,0);assert.equal(snap.retainedRoots,1);assert.equal(snap.ended,true);return snap;});
  await check('Expired inherited deadline stops entry',async()=>{const s=setup(1,{deadline:10,clock:()=>10});assert.throws(()=>dispatch(s.execution),x=>x.code==='RA03_DEADLINE');await s.execution.close();assert.equal(s.dispatches,0);});
  await check('Existing local and provider admissions share the cumulative count',async()=>{const s=setup(1);await s.execution.local('fixture.pure',()=>7);await dispatch(s.execution);await s.execution.local('fixture.pure',()=>8);assert.equal(s.execution.summary().ownedEffectCount,3);assert.equal(s.ledger.snapshot().usedEffects,3);await s.execution.close();});
  await check('Future child promises block local producer before it starts',async()=>{const b=bridge(),l=new Ledger(config(1,{effectsLimit:4}));let resolve,localCalls=0;const wait=new Promise(r=>resolve=r);const e=b.api.createJavascriptEffectExecution({maxEffects:4,resourceAccounting:executionHooks(l,()=>0),effectAdapter:b.api.createJavascriptEffectAdapter({dispatch:()=>wait})});const effect=dispatch(e);await Promise.resolve();await Promise.resolve();assert.equal(l.snapshot().promisedEffects,3);assert.throws(()=>e.local('fixture.pure',()=>localCalls++),x=>x.code==='RA03_EFFECT_CAPACITY');resolve(time());await assert.rejects(effect);await e.close();assert.equal(localCalls,0);});
  await check('Disabled hook is exact production source and behavior',async()=>{const original=require(file),off=bridge(false);assert.equal(original,off.api);assert.equal(off.source,off.original);const s=setup(2,{enabled:false});const result=await s.execution.parallel({a:dispatch(s.execution),b:dispatch(s.execution)});assert.deepEqual(result,{a:time(),b:time()});assert.equal(s.ledger,null);assert.equal(s.dispatches,2);await s.execution.close();return{sourceIdentical:true,ledgerConstructed:false};});
  return cases;
}
if(require.main===module)(async()=>{const output=path.resolve(process.argv[2]||'/tmp/hex-ra03-hooks.json'),r={version:'hex.ra03-hooks.v1',status:'running',cases,node:process.version};try{await run();r.status='passed';}catch(e){r.status='failed';r.error=e.stack;process.exitCode=1;}r.inputs=['service.cjs','provider-hooks.cjs','javascript-bridge.cjs','check-hooks.cjs'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')}));r.productionSource={file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};fs.writeFileSync(output,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,cases:cases.length,error:r.error,output}));})();
module.exports={run,setup,dispatch};
