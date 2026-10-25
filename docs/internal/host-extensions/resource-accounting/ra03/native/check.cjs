'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const b=require('./build.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const D=['handles','bytes','records'],v=(h=0,by=0,r=0)=>({handles:h,bytes:by,records:r});
const errors={1:'ENDED',2:'DEADLINE',3:'STOPPED',7:'EFFECT_CAPACITY',11:'RESOURCE_CAPACITY',23:'NO_RELEASE_EVIDENCE'};
const inputFiles=['service.as.ts','build.cjs','check.cjs','../../ra02/policy.json','../../ra02/sweep/traces.json.gz'];
const inputs=()=>inputFiles.map(file=>({file,sha256:hash(fs.readFileSync(path.join(__dirname,file)))}));
const output=path.resolve(process.argv[2]||'/tmp/hex-ra03-native');fs.mkdirSync(output,{recursive:true});
const receipt={version:'hex.ra03-native-ledger.v1',status:'running',sourceBase:execFileSync('git',['rev-parse','HEAD'],{cwd:b.root,encoding:'utf8'}).trim(),node:process.version,asc:require(path.join(b.asc.packageRoot,'package.json')).version,inputs:inputs(),cases:[],artifacts:[]};
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
function ok(n){if(n<0)throw Object.assign(Error('Native rejection '+(-n)),{code:errors[-n]||String(-n)});return n;}
function instance(bytes){return new WebAssembly.Instance(new WebAssembly.Module(bytes),{env:{abort(){throw Error('abort');}}}).exports;}
function init(e,n,cap={handles:n*5+2,bytes:n*256+64,records:n*6+2},limit=1024){ok(e.na_init(cap.handles,cap.bytes,cap.records,limit,100000));}
function summary(e){return Object.fromEntries(['committed','charged','carry','carryCleanupReserve'].map((name,k)=>[name,Object.fromEntries(D.map((d,i)=>[d,e.na_query(k,i)]))]).concat([['usedEffects',e.na_query(4,0)],['promisedEffects',e.na_query(5,0)]]));}
function check(name,fn){const detail=fn();receipt.cases.push({name,status:'passed',detail});console.log('ok - '+name);save();}
function replay(e,row){const n=row.width,cap={handles:n*5+2,bytes:n*256+64,records:n*6+2};let limit=1024;if(row.scenario.startsWith('one-below-')){let d=row.scenario.slice(10);if(d==='effects')limit=4*n-1;else cap[d]--;}if(row.scenario==='exact-effects')limit=4*n;init(e,n,cap,limit);const roots=new Map(),claims=new Map(),children=new Map();
 function event(x){let r=roots.get(x.root),c=claims.get(x.resource?.ref.slot??x.ref?.slot);switch(x.type){
 case 'capture':roots.set(x.root,ok(e.na_capture()));break;
 case 'admit':x.members.forEach((m,i)=>ok(e.na_member(i,roots.get(m.root))));ok(e.na_admit(x.members.length));break;
 case 'deny':x.roots.forEach(r=>ok(e.na_deny(roots.get(r))));break;
 case 'ticket':children.set(x.root+':'+x.id,ok(e.na_child(r)));break;
 case 'settle-child':ok(e.na_settle_child(r,children.get(x.root+':'+x.id)));break;
 case 'acquire':{let q=x.charge,t=ok(e.na_prepare(r,q.handles,q.bytes,q.records,x.lane==='work'?1:2));ok(e.na_adopt(t,x.resource.ref.slot));claims.set(x.resource.ref.slot,t);break;}
 case 'observe':ok(e.na_observe(c,x.resource.state==='released'?3:4,0));break;
 case 'refund':ok(e.na_refund(c,x.amount.handles,x.amount.bytes,x.amount.records));break;
 case 'finish':ok(e.na_finish(r));break;
 case 'stop':e.na_stop();break;
 case 'exit-acquire':ok(e.na_exit(x.charge.handles,x.charge.bytes,x.charge.records));break;
 case 'end':e.na_end();break;
 default:throw Error(x.type);}}
 for(const s of row.trace){if(s.rejection)assert.throws(()=>event(s.event),x=>x.code===s.rejection);else event(s.event);const snap=summary(e);for(const k of Object.keys(snap))assert.deepEqual(snap[k],s.after[k],k);}
 return{events:row.trace.length,summary:summary(e)};
}
try{
 const old=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../../ra02/sweep/traces.json.gz'))));
 for(const width of [8,16,32]){
  const bytes=b.compile(b.source(width),output,'ledger-'+width),e=instance(bytes),pages=e.memory.buffer.byteLength;
  receipt.artifacts.push({width,file:'ledger-'+width+'.wasm',bytes:bytes.length,sha256:hash(bytes),bankBytes:e.na_bytes(),memoryBytes:pages,imports:WebAssembly.Module.imports(new WebAssembly.Module(bytes))});save();
  for(const row of old.cases.filter(c=>c.width===width))check(`Wasm oracle parity ${width}/${row.scenario}`,()=>replay(e,row));
  check(`Wasm stale handles, ownership and pre-host records ${width}`,()=>{init(e,width);let r=ok(e.na_capture());e.na_member(0,r);ok(e.na_admit(1));let c=ok(e.na_prepare(r,1,64,1,1));assert.equal(e.na_finish(r),-26);ok(e.na_adopt(c,0));ok(e.na_handoff(c,0,1));assert.equal(e.na_observe(c,3,0),-21);ok(e.na_observe(c,3,1));ok(e.na_refund(c,1,64,1));assert.equal(e.na_refund(c,1,64,1),-5);ok(e.na_finish(r));assert.equal(e.na_finish(r),-4);});
  check(`Wasm deadline and late output ${width}`,()=>{init(e,width);let r=ok(e.na_capture());e.na_member(0,r);ok(e.na_admit(1));let c=ok(e.na_prepare(r,1,64,1,1));ok(e.na_now(100000));assert.equal(e.na_step(r,2),-2);ok(e.na_adopt(c,1));assert.equal(e.na_refund(c,1,64,1),-23);ok(e.na_finish(r));e.na_end();assert.deepEqual(summary(e).carry,v(1,64,1));});
  check(`Wasm finite work steps preserve cleanup allowance ${width}`,()=>{init(e,width);let r=ok(e.na_capture());e.na_member(0,r);ok(e.na_admit(1));for(let k=0;k<10000;k++)ok(e.na_step(r,1));assert.equal(e.na_step(r,1),-14);ok(e.na_step(r,2));ok(e.na_finish(r));});
  check(`Wasm bounded emergency ${width}`,()=>{init(e,width);ok(e.na_unexpected(1));ok(e.na_unexpected(2));assert.equal(e.na_unexpected(3),-28);assert.equal(e.na_query(9,0),1);assert.equal(e.na_capture(),-3);});
  check(`Wasm 5000 cycles without allocation/growth ${width}`,()=>{const before=e.memory.buffer.byteLength;const result=ok(e.na_bench(5000,2));assert.equal(result,width*4*5000);assert.equal(e.na_query(6,0),0);assert.equal(e.memory.buffer.byteLength,before);return{cycles:5000,bankBytes:e.na_bytes(),memoryBytes:before};});
 }
 receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.stack;process.exitCode=1;}
if(JSON.stringify(inputs())!==JSON.stringify(receipt.inputs)){receipt.status='failed';receipt.error='Inputs changed while running';process.exitCode=1;}save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,error:receipt.error,output}));
module.exports={instance,init,summary};
