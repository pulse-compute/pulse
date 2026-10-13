'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const {resolveProject} = require('../../packages/cli/src/project-config.js');
const {buildProject} = require('../../packages/cli/src/project-execution.js');
const {compileCanonicalSource} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan.js');
const generator = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const {executeFastlyNativePlatformCapabilities: execute} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {normalizeBodyForwarding} = require('../../../packages/provider-fastly/src/toolchain/body-forwarding.js');
const root = path.resolve(__dirname, '../../..'), url = 'https://origin.example/upload';
const config = {maxDurationMs:2000,bodyForwarding:{requestMaxBytes:1048576,responseMaxBytes:1048576},bindings:{backends:{'https://origin.example':'origin'}}};
const source = `import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/',async ctx=>{return ctx.fetch('${url}',{method:'POST',body:ctx.req.body(),timeoutMs:1500,headers:{'content-type':'application/octet-stream'}})});export default app;`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function binary(size) { const bytes=Buffer.alloc(size); for(let i=0;i<size;i++)bytes[i]=i%256; return bytes; }
function admission() {
  for (const value of [null,{},true,{requestMaxBytes:0,responseMaxBytes:1},{requestMaxBytes:1048577,responseMaxBytes:1},{requestMaxBytes:1,responseMaxBytes:1.5},{requestMaxBytes:1,responseMaxBytes:1,extra:true}])
    assert.throws(()=>normalizeBodyForwarding(value,2000),{code:'PULSE_FASTLY_BODY_FORWARDING_INVALID'});
  assert.throws(()=>normalizeBodyForwarding(config.bodyForwarding),{code:'PULSE_FASTLY_BODY_FORWARDING_INVALID'});
  const planFor = body => buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx){${body}}`));
  const valid = planFor(`return ctx.fetch('${url}',{method:'POST',body:ctx.req.body()});`);
  assert.throws(()=>generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(valid,{bindings:config.bindings,requirePlatformCapability:false}),{code:'PULSE_FASTLY_BODY_FORWARDING_INVALID'});
  assert.throws(()=>generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(valid,{...config,bindings:{...config.bindings,dynamicBackends:true},requirePlatformCapability:false}),{code:'PULSE_FASTLY_BODY_FORWARDING_INVALID'});
  for(const body of [
    `return ctx.fetch('${url}',{method:'PUT',body:ctx.req.body()});`,
    `const first=ctx.req.body();return ctx.fetch('${url}',{method:'POST',body:ctx.req.body()});`,
    `const response=await ctx.fetch('${url}',{method:'POST',body:ctx.req.body()});return ctx.text(await response.text());`
  ]) assert.throws(()=>generator.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor(body),{...config,requirePlatformCapability:false}));
}
async function replay(wasmFile, dir, report) {
  if (!process.env.PULSE_VICEROY_BIN) { report.http='not-run'; console.log('skip - HTTP replay requires PULSE_VICEROY_BIN'); return; }
  const launcher=cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  assert.equal(launcher.inspection.version,'0.21.1','Review ABI sources before qualifying another engine.');
  let firstResolve, received=0, mode='echo';
  let first = new Promise(resolve=>{firstResolve=resolve;});
  const origin=http.createServer((req,res)=>{
    req.on('error',()=>{}); const chunks=[];
    req.on('data',chunk=>{received+=chunk.length; chunks.push(chunk); firstResolve();});
    req.on('end',()=>{res.writeHead(200,{'content-type':'application/octet-stream','x-origin':'opaque'});res.end(Buffer.concat(chunks));});
    if(mode==='early'){res.writeHead(413);res.end('denied');}
  });
  origin.listen(0,'127.0.0.1');await once(origin,'listening');let server;
  try{
    const manifestFile=path.join(dir,'fastly.toml');
    fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'fwd9-02-proof',backends:{origin:{url:`http://127.0.0.1:${origin.address().port}`,useSni:false}}}));
    server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:15000,stopTimeoutMs:3000});
    const cases=[];
    for(const size of [0,1024,65536,1048576]){
      const input=binary(size), response=await fetch(server.baseUrl,{method:'POST',body:input});
      assert.equal(response.status,200);assert.equal(response.headers.get('x-origin'),'opaque');
      const output=Buffer.from(await response.arrayBuffer());assert.deepEqual(output,input);
      cases.push({size,sha256:hash(output)});
    }
    // The origin must receive the prefix before the caller supplies EOF.
    first=new Promise(resolve=>{firstResolve=resolve;});received=0;
    const result=new Promise((resolve,reject)=>{
      const req=http.request(server.baseUrl,{method:'POST'},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);});
      req.on('error',reject);req.setTimeout(4000,()=>req.destroy(new Error('HTTP replay timeout')));
      req.write(binary(1024));first.then(()=>req.end(binary(17)));
    });
    assert.deepEqual(await result,Buffer.concat([binary(1024),binary(17)]));assert.equal(received,1041);
    mode='early';
    const early=await new Promise((resolve,reject)=>{
      const req=http.request(server.baseUrl,{method:'POST'},res=>{res.resume();res.on('end',()=>{req.destroy();resolve(res.statusCode);});});
      req.on('error',reject);req.setTimeout(4000,()=>req.destroy(new Error('early response timeout')));req.flushHeaders();
    });
    assert.equal(early,413);
    report.http={engine:launcher.inspection.version,engineSha256:hash(fs.readFileSync(launcher.inspection.binary)),cases,firstByteBeforeEof:true,earlyResponseBeforeEof:true,livePlatform:false};
  }finally{if(server)await server.stop();origin.closeAllConnections();await new Promise(resolve=>origin.close(resolve));}
}
async function main(){
  admission();
  const dir=fs.mkdtempSync(path.join(root,'.fwd9-forwarding-'));
  const report={version:'pulse.fwd9-02-proof.v1',status:'running',source:hash(fs.readFileSync(__filename))};
  try{
    fs.mkdirSync(path.join(dir,'src'));fs.mkdirSync(path.join(dir,'.pulse'));
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'fwd9-forwarding-proof',private:true,type:'module'}));
    fs.writeFileSync(path.join(dir,'src/index.ts'),source);
    fs.writeFileSync(path.join(dir,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:${JSON.stringify(config)}}}));`);
    const built=buildProject(resolveProject({cwd:dir,profile:'proof'}));assert.equal(built.status,'built');
    const wasmFile=path.join(built.outDir,'bin/main.wasm'), wasm=fs.readFileSync(wasmFile), native={wasm};
    report.wasm={bytes:wasm.length,sha256:hash(wasm),normalBuild:true};
    const imports=WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    assert.ok(imports.some(x=>x.name==='send_async_streaming'));assert.ok(!imports.some(x=>x.module==='pulse_host'));
    const run=(request={},fixture={},options={})=>execute(native,{request:{method:'POST',path:'/',...request},fixtures:{[url]:{echoBody:true,...fixture}},allowAbortedResponse:true,...options});
    let pages;
    for(const size of [0,1024,65536,1048576]){
      const data=binary(size), result=run({body:data},{},{bodyWriteChunkBytes:997});
      assert.deepEqual(result.response.bodyBytes,data);assert.deepEqual(result.outboundRequests[0].bodyBytes,data);
      assert.equal(result.response.aborted,false);assert.equal(result.outboundRequests.length,1);
      const allocated=result.instance.exports.memory.buffer.byteLength;
      if(pages===undefined)pages=allocated;else assert.equal(allocated,pages,'guest memory must not grow with payload');
      assert.ok(result.trace.filter(x=>x.name==='read'||x.name==='write').every(x=>x.bytes<=16384));
    }
    report.guestMemoryBytes=pages;
    const denied=run({headers:{'content-length':'1048577'},body:binary(1)});
    assert.equal(denied.response.status,413);assert.equal(denied.outboundRequests.length,0);assert.ok(!denied.trace.some(x=>x.name==='read'));
    const overflow=run({body:binary(1048577)});assert.equal(overflow.response.status,413);assert.ok(overflow.outboundRequests[0].bodyBytes.length<=1048576);assert.equal(overflow.outboundRequests[0].aborted,true);
    const early=run({body:binary(1024),readyDelayMs:4000},{earlyResponse:true,status:413,body:'denied',echoBody:false});
    assert.equal(early.response.status,413);assert.equal(early.response.body,'denied');assert.ok(!early.trace.some(x=>x.name==='read'&&x.handle===2));assert.equal(early.outboundRequests[0].aborted,true);
    const blocked=run({body:binary(1024)},{},{uploadReadyDelayMs:4000});assert.equal(blocked.response.status,504);assert.ok(!blocked.trace.some(x=>x.name==='read'));assert.equal(blocked.monotonicMs,1500);
    const late=run({body:binary(10)},{neverHeaders:true});assert.equal(late.response.status,504);assert.equal(late.monotonicMs,1500);
    const slow=run({}, {body:binary(1024),echoBody:false,bodyDelayMs:2000});assert.equal(slow.response.aborted,true);assert.equal(slow.monotonicMs,1500);assert.equal(slow.trace.filter(x=>x.name==='send_downstream').length,1);
    const headers=run({}, {body:binary(7),echoBody:false,headers:[['connection','x-private'],['x-private','hidden'],['content-length','7'],['content-encoding','gzip'],['set-cookie','a=1'],['set-cookie','b=2']]});
    assert.deepEqual(headers.response.bodyBytes,binary(7));assert.deepEqual(headers.response.headers,[['content-encoding','gzip'],['set-cookie','a=1'],['set-cookie','b=2']]);
    for(const fixture of [{headers:{'content-length':'1048577'}},{headers:{'x-large':'x'.repeat(16384)}}])assert.equal(run({},fixture).response.status,502);
    const responseOverflow=run({}, {body:binary(1048577),echoBody:false});assert.equal(responseOverflow.response.aborted,true);assert.ok(responseOverflow.response.bodyBytes.length<=1048576);
    for(const fault of [{bodyWriteChunkBytes:1},{outboundBodyWriteStatus:1},{downstreamBodyWriteStatus:1}]){
      const result=run({body:binary(31)},{},fault);assert.equal(result.trace.filter(x=>x.name==='send_downstream').length,1);
      if(fault.bodyWriteChunkBytes)assert.deepEqual(result.response.bodyBytes,binary(31));
      else assert.ok(result.response.status===502||result.response.aborted);
    }
    await replay(wasmFile,dir,report);report.status='passed';
    console.log('ok - FWD9-02 admission, normal Native build, bounded binary pump, headers, early response, overflow and deadline checks');
  }catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
  finally{
    const reportDir=path.join(root,'wasm/.test-results');fs.mkdirSync(reportDir,{recursive:true});fs.writeFileSync(path.join(reportDir,'fwd9-02-proof.json'),JSON.stringify(report,null,2)+'\n');
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
