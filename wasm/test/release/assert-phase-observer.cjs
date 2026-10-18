'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = path.resolve(__dirname, '../support/phase-observer.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-phase-observer-test-'));
try {
  const disabled = spawnSync(process.execPath, ['-e', `const a=require('node:assert/strict'), p=require(${JSON.stringify(helper)}); const f=()=>7;a.equal(p.wrap('x',f),f);a.equal(p.measure('x',f),7);`], {
    env: { ...process.env, PULSEWASM_TEST_PHASE_DIR: '' }, encoding: 'utf8' });
  assert.equal(disabled.status, 0, disabled.stderr);
  const fixture = path.join(root, 'probe.cjs');
  fs.writeFileSync(fixture, `const assert=require('node:assert/strict'), fs=require('node:fs'), p=require(${JSON.stringify(helper)});
const secret='DO-NOT-RETAIN-THIS';
(async()=>{
 const receiver={n:9,f:p.wrap('sync',function(){return this.n})}; assert.equal(receiver.f(),9);
 const error=new Error(secret);assert.throws(()=>p.measure('throws',()=>{throw error}),e=>e===error);
 await assert.rejects(p.measure('rejects',()=>Promise.reject(error)),e=>e===error);
 await p.measure('outer',async()=>{assert.equal(await p.measure('inner',async()=>42),42)});
 const fn=fs.writeFileSync;fs.writeFileSync=()=>{throw new Error('write guard')};p.measure('guarded',()=>1);fs.writeFileSync=fn;
 const bytes=Buffer.from('0061736d01000000','hex');const m=new WebAssembly.Module(bytes);assert(m instanceof WebAssembly.Module);
 new WebAssembly.Instance(m);await WebAssembly.instantiate(bytes);
 fs.readFileSync(__filename);require('node:crypto').createHash('sha256').update(secret).digest('hex');
 fs.closeSync=()=>{throw new Error('close guard')};
})();`);
  const child = spawnSync(process.execPath, ['--require', helper, fixture], { env: { ...process.env, PULSEWASM_TEST_PHASE_DIR: root }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const trace = fs.readdirSync(root).filter(name => name.endsWith('.jsonl'));
  assert.equal(trace.length, 1);
  const text = fs.readFileSync(path.join(root, trace[0]), 'utf8');
  assert(!text.includes('DO-NOT-RETAIN-THIS'));
  const rows = text.trim().split('\n').map(JSON.parse);
  const starts = rows.filter(row => row.event === 'start');
  const ends = rows.filter(row => row.event === 'end');
  assert.equal(starts.length, ends.length);
  const outer = starts.find(row => row.label === 'outer');
  assert.equal(starts.find(row => row.label === 'inner').parent, outer.id);
  for (const label of ['throws', 'rejects']) assert.equal(ends.find(row => row.id === starts.find(row => row.label === label).id).status, 'threw');
  for (const label of ['execution.WebAssembly.Module','execution.WebAssembly.Instance','execution.WebAssembly.instantiate']) assert(starts.some(row=>row.label===label));
  const exit=rows.at(-1); assert.equal(exit.event,'exit'); assert.equal(exit.observationErrors,0); assert.equal(exit.dropped,0);
  assert(Object.keys(exit.counts).some(key=>key.endsWith(':hash.update')));
  const capped=path.join(root,'capped');fs.mkdirSync(capped);
  const stress=spawnSync(process.execPath,['-e',`const p=require(${JSON.stringify(helper)});let count=0;for(let i=0;i<100002;i++)p.measure('bounded',()=>count++);if(count!==100002)process.exitCode=2;`],{env:{...process.env,PULSEWASM_TEST_PHASE_DIR:capped},encoding:'utf8',timeout:30000});
  assert.equal(stress.status,0,stress.stderr);
  const last=JSON.parse(fs.readFileSync(path.join(capped,fs.readdirSync(capped)[0]),'utf8').trim().split('\n').at(-1));
  assert.equal(last.event,'exit');assert(last.dropped>0);assert.equal(last.observationErrors,0);
  console.log('ok - opt-in phase observation preserves sync/async errors, receivers, Wasm construction and guarded writes; records bounded redacted traces');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
