'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { install, sha } = require('./native-overlay.cjs');
const evidence = install();
const { acceptanceToolchain } = require('../acceptance-toolchain.cjs');
const { bytesAt } = require('../upload-01/transport.cjs');
const { verify } = require('../upload-01/local.cjs');
const root = path.resolve(__dirname,'../../../..');
const target = { endpoint:'https://objects.example.invalid', bucket:'upload-fixture', region:'us-east-1', accessId:'fixture-id', secret:'fixture-secret' };
const {source}=require('./scaffold.cjs');
async function run() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload02-'));
  const T=acceptanceToolchain();
  try {
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','s3']) fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
    fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
    const binding={...target,backend:'object_origin',accessKeyIdSecret:'S3_ID',secretAccessKeySecret:'S3_SECRET',maxTextBytes:16384,timeoutMs:1500};
    delete binding.accessId;delete binding.secret;
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,crypto:['SHA-256','HMAC-SHA256'],defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{maxDurationMs:2000,bindings:${JSON.stringify({secretStore:'app_secrets',s3:{objects:binding}})}}}}));`);
    const project=T.resolveProject({cwd,profile:'proof'});
    const compiled=T.compileNativeProjectInMemory(project);
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
    const cases=[];let memory;
    const trial=(size,extra={},fixture={})=>{
      const raw = new Map(); let signatureValid = false;
      const result = T.executeFastlyNativePlatformCapabilities(native,{
      request:{method:'POST',path:'/',headers:[['content-length',String(size)],['x-object-key',key],['cookie','private']],body:bytesAt(0,size),...extra.request},
      secrets:{AUTHORIZE:'allowed',S3_ID:target.accessId,S3_SECRET:target.secret,...extra.secrets},secretStore:'app_secrets',
      fixtures:{[url]:{status:200,body:'',headers:{'content-length':'0',etag:'"opaque"'},...fixture}},
      bodyWriteChunkBytes:997,...extra.options,
      afterHostcall(call) {
        const text=(pointer,length)=>{const bytes=Buffer.alloc(length);for(let i=0;i<length;i++)bytes[i]=(call.readU32(pointer+(i&~3))>>>((i&3)*8))&255;return bytes.toString('utf8');};
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
    for(const size of [0,1,16385,1048576]) {
      const result=trial(size);
      assert.equal(result.response.status,200,JSON.stringify(result.response));
      assert.equal(result.response.body,'stored:'+size,JSON.stringify(result.response));
      assert.equal(result.outboundRequests.length,1);
      const out=result.outboundRequests[0];assert.deepEqual(out.bodyBytes,bytesAt(0,size));
      assert.equal(out.method,'PUT');assert.equal(out.url,url);
      assert(result.signatureValid);
      const reads=result.trace.filter(x=>x.name==='read'&&x.handle===2);
      const writes=result.trace.filter(x=>x.name==='write');
      assert(reads.every(x=>x.bytes<=16384));assert(writes.every(x=>x.bytes<=16384));
      assert.equal(result.transportResources.outboundRequests,0);
      assert.deepEqual(result.forwardingResources,{bodies:0,responses:0});
      const allocated=result.instance.exports.memory.buffer.byteLength;
      if(memory===undefined)memory=allocated;else assert.equal(allocated,memory);
      cases.push({name:`binary-${size}`,status:'passed',requestBytes:size,originExact:true,signatureValid:true,guestMemoryBytes:allocated,sourceReads:reads.length,writeCalls:writes.length});
    }
    for(const scenario of [
      {name:'authorization-denied',secrets:{AUTHORIZE:'denied'},expected:'denied'},
      {name:'missing-length',request:{headers:[['x-object-key',key]]},expected:'not-stored'},
      {name:'duplicate-length',request:{headers:[['x-object-key',key],['content-length','1'],['content-length','1']]},expected:'not-stored'},
      {name:'cap-plus-one',request:{headers:[['x-object-key',key],['content-length','1048577']]},expected:'not-stored'}
    ]) {
      const result=trial(1,scenario);
      assert.equal(result.response.body,scenario.expected);assert.equal(result.outboundRequests.length,0);
      assert(!result.trace.some(x=>x.name==='read'&&x.handle===2));
      cases.push({name:scenario.name,status:'passed',sourceReads:0,dispatches:0});
    }
    for(const status of [403,200]) {
      const early=trial(16385,{}, {earlyResponse:true,status});
      const expected=status===403?'not-stored':'unknown';
      assert.equal(early.response.body,expected);
      assert(!early.trace.some(x=>x.name==='read'&&x.handle===2));
      cases.push({name:`early-${status}`,status:'passed',sourceReads:0,result:expected});
    }
    const blocked=trial(16385,{options:{uploadReadyDelayMs:4000}});
    assert.equal(blocked.response.body,'unknown');assert(!blocked.trace.some(x=>x.name==='read'&&x.handle===2));
    cases.push({name:'writer-backpressure-before-source-read',status:'passed',sourceReads:0,result:'unknown'});
    return {status:'passed',cases,...evidence,wasm:{bytes:native.wasm.length,sha256:sha(native.wasm)},emittedSourceSha256:sha(generated.source),
      sharedResolverAndDriverUnchanged:true,sharedFunctions,scaffoldSource:source,guestMemoryBytes:memory,payloadScratchBytes:16384,
      limitations:['emitted S3 contribution experiment; putText is only a compiler scaffold','not public upload lowering or installed-package qualification','injected Fastly ABI; no Viceroy or deployed Compute','host queues and RSS unmeasured']};
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={run,source};
if(require.main===module)run().then(r=>fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2)+'\n')).catch(e=>{console.error(e);process.exitCode=1;});
