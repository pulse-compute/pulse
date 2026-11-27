'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const cli=require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {target}=require('./project.cjs'),{bytesAt,digest}=require('../upload-01/transport.cjs'),{verify}=require('../upload-01/local.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const [wasmFile,binary,out,selection='capacity']=process.argv.slice(2);
async function run(){
  if(fs.existsSync(out))throw Error('Refusing to overwrite an earlier attempt');
  const dir=path.dirname(wasmFile),launcher=cli.inspectFastlyComputeLauncher({viceroyBinary:binary,required:true});assert.equal(launcher.viceroyInspection.version,'0.21.1');
  const receipt={status:'running',kind:'local-Viceroy',livePlatform:false,engine:{version:'0.21.1',sha256:hash(fs.readFileSync(binary))},wasmSha256:hash(fs.readFileSync(wasmFile)),cases:[]};
  const save=()=>fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');save();
  let originMode='normal',first,originError,server,active=0,peakActive=0,requestId=0;const received=new Map(),open=new Set();
  const origin=http.createServer((req,res)=>{void(async()=>{
    if(req.method==='GET'&&req.url==='/'){res.end('health');return;}
    const mode=originMode,key=req.url;assert(verify(req.method,req.url,req.headers,target),'wire SigV4 '+JSON.stringify({method:req.method,url:req.url,host:req.headers.host,length:req.headers['content-length'],framing:req.headers['transfer-encoding'],type:req.headers['content-type']}));assert.equal(req.method,'PUT');
    const h=crypto.createHash('sha256');let count=0;active++;peakActive=Math.max(peakActive,active);open.add(res);
    res.once('close',()=>{active--;open.delete(res);});req.on('error',()=>{});res.on('error',()=>{});
    if(mode==='early'){res.writeHead(403,{'content-length':'0'});res.end();return;}
    for await(const chunk of req){count+=chunk.length;h.update(chunk);first?.();if(mode==='slow-origin')await delay(2);}
    received.set(key,{bytes:count,digest:h.digest('hex')});
    if(mode==='stall-ack')return;
    res.writeHead(200,{'content-length':'0'});res.end();
  })().catch(e=>{if(e.code!=='ECONNRESET')originError=e;res.destroy();});});
  await new Promise(r=>origin.listen(0,'127.0.0.1',r));
  function rss(){try{return Number(fs.readFileSync('/proc/'+server.child.pid+'/status','utf8').match(/^VmRSS:\s+(\d+)/m)[1])*1024;}catch{return null;}}
  async function request(size,{slow=false,prefix=false,cancel=false,declared=size}={}){
    const key='wire-'+requestId++,start=performance.now();let sent=0,responseEnded=false,clientFinished=false,prefixBeforeEOF=false;
    const prefixSeen=new Promise(resolve=>{if(prefix||cancel)first=()=>{prefixBeforeEOF=!clientFinished;resolve();};});
    let req;const response=new Promise((resolve,reject)=>{
      req=http.request(server.baseUrl,{method:'POST',headers:{'content-length':String(declared),'x-object-key':key}},res=>{
        const chunks=[];let n=0;res.on('data',b=>{n+=b.length;if(n>1024){res.destroy(Error('unbounded application ack'));return;}chunks.push(b);});
        res.on('end',()=>{responseEnded=true;resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()});});res.on('error',reject);
      });req.on('error',reject);req.setTimeout(prefix?1200:17000,()=>req.destroy(Error('wire watchdog')));
    });response.catch(()=>{});
    try{
      while(sent<size&&!responseEnded){const n=Math.min(16384,size-sent);const ok=req.write(bytesAt(sent,n));sent+=n;
        if(cancel){await delay(50);req.destroy();await response.catch(()=>{});return {key,sent,cancelled:true,prefixBeforeEOF,elapsedMs:performance.now()-start};}
        if(prefix){await Promise.race([prefixSeen,response]);first=undefined;if(cancel){req.destroy();await response.catch(()=>{});return {key,sent,cancelled:true,prefixBeforeEOF,elapsedMs:performance.now()-start};}}
        if(!ok&&!responseEnded)await new Promise((resolve,reject)=>{const clean=()=>{req.removeListener('drain',done);req.removeListener('close',done);req.removeListener('error',fail);};const done=()=>{clean();resolve();};const fail=e=>{clean();reject(e);};req.once('drain',done);req.once('error',fail);req.once('close',done);});
        if(slow)await delay(2);
      }
      clientFinished=true;if(!responseEnded)req.end();const result=await response;
      return {key,sent,prefixBeforeEOF,...result,elapsedMs:performance.now()-start};
    }finally{req.destroy();first=undefined;}
  }
  try{
    const manifestFile=path.join(dir,'fastly.toml');fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'upload04-research',backends:{object_origin:{url:`http://127.0.0.1:${origin.address().port}`,overrideHost:'objects.example.invalid',useSni:false}},secretStores:{app_secrets:{AUTHORIZE:'allowed',AFTER_UPLOAD:'continued',S3_ID:target.accessId,S3_SECRET:target.secret}}}));
    server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:20000,stopTimeoutMs:3000});
    for(const [size,concurrency,pace]of (selection==='settlement'?[]:[...[65536,1048576,8388608,33554432].flatMap(size=>[1,8,16].map(c=>[size,c,'normal'])),[1048576,8,'slow-client'],[8388608,8,'slow-origin']]).filter(cell=>selection!=='slow'||cell[2]!=='normal')){
      const name=`${size}-${concurrency}-${pace}`;originMode=pace;peakActive=0;const baselineRss=rss();let peakRss=baselineRss,samples=0;
      const timer=setInterval(()=>{peakRss=Math.max(peakRss,rss()||0);samples++;},5);const start=performance.now();
      try{
        const rows=await Promise.all(Array.from({length:concurrency},()=>request(size,{slow:pace==='slow-client'})));const elapsedMs=performance.now()-start;
        for(const row of rows){assert.equal(row.status,200);assert.equal(row.body,'stored:'+size);assert.deepEqual(received.get('/upload-fixture/'+row.key),{bytes:size,digest:digest(size)});received.delete('/upload-fixture/'+row.key);}
        if(originError)throw originError;const times=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);
        receipt.cases.push({name,status:'passed',size,concurrency,pace,elapsedMs,p50Ms:times[Math.ceil(times.length*.5)-1],p95Ms:times[Math.ceil(times.length*.95)-1],MiBPerSecond:size*concurrency/1048576/(elapsedMs/1000),baselineRss,peakRss,afterRss:rss(),samples,peakOriginRequests:peakActive});
      }catch(e){receipt.cases.push({name,status:'failed',error:e.message,baselineRss,peakRss});throw e;}finally{clearInterval(timer);save();}
    }
    for(const mode of (selection==='slow'?[]:['prefix','cancel','stall-ack','recovery','cap-plus-one'])){
      originMode=mode==='stall-ack'?'stall-ack':'normal';const start=performance.now();
      try {
        const row=await request(65536,{prefix:mode==='prefix',cancel:mode==='cancel',declared:mode==='cap-plus-one'?33554433:65536});
        if(mode==='prefix')assert(row.prefixBeforeEOF);
        if(mode==='stall-ack')assert.match(row.body,/^unknown(:|$)/);
        else if(mode==='cap-plus-one')assert.match(row.body,/^not-stored(:|$)/);
        else if(mode!=='cancel')assert.equal(row.body,'stored:65536');
        const settleStart=performance.now();while(open.size&&performance.now()-settleStart<2000)await delay(10);
        const openResponses=open.size;
        receipt.cases.push({name:mode,status:openResponses?'failed':'passed',elapsedMs:performance.now()-start,openOriginResponsesAfterGrace:openResponses,settlementGraceMs:performance.now()-settleStart,result:row});
      }catch(e){receipt.cases.push({name:mode,status:'failed',error:e.message,elapsedMs:performance.now()-start});}
      save();
      // Fixture teardown follows the recorded observation; it is never counted as provider cleanup.
      for(const response of open)response.destroy();
      await delay(10);
    }
    receipt.status=receipt.cases.every(x=>x.status==='passed')?'passed':'failed';if(receipt.status==='failed')process.exitCode=1;
  }catch(e){receipt.status='failed';receipt.error=e.message;receipt.originError=originError?.message;receipt.originRecords=[...received.entries()];receipt.runtimeLog=server?.logs;process.exitCode=1;}
  finally{if(server)await server.stop();origin.closeAllConnections();await new Promise(r=>origin.close(r));receipt.memoryScope='sampled Viceroy process RSS, separate from producer/origin; retained allocator/JIT memory included; local only';save();console.log(receipt.status,receipt.error||'',receipt.cases.length);}
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
