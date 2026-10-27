'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const { resourceLedgerSource } = require('../../packages/runtime-core-as/src/compiler/resource-ledger.js');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile.js');
const { pnpmInvocation } = require('../../../scripts/pnpm-toolchain.cjs');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const profiles = require('../../packages/contracts/src/handler/resource-admission.js');
const SAFE = BigInt(Number.MAX_SAFE_INTEGER), MAX = 0xffffffffn;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-resource-ledger-'));
const wrapper = `
let ledger: PulseResourceLedger | null = null;
function l(): PulseResourceLedger { return ledger!; }
export function init(e:u64,c:i32,h:u64,b:u64,s:u64,f:u64,d:u64,m:u32):bool {ledger=new PulseResourceLedger(e,c,h,b,s,f,d,m);return l().primary==0;}
export function begin(e:u64,n:u64,c:u64,x:u64,f:u64,w:bool):bool{return l().begin(e,n,c,x,f,w);}
export function stage(e:u64,k:u32,n:u32,o:u32,p:u32,a:u64):bool{return l().stageRecord(e,k,n,o,p,a);}
export function commit(e:u64,n:u64):bool{return l().commit(e,n);}
export function abortStage(e:u64):bool{return l().abort(e);}
export function slot(i:i32):i32{return l().reservedSlot(i);}
export function generation(i:i32):u64{return l().reservedGeneration(i);}
export function acquire(e:u64,s:i32,g:u64,n:u32,o:u32,c:bool,t:u64):bool{return l().beginAcquire(e,s,g,n,o,c,t);}
export function acquired(e:u64,s:i32,g:u64,n:u32,o:u32,h:u32):bool{return l().acquired(e,s,g,n,o,h);}
export function noAcquisition(e:u64,s:i32,g:u64,n:u32,o:u32,k:bool):bool{return l().noAcquisition(e,s,g,n,o,k);}
export function dispose(e:u64,s:i32,g:u64,n:u32,o:u32,t:u64):bool{return l().beginDispose(e,s,g,n,o,t);}
export function disposed(e:u64,s:i32,g:u64,n:u32,o:u32,k:bool):bool{return l().disposed(e,s,g,n,o,k);}
export function transfer(e:u64,s:i32,g:u64,n:u32,o:u32):bool{return l().transferred(e,s,g,n,o);}
export function unused(e:u64,s:i32,g:u64,n:u32,o:u32):bool{return l().unused(e,s,g,n,o);}
export function consume(e:u64,s:i32,g:u64,o:u32,b:u64,c:bool,t:u64):bool{return l().consume(e,s,g,o,b,c,t);}
export function fail(e:u64,c:u32):bool{return l().fail(e,c);}
export function close(e:u64):bool{return l().close(e);}
export function read(s:i32,f:i32):u64 {if(s<0||s>=l().capacity||f<0||f>=8)return 0;return unchecked(l().bank[s*8+f]);}
export function total(f:i32):u64 {if(f==0)return l().handles;if(f==1)return l().backing;if(f==2)return l().records;if(f==3)return l().steps;if(f==4)return l().effects;if(f==5)return l().cleanupRemaining;if(f==6)return l().exitRemaining;return l().primary;}
export function bank():usize{return changetype<usize>(l().bank);}
export function stageBank():usize{return changetype<usize>(l().stage);}
export function header():usize{return offsetof<PulseResourceLedger>();}
// Test-only state injection at the real u32 boundary. No kernel hook or smaller
// production counter is introduced, and the kernel source is not rewritten.
export function seedGeneration(s:i32,g:u64):void{assert(s>=0&&s<l().capacity);unchecked(l().bank[s*8+2]=g);}
export function abort(message:usize,file:usize,line:u32,column:u32):void{unreachable();}
`;
function build(name, source, entry = wrapper) {
  const file = path.join(directory, name + '.ts'), output = path.join(directory, name + '.wasm');
  fs.writeFileSync(file, source + entry);
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const args = [asc.script, file, '--outFile', output, '--runtime', 'stub', '--optimize', '--noAssert', '--use', `abort=${name}/abort`];
  const result = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const bytes = fs.readFileSync(output), module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'the kernel cannot acquire host authority');
  return { bytes, module };
}
function instance(module, overrides = {}) {
  const x = new WebAssembly.Instance(module).exports;
  const v = { e: 1n, c: 8, h: 8n, b: 1024n, s: 8n, f: 8n, d: 100n, m: 2048, ...overrides };
  assert.equal(x.init(v.e,v.c,v.h,v.b,v.s,v.f,v.d,v.m),1);
  return x;
}
const totals = x => [0,1,2,3,4].map(i=>x.total(i));
const row = (k=1,n=1,o=1,p=1,a=0n) => [k,n,o,p,BigInt(a)];
function reserve(x, rows, { e=1n, now=0n, cleanup=1n, exit=0n, effects=1n, withExit=true } = {}) {
  if (!x.begin(e,now,cleanup,exit,effects,withExit)) return null;
  for (const r of rows) if (!x.stage(e,...r)) return null;
  if (!x.commit(e,now)) return null;
  return rows.map((r,i)=>[e,x.slot(i),x.generation(i),r[1],r[2]]);
}
const acquire = (x,t,h=0) => { assert.equal(x.acquire(...t,0,0n),1);assert.equal(x.acquired(...t,h),1); };
const dispose = (x,t) => { assert.equal(x.dispose(...t,0n),1);assert.equal(x.disposed(...t,1),1); };
const empty = () => ({ handles:[], allocations:[], records:0, cleanupSteps:0 });
function profilePlan(width) {
  const zero=Object.fromEntries(profiles.DIMENSIONS.map(k=>[k,0]));
  const limits={handles:2*width+1,backingBytes:49*width+8,records:5*width+2,cleanupSteps:width+1,effects:width};
  return profiles.createPlan({version:profiles.VERSION,realization:'kernel.proof-v1',occupied:zero,limits,
    selected:[{site:'read',count:width,profile:{version:profiles.PROFILE_VERSION,owner:'proof',operation:'read',realization:'kernel.proof-v1',effects:1,
      work:{handles:[{namespace:'body',count:1}],allocations:[{id:'payload',kind:'fixed',bytes:33,copies:1}],records:1,cleanupSteps:0},
      cleanup:{handles:[{namespace:'body',count:1}],allocations:[{id:'scratch',kind:'fixed',bytes:16,copies:1}],records:0,cleanupSteps:1},exclusions:[]}}],
    exit:{handles:[{namespace:'body',count:1}],allocations:[{id:'exit',kind:'fixed',bytes:8,copies:1}],records:0,cleanupSteps:1}});
}
function correctness(module) {
  let cases=0;
  const check=(name,fn)=>{try{fn();cases++;}catch(error){error.message=name+': '+error.message;throw error;}};
  for(const width of [1,8,16,32]) check('P05 complete envelope width '+width,()=>{
    const p=profilePlan(width);assert.equal(p.admitted,true);
    assert.deepEqual(p.required,{handles:2*width+1,backingBytes:49*width+8,records:5*width+2,cleanupSteps:width+1,effects:width});
    const rows=[];for(let i=1;i<=width;i++) rows.push(row(1,1,i),row(2,0,i,1,33),row(3,0,i),row(1,1,i,2),row(2,0,i,2,16));
    rows.push(row(1,1,99,3),row(2,0,99,3,8));
    const options={c:p.required.records,h:BigInt(p.required.handles),b:BigInt(p.required.backingBytes),s:BigInt(p.required.cleanupSteps),f:BigInt(width),m:1024+128*p.required.records};
    const x=instance(module,options), before=x.memory.buffer.byteLength, bank=x.bank(), stage=x.stageBank();
    const tickets=reserve(x,rows,{cleanup:BigInt(width),exit:1n,effects:BigInt(width)});assert(tickets);
    assert.equal(new Set(tickets.map(t=>t[1])).size,rows.length);assert.deepEqual(totals(x),Object.values(p.required).map(BigInt));
    assert(x.header()<=1024);assert.equal(x.bank(),bank);assert.equal(x.stageBank(),stage);assert.equal(x.memory.buffer.byteLength,before);
    for(const [field,shortage,code] of [['h',1,4],['b',1,5],['c',1,6],['s',1,7],['f',1,8]]) {
      const reduced={...options,[field]:typeof options[field]==='bigint'?options[field]-BigInt(shortage):options[field]-shortage};
      const denied=instance(module,reduced);assert.equal(reserve(denied,rows,{cleanup:BigInt(width),exit:1n,effects:BigInt(width)}),null);
      assert.deepEqual(totals(denied),[0n,0n,0n,0n,0n]);assert.equal(denied.total(7),BigInt(code));
    }
  });
  check('zero handle, namespaces, ownership, foreign/stale/duplicate identity',()=>{
    const x=instance(module);const [a,b]=reserve(x,[row(),row(1,2,2)],{cleanup:2n});
    assert.equal(x.acquired(...a,0),0);acquire(x,a);acquire(x,b);
    for(const bad of [[2n,...a.slice(1)],[a[0],-1,...a.slice(2)],[a[0],8,...a.slice(2)],[a[0],a[1],0n,...a.slice(3)],[a[0],a[1],2n,...a.slice(3)],[...a.slice(0,3),2,1],[...a.slice(0,4),2]]) {
      assert.equal(x.dispose(...bad,0n),0);assert.equal(x.acquired(...bad,5),0);
    }
    assert.equal(x.read(a[1],6),0n);assert.equal(x.read(a[1],5),3n);assert.equal(x.acquired(...a,9),0);
    dispose(x,a);assert.equal(x.dispose(...a,0n),0);assert.equal(x.disposed(...a,1),0);
    const [next]=reserve(x,[row()],{withExit:false,cleanup:0n});assert.equal(next[1],a[1]);assert.equal(next[2],2n);
    assert.equal(x.acquire(...a,0,0n),0);acquire(x,next);assert.equal(x.transfer(...next),1);assert.equal(x.transfer(...next),0);
    dispose(x,b);assert.equal(x.total(0),0n);
  });
  check('backing retained after all handles retire, bounded consumption',()=>{
    const x=instance(module),[h,a]=reserve(x,[row(),row(2,0,1,1,100)]);acquire(x,h);
    assert.equal(x.consume(a[0],a[1],a[2],a[4],40n,0,0n),1);dispose(x,h);
    assert.deepEqual(totals(x),[0n,100n,1n,1n,1n]);
    assert.equal(x.consume(a[0],a[1],a[2],a[4],61n,0,0n),0);assert.equal(x.read(a[1],7),40n);
    assert.equal(x.total(1),100n);assert.equal(x.total(7),5n);
  });
  check('unknown disposal, trap fence, primary error and protected cleanup',()=>{
    const x=instance(module),[a,b,c]=reserve(x,[row(),row(1,1,2),row(1,1,3,2)],{cleanup:3n});
    acquire(x,a);acquire(x,b);assert.equal(x.fail(1n,501),1);
    assert.equal(x.acquire(...c,0,0n),0);assert.equal(x.acquire(...c,1,0n),1);assert.equal(x.acquired(...c,0),1);
    assert.equal(x.dispose(...a,0n),1);assert.equal(x.dispose(...a,0n),0); // simulated trap before outcome
    assert.equal(x.read(a[1],5),4n);assert.equal(x.total(0),3n);
    assert.equal(x.disposed(...a,0),1);assert.equal(x.dispose(...a,0n),0);assert.equal(x.read(a[1],5),5n);
    assert.equal(x.total(7),501n);dispose(x,b);dispose(x,c);assert.equal(x.total(0),1n);
    assert.equal(reserve(x,[row()],{withExit:false}),null);assert.equal(x.close(1n),1);assert.equal(x.close(1n),1);
  });
  check('acquisition uncertainty and qualified no-acquisition',()=>{
    for(const known of [false,true]) {
      const x=instance(module),[t]=reserve(x,[row()]);assert.equal(x.acquire(...t,0,0n),1);
      assert.equal(x.noAcquisition(...t,known),1);assert.equal(x.total(0),known?0n:1n);
      assert.equal(x.acquired(...t,3),0);assert.equal(x.dispose(...t,0n),0);
      assert.equal(x.total(7),known?0n:10n);
    }
  });
  check('late acquisition result retained after close; original deadline',()=>{
    const x=instance(module),[t]=reserve(x,[row()]);assert.equal(x.acquire(...t,0,99n),1);
    x.close(1n);assert.equal(x.acquired(...t,0),1);assert.equal(x.dispose(...t,100n),0);
    assert.equal(x.read(t[1],5),3n);assert.equal(x.total(0),1n);assert.equal(x.total(7),3n);
  });
  check('deadline recheck before commit and monotonic time',()=>{
    const x=instance(module);assert.equal(x.begin(1n,0n,1n,0n,1n,true),1);assert.equal(x.stage(1n,...row()),1);
    assert.equal(x.commit(1n,100n),0);assert.deepEqual(totals(x),[0n,0n,0n,0n,0n]);
    const y=instance(module),[t]=reserve(y,[row()],{now:5n});assert.equal(y.acquire(...t,0,4n),0);assert.equal(y.total(7),2n);
  });
  check('cleanup and exit pools are distinct; no repeated exit reserve',()=>{
    const x=instance(module),[w,e]=reserve(x,[row(),row(1,1,9,3)],{cleanup:0n,exit:1n});acquire(x,w);
    assert.equal(x.unused(...e),0);assert.equal(x.dispose(...w,0n),0);assert.equal(x.total(6),1n);
    assert.equal(x.acquire(...e,1,0n),1);assert.equal(x.acquired(...e,0),1);dispose(x,e);assert.equal(x.total(6),0n);
    const y=instance(module);assert(reserve(y,[row()]));assert.equal(reserve(y,[row()]),null);assert.equal(y.total(7),1n);
  });
  check('allocation phase protection after failure and close',()=>{
    const x=instance(module),[w,c]=reserve(x,[row(2,0,1,1,10),row(2,0,2,2,10)]);x.fail(1n,99);x.close(1n);
    assert.equal(x.consume(w[0],w[1],w[2],w[4],1n,1,0n),0);
    assert.equal(x.consume(w[0],w[1],w[2],w[4],1n,0,0n),0);
    assert.equal(x.consume(c[0],c[1],c[2],c[4],10n,1,0n),1);assert.equal(x.total(1),20n);
  });
  check('unused protected handles cannot be lent back to business work',()=>{
    const x=instance(module),[c,e]=reserve(x,[row(1,1,1,2),row(1,1,2,3)]);
    assert.equal(x.unused(...c),0);assert.equal(x.unused(...e),0);assert.equal(x.total(0),2n);
    x.close(1n);assert.equal(x.unused(...c),1);assert.equal(x.unused(...e),1);assert.equal(x.total(0),0n);
    assert.equal(reserve(x,[row()],{withExit:false}),null);
  });
  check('u32 generation exhaustion retires the slot without wrap',()=>{
    const x=instance(module,{c:1,m:1152});x.seedGeneration(0,MAX-1n);
    const [t]=reserve(x,[row()]);assert.equal(t[2],MAX);acquire(x,t);dispose(x,t);
    assert.equal(x.read(0,5),6n);assert.equal(x.read(0,2),MAX);
    assert.equal(reserve(x,[row()],{withExit:false}),null);assert.equal(x.total(7),9n);assert.equal(x.total(0),0n);
    const y=instance(module,{c:2,m:1280});y.seedGeneration(0,MAX-1n);const [a]=reserve(y,[row()]);acquire(y,a);dispose(y,a);
    const [b]=reserve(y,[row()],{withExit:false});assert.equal(b[1],1);assert.equal(b[2],1n);
  });
  check('safe-integer overflow and initialization address limits',()=>{
    const x=instance(module,{b:SAFE});assert.equal(reserve(x,[row(2,0,1,1,SAFE),row(2,0,2,1,1)]),null);assert.equal(x.total(1),0n);
    const y=instance(module,{s:SAFE});assert.equal(y.begin(1n,0n,SAFE,1n,0n,true),0);assert.equal(y.total(3),0n);
    for(const args of [[0n,8,8n,1024n,8n,8n,100n,2048],[1n,-1,8n,1024n,8n,8n,100n,2048],[1n,0x7fffffff,8n,1024n,8n,8n,100n,0x7fffffff],[1n,8,8n,SAFE+1n,8n,8n,100n,2048],[1n,8,8n,1024n,8n,8n,0n,2048],[1n,8,8n,1024n,8n,8n,100n,2047]]) {
      const z=new WebAssembly.Instance(module).exports;assert.equal(z.init(...args),0);assert.equal(z.begin(1n,0n,0n,0n,0n,true),0);
    }
  });
  check('invalid descriptors never partially reserve',()=>{
    for(const bad of [row(0),row(1,0),row(1,1,0),row(1,1,1,4),row(1,1,1,1,1),row(2,1),row(2,0,1,1,SAFE+1n)]) {
      const x=instance(module);assert.equal(reserve(x,[row(),bad]),null);assert.deepEqual(totals(x),[0n,0n,0n,0n,0n]);
    }
  });
  check('abort, foreign execution and cumulative effects',()=>{
    const x=instance(module,{f:1n});assert.equal(x.begin(1n,0n,1n,0n,1n,true),1);assert.equal(x.stage(1n,...row()),1);
    assert.equal(x.commit(2n,0n),0);assert.equal(x.abortStage(2n),0);assert.equal(x.abortStage(1n),1);assert.deepEqual(totals(x),[0n,0n,0n,0n,0n]);
    const [t]=reserve(x,[row()]);acquire(x,t);x.transfer(...t);assert.equal(reserve(x,[row()],{withExit:false}),null);assert.equal(x.total(7),8n);
  });
  check('64 sequential cohorts reuse slots but not backing or cumulative budgets',()=>{
    const x=instance(module,{c:4,m:1536,s:64n,f:64n}),memory=x.memory.buffer.byteLength,bank=x.bank(),stage=x.stageBank();
    for(let i=0;i<64;i++) {
      const rows=i===0?[row(),row(2,0,1,1,10)]:[row()];
      const [t]=reserve(x,rows,{withExit:i===0});assert.equal(t[2],BigInt(i+1));acquire(x,t,i%2);dispose(x,t);
      assert.deepEqual(totals(x),[0n,10n,1n,BigInt(i+1),BigInt(i+1)]);
      assert.equal(x.bank(),bank);assert.equal(x.stageBank(),stage);assert.equal(x.memory.buffer.byteLength,memory);
    }
    assert.equal(reserve(x,[row()],{withExit:false,cleanup:0n}),null);assert.equal(x.total(7),8n);
  });
  return cases;
}
try {
  assert.throws(()=>resourceLedgerSource({}),TypeError);
  const source=resourceLedgerSource(true), artifact=build('ledger',source);
  const cases=correctness(artifact.module);
  // Actual package payload, unpacked outside the checkout. Only the two private
  // kernel files are loaded; this does not claim installed dependency closure.
  const pack=path.join(directory,'pack'),consumer=path.join(directory,'consumer');fs.mkdirSync(pack);
  const pnpm=pnpmInvocation(root);
  const packed=spawnSync(pnpm.command,[...pnpm.prefix,'--dir',path.join(root,'wasm/packages/runtime-core-as'),'pack','--pack-destination',pack],
    {cwd:directory,encoding:'utf8',timeout:60000,env:{...process.env,npm_config_ignore_scripts:'true'}});
  assert.equal(packed.status,0,packed.stderr||packed.error?.message);
  const tarballs=fs.readdirSync(pack).filter(f=>f.endsWith('.tgz'));assert.equal(tarballs.length,1);
  const packedFile=path.join(pack,tarballs[0]), entries=readTarEntries(packedFile);
  for(const name of ['resource-ledger.js','resource-ledger.as.ts']) {
    const key='package/src/compiler/'+name;assert(entries.has(key),'kernel missing from packed files: '+name);
    fs.mkdirSync(consumer,{recursive:true});fs.writeFileSync(path.join(consumer,name),entries.get(key));
  }
  const packedSource=require(path.join(consumer,'resource-ledger.js')).resourceLedgerSource(true);
  assert.equal(packedSource,source);const packedArtifact=build('packed',packedSource);
  assert.deepEqual(packedArtifact.bytes,artifact.bytes);assert.equal(correctness(packedArtifact.module),cases);
  const unusedEntry='\nexport function value():i32{return 42;}\nexport function abort(message:usize,file:usize,line:u32,column:u32):void{unreachable();}\n';
  const absent=build('absent','',unusedEntry), disabled=build('disabled',resourceLedgerSource(false),unusedEntry), unused=build('unused',source,unusedEntry);
  assert.deepEqual(disabled.bytes,absent.bytes);assert.deepEqual(unused.bytes,absent.bytes);
  const mutations={
    authentication:['unchecked(this.bank[at + 2]) == generation','true'],
    backing:['this.records--;','this.records--; this.backing = 0;'],
    primary:['if (this.primary == 0) this.primary = code;','this.primary = code;']
  };
  for(const [name,[before,after]] of Object.entries(mutations)) {
    assert.equal(source.split(before).length,2);const mutant=build('mutant-'+name,source.replace(before,after));
    assert.throws(()=>correctness(mutant.module),assert.AssertionError,name);console.log('ok - rejects compiled ledger mutation '+name);
  }
  console.log(JSON.stringify({status:'passed',cases,mutations:3,recordElementBytes:128,headerBytes:new WebAssembly.Instance(artifact.module).exports.header(),
    wasmBytes:artifact.bytes.length,wasmSha256:createHash('sha256').update(artifact.bytes).digest('hex'),unusedByteIdentity:true,
    packedKernelReplay:true,tarballSha256:createHash('sha256').update(fs.readFileSync(packedFile)).digest('hex'),installedDependencyClosure:false,
    scope:'private Native kernel; no production dispatch integration or accounting cost measurement'}));
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
