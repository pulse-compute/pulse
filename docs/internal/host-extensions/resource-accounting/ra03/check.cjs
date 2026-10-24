'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Ledger } = require('./service.cjs');
const P = require('../ra02/policy.json');
const v = (handles = 0, bytes = 0, records = 0) => ({ handles, bytes, records });
const demand = n => v(5 * n + 2, 256 * n + 64, 6 * n + 2);
const profile = { version: P.version, coverage: 'complete-for-accounted-domain', binding: 1, work: v(3,192,4), cleanup: v(2,64,2), effects: 4, workSteps: 10000, cleanupSteps: 10000, exclusive: [] };
function config(n = 8, extra = {}) { return { rootSlots: 2*n, claimsPerRoot: 6, childrenPerRoot: 3, emergencySlots: 2, capacity: demand(n), baseline: v(), exit: v(2,64,2), effectsLimit: 1024, deadline: 100000, clock: () => 0, profiles: [profile], ...extra }; }
const bind = (l, r, payload = 1, charge = v(1,64,1), lane = 'work', owner = 0) => { const [t] = l.prepare(r,[charge],lane,owner); l.adopt(t,payload); return t; };
const release = (l,t,amount=v(1,64,1),owner=0) => { l.observe(t,'released','quiescent',owner);l.refund(t,amount,'released-quiescent'); };
const admitted = (l,n=1) => { const roots=Array.from({length:n},()=>l.capture());l.admit(roots);return roots; };
const rejects = (fn,code) => assert.throws(fn,e=>e.code==='RA03_'+code);
function compare(l, expected) {
  const actual=l.snapshot();
  for(const key of ['committed','charged','carry','carryCleanupReserve','usedEffects','promisedEffects']) assert.deepEqual(actual[key],expected[key],key);
  return actual;
}
const cases=[];
function check(name, fn) { const detail=fn();cases.push({name,status:'passed',detail}); }
function replay(row) {
  const n=row.width,capacity=demand(n);let effectsLimit=1024;
  if(row.scenario.startsWith('one-below-')){const d=row.scenario.slice(10);if(d==='effects')effectsLimit=4*n-1;else capacity[d]--;}
  if(row.scenario==='exact-effects')effectsLimit=4*n;
  const ledger=new Ledger(config(n,{capacity,effectsLimit})), roots=new Map(), claims=new Map(), children=new Map();
  function event(e) {
    const r=roots.get(e.root),k=e.resource?.ref.slot??e.ref?.slot;
    switch(e.type){
      case 'capture':roots.set(e.root,ledger.capture());break;
      case 'admit':ledger.admit(e.members.map(m=>roots.get(m.root)));break;
      case 'deny':ledger.deny(e.roots.map(n=>roots.get(n)));break;
      case 'ticket':children.set(e.root+':'+e.id,ledger.child(r));break;
      case 'settle-child':ledger.settleChild(r,children.get(e.root+':'+e.id));break;
      case 'acquire':claims.set(k,bind(ledger,r,k,e.charge,e.lane));break;
      case 'observe':ledger.observe(claims.get(k),e.resource.state,e.resource.access);break;
      case 'refund':ledger.refund(claims.get(k),e.amount,e.proof);break;
      case 'stop':ledger.stop(r);break;
      case 'finish':ledger.finish(r);break;
      case 'exit-acquire':ledger.chargeExit(e.charge);break;
      case 'end':ledger.end();break;
      default:throw Error(e.type);
    }
  }
  for(const step of row.trace){if(step.rejection)rejects(()=>event(step.event),step.rejection);else event(step.event);compare(ledger,step.after);}
  return {events:row.trace.length,storage:ledger.storage(),final:ledger.snapshot()};
}
function run() {
  const original=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../ra02/sweep/traces.json.gz'))));
  for(const row of original.cases) check(`RA-02 differential ${row.width}/${row.scenario}`,()=>replay(row));
  check('Malformed finite profiles reject before allocation/dispatch',()=>{
    for(const patch of [{workSteps:Infinity},{cleanupSteps:0},{effects:5},{coverage:'unknown'},{binding:0},{exclusive:[1,1]},{work:v(1,1,8)},{children:[]},{graph:'cycle'}])assert.throws(()=>new Ledger(config(1,{profiles:[{...profile,...patch}]})));
    rejects(()=>new Ledger(config(1,{exit:v(2,64,1)})),'EMERGENCY_RESERVE');
  });
  check('Atomic cohort rejection and spent captures',()=>{const l=new Ledger(config(1,{capacity:v(6,320,8)})),r=l.capture(),before=l.snapshot();rejects(()=>l.admit([r]),'RESOURCE_CAPACITY');assert.deepEqual(l.snapshot(),before);l.deny([r]);assert.equal(l.snapshot().usedEffects,1);rejects(()=>l.admit([r]),'STALE_ROOT');});
  check('Atomic output reservation before host entry',()=>{const l=new Ledger(config(1)),[r]=admitted(l);const before=l.snapshot();rejects(()=>l.prepare(r,[v(2,128,2),v(2,128,2)]),'WORK_ENVELOPE');assert.deepEqual(l.snapshot(),before);const ts=l.prepare(r,[v(1,64,1),v(1,64,1)]);assert.equal(l.snapshot().prepared,2);rejects(()=>l.finish(r),'IN_FLIGHT');ts.forEach(t=>l.noOutput(t,'provider-proved-no-output'));l.finish(r);});
  check('Root/resource generations reject stale, cross-execution and duplicate receipts',()=>{const l=new Ledger(config(1)),[r]=admitted(l),t=bind(l,r);release(l,t);rejects(()=>l.refund(t,v(1,64,1),'released-quiescent'),'STALE_CLAIM');const t2=bind(l,r,2);assert.equal(t.slot,t2.slot);assert.notEqual(t.generation,t2.generation);rejects(()=>l.observe(t,'released','quiescent'),'STALE_CLAIM');release(l,t2);l.finish(r);const r2=l.capture();assert.equal(r.slot,r2.slot);rejects(()=>l.finish(r),'STALE_ROOT');rejects(()=>new Ledger(config(1)).admit([r2]),'ROOT');});
  check('Ownership handoff keeps charge/root and fences stale actor',()=>{const l=new Ledger(config(1)),[r]=admitted(l),t=bind(l,r);const before=l.snapshot();l.handoff(t,0,1);assert.deepEqual(l.snapshot(),before);rejects(()=>l.observe(t,'released','quiescent',0),'OWNER');release(l,t,v(1,64,1),1);l.finish(r);});
  check('Action tickets fence duplicates, in-flight handoff and repeated disposal',()=>{const l=new Ledger(config(1)),[r]=admitted(l),t=bind(l,r);const a=l.beginAction(t,0,'close','cleanup');rejects(()=>l.handoff(t,0,1),'HANDOFF_STATE');rejects(()=>l.beginAction(t,0,'close','cleanup'),'ACTION_STATE');l.completeAction(a,'error','retained','unknown');rejects(()=>l.completeAction(a,'error','retained','unknown'),'STALE_ACTION');rejects(()=>l.beginAction(t,0,'close','cleanup'),'ACTION_STATE');rejects(()=>l.refund(t,v(1,64,1),'released-quiescent'),'NO_RELEASE_EVIDENCE');l.finish(r);assert.equal(l.snapshot().unresolved,1);});
  check('Failed retained read cannot retry, but independent cleanup remains possible',()=>{const l=new Ledger(config(1)),[r]=admitted(l),t=bind(l,r);const a=l.beginAction(t,0,'read');l.completeAction(a,'error','retained','quiescent');rejects(()=>l.beginAction(t,0,'read'),'RETRY');const c=l.beginAction(t,0,'close','cleanup');l.completeAction(c,'ok','released','quiescent');l.refund(t,v(1,64,1),'released-quiescent');l.finish(r);});
  check('Known consumed quiescent host handle can be reused without erasing backing charges',()=>{const l=new Ledger(config(1)),[r]=admitted(l),old=bind(l,r,0);l.observe(old,'consumed','quiescent');l.refund(old,v(1,0,0),'consumed-handle');const next=bind(l,r,0);release(l,next);assert.deepEqual(l.snapshot().charged,v(0,64,1));rejects(()=>l.observe(old,'owned','quiescent'),'RESURRECTION');});
  check('Transfer refunds only qualified dimensions',()=>{const l=new Ledger(config(1)),[r]=admitted(l),t=bind(l,r);const a=l.beginAction(t,0,'send');l.completeAction(a,'ok','transferred','active');l.refund(t,v(1,0,0),'transferred-handle');rejects(()=>l.refund(t,v(0,64,1),'transferred-handle'),'PROOF_DIMENSION');rejects(()=>l.refund(t,v(0,0,1),'transferred-record'),'QUIESCENCE');l.finish(r);assert.deepEqual(l.snapshot().carry,v(0,64,1));});
  check('Child tickets remain cumulative and stale completion rejects after reuse',()=>{const l=new Ledger(config(1)),[r]=admitted(l),a=l.child(r);rejects(()=>l.finish(r),'CHILD_LIVE');l.settleChild(r,a);const b=l.child(r);assert.equal(a.slot,b.slot);rejects(()=>l.settleChild(r,a),'STALE_CHILD');l.settleChild(r,b);l.finish(r);assert.equal(l.snapshot().usedEffects,3);});
  check('Repeated acquisition reuses backing storage without retained history',()=>{const l=new Ledger(config(1)),[r]=admitted(l),before=l.storage();for(let i=0;i<5000;i++){const t=bind(l,r,i);release(l,t);}assert.equal(l.storage().backingBytes,before.backingBytes);assert.equal(l.storage().activeRecords,0);assert.equal(l.storage().peakRecords,1);l.finish(r);return l.storage();});
  check('Finite step bound preserves cleanup lane',()=>{const l=new Ledger(config(1,{profiles:[{...profile,workSteps:1,cleanupSteps:1}]})),[r]=admitted(l),t=bind(l,r);rejects(()=>l.prepare(r,[v(1,1,1)]),'STEP_LIMIT');const a=l.beginAction(t,0,'close','cleanup');l.completeAction(a,'ok','released','quiescent');l.refund(t,v(1,64,1),'released-quiescent');rejects(()=>l.step(r,'cleanup'),'STEP_LIMIT');l.finish(r);});
  check('Deadline blocks work and cleanup, late output stays charged',()=>{let now=0;const l=new Ledger(config(1,{clock:()=>now,deadline:10})),[r]=admitted(l),[t]=l.prepare(r,[v(1,64,1)]);now=10;rejects(()=>l.step(r),'DEADLINE');rejects(()=>l.step(r,'cleanup'),'DEADLINE');l.adopt(t,99);assert.equal(l.snapshot().unresolved,1);l.finish(r);const before=l.snapshot().committed;l.end();assert.deepEqual(l.snapshot().committed,before);});
  check('Output after end recorded as unresolved; no synthetic refund',()=>{const l=new Ledger(config(1)),[r]=admitted(l),[t]=l.prepare(r,[v(1,64,1)]);l.end();l.adopt(t,23);assert.equal(l.snapshot().unresolved,1);rejects(()=>l.refund(t,v(1,64,1),'released-quiescent'),'NO_RELEASE_EVIDENCE');});
  check('Exclusive promises conflict; acquired uncertainty survives settlement',()=>{const l=new Ledger(config(2,{profiles:[{...profile,exclusive:[1]}]})),a=l.capture(),b=l.capture();rejects(()=>l.admit([a,b]),'EXCLUSIVE_CONFLICT');l.admit([a]);const[t]=l.prepare(a,[v(1,1,1)]);l.adopt(t,0,'quiescent',1);l.observe(t,'unresolved','unknown');l.finish(a);rejects(()=>l.admit([b]),'EXCLUSIVE_CONFLICT');});
  check('Emergency quarantine is bounded and overflow explicitly loses coverage',()=>{const l=new Ledger(config(1)),[r]=admitted(l),before=l.storage().backingBytes;l.contain(r,[100,101,102]);const s=l.snapshot();assert.equal(s.emergency,2);assert.equal(s.coverageLost,true);assert.equal(s.accountingComplete,false);assert.equal(l.storage().backingBytes,before);rejects(()=>l.capture(),'STOPPED');return s;});
  check('Unadmitted root cannot acquire a stop/cleanup reservation',()=>{const l=new Ledger(config(1)),r=l.capture(),before=l.snapshot();rejects(()=>l.stop(r),'ADMISSION_BOUNDARY');assert.deepEqual(l.snapshot(),before);rejects(()=>l.deny([r,r]),'ADMISSION_BOUNDARY');assert.deepEqual(l.snapshot(),before);l.deny([r]);});
  check('Partial logical refunds cannot spend physical cleanup slots on work',()=>{const l=new Ledger(config(1)),[r]=admitted(l);for(let i=0;i<4;i++){const t=bind(l,r,i,v(0,1,1));l.observe(t,'consumed','quiescent');l.refund(t,v(0,0,1),'consumed-record');}rejects(()=>l.prepare(r,[v(0,1,1)]),'RECORD_STORAGE');const ts=l.prepare(r,[v(0,1,1),v(0,1,1)],'cleanup');assert.equal(ts.length,2);});
  check('Physical record exhaustion cannot start a host call',()=>{const l=new Ledger(config(1)),[r]=admitted(l);for(let i=0;i<6;i++){const[t]=l.prepare(r,[v(0,0,1)]);l.adopt(t,i,'quiescent',null);l.observe(t,'consumed','quiescent');l.refund(t,v(0,0,1),'consumed-record');}assert.equal(l.storage().activeRecords,0); // wholly retired records recycle
    // Partial record refunds do not retire a remaining byte obligation.
    for(let i=0;i<6;i++){const[t]=l.prepare(r,[v(0,1,1)],'cleanup');l.adopt(t,i+10);l.observe(t,'consumed','quiescent');l.refund(t,v(0,0,1),'consumed-record');}
    const before=l.snapshot();rejects(()=>l.prepare(r,[v(0,1,1)],'cleanup'),'RECORD_STORAGE');assert.deepEqual(l.snapshot(),before);
  });
  return cases;
}
if(require.main===module){
  const output=path.resolve(process.argv[2]||'/tmp/hex-ra03-check.json');const receipt={version:'hex.ra03-check.v1',status:'running',cases,sourceBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version};
  try{run();receipt.status='passed';}catch(e){receipt.status='failed';receipt.error=e.stack;process.exitCode=1;}
  receipt.inputs=['service.cjs','check.cjs','../ra02/policy.json','../ra02/sweep/traces.json.gz'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')}));
  fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,cases:cases.length,error:receipt.error,output}));
}
module.exports={config,profile,v,demand,bind,release,admitted,run};
