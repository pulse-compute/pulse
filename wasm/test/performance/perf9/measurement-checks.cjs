'use strict';
const assert=require('node:assert/strict');
const {schedule,stats,paired,protocol,summarize}=require('./measurement-protocol.cjs');
const {parseStat}=require('./measurement-host.cjs');
const {validateStructure}=require('./measurement-report.cjs');
function selfTest(){
  for(const profile of ['smoke','standard']){
    const a=schedule(profile,42);assert.deepEqual(a,schedule(profile,42));assert.notDeepEqual(a,schedule(profile,43));
    assert.equal(new Set(a.map(x=>x.id)).size,10);
    for(const c of a){assert(c.requests%c.concurrency===0);assert.equal(c.orders.filter(x=>x[0]==='pulse').length,c.blocks/2);}
  }
  assert.throws(()=>schedule('unknown',42));assert.throws(()=>schedule('standard',-1));
  assert.deepEqual(stats([4,1,2,3]),{count:4,min:1,p50:2,p95:4,max:4,mean:2.5});assert.throws(()=>stats([NaN]));
  const pairs=Array.from({length:30},()=>({pulse:{requests:[{elapsedMs:102}]},rust:{requests:[{elapsedMs:100}]}}));
  const positive=paired(pairs,{seed:1,profile:'standard'});assert(Math.abs(positive.relativePercent-2)<1e-10);assert.equal(positive.direction,'Rust lower latency');assert.equal(positive.oneToThreePercent,'interval within 1–3%');
  assert.equal(paired(pairs,{seed:1,profile:'smoke'}).oneToThreePercent,'inconclusive at this resolution');
  assert.equal(paired(pairs,{seed:1,profile:'standard',errors:1}).direction,'insufficient evidence');
  const zero=paired(pairs.map(p=>({pulse:p.rust,rust:p.rust})),{seed:1,profile:'standard'});assert.equal(zero.direction,'inconclusive at this resolution');
  const noisy=paired(pairs.map((p,i)=>({pulse:{requests:[{elapsedMs:i%2?140:60}]},rust:p.rust})),{seed:1,profile:'standard'});assert.equal(noisy.oneToThreePercent,'inconclusive at this resolution');
  const fields=Array.from({length:22},(_,i)=>i+3);fields[11]=42;fields[12]=7;fields[19]=900;
  assert.deepEqual(parseStat('123 (name with ) spaces) '+fields.join(' ')),{userTicks:42,systemTicks:7,startTicks:900});
  console.log('ok - PERF9-01B balanced schedules, paired uncertainty, insufficient/noisy evidence and procfs parsing');
}
function rejectionTests(report){
  validateStructure(report);
  const mutations=[r=>r.status='running',r=>r.source.workingTree='dirty',r=>r.environmentKind='Fastly',r=>r.liveFastly=true,
    r=>r.cells.pop(),r=>r.cells[0].pairs.pop(),r=>r.cells[0].pairs[0].order.reverse(),
    r=>r.cells[0].pairs[0].pulse.requests.pop(),r=>r.cells[0].pairs[0].pulse.requests[0].outcome='timeout',
    r=>r.cells[0].pairs[0].pulse.requests[0].receivedBytes++,r=>r.cells[0].pairs[0].pulse.resources.userMs++,
    r=>r.cells[0].pairs[0].pulse.resources.sampledPeakRssBytes++,r=>r.cells[0].summary.pulse.successfulLatencyMs.p50++,
    r=>r.cells[0].summary.comparison.relativePercent++,r=>r.cells[0].pairs[0].pulse.origin.invalid++,
    r=>r.cells[0].pairs[0].pulse.startedAtMs=-1,r=>r.diagnostics.pop(),r=>r.cpu.guest.status='measured',r=>r.protocol.bootstrapReplicates=1];
  for(const mutate of mutations){const r=structuredClone(report);mutate(r);assert.throws(()=>validateStructure(r));}
  console.log(`ok - PERF9-01B rejects ${mutations.length} partial, altered, errored and mismatched-domain reports`);
}
if(require.main===module)selfTest();
module.exports={selfTest,rejectionTests};
