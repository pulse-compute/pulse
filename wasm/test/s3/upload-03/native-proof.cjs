'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {install,sha}=require(process.env.UPLOAD03_BASELINE==='1'?'../upload-02/native-overlay.cjs':'./native-overlay.cjs');
const evidence=install();
const {project,target,source}=require('./project.cjs');
const {bytesAt}=require('../upload-01/transport.cjs');
const {verify}=require('../upload-01/local.cjs');
async function run(){
  const p=project('fastly'),{cwd,T,compiled,resolved}=p;
  try{
    const project=resolved;
    const generator=require('../../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
    const options={cwd,bindings:project.providerConfig.bindings,maxDurationMs:2000,canonicalBuild:true};
    const generated=generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(compiled.plan,options);
    const owner=require('../../../../packages/provider-fastly/src/build/s3-native.js');
    const experimental=owner.s3NativeSource;
    let baseline;
    try {owner.s3NativeSource=evidence.originalSource;baseline=generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(compiled.plan,options);}
    finally {owner.s3NativeSource=experimental;}
    const sharedFunctions={};
    for(const name of ['__pulse_fastly_resolve_effect','__pulse_fastly_run_invocation']) {
      const extract=source=>{const start=source.indexOf('function '+name+'(');assert(start>=0);
        const end=source.indexOf('\n}',start);assert(end>start);return source.slice(start,end+2);};
      const shared=extract(generated.source);assert.equal(shared,extract(baseline.source),'unchanged shared '+name);
      sharedFunctions[name]=sha(shared);
    }
    const native=generator.compileFastlyNativePlatformCapabilitiesPlan(compiled.plan,options);
    const imports=WebAssembly.Module.imports(new WebAssembly.Module(native.wasm));
    assert(imports.some(x=>x.name==='send_async_streaming'));
    assert(!imports.some(x=>x.module==='pulse_host'));
    assert(!generated.source.includes('function __fwd_begin('));
    const key='café %/雪.bin',url=target.endpoint+'/'+target.bucket+'/caf%C3%A9%20%25/%E9%9B%AA.bin';
    const cases=[];
    const trial=(size,extra={},fixture={})=>{
      const raw = new Map(); let signatureValid = false;
      const result = T.executeFastlyNativePlatformCapabilities(native,{
      request:{method:'POST',path:'/',headers:[['content-length',String(size)],['x-object-key',key],['cookie','private']],body:bytesAt(0,size),...extra.request},
      secrets:{AFTER_UPLOAD:'continued',AUTHORIZE:'allowed',S3_ID:target.accessId,S3_SECRET:target.secret,...extra.secrets},secretStore:'app_secrets',
      fixtures:{[url]:{status:200,body:'',headers:{'content-length':'0',etag:'"opaque"'},...fixture}},
      bodyWriteChunkBytes:997,...extra.options,
      afterHostcall(call) {
        const text=(pointer,length)=>{const bytes=Buffer.alloc(length);for(let i=0;i<length;i++)bytes[i]=(call.readU32(pointer+(i&~3))>>>((i&3)*8))&255;return bytes.toString('utf8');};
        extra.observe?.(call);
        if(call.module!=='fastly_http_req')return;
        const [handle,a,b,c,d]=call.args;
        if(call.name==='new')return;
        if(!raw.has(handle))raw.set(handle,{headers:{}});
        const request=raw.get(handle);
        if(call.name==='uri_set')request.url=text(a,b);
        if(call.name==='method_set')request.method=text(a,b);
        if(call.name==='header_insert')request.headers[text(a,b).toLowerCase()]=text(c,d);
        if(call.name==='send_async_streaming') {
          assert.equal(request.url,url);assert.equal(request.method,'PUT');
          assert.equal(request.headers.cookie,undefined);
          signatureValid=verify(request.method,new URL(request.url).pathname,request.headers,target);
          assert(signatureValid,'independent SigV4 verification at hostcall boundary');
          assert.equal(request.headers['x-amz-content-sha256'],'UNSIGNED-PAYLOAD');
        }
      }
    }); return {...result,signatureValid}; };
    const check=(name,fn)=>{try{const detail=fn();cases.push({name,status:'passed',...detail});}catch(error){cases.push({name,status:'failed',error:error.stack,...error.evidence});}};
    const scenarios=[
      {name:'success',expected:'stored:32769'},
      {name:'source-underflow',request:{body:bytesAt(0,3)}},
      {name:'source-overflow',request:{body:bytesAt(0,32770)}},
      {name:'source-reset',request:{bodyReadStatus:1}},
      {name:'source-stall',request:{readyDelayMs:4000}},
      {name:'writer-stall',options:{uploadReadyDelayMs:4000}},
      {name:'writer-reset',options:{outboundBodyWriteStatus:1}},
      {name:'send-error',fixture:{sendStatus:1}},
      {name:'origin-reset',fixture:{transportStatus:1}},
      {name:'headers-stall',fixture:{neverHeaders:true}},
      {name:'ack-stall',fixture:{status:403,body:'x',headers:{'content-length':'1'},bodyDelayMs:4000}},
      {name:'ack-reset',fixture:{bodyReadStatus:1}},
      {name:'ack-underflow',fixture:{status:403,body:'x',headers:{'content-length':'2'}}},
      {name:'ack-overflow',fixture:{status:403,body:'xx',headers:{'content-length':'1'}}},
      {name:'ack-nonempty',fixture:{body:'x',headers:{'content-length':'1'}}},
      {name:'ack-oversized-rejection',fixture:{status:403,body:'x'.repeat(16385),headers:{'content-length':'16385'}}},
      {name:'ack-duplicate-length',fixture:{headers:[['content-length','0'],['content-length','0']]}},
      {name:'ack-oversized-metadata',fixture:{headers:{'x-large':'x'.repeat(17000)}}},
      {name:'ack-unsupported-encoding',fixture:{headers:{'content-encoding':'gzip','content-length':'0'}}},
      ...[200,403,408,429,500,307].map(status=>({name:'early-'+status,fixture:{earlyResponse:true,status},expected:[403,429].includes(status)?'not-stored':'unknown'})),
      {name:'complete-rejection',fixture:{status:403},expected:'not-stored'},
      {name:'early-rejection-during-write',fixture:{earlyResponse:true,status:403,delayMs:5},options:{bodyWriteChunkBytes:1,uploadWriteDelayMs:10},expected:'not-stored'},
      {name:'fresh-after-failures',expected:'stored:32769'}
    ];
    const summarize=result=>({result:result.response.body,sourceReads:result.trace.filter(x=>x.name==='read'&&x.handle===2).length,
      dispatches:result.outboundRequests.length,originBytes:result.outboundRequests[0]?.bodyBytes.length??0,
      monotonicMs:result.monotonicMs,resources:result.transportResources,ownedResources:result.forwardingResources});
    const clean=result=>{
      assert.equal(result.transportResources.outboundRequests,0);
      assert.deepEqual(result.forwardingResources,{bodies:0,responses:0});
      assert(result.transportResources.pendingRequests<=1,'at most one invocation-owned uncancellable pending request');
      assert(result.outboundRequests.length<=1,'no replay');
      assert(result.trace.filter(x=>x.name==='select').every(x=>x.timeout>0&&x.timeout<=1500));
      assert.equal(result.trace.filter(x=>x.name==='send_downstream').length,1);
      for(const entry of result.trace.filter(x=>x.module==='fastly_http_body'&&x.name==='new')) {
        const transferred=result.trace.some(x=>x.name==='send_downstream'&&x.bodyHandle===entry.handle&&x.streaming===0);
        if(!transferred)assert.equal(result.trace.filter(x=>x.module==='fastly_http_body'&&x.handle===entry.handle&&['close','abandon'].includes(x.name)).length,1,'one terminal owner for body '+entry.handle);
      }
    };
    for(const s of scenarios)check(s.name,()=>{
      const result=trial(32769,s,s.fixture);const detail=summarize(result);
      try {assert.equal(result.response.body,s.expected??'unknown');clean(result);
        if(s.expected==='stored:32769')assert.deepEqual(result.outboundRequests[0].bodyBytes,bytesAt(0,32769));
        if(s.name.startsWith('early-')&&s.name!=='early-rejection-during-write')assert.equal(detail.sourceReads,0);
      }catch(error){error.evidence=detail;throw error;}return detail;
    });
    check('late-early-rejection-cleanup',()=>{
      let fired=false;const result=trial(32769,{observe(c){if(c.module==='fastly_http_resp'&&c.name==='close'&&!fired){fired=true;c.advance(1500);}}},{earlyResponse:true,status:403});
      assert(fired);assert.equal(result.response.body,'unknown');clean(result);return summarize(result);
    });
    for(const phase of ['input-eof','upload-close','late-headers','ack-eof','response-close'])check('deadline-'+phase,()=>{
      let fired=false,upload;
      const result=trial(32769,{observe(c){
        if(c.name==='send_async_streaming')upload=c.args[1];
        const hit=phase==='input-eof'?c.name==='read'&&c.args[0]===2&&c.readU32(c.args[3])===0
          :phase==='upload-close'?c.module==='fastly_http_body'&&c.name==='close'&&c.args[0]===upload
          :phase==='late-headers'?c.name==='pending_req_poll_v2'&&c.readU32(c.args[2])===1
          :phase==='ack-eof'?c.name==='read'&&c.args[0]!==2&&c.readU32(c.args[3])===0
          :c.module==='fastly_http_resp'&&c.name==='close';
        if(hit&&!fired){fired=true;c.advance(1500);}
      }});
      const detail=summarize(result);try{assert(fired);assert.equal(result.response.body,'unknown');clean(result);}catch(error){error.evidence=detail;throw error;}return detail;
    });
    for(const phase of ['before-source','during-write','after-upload','after-ack'])check('disconnect-'+phase,()=>{
      const controller=new AbortController();let fired=false,calls=0,after=0;
      assert.throws(()=>trial(32769,{options:{signal:controller.signal},observe(c){calls++;if(fired)after++;
        const hit=phase==='before-source'?c.name==='send_async_streaming':phase==='during-write'?c.name==='write'
          :phase==='after-upload'?c.module==='fastly_http_body'&&c.name==='close'&&c.args[0]!==2
          :c.module==='fastly_http_resp'&&c.name==='close';
        if(hit&&!fired){fired=true;controller.abort(Error('UPLOAD03_CLIENT_DISCONNECT'));}
      }}),/UPLOAD03_CLIENT_DISCONNECT/);
      assert(fired);assert.equal(after,0,'host traps fence every subsequent operation');
      const fresh=trial(1);assert.equal(fresh.response.body,'stored:1');clean(fresh);
      return {result:'cancelled',calls,hostcallsAfterCancel:after,cleanup:'host invocation teardown; guest cleanup cannot execute after trap',freshInvocationPassed:true};
    });
    for(const phase of ['upload','ack'])check('request-deadline-'+phase,()=>{
      let fired=false,trace;
      const expired=trial(32769,{observe(c){trace=c.trace;
        const hit=phase==='upload'?c.name==='write':c.name==='pending_req_poll_v2'&&c.readU32(c.args[2])===1;
        if(hit&&!fired){fired=true;c.advance(2000);}
      }});
      assert(fired);assert.equal(expired.response.status,504,JSON.stringify(summarize(expired)));
      assert.equal(trace.filter(x=>x.name==='send_downstream').length,1);
      assert(!trace.some(x=>x.module==='fastly_secret_store'&&x.key==='AFTER_UPLOAD'));
      return {result:'request-deadline',continued:false,cleanup:'existing request-budget timeout response; invocation-scoped pending cleanup'};
    });
    return {status:cases.every(x=>x.status==='passed')?'passed':'failed',cases,...evidence,wasm:{bytes:native.wasm.length,sha256:sha(native.wasm)},emittedSourceSha256:sha(generated.source),
      sharedResolverAndDriverUnchanged:true,sharedFunctions,scaffoldSource:source,payloadScratchBytes:16384,
      limitations:['emitted S3 contribution experiment; putText is only a compiler scaffold','not public upload lowering or installed-package qualification','injected Fastly ABI; no Viceroy or deployed Compute','host queues and RSS unmeasured']};
  } finally {p.cleanup();}
}
module.exports={run,source};
if(require.main===module)run().then(r=>{fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2)+'\n');console.log(r.status,r.cases.filter(x=>x.status==='failed').map(x=>({name:x.name,error:x.error.split('\n').slice(0,4).join('\n'),resources:x.resources})));if(r.status!=='passed')process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});
