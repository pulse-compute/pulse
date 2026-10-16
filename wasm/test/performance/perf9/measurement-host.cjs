'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { protocol } = require('./measurement-protocol.cjs');
const { binary } = require('../../support/fastly-forwarding-qualification.cjs');
const maxPayload = binary(1048576);
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function parseStat(text) {
  // comm can contain spaces and parentheses. Fields after final ')' start at 3.
  const fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
  const value=i=>{const n=Number(fields[i-3]);assert(Number.isSafeInteger(n)&&n>=0);return n;};
  return { userTicks:value(14),systemTicks:value(15),startTicks:value(22) };
}
// procfs may be mounted from the outer namespace while child.pid is relative
// to this process's namespace. Resolve only our direct child, never by name.
function resolveProcessPid(childPid) {
  const self=fs.readFileSync('/proc/self/status','utf8');
  const parent=Number(self.match(/^Pid:\s+(\d+)$/m)[1]);
  const namespace=fs.readlinkSync('/proc/self/ns/pid');
  const matches=id=>{
    try {
      const status=fs.readFileSync(`/proc/${id}/status`,'utf8');
      const ids=status.match(/^NSpid:\s+([\d\t ]+)$/m)?.[1].trim().split(/\s+/).map(Number);
      return Number(status.match(/^PPid:\s+(\d+)$/m)?.[1])===parent
        && (ids?.at(-1)??Number(id))===childPid && fs.readlinkSync(`/proc/${id}/ns/pid`)===namespace;
    } catch { return false; }
  };
  if(matches(childPid))return childPid;
  const found=fs.readdirSync('/proc').filter(id=>/^\d+$/.test(id)&&matches(id));
  assert.equal(found.length,1,'Cannot uniquely resolve our Viceroy child in procfs');
  return Number(found[0]);
}
function resources(pid) {
  const stat=parseStat(fs.readFileSync(`/proc/${pid}/stat`,'utf8')), status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
  const bytes=name=>{const m=status.match(new RegExp('^'+name+':\\s+(\\d+) kB$','m'));assert(m, 'Missing '+name);return Number(m[1])*1024;};
  return {...stat,rssBytes:bytes('VmRSS'),hwmBytes:bytes('VmHWM')};
}
function tickRate() { assert.equal(process.platform,'linux','CPU/RSS measurement requires Linux procfs'); const n=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}));assert(n>0&&Number.isInteger(n));return n; }
function monitor(pid,hz) {
  const before=resources(pid), samples=[{elapsedMs:0,rssBytes:before.rssBytes}], started=performance.now(); let failure;
  const timer=setInterval(()=>{try {const r=resources(pid); assert.equal(r.startTicks,before.startTicks,'Viceroy PID changed'); samples.push({elapsedMs:performance.now()-started,rssBytes:r.rssBytes});}catch(e){failure=e;}},protocol.sampleRssIntervalMs);
  return { finish() { clearInterval(timer); if(failure)throw failure; const after=resources(pid);assert.equal(after.startTicks,before.startTicks);
    samples.push({elapsedMs:performance.now()-started,rssBytes:after.rssBytes});
    assert(after.userTicks>=before.userTicks&&after.systemTicks>=before.systemTicks);
    return {before,after,samples,windowMs:performance.now()-started,tickMs:1000/hz,userMs:1000*(after.userTicks-before.userTicks)/hz,systemMs:1000*(after.systemTicks-before.systemTicks)/hz,
      sampledPeakRssBytes:Math.max(...samples.map(s=>s.rssBytes))}; }, cancel(){clearInterval(timer);} };
}
async function originServer() {
  let mode='echo', audit, prefixResolve;
  const sockets=new Set(), tasks=new Set();
  const reset=()=>{audit={requests:0,completed:0,receivedBytes:0,invalid:0,writableBytesMax:0,drainWaits:0,activeMax:0};};reset();
  let active=0;
  const server=http.createServer((req,res)=>{
    const selected=mode, current=audit; current.requests++; active++; current.activeMax=Math.max(current.activeMax,active);
    let received=0, valid=req.method==='POST'&&req.url==='/upload'&&req.headers['content-type']==='application/octet-stream';
    req.on('error',()=>{});res.on('error',()=>{});
    req.on('data',chunk=>{if(received+chunk.length>maxPayload.length||!chunk.equals(maxPayload.subarray(received,received+chunk.length)))valid=false;
      received+=chunk.length;current.receivedBytes+=chunk.length;prefixResolve?.();});
    const finished=new Promise(resolve=>{
      let done=false;const finish=()=>{if(!done){done=true;active--;resolve();}};
      res.once('close',finish);req.once('aborted',finish);
      req.on('end',async()=>{
        current.completed++;if(!valid)current.invalid++;
        if(res.destroyed)return;
        res.writeHead(valid?200:400,{'content-type':'application/octet-stream','content-length':received,'x-perf9-origin':'binary'});
        res.flushHeaders();
        try {
          if(selected==='deadline')await delay(protocol.deadlineOriginDelayMs);
          for(let offset=0;offset<received&&!res.destroyed;offset+=protocol.chunkBytes){
            if(selected==='slow-origin')await delay(protocol.slowDelayMs);
            if(res.destroyed)break;
            const ready=res.write(maxPayload.subarray(offset,Math.min(received,offset+protocol.chunkBytes)));
            current.writableBytesMax=Math.max(current.writableBytesMax,res.writableLength);
            if(!ready){current.drainWaits++;await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
          }
          if(!res.destroyed)res.end();
        }catch{res.destroy();}
      });
    });tasks.add(finished);finished.finally(()=>tasks.delete(finished));
  });
  server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {url:`http://127.0.0.1:${server.address().port}`,
    begin(next){assert.equal(active,0,'Previous origin request still active');mode=next;reset();},
    snapshot(){return {...audit};},
    onPrefix(fn){prefixResolve=fn;},
    async idle(){const deadline=performance.now()+6000;while(active){assert(performance.now()<deadline,'Origin did not settle');await delay(5);}},
    async stop(){prefixResolve=undefined;for(const s of sockets)s.destroy();await Promise.allSettled([...tasks]);await new Promise(resolve=>server.close(resolve));}
  };
}
function request(baseUrl,agent,cell,{cancelOnPrefix,signal}={}) {
  return new Promise(resolve=>{
    const started=performance.now(), input=maxPayload.subarray(0,cell.bytes);
    let received=0,headersMs=null,status=null,readableBytesMax=0,uploadWritableBytesMax=0,valid=true,done=false,cancelled=false;
    let timer,pauseTimer,res;
    const finish=(outcome,error=null)=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(pauseTimer);signal?.removeEventListener('abort',interrupt);
      resolve({outcome,status,receivedBytes:received,elapsedMs:performance.now()-started,headersMs,readableBytesMax,uploadWritableBytesMax,error});
    };
    const req=http.request(baseUrl,{method:'POST',agent,headers:cancelOnPrefix?{}:{'content-length':cell.bytes}},response=>{
      res=response;headersMs=performance.now()-started;status=res.statusCode;
      res.on('data',chunk=>{
        readableBytesMax=Math.max(readableBytesMax,res.readableLength+chunk.length);
        if(received+chunk.length>input.length||!chunk.equals(input.subarray(received,received+chunk.length)))valid=false;
        received+=chunk.length;
        if(cell.mode==='slow-client'){res.pause();pauseTimer=setTimeout(()=>res.resume(),protocol.slowDelayMs);}
      });
      res.once('end',()=>finish(status===200&&valid&&received===input.length?'ok':status!==200?'http-error':'corrupt'));
      res.once('aborted',()=>finish('aborted'));res.once('error',e=>finish(cancelled?'cancelled':'transport-error',e.code||e.message));
    });
    const interrupt=()=>{finish('interrupted');req.destroy();res?.destroy();};
    signal?.addEventListener('abort',interrupt,{once:true});
    req.on('error',e=>finish(cancelled?'cancelled':'transport-error',e.code||e.message));
    timer=setTimeout(()=>{finish('timeout');req.destroy();res?.destroy();},protocol.requestTimeoutMs);
    if(cancelOnPrefix){cancelOnPrefix(()=>{cancelled=true;finish('cancelled');req.destroy();res?.destroy();});req.write(input.subarray(0,1024));}
    else req.end(input);
    uploadWritableBytesMax=Math.max(uploadWritableBytesMax,req.writableLength);
    if(signal?.aborted)interrupt();
  });
}
async function batch(server,agent,origin,cell,count,hz,signal) {
  origin.begin(cell.mode);const watching=monitor(server.procPid,hz),rows=new Array(count);let next=0,active=0,maxActive=0;
  const started=performance.now();
  try {
    await Promise.all(Array.from({length:cell.concurrency},async()=>{while(next<count){if(signal?.aborted)throw Error('Interrupted');const index=next++;active++;maxActive=Math.max(maxActive,active);
      try{rows[index]=await request(server.baseUrl,agent,cell,{signal});}finally{active--;}}}));
    const workloadMs=performance.now()-started;
    await origin.idle();await delay(protocol.settleMs);
    const resource=watching.finish(),snapshot=origin.snapshot();
    return {requests:rows,workloadMs,maxActive,origin:snapshot,resources:resource};
  } finally {watching.cancel();}
}
module.exports={resolveProcessPid,parseStat,resources,tickRate,monitor,originServer,request,batch,delay};
