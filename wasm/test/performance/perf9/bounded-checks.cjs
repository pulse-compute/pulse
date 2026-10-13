'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {selfTest,summarize}=require('./bounded-protocol.cjs');
selfTest();
const arm=(latency,cpu)=>({requests:[{elapsedMs:latency,outcome:'ok',headersMs:1,receivedBytes:1024,readableBytesMax:1024,uploadWritableBytesMax:1100}],
  workloadMs:latency,resources:{userMs:cpu,systemMs:0,sampledPeakRssBytes:1024,after:{hwmBytes:1024}},origin:{writableBytesMax:1024,drainWaits:0}});
const synthetic={blocks:Array.from({length:30},()=>({default:arm(100,10),bounded:arm(90,8),rust:arm(80,7)}))};
const s=summarize(synthetic,1);
assert.equal(s.boundedVsdefault.comparison.absoluteMs,-10);
assert.equal(s.boundedVsdefault.comparison.direction,'bounded lower latency');
assert.deepEqual(s.boundedVsdefault.processCpuDifference.ms95,[-2,-2]);
assert.equal(s.defaultVsrust.comparison.absoluteMs,20);
assert.equal(s.boundedVsrust.comparison.absoluteMs,10);
console.log('ok - PERF9-02 schedule, arm labels, paired latency and process CPU differences');
if(process.argv.length>2){
  assert.equal(process.argv.length,3);
  const {validate}=require('./bounded.cjs'),original=JSON.parse(fs.readFileSync(process.argv[2]));validate(original);
  const mutations=[r=>r.status='running',r=>r.profiledTiming=true,r=>r.liveFastly=true,r=>r.source.workingTree='dirty',
    r=>r.cells.pop(),r=>r.cells[0].blocks.pop(),r=>r.cells[0].blocks[0].order.reverse(),
    r=>r.cells[0].blocks[0].bounded.requests[0].outcome='timeout',r=>r.cells[0].blocks[0].bounded.resources.userMs++,
    r=>r.cells[0].summary.boundedVsdefault.comparison.absoluteMs++,r=>r.builds[0].buildMs++,
    r=>r.artifacts.default.sha256='0'.repeat(64),r=>r.attribution.guestCpu.status='measured',
    r=>r.attribution.calibratedCpuMilliseconds=true,r=>r.profiles[0].sampleCount++,
    r=>r.servers.bounded.args.push('--profile=guest'),r=>r.qualifications[0].bounded.wire.cases.pop()];
  for(const mutate of mutations){const report=structuredClone(original);mutate(report);assert.throws(()=>validate(report));}
  console.log(`ok - PERF9-02 rejects ${mutations.length} incomplete, altered or mismatched-domain reports`);
}
