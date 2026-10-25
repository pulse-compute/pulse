'use strict';
// Actual JS executor/Response lifecycle, using existing RA03 investigation hooks.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Ledger}=require('../ra03/service.cjs'),{config,profile,v,demand}=require('../ra03/check.cjs');
const {bridge,file}=require('../ra03/javascript-bridge.cjs'),{executionHooks,providerCall}=require('../ra03/provider-hooks.cjs');
const out=path.resolve(process.argv[2]||'/tmp/hex-ra05-js.json'),cases=[];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function setup({mode='resolve',n=1,short=false,signal,late=false}={}){
 const api=bridge().api,capacity=demand(n);if(short)capacity.handles--;
 const l=new Ledger(config(n,{capacity,profiles:[{...profile,effects:1}]}));let cancels=0,dispatches=0,complete,transferred;
 const records=[];
 const adapter=api.createJavascriptEffectAdapter({id:'ra05-fetch-fixture',async dispatch(d,e){
  dispatches++;let response;
  const tickets=await providerCall(l,e.accountingRoot,[v(1,64,1)],async()=>{
   if(late)await new Promise(r=>complete=r);
   response=new Response(new ReadableStream({cancel(){cancels++;if(mode==='reject')return Promise.reject(Error('cancel failed'));if(mode==='never')return new Promise(()=>{});}}));
   return {outputs:[dispatches]};
  });records.push({response,ticket:tickets[0]});return response;
 },dispose(){for(const r of records){if(r.response===transferred){l.observe(r.ticket,'transferred','active');l.refund(r.ticket,v(1,0,0),'transferred-handle');}else l.observe(r.ticket,'unresolved','unknown');}}});
 const e=api.createJavascriptEffectExecution({effectAdapter:adapter,signal,resourceAccounting:executionHooks(l,d=>{assert.equal(d.kind,'fetch');return 0;})});
 return{e,l,records,dispatch:()=>e.dispatch({kind:'fetch',url:'https://origin.example/value'}),close:async r=>{transferred=r;await e.close(r);},get cancels(){return cancels;},get dispatches(){return dispatches;},complete:()=>complete()};
}
async function test(name,fn){cases.push({name,status:'passed',detail:await fn()});}
(async()=>{const r={version:'hex.ra05-js.v1',status:'running',cases,node:process.version};try{
 for(const mode of ['resolve','reject','never'])await test('Cancellation '+mode+' is not a release receipt',async()=>{const s=setup({mode});await s.dispatch();await s.close();assert.equal(s.cancels,1);assert.deepEqual(s.l.snapshot().charged,v(1,64,1));assert.equal(s.l.snapshot().unresolved,1);return s.l.snapshot();});
 await test('Locked response is skipped and remains charged',async()=>{const s=setup();await s.dispatch();const reader=s.records[0].response.body.getReader();await s.close();assert.equal(s.cancels,0);assert.equal(s.l.snapshot().unresolved,1);reader.releaseLock();return s.l.snapshot();});
 await test('Explicit final response transfer preserves continued-access charge',async()=>{const s=setup();await s.dispatch();await s.close(s.records[0].response);assert.equal(s.cancels,0);assert.deepEqual(s.l.snapshot().charged,v(0,64,1));return s.l.snapshot();});
 await test('Late arrival after cancellation remains represented',async()=>{const c=new AbortController(),s=setup({signal:c.signal,late:true}),effect=s.dispatch();await new Promise(r=>setImmediate(r));assert.equal(s.dispatches,1);c.abort(Error('stop'));await assert.rejects(effect);await s.close();s.complete();await new Promise(r=>setImmediate(r));assert.equal(s.cancels,1);assert.equal(s.l.snapshot().unresolved,1);assert.equal(s.l.snapshot().prepared,0);return s.l.snapshot();});
 for(const n of [8,16,32])await test('Fetch cohort shortage '+n+' dispatches zero',async()=>{const s=setup({n,short:true});const group=Object.fromEntries(Array.from({length:n},(_,i)=>['k'+i,s.dispatch()]));assert.throws(()=>s.e.parallel(group),e=>e.code==='RA03_RESOURCE_CAPACITY');await s.close();assert.equal(s.dispatches,0);return{width:n,dispatches:0};});
 r.status='passed';
 }catch(e){r.status='failed';r.error=e.stack;process.exitCode=1;}
 r.inputs=['check-js.cjs','../ra03/service.cjs','../ra03/check.cjs','../ra03/provider-hooks.cjs','../ra03/javascript-bridge.cjs','../ra02/policy.json','../../../../../packages/runtime/src/internal/response.js','../../../../../packages/runtime/src/internal/body.js'].map(file=>({file,sha256:hash(fs.readFileSync(path.join(__dirname,file)))}));r.executor={file,sha256:hash(fs.readFileSync(file))};fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,cases:cases.length,error:r.error,out}));})();
