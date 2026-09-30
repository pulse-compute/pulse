'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inventory } = require('./artifacts.cjs');
const { exercise } = require('./exercise.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-ops01-contract-'));
function revision(name) { const root=path.join(temporary,name);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'app.wasm'),name);return {root,manifest:inventory(root)}; }
const baseline=revision('baseline'),candidate=revision('candidate');
function driver(fault) {
  let active, stage;
  const calls=[];
  return {mode:'local-rehearsal',calls,
    async activate(input){ stage=input.name;calls.push(stage);if(fault==='activation'&&stage==='candidate')throw new Error('secret bearer-value');active=input.revision; },
    async inspect({nonce}){return {instanceId:stage,nonce,artifactSha256:active.manifest.sha256};},
    async readActiveFile(name){if(name===null)return active.manifest.files.map(f=>f.path);return fault==='tamper'&&stage==='candidate'?Buffer.from('bad'):fs.readFileSync(path.join(active.root,name));},
    async connection(){return {stage};}
  };
}
(async()=>{
  try {
    let d=driver(); let report=await exercise({baseline,candidate,driver:d,probe:async()=>['wire']});
    assert.equal(report.status,'passed');assert.equal(report.deployed,false);assert.equal(report.liveGate,'pending');assert.deepEqual(d.calls,['baseline','candidate','rollback']);
    const saves=[];
    d=driver();d.mode='deployed';
    report=await exercise({baseline,candidate,driver:d,probe:async()=>['wire'],save:r=>saves.push(r)});
    assert.equal(report.deployedSmokeStatus,'passed');assert.equal(report.liveGate,'pending');assert.equal(report.ops01Complete,false);
    assert.deepEqual(saves.at(-1),report);assert.equal(saves[0].status,'running');
    for(const fault of ['tamper','activation','wire','deadline','rollback']) {
      d=driver(fault);const snapshots=[];
      report=await exercise({baseline,candidate,driver:d,timeoutMs:100,save:r=>snapshots.push(r),probe:async({stage})=>{
        if(fault==='deadline'&&stage==='candidate')return new Promise(()=>{});
        if((fault==='wire'&&stage==='candidate')||(fault==='rollback'&&stage==='rollback'))throw new Error('secret bearer-value');
        return ['wire'];
      }});
      assert.equal(report.status,'failed',fault);assert.deepEqual(d.calls,fault==='activation'?['baseline','candidate']:['baseline','candidate','rollback']);
      assert.equal(report.stages[2].status,fault==='activation'?'blocked':fault==='rollback'?'failed':'passed');
      assert.equal(JSON.stringify(snapshots).includes('bearer-value'),false);
      assert.ok(report.findings.every(f=>f.owner==='deployment-operator'));
    }
    const escape=path.join(baseline.root,'escape');fs.symlinkSync(candidate.root,escape);
    assert.throws(()=>inventory(baseline.root),/symlink/);fs.unlinkSync(escape);
    await assert.rejects(exercise({baseline,candidate:baseline,driver:driver(),probe:async()=>[]}),/distinct artifacts/);
    console.log('ok - OPS-01 immutable artifacts, failed candidate rollback, bounded waits and secret-safe evidence');
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
