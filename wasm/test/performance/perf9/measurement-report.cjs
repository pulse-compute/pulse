'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {protocol,profiles,schedule,summarize,hash}=require('./measurement-protocol.cjs');
const qualification=require('./qualify.cjs');
const sources=()=>Object.fromEntries(['measurement-protocol.cjs','measurement-host.cjs','measurement-report.cjs','measurement-checks.cjs','measure.cjs',
  '../baseline.cjs','../../../../packages/provider-fastly/src/testing/fastly-cli.js'].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
const finite=(n,min=0)=>assert(Number.isFinite(n)&&n>=min,`Invalid numeric measurement ${n}`);
function validateBlock(b,c,hz){
  assert.equal(b.requests.length,c.requests);finite(b.workloadMs,Number.EPSILON);
  assert.equal(b.maxActive,Math.min(c.concurrency,c.requests));
  for(const row of b.requests){
    finite(row.elapsedMs,Number.EPSILON);if(row.headersMs!==null){finite(row.headersMs);assert(row.headersMs<=row.elapsedMs);}
    finite(row.receivedBytes);finite(row.readableBytesMax);finite(row.uploadWritableBytesMax);
    assert.equal(row.outcome,'ok','Unexpected error cannot enter a passed performance comparison');
    assert.equal(row.status,200);assert.equal(row.receivedBytes,c.bytes);assert.equal(row.error,null);
  }
  assert.equal(b.origin.requests,c.requests);assert.equal(b.origin.completed,c.requests);assert.equal(b.origin.invalid,0);
  assert.equal(b.origin.receivedBytes,c.requests*c.bytes);finite(b.origin.writableBytesMax);finite(b.origin.drainWaits);
  assert(b.origin.activeMax>0&&b.origin.activeMax<=c.concurrency);
  const r=b.resources;assert.equal(r.before.startTicks,r.after.startTicks);assert.equal(r.tickMs,1000/hz);
  for(const snapshot of [r.before,r.after])for(const key of ['userTicks','systemTicks','startTicks','rssBytes','hwmBytes'])finite(snapshot[key]);
  assert.equal(r.userMs,1000*(r.after.userTicks-r.before.userTicks)/hz);finite(r.userMs);
  assert.equal(r.systemMs,1000*(r.after.systemTicks-r.before.systemTicks)/hz);finite(r.systemMs);
  assert(r.windowMs>=b.workloadMs);assert(r.samples.length>=2);
  let prior=-1;for(const sample of r.samples){finite(sample.elapsedMs);finite(sample.rssBytes);assert(sample.elapsedMs>=prior);prior=sample.elapsedMs;}
  assert.equal(r.samples[0].rssBytes,r.before.rssBytes);assert.equal(r.samples.at(-1).rssBytes,r.after.rssBytes);
  assert.equal(r.sampledPeakRssBytes,Math.max(...r.samples.map(s=>s.rssBytes)));
  assert(r.after.hwmBytes>=r.before.hwmBytes);
}
function validateStructure(r){
  assert.equal(r.schemaVersion,'pulse.perf9-01b-measurements.v1');assert.equal(r.status,'passed');
  assert.deepEqual(r.protocol,protocol);assert(profiles[r.profile]);assert.equal(r.source.workingTree,'');
  for(const k of ['sourceRevision','sourceTree'])assert.match(r.source[k],/^[a-f0-9]{40}$/);
  assert.equal(r.environmentKind,'local-Viceroy');assert.equal(r.liveFastly,false);assert.equal(r.viceroy.version,'0.21.1');assert.match(r.viceroy.sha256,/^[a-f0-9]{64}$/);
  assert(r.clockTicksPerSecond>0);assert.equal(r.cpu.guest.status,'unavailable');assert.equal(r.cpu.hostOnly.status,'unavailable');
  assert.equal(r.hostQueueBytes.status,'unavailable');assert.equal(r.profile==='standard',r.performanceMeasured);
  assert.equal(r.fixtureSource.clean,true);assert.match(r.fixtureSource.reportSha256,/^[a-f0-9]{64}$/);
  for(const name of ['pulse','rust']){assert.match(r.artifacts[name].sha256,/^[a-f0-9]{64}$/);finite(r.artifacts[name].bytes,1);finite(r.artifacts[name].guestLinearMemoryBytes,1);}
  const planned=schedule(r.profile,r.seed);assert.deepEqual(r.schedule,planned);assert.equal(r.cells.length,planned.length);
  let lastFinish=0;
  for(let i=0;i<planned.length;i++){
    const c=planned[i],cell=r.cells[i];assert.equal(cell.id,c.id);assert.equal(cell.pairs.length,c.blocks);
    assert.equal(cell.warmup.length,2);
    for(const name of ['pulse','rust']){const b=cell.warmup.find(x=>x.implementation===name);assert(b);validateBlock(b,{...c,requests:profiles[r.profile].warmup},r.clockTicksPerSecond);}
    for(let block=0;block<c.blocks;block++){
      const pair=cell.pairs[block];assert.equal(pair.index,block);assert.deepEqual(pair.order,c.orders[block]);
      for(const name of pair.order){const b=pair[name];assert.equal(b.implementation,name);validateBlock(b,c,r.clockTicksPerSecond);
        assert(b.startedAtMs>=lastFinish);assert(b.finishedAtMs>b.startedAtMs);lastFinish=b.finishedAtMs;}
    }
    assert.deepEqual(cell.summary,summarize(cell,r.profile,r.seed+i));
  }
  assert.equal(r.diagnostics.length,protocol.diagnosticRepeats*2*2);
  for(const name of ['pulse','rust'])for(const kind of ['deadline','cancel'])for(let repeat=0;repeat<protocol.diagnosticRepeats;repeat++){
    const found=r.diagnostics.filter(d=>d.implementation===name&&d.kind===kind&&d.repeat===repeat);assert.equal(found.length,1);
    const d=found[0];finite(d.result.elapsedMs,Number.EPSILON);
    if(kind==='deadline'){assert.equal(d.result.status,200);assert.equal(d.result.outcome,'aborted');assert(d.result.receivedBytes<65536);}
    else{assert.equal(d.result.outcome,'cancelled');assert.equal(d.originReached,true);}
    assert.equal(d.recovery.outcome,'ok');assert.equal(d.recovery.status,200);assert.equal(d.recovery.receivedBytes,1024);
  }
  return r;
}
function validate(r){
  validateStructure(r);assert.deepEqual(r.sources,sources());
  const bytes=fs.readFileSync(r.fixtureSource.reportFile);assert.equal(hash(bytes),r.fixtureSource.reportSha256);
  const q=qualification.validate(JSON.parse(bytes));assert.deepEqual(q.source,r.fixtureSource.identity);
  assert.equal(q.viceroy.sha256,r.viceroy.sha256);
  for(const name of ['pulse','rust']){
    const artifact=r.artifacts[name],expected=q.cells[0][name];
    assert.equal(artifact.sha256,expected.sha256);assert.equal(artifact.bytes,expected.bytes);
    assert.equal(artifact.guestLinearMemoryBytes,expected.abi.guestMemoryBytes);
    assert.equal(hash(fs.readFileSync(artifact.file)),artifact.sha256);
  }
  return r;
}
module.exports={sources,validateStructure,validateBlock,validate};
