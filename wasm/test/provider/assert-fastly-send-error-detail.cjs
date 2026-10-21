'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root = path.resolve(__dirname, '../../..');
const origin = 'https://layout.example';
const secrets = {ID:'layout-access-key', KEY:'layout-secret-key-32-characters-long'};
const cases = [
  {tag:1,mask:0}, {tag:3,mask:6,dnsRcode:65535,dnsInfo:65534},
  {tag:23,mask:8,tlsAlert:255}, {tag:25,mask:16,h2Frame:255,h2Code:0x76543210},
  {tag:0xffffffff,mask:0xffffffff,h2Code:0xffffffff}
];
function fixture(kind) {
  const fastly = {maxDurationMs:2000,bindings:{backends:{[origin]:'origin'},secretStore:'secrets'}};
  let source;
  if(kind==='forward') {
    fastly.bodyForwarding={requestMaxBytes:1024,responseMaxBytes:1024};
    source=`export default async function handler(ctx){return ctx.fetch('${origin}/object',{method:'POST',body:ctx.req.body(),timeoutMs:1000});}`;
  } else if(kind==='s3') {
    fastly.bindings.s3={objects:{endpoint:origin,bucket:'bucket',region:'us-east-1',backend:'origin',accessKeyIdSecret:'ID',secretAccessKeySecret:'KEY',timeoutMs:1000,maxTextBytes:1024}};
    source="import {Pulse} from '@pulse-compute/pulse';import {s3} from '@pulse-compute/s3';const app=new Pulse({auto:true});app.post('/',async ctx=>{const result=await s3.getText(ctx,'objects','object');return ctx.json(result);});export default app;";
  } else {
    source=`import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});
app.post('/',async ctx=>{const result=await ctx.fetch('${origin}/object',{timeoutMs:1000}).text();return ctx.text(result);});
app.error(async(error,ctx,next)=>ctx.text(error.code,{status:502}));export default app;`;
  }
  return {source,fastly};
}
async function main(options={}) {
  const tc=acceptanceToolchain(options.packedRoot);
  const parent=options.packedRoot || root, dir=fs.mkdtempSync(path.join(parent,'.send-error-layout-'));
  const report={status:'running',cases:[],artifacts:[],local:[],hosted:false};
  try {
    for(const kind of options.only ? [options.only] : ['fetch','s3','forward']) {
      // Installed lowerer discovery is project-local: build at the actual consumer root.
      const cwd=options.packedRoot || path.join(dir,kind);
      fs.mkdirSync(path.join(cwd,'src'),{recursive:true});fs.mkdirSync(path.join(cwd,'.pulse'),{recursive:true});
      const f=fixture(kind);fs.writeFileSync(path.join(cwd,'src/index.ts'),f.source);
      fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(scope=>(${JSON.stringify({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof',...(kind==='s3'?{crypto:['SHA-256','HMAC-SHA256']}:{})},proof:{host:'fastly',target:'native',outDir:'dist',fastly:f.fastly}})}));`);
      const built=tc.buildProject(tc.resolveProject({cwd,profile:'proof'}));assert.equal(built.status,'built');
      const wasmFile=path.join(built.outDir,'bin/main.wasm'),wasm=fs.readFileSync(wasmFile);
      const identity={kind,bytes:wasm.length,sha256:createHash('sha256').update(wasm).digest('hex')};report.artifacts.push(identity);
      if(options.artifactDir)fs.writeFileSync(path.join(options.artifactDir,kind+'.wasm'),wasm);
      for(const detail of cases) for(const outcome of ['success','not-ready','failure','timeout']) {
        const result=tc.executeFastlyNativePlatformCapabilities({wasm},{request:{method:'POST',body:'request'},secretStore:'secrets',secrets,
          fixtures:{[origin+(kind==='s3'?'/bucket/object':'/object')]:{status:200,body:'ok',headers:{'content-length':'2'},
            sendErrorDetail:detail,...(outcome==='not-ready'?{pollNotReadyMs:10}:outcome==='failure'?{transportStatus:1}:outcome==='timeout'?{pollNotReadyMs:1100}:{})}},
          sendErrorDetailLayout:kind==='forward'?'scratch':'managed',allowHandledTransportError:true,allowHandledFetchDeadlineError:true});
        const polls=result.trace.filter(x=>x.name==='pending_req_poll_v2');assert(polls.length>0,kind+'/'+outcome);assert(polls.every(x=>x.detailLayoutChecked&&x.detailBytes===20));
        assert.equal(result.outboundRequests.length,1,'no retry or duplicate dispatch');
        assert.equal(result.trace.filter(x=>x.name==='send_downstream').length,1);
        if(kind==='s3') assert.equal(JSON.parse(result.response.body).status,['failure','timeout'].includes(outcome)?'failed':'found');
        if(kind==='s3' && ['failure','timeout'].includes(outcome)) assert.equal(JSON.parse(result.response.body).reason,outcome==='timeout'?'timeout':'transport');
        if(kind!=='s3') assert.equal(result.response.status,outcome==='failure'?502:outcome==='timeout'?(kind==='fetch'?502:504):200);
        if(outcome==='success'||outcome==='not-ready') assert.equal(kind==='s3'?JSON.parse(result.response.body).text:result.response.body,'ok');
        if(outcome==='not-ready') assert(polls.length>=2,'repeated poll must reset returned detail');
        assert.equal(result.transportResources.pendingRequests,outcome==='timeout'?1:0);
        if(outcome==='timeout') assert.equal(result.monotonicMs,1000);
        report.cases.push({kind,outcome,tag:detail.tag,mask:detail.mask,polls:polls.length,status:'passed'});
      }
      if(process.env.PULSE_VICEROY_BIN) report.local.push(await replay(wasmFile,built.outDir,kind));
    }
    report.status='passed';if(!options.quiet)console.log(JSON.stringify(report));return report;
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
async function replay(wasmFile,dir,kind) {
  let mode='success',count=0;const timers=new Set();
  const originServer=http.createServer((req,res)=>{count++;req.resume();if(mode==='reset'){req.socket.destroy();return;}
    const timer=setTimeout(()=>{timers.delete(timer);if(!res.destroyed){res.setHeader('content-length','2');res.end('ok');}},mode==='timeout'?1400:0);timers.add(timer);});
  await new Promise(r=>originServer.listen(0,'127.0.0.1',r));let server;
  try {
    const manifestFile=path.join(dir,'fastly.toml');fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'send-error-layout',secretStores:{secrets},backends:{origin:{url:`http://127.0.0.1:${originServer.address().port}`,useSni:false}}}));
    const launcher=cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
    server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:60000});
    const results=[];for(mode of ['success','reset','timeout']) {
      count=0;const response=await cli.requestFastlyCompute(server,{method:'POST',body:'request'});
      assert.equal(count,1);const body=response.body.toString();
      if(kind==='s3')assert.equal(JSON.parse(body).status,mode==='success'?'found':'failed');
      else assert.equal(response.status,mode==='success'?200:mode==='timeout'&&kind==='forward'?504:502);
      results.push({mode,status:response.status,body,originRequests:count});
    }
    return {kind,engine:launcher.inspection.version,engineSha256:createHash('sha256').update(fs.readFileSync(launcher.inspection.binary)).digest('hex'),results};
  } finally {if(server)await server.stop();for(const t of timers)clearTimeout(t);originServer.closeAllConnections();await new Promise(r=>originServer.close(r));}
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
