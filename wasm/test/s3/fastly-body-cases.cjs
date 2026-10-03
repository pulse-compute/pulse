'use strict';
const assert = require('node:assert/strict');
const protocol = require('../../../packages/s3/src/provider.js');
async function run(toolchain, fastly, binding) {
  const bytes = Buffer.from([0, 255, 192, 128, 254, 1]);
  let cases = 0;
  const crypto = require('node:crypto');
  const signing = {sha256:data=>crypto.createHash('sha256').update(data).digest(),hmacSha256:(key,data)=>crypto.createHmac('sha256',key).update(data).digest()};
  const signatures = {};
  for (const route of ['/body','/head','/range','/conditional','/discard']) {
    const readOptions = route === '/head' ? {method:'HEAD'} : route === '/range' ? {range:'bytes=1-3'} : route === '/conditional' ? {ifNoneMatch:'"fixture"'} : {};
    signatures[route] = await protocol.signRequest({binding,method:readOptions.method||'GET',encodedKey:'image',accessId:'fixture-key',secret:'fixture-secret',now:1369353600000,readOptions}, signing);
  }
  function execute(route, origin = {}, extra = {}, key = 'image') {
    cases++;
    const method = route === '/head' ? 'HEAD' : 'GET';
    return toolchain.executeFastlyNativePlatformCapabilities(fastly, {
      request:{method:'POST',url:'https://app.invalid'+route,body:key},
      secrets:{KEY:'fixture-key',SECRET:'fixture-secret'},secretStore:'app_secrets',clockUnixSeconds:1369353600,
      fixtures:{[`${method} ${binding.endpoint}/${binding.bucket}/image`]:{status:200,headers:[['content-length','6']],body:bytes,chunkBytes:2,...origin}},
      onOutboundRequest(request) {
        // Verify canonical signed range/validator with the independent JS owner.
        const headers = Object.fromEntries(request.headers);
        assert.equal(headers['accept-encoding'],'identity');
        assert.equal(headers.authorization,signatures[route].headers.authorization);
      }, ...extra,
    });
  }
  let r = execute('/body'); assert.deepEqual(r.response.bodyBytes,bytes); assert.equal(r.response.streaming,1); assert.equal(r.response.aborted,false);
  const send = r.trace.findIndex(x=>x.name==='send_downstream');
  const reads = r.trace.map((x,i)=>[x,i]).filter(([x])=>x.name==='read'&&x.handle!==2);
  assert.ok(reads.every(([,i])=>i>send),'return headers before reading the object');
  assert.ok(r.trace.slice(reads[0][1]+1,reads[1][1]).some(x=>x.name==='write'),'write each chunk before reading another');
  assert.equal(r.trace.filter(x=>x.name==='close'&&x.handle===reads[0][0].handle).length,1);
  r=execute('/body',{body:Buffer.alloc(32768),headers:[['content-length','32768']],chunkBytes:16384},{bodyWriteChunkBytes:257}); assert.equal(r.response.bodyBytes.length,32768);
  r=execute('/body',{body:Buffer.alloc(0),headers:[['content-length','0']]}); assert.equal(r.response.aborted,false);
  r=execute('/range',{status:206,body:bytes.subarray(1,4),headers:[['content-length','3'],['content-range','bytes 1-3/6']]}); assert.deepEqual(r.response.bodyBytes,bytes.subarray(1,4)); assert.equal(r.response.headers.some(([n])=>n.includes('sha256')),false);
  r=execute('/range',{status:416,headers:[['content-range','bytes */1']]}); assert.equal(r.response.status,416);
  r=execute('/conditional',{status:304,headers:[],bodyDelayMs:2000}); assert.equal(r.response.status,304);
  r=execute('/head',{headers:[['content-length','9007199254740991']],bodyDelayMs:2000}); assert.equal(r.response.status,200); assert.equal(r.response.bodyBytes.length,0);
  for(const status of [404,412]) {r=execute('/body',{status,headers:[],bodyDelayMs:2000});assert.equal(r.response.status,status);}
  for(const origin of [
    {headers:[]}, {headers:[['content-length','01']]}, {headers:[['content-length','9007199254740992']]},
    {headers:[['content-length','32769']]}, {headers:[['content-length','6'],['Content-Length','6']]},
    {headers:[['content-length','6'],['content-encoding','gzip']]}, {headers:[['content-length','6'],['etag','']]},
    {status:302}, {status:304}, {status:206,headers:[['content-length','6'],['content-range','bytes 0-5/6']]},
    {headers:[['content-length','6'],['content-range','']]},
  ]) {r=execute('/body',origin);assert.equal(r.response.status,502);assert.equal(r.response.bodyBytes.length,0);}
  for(const origin of [{headers:[['content-length','7']]},{headers:[['content-length','5']]},{bodyReadStatus:1},{chunkDelayMs:600}]) {
    r=execute('/body',origin,{allowAbortedResponse:true});assert.equal(r.response.aborted,true);assert.equal(r.trace.filter(x=>x.name==='send_downstream').length,1);
  }
  r=execute('/body',{}, {allowAbortedResponse:true,downstreamBodyWriteStatus:1});assert.equal(r.response.aborted,true);
  r=execute('/body',{delayMs:2000});assert.equal(r.response.status,504);
  r=execute('/discard',{bodyDelayMs:2000});assert.equal(r.response.body,'discarded');assert.equal(r.trace.filter(x=>x.name==='read'&&x.handle!==2).length,0);
  r=execute('/body',{}, {}, '../escape');assert.equal(r.outboundRequests.length,0);assert.equal(r.response.status,502);
  console.log(`ok - ${cases} Fastly opaque body ABI cases; first-byte order, raw bytes, signed ranges, deadlines, discard and aborted streams`);
  return cases;
}
module.exports={run};
