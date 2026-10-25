'use strict';
// No deployed service, credentials or synthetic ABI imports. All faults originate
// in guest arguments, the loopback HTTP origin, or explicit guest/process exit.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const PIN='881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9';
async function until(fn,ms,label){const end=performance.now()+ms;while(!fn()){if(performance.now()>end)throw Error('timeout: '+label);await delay(10);}}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(buildDir,binary,out){
 assert(!fs.existsSync(out),'fresh evidence directory required');fs.mkdirSync(out,{recursive:true});
 const receipt={version:'hex.ra10.host-lifecycle.v1',status:'running',engine:{version:execFileSync(binary,['--version'],{encoding:'utf8',timeout:5000}).trim(),sha256:hash(fs.readFileSync(binary))},cases:[],logs:{},scope:{localViceroy:true,hostedFastly:false,esp32:false,physicalReclamation:false}};
 const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
 assert.equal(receipt.engine.version,'viceroy 0.21.1');assert.equal(receipt.engine.sha256,PIN);
 const sockets=new Set(),timers=new Set(),originEvents=[],engines=[];let mode='ok',current='none',engine=null,engineId=0;
 const origin=http.createServer((req,res)=>{const e={case:current,mode,receivedAt:performance.now(),finishedAt:null,closedAt:null};originEvents.push(e);req.resume();res.on('close',()=>e.closedAt=performance.now());res.on('error',()=>{});
  if(mode==='reset'){req.socket.destroy();return;}
  const complete=()=>{e.finishedAt=performance.now();res.end(mode==='large'?'x'.repeat(65):'loaded');};
  if(mode==='delay'||mode==='timeout'){const t=setTimeout(()=>{timers.delete(t);complete();},mode==='timeout'?1300:300);timers.add(t);}else complete();
 });
 origin.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 async function stop(){if(!engine)return;const e=engine;engine=null;if(e.child.exitCode===null&&e.child.signalCode===null){e.child.kill('SIGTERM');try{await until(()=>e.child.exitCode!==null||e.child.signalCode!==null,1000,'engine terminate');}catch{e.child.kill('SIGKILL');await until(()=>e.child.exitCode!==null||e.child.signalCode!==null,1000,'engine kill');}}}
 async function start(wasm,label){await stop();const p=await freePort(),id=label+'-'+engineId++;
  const child=spawn(binary,[wasm,'--addr','127.0.0.1:'+p,'-C',path.join(out,'fastly.toml'),'--log-stdout'],{stdio:['ignore','pipe','pipe']});
  const e={child,id,p,lines:[],stdout:'',stderr:'',error:null};engine=e;engines.push(e);
  child.on('error',err=>e.error=err.message);child.stdout.on('data',b=>{e.stdout+=b;e.lines=e.stdout.split('\n').filter(l=>l.includes('RA10 ')).map(l=>{try{return JSON.parse(l.slice(l.indexOf('RA10 ')+5));}catch{return null;}}).filter(Boolean);});child.stderr.on('data',b=>e.stderr+=b);
  receipt.logs[id]={wasmSha256:hash(fs.readFileSync(wasm))};
  const end=performance.now()+15000;while(true){if(e.error||child.exitCode!==null||child.signalCode!==null)throw Error('engine startup: '+(e.error||e.stderr));const ok=await new Promise(r=>{const s=net.connect(p,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));});if(ok)break;if(performance.now()>end)throw Error('startup timeout');await delay(25);}
  return e;
 }
 async function launch(wasm,label){return start(wasm,label);}
 async function request(e,name){const begin=performance.now();try{const r=await fetch(`http://127.0.0.1:${e.p}/${name}`,{signal:AbortSignal.timeout(4000)});return {status:r.status,body:await r.text(),elapsedMs:performance.now()-begin,completedAt:performance.now()};}catch(error){return {error:error.message,elapsedMs:performance.now()-begin,completedAt:performance.now()};}}
 async function record(name,e,originMode,verify,{kill=false}={}){
  current=name;mode=originMode;receipt.activeCase=name;save();const startLines=e.lines.length,startOrigins=originEvents.length,begin=performance.now();
  const responsePromise=request(e,name);
  if(kill){await until(()=>e.lines.length>startLines,4000,'guest reached termination marker');await stop();}
  const response=await responsePromise;receipt.activeResponse=response;save();
  await until(()=>e.lines.length>startLines,1000,'guest observation '+name);
  if(originMode==='delay'||originMode==='timeout')await until(()=>originEvents.slice(startOrigins).every(x=>x.finishedAt!==null),2000,'origin continuation');
  const result={name,engine:e.id,response,guest:e.lines.slice(startLines),origin:originEvents.slice(startOrigins),elapsedMs:performance.now()-begin};
  receipt.cases.push(result);try{verify(result);result.status='passed';}catch(error){result.status='failed';result.error=error.stack;save();throw error;}delete receipt.activeCase;delete receipt.activeResponse;save();console.log('ok - '+name);
 }
 const eq=(r,key,value)=>assert.equal(r.guest[0].observations[key],value,key);
 const abiOk=r=>{assert.equal(r.response.status,200);assert.equal(r.guest.length,1);};
 let watchdog;
 try{
  watchdog=setTimeout(()=>{if(engine)engine.child.kill('SIGKILL');for(const s of sockets)s.destroy();},120000);watchdog.unref();
  await new Promise(r=>origin.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(out,'fastly.toml'),`[local_server.backends.origin]\nurl="http://127.0.0.1:${origin.address().port}"\n`);
  const e=await launch(path.join(buildDir,'abi/module.wasm'),'abi');
  await record('body',e,'ok',r=>{abiOk(r);for(const k of ['new','close','new.second','abandon'])eq(r,k,0);for(const k of ['close.stale','abandon.stale'])eq(r,k,3);eq(r,'same.request.reuse',0);});
  await record('namespace',e,'ok',r=>{abiOk(r);for(const k of ['request.close','response.close','body.close','response.zero.close'])eq(r,k,0);eq(r,'response.zero.valid',1);eq(r,'request.response.overlap',1);eq(r,'body.acquired',256);eq(r,'body.closed',256);});
  await record('downstream-twice',e,'ok',r=>{abiOk(r);assert.equal(r.response.body,'first response');assert.notEqual(r.guest[0].observations['second.send'],0);eq(r,'response.after.send',3);eq(r,'body.after.send',3);});
  await record('send-unknown',e,'ok',r=>{abiOk(r);eq(r,'send',2);eq(r,'request.after.send',3);eq(r,'body.after.send',3);eq(r,'pending.output.changed',0);assert.equal(r.origin.length,0);});
  await record('send-badbody',e,'ok',r=>{abiOk(r);eq(r,'send',3);eq(r,'request.after.send',3);eq(r,'body.after.send',0);eq(r,'pending.output.changed',0);assert.equal(r.origin.length,0);});
  for(const name of ['wait-ok','wait-error','poll-delay','poll-error'])await record(name,e,name.endsWith('error')?'reset':name==='poll-delay'?'delay':'ok',r=>{abiOk(r);eq(r,'send',0);eq(r,'request.after.send',3);eq(r,'body.after.send',3);eq(r,'pending.after.completion',3);if(name==='poll-delay'){eq(r,'poll',0);eq(r,'done',0);eq(r,'pending.retained',0);eq(r,'wait',0);}else if(name.endsWith('error'))assert.notEqual(r.guest[0].observations[name.startsWith('poll')?'poll':'wait'],0);else eq(r,'wait',0);if(!name.endsWith('error'))for(const k of ['response.close','body.close'])eq(r,k,0);});
  for(const name of ['cache-miss','cache-commit','cache-abandon','cache-invalid'])await record(name,e,'ok',r=>{abiOk(r);const o=r.guest[0].observations;if(name==='cache-invalid'){assert.notEqual(o['insert.invalid'],0);eq(r,'insert.output.changed',0);return;}eq(r,'lookup',0);eq(r,'cache.close',0);eq(r,'cache.stale',3);if(name==='cache-commit'){eq(r,'writer.dispose',0);eq(r,'cache.state.value',3);eq(r,'cache.read.bytes',7);}else if(name==='cache-miss'){eq(r,'cache.state.value',0);assert.notEqual(o['cache.body'],0);}else{eq(r,'writer.dispose',0);eq(r,'cache.state.value',3);assert.notEqual(o['cache.read'],0);eq(r,'cache.read.eof',0);}});
  for(const name of ['cache-return','cache-trap']){await record(name,e,'ok',r=>{eq(r,'insert',0);eq(r,'write',0);assert.equal(r.response.status,name==='cache-trap'?500:200);});await record(name==='cache-trap'?'cache-check-trap':'cache-check-return',e,'ok',r=>{abiOk(r);eq(r,'cache.state.value',3);assert.notEqual(r.guest[0].observations['cache.read'],0);eq(r,'cache.read.eof',0);});}
  for(const name of ['return-pending','trap-pending','exit-pending','kill-pending'])await record(name,e,'delay',r=>{eq(r,'send',0);eq(r,'select',0);eq(r,'select.index',-1);assert.equal(r.origin.length,1);assert(r.origin[0].finishedAt>r.response.completedAt,'origin work continues after guest end');if(name==='trap-pending')assert.equal(r.response.status,500);else if(name!=='kill-pending')assert.equal(r.response.status,200);}, {kill:name==='kill-pending'});
  for(const n of [1,8,32]){
   const c=await launch(path.join(buildDir,`width-${n}/module.wasm`),'composed-'+n);
   for(const hit of [false,true])await record(`composed-${n}-${hit?'hit':'miss'}`,c,'ok',r=>{assert.equal(r.response.status,200);assert.equal(r.origin.length,hit?0:n);assert.equal(r.guest.length,1);const g=r.guest[0];assert.equal(g.kind,'composed');assert.equal(g.closed,1);assert.equal(g.ledgerError,0);assert.equal(g.handles,0);assert.equal(g.bytes,n*(hit?257:262785));assert.equal(g.invocations,n*(hit?2:4));assert.equal(g.fetchCloses,hit?0:2*n);const v=JSON.parse(r.response.body);for(const x of n===1?[v]:Object.values(v)){assert.equal(x.status,hit?'hit':'stored');assert.equal(x.value,'loaded');}});
  }
  for(const scenario of ['reset','large','timeout']){
   const c=await launch(path.join(buildDir,'width-1/module.wasm'),'composed-'+scenario);
   await record('composed-'+scenario,c,scenario,r=>{assert.equal(r.response.status,scenario==='timeout'?504:scenario==='reset'?502:500);assert.equal(r.origin.length,1);assert.equal(r.guest.length,1);const g=r.guest[0];assert.equal(g.closed,1);assert.equal(g.ledgerError,0);assert.equal(g.handles,scenario==='large'?0:1);});
   await record('recovery-'+scenario,c,'ok',r=>{assert.equal(r.response.status,200);assert.equal(r.origin.length,1,'failed request must not insert');assert.equal(r.guest[0].handles,0);});
  }
  assert.equal(receipt.cases.length,33);receipt.status='passed';
 }catch(error){receipt.status='failed';receipt.error=error.stack;process.exitCode=1;console.error(error.stack);}
 finally{clearTimeout(watchdog);await stop();for(const t of timers)clearTimeout(t);for(const s of sockets)s.destroy();await new Promise(r=>origin.close(r));for(const e of engines){fs.writeFileSync(path.join(out,e.id+'.stdout.log'),e.stdout);fs.writeFileSync(path.join(out,e.id+'.stderr.log'),e.stderr);receipt.logs[e.id].exitCode=e.child.exitCode;receipt.logs[e.id].signal=e.child.signalCode;}receipt.cleanup=true;save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,out}));}
}
if(require.main===module)main(...process.argv.slice(2).map(x=>path.resolve(x))).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
