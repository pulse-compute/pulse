'use strict';
const {install}=require('../upload-02/runtime-overlay.cjs');const overlay=install();
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),v8=require('node:v8');
// Raise only the experiment's ceiling; all production owners remain unchanged.
const file=path.resolve(__dirname,'../upload-02/node-transport.cjs'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file,'utf8').replace('const MAX = 1048576;','const MAX = 33554432;'),file);
const {createOwner}=m.exports;
const {executeNodeJavascriptApplication}=require('../../../../packages/provider-node/src/javascript/runtime-host.js');
const {executeCanonicalNativeModule}=require('../../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {bytesAt}=require('../upload-01/transport.cjs'),{verify}=require('../upload-01/local.cjs'),{target}=require('./project.cjs');
const [mode,sizeText,countText,pace='normal',artifact,out]=process.argv.slice(2),size=Number(sizeText),concurrency=Number(countText);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  const native=mode==='native'?v8.deserialize(fs.readFileSync(artifact)):null,origin=new Map();let error,active=0,peakActive=0;
  const server=http.createServer((req,res)=>{void(async()=>{
    assert(verify(req.method,req.url,req.headers,target));const h=crypto.createHash('sha256');let bytes=0;active++;peakActive=Math.max(peakActive,active);
    try{for await(const chunk of req){bytes+=chunk.length;h.update(chunk);if(pace==='slow-origin')await delay(2);}origin.set(req.url,{bytes,digest:h.digest('hex')});res.writeHead(200,{'content-length':'0'});res.end();}finally{active--;}
  })().catch(e=>{error=e;res.destroy();});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  global.gc?.();const baseline=process.memoryUsage(),peak={...baseline};let samples=0;
  const sample=()=>{samples++;const now=process.memoryUsage();for(const k of Object.keys(now))peak[k]=Math.max(peak[k],now[k]);};
  const timer=setInterval(sample,5),begin=performance.now(),rows=[];
  try{
    await Promise.all(Array.from({length:concurrency},async(_,id)=>{
      const key='probe-'+id;let offset=0,authorized=false,continued=0;const expected=crypto.createHash('sha256');const start=performance.now();
      const stream=new ReadableStream({async pull(c){assert(authorized);if(offset===size){c.close();return;}if(pace==='slow-client')await delay(2);const n=Math.min(16384,size-offset),bytes=bytesAt(offset,n);expected.update(bytes);c.enqueue(bytes);offset+=n;}},{highWaterMark:0});
      const request=new Request('https://app.example/',{method:'POST',body:stream,duplex:'half'}),raw=[['content-length',String(size)],['x-object-key',key]];
      const {owner,metrics}=createOwner(request,raw,{port:server.address().port,binding:target,timeoutMs:10000,secret:name=>name==='S3_ID'?target.accessId:target.secret});
      const dispatch=async(effect,execution)=>{if(effect.kind==='secret.get'){if(authorized)continued++;authorized=true;return 'allowed';}if(mode==='native')owner.claim(owner.marker(),{binding:'objects',key});return owner.forward(target.endpoint,{binding:'objects',key},execution);};
      const app=async ctx=>{await ctx.secret.get('AUTHORIZE');const r=await overlay.upload(ctx,{binding:'objects',key},ctx.req.body());await ctx.secret.get('AFTER_UPLOAD');return ctx.text(r.status==='stored'?'stored:'+r.byteLength:r.status);};
      try{const r=mode==='native'?await executeCanonicalNativeModule(native,{request:{method:'POST',url:'https://app.example/',headers:raw},incomingBody:owner,maxDurationMs:15000,providerAdapter:{id:'upload04-research',dispatchEffect:dispatch}}):await executeNodeJavascriptApplication(app,request,{incomingBody:owner,maxDurationMs:15000,effectAdapter:{dispatch}});
        const result=mode==='native'?r.response.body:await r.text();assert.equal(result,'stored:'+size);assert.equal(continued,1);
        assert.deepEqual(origin.get('/upload-fixture/'+key),{bytes:size,digest:expected.digest('hex')});assert.equal(metrics.dispatches,1);assert(metrics.maxChunkBytes<=16384&&metrics.maxSourceChunkBytes<=65536);
        rows.push({elapsedMs:performance.now()-start,metrics});sample();
      }finally{await owner.close();}
    }));
    if(error)throw error;clearInterval(timer);sample();const elapsedMs=performance.now()-begin;global.gc?.();
    const times=rows.map(x=>x.elapsedMs).sort((a,b)=>a-b);
    return {status:'passed',mode,size,concurrency,pace,requests:rows.length,peakOriginRequests:peakActive,elapsedMs,p50Ms:times[Math.ceil(times.length*.5)-1],p95Ms:times[Math.ceil(times.length*.95)-1],MiBPerSecond:size*concurrency/1048576/(elapsedMs/1000),baseline,peak,afterGc:process.memoryUsage(),samples,requestMetrics:rows.map(x=>x.metrics),memoryScope:'whole isolated worker including runtime, producer and loopback origin; sampled RSS, not a hard peak bound'};
  }finally{clearInterval(timer);server.closeAllConnections();await new Promise(r=>server.close(r));}
}
run().then(r=>fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n')).catch(e=>{console.error(e.stack);process.exitCode=1;});
