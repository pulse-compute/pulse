'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const { hashWorkingDiff, withForwardingEvidence } = require('../support/forwarding-evidence.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forwarding-evidence-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function git(args) { return execFileSync('git', args, {cwd:root,stdio:['ignore','pipe','pipe']}); }
function independentDigest() {
  const file = path.join(root, 'expected-diff'), fd = fs.openSync(file, 'w');
  let result;
  try { result = spawnSync('git', ['diff', 'HEAD'], {cwd:root,stdio:['ignore',fd,'pipe']}); }
  finally { fs.closeSync(fd); }
  assert.equal(result.status,0);
  const bytes = fs.readFileSync(file); fs.unlinkSync(file);
  return {bytes:bytes.length, sha256:hash(bytes)};
}
async function main() {
  try {
    git(['init','--quiet']);
    fs.writeFileSync(path.join(root,'tracked.txt'),'base\n');git(['add','tracked.txt']);
    git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','base']);
    assert.equal(await hashWorkingDiff(root),hash(Buffer.alloc(0)));
    fs.writeFileSync(path.join(root,'tracked.txt'),'small dirty\n');
    assert.equal(await hashWorkingDiff(root),independentDigest().sha256);
    // Include staged and unstaged changes, exactly as `git diff HEAD` does.
    git(['add','tracked.txt']);
    fs.writeFileSync(path.join(root,'tracked.txt'),('large dirty line 0123456789\n').repeat(180000));
    const expected = independentDigest();
    assert(expected.bytes > 4*1024*1024);
    assert.throws(()=>execFileSync('git',['diff','HEAD'],{cwd:root}), error=>error.code==='ENOBUFS');
    assert.equal(await hashWorkingDiff(root),expected.sha256);
    const nongit = fs.mkdtempSync(path.join(os.tmpdir(),'forwarding-nongit-'));
    try {
      await assert.rejects(hashWorkingDiff(nongit), error=>error.code==='FWD9_PROVENANCE_FAILED' && error.stage==='git-diff');
      const unrelated=path.join(root,'unrelated');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep'),'keep');
      let ran=false;
      await assert.rejects(withForwardingEvidence({root,
        initialize:async report=>{report.workingDiffSha256=await hashWorkingDiff(nongit);},
        run:async()=>{ran=true;}
      }),{code:'FWD9_PROVENANCE_FAILED'});
      assert.equal(ran,false);
      assert.equal(fs.readdirSync(root).filter(name=>name.startsWith('.fwd9-forwarding-')).length,0);
      const reports=fs.readdirSync(path.join(root,'wasm/.test-results'));
      const retained=JSON.parse(fs.readFileSync(path.join(root,'wasm/.test-results',reports[0],'proof.json')));
      assert.equal(retained.status,'failed');assert.equal(retained.cleanup.status,'passed');
      assert.equal(retained.wasm,undefined); assert.equal(retained.workingDiffSha256,undefined);
      assert.equal(fs.readFileSync(path.join(unrelated,'keep'),'utf8'),'keep');
    } finally { fs.rmSync(nongit,{recursive:true,force:true}); }
    const primary=Error('primary assertion');
    const seen=[],secondary=[];
    let ownedDir, failedReport;
    await assert.rejects(withForwardingEvidence({root,
      initialize:async()=>{},run:async dir=>{ownedDir=dir;throw primary;},
      remove:dir=>{seen.push(dir);throw Error('cleanup failure');},
      publish:(_root,report)=>{failedReport=report;throw Error('reporting failure');},
      secondary:stage=>{secondary.push(stage);throw Error('logger failure');}
    }), error=>error===primary);
    assert.deepEqual(seen,[ownedDir]);assert(ownedDir.startsWith(path.join(root,'.fwd9-forwarding-')));
    assert.deepEqual(secondary,['cleanup','reporting']);
    assert.equal(failedReport.status,'failed');assert.equal(failedReport.cleanup.status,'failed');
    assert(failedReport.error.includes('primary assertion'));
    fs.rmSync(ownedDir,{recursive:true,force:true});
    for(const phase of ['cleanup','reporting']) {
      let allocated;
      const error=Error(phase+' failure');
      await assert.rejects(withForwardingEvidence({root,initialize:async()=>{},run:async dir=>{allocated=dir;},
        ...(phase==='cleanup'?{remove:()=>{throw error;}}:{publish:()=>{throw error;}})
      }), failure=>failure===error);
      if(phase==='reporting')assert(!fs.existsSync(allocated));
      else fs.rmSync(allocated,{recursive:true,force:true});
    }
    const launchFailure = () => { throw Error('spawn failed'); };
    await assert.rejects(hashWorkingDiff(root,{spawn:launchFailure}),{code:'FWD9_PROVENANCE_FAILED',stage:'spawn'});
    await assert.rejects(hashWorkingDiff(root,{spawn:()=>spawn('definitely-unavailable-forwarding-git',[])}),{code:'FWD9_PROVENANCE_FAILED',stage:'spawn'});
    let hanging;
    await assert.rejects(hashWorkingDiff(root,{timeoutMs:30,spawn:(_cmd,_args,options)=>{
      hanging=spawn(process.execPath,['-e',"process.stdout.write('partial');setInterval(()=>{},1000)"],options);return hanging;
    }}),{code:'FWD9_PROVENANCE_FAILED',stage:'timeout'});
    assert(hanging.signalCode || hanging.exitCode !== null);
    let unreadable;
    await assert.rejects(hashWorkingDiff(root,{spawn:(_cmd,_args,options)=>{
      unreadable=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],options);
      unreadable.once('spawn',()=>unreadable.stdout.destroy(Error('injected read failure')));
      return unreadable;
    }}),{code:'FWD9_PROVENANCE_FAILED',stage:'read'});
    assert(unreadable.signalCode || unreadable.exitCode !== null);
    let falsyRejected=false;
    try {await withForwardingEvidence({root,initialize:async()=>{throw null;},run:async()=>{throw Error('unreachable');}});}
    catch(error){assert.equal(error,null);falsyRejected=true;}
    assert(falsyRejected,'even a falsy thrown primary remains a nonpassing result');
    const ok=await withForwardingEvidence({root,initialize:async report=>{report.workingDiffSha256=await hashWorkingDiff(root);},run:async()=>{}});
    assert.equal(ok.report.status,'passed');assert.equal(ok.report.cleanup.status,'passed');
    assert.equal(ok.report.workingDiffSha256,expected.sha256);
    assert.equal(fs.readdirSync(root).filter(name=>name.startsWith('.fwd9-forwarding-')).length,0);
    console.log('ok - complete streamed >4MiB Git diff, clean/small/staged controls, provenance/spawn/timeout failure, independent cleanup/reporting and primary error preservation');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
