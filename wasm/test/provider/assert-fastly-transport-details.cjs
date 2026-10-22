'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const root = path.resolve(__dirname, '../../..');
const origin = 'https://details.example';
const secrets = {ID:'private-access-key',KEY:'private-secret-key-32-characters-long'};
const wireCases = [
  [null,'unavailable',{}],
  [{tag:3,mask:6,dnsRcode:0,dnsInfo:65535},'dns_error',{dnsRcode:0,dnsInfo:65535}],
  [{tag:3,mask:0,dnsRcode:12,dnsInfo:34},'dns_error',{}],
  [{tag:23,mask:8,tlsAlert:255},'tls_alert_received',{tlsAlert:255}],
  [{tag:25,mask:16,h2Frame:255,h2Code:0xffffffff},'h2_error',{h2Frame:255,h2Code:0xffffffff}],
  [{tag:3,mask:0xfffffff8,tlsAlert:255,h2Code:5},'dns_error',{}],
  [{tag:0xffffffff,mask:0xffffffff,dnsRcode:42,tlsAlert:42},'unknown',{}],
  [{tag:1,mask:0},'ok',{}]
];
function fixture(kind) {
  const fastly={maxDurationMs:2000,bindings:{backends:{[origin]:'origin'},secretStore:'secrets'}};
  if(kind==='poll')fastly.bindings.logEndpoint='transport-events';
  let source;
  if(kind==='forward') {
    fastly.bodyForwarding={requestMaxBytes:1024,responseMaxBytes:1024};
    source=`export default async function handler(ctx){return ctx.fetch('${origin}/object',{method:'POST',body:ctx.req.body(),timeoutMs:1000});}`;
  } else if(kind==='s3') {
    fastly.bindings.s3={objects:{endpoint:origin,bucket:'bucket',region:'us-east-1',backend:'origin',accessKeyIdSecret:'ID',secretAccessKeySecret:'KEY',timeoutMs:1000,maxTextBytes:1024}};
    source="import {Pulse} from '@pulse-compute/pulse';import {s3} from '@pulse-compute/s3';const app=new Pulse({auto:true});app.post('/',async ctx=>{const result=await s3.getText(ctx,'objects','object');return ctx.json(result);});export default app;";
  } else {
    const options=kind==='wait'?",{method:'POST',body:'private-request-body'}":",{method:'POST',body:'private-request-body',timeoutMs:1000}";
    const action=kind==='siblings'?`const {first,second}=await ctx.parallel({first:ctx.fetch('${origin}/object',{timeoutMs:1000}).text(),second:ctx.fetch('${origin}/second',{timeoutMs:1000}).text()});return ctx.text(first);`:`const value=await ctx.fetch('${origin}/object'${options}).text();return ctx.text(value);`;
    source=`import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/',async ctx=>{${action}});`;
    if(kind==='poll')source+=`app.post('/recover',async ctx=>{const value=await ctx.fetch('${origin}/object',{timeoutMs:1000}).text();return ctx.text(value);});`;
    if(kind!=='unhandled') source+=`app.error(async(error,ctx,next)=>{${kind==='poll'?`if(ctx.req.path==='/recover'){const value=await ctx.fetch('${origin}/second',{timeoutMs:1000}).text();return ctx.text(value);}`:''}return next(error);});app.error(async(error,ctx,next)=>ctx.json({code:error.code,detail:error.detail},{status:418}));`;
    source+='export default app;';
  }
  return {source,fastly};
}
function diagnostic(result) {
  return result.logs.filter(x=>x.message.includes('"event":"pulse.transport"')).map(x=>{
    assert(Buffer.byteLength(x.message)<512);return JSON.parse(x.message.slice(x.message.indexOf('{')));
  });
}
function expected(wire,kind,optional,phase,status=1) {
  return {provider:'fastly',phase,status,tag:wire?.tag||null,mask:wire?.tag?wire.mask:null,kind,
    dnsRcode:null,dnsInfo:null,tlsAlert:null,h2Frame:null,h2Code:null,...optional};
}
async function main(options={}) {
  const tc=acceptanceToolchain(options.packedRoot),dir=fs.mkdtempSync(path.join(options.packedRoot||root,'.transport-details-'));
  const report={status:'running',cases:[],artifacts:[],local:[],hosted:false};
  try {
    for(const kind of options.only?[options.only]:['wait','poll','s3','forward','siblings','unhandled']) {
      const cwd=options.packedRoot||path.join(dir,kind), f=fixture(kind);
      fs.mkdirSync(path.join(cwd,'src'),{recursive:true});fs.mkdirSync(path.join(cwd,'.pulse'),{recursive:true});
      fs.writeFileSync(path.join(cwd,'src/index.ts'),f.source);
      fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(scope=>(${JSON.stringify({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'proof',...(kind==='s3'?{crypto:['SHA-256','HMAC-SHA256']}:{})},proof:{host:'fastly',target:'native',outDir:'dist',fastly:f.fastly}})}));`);
      const built=tc.buildProject(tc.resolveProject({cwd,profile:'proof'}));assert.equal(built.status,'built');
      const wasmFile=path.join(built.outDir,'bin/main.wasm'),wasm=fs.readFileSync(wasmFile);
      report.artifacts.push({kind,bytes:wasm.length,sha256:createHash('sha256').update(wasm).digest('hex')});
      if(options.artifactDir)fs.writeFileSync(path.join(options.artifactDir,kind+'.wasm'),wasm);
      for(const [wire,label,optional] of wireCases) for(const outcome of ['failure','send','success',...(kind==='wait'?[]:['timeout'])]) {
        const result=tc.executeFastlyNativePlatformCapabilities({wasm},{request:{method:'POST',body:'private-request-body',headers:{authorization:'private-authorization'}},secretStore:'secrets',secrets,
          fixtures:{[origin+(kind==='s3'?'/bucket/object':'/object')]:{status:200,body:'ok',headers:{'content-length':'2'},sendErrorDetail:wire,
            ...(outcome==='failure'?{transportStatus:1}:outcome==='send'?{sendStatus:1}:outcome==='timeout'?{pollNotReadyMs:1100}:{})},
            [origin+'/second']:{status:200,body:'sibling',transportStatus:1,sendErrorDetail:{tag:23,mask:8,tlsAlert:99},delayMs:10}},
          sendErrorDetailLayout:kind==='forward'?'scratch':'managed',allowHandledTransportError:true,allowHandledFetchDeadlineError:true});
        const records=diagnostic(result);
        if(outcome==='failure'||outcome==='send') {
          const detail=expected(outcome==='send'?null:wire,outcome==='send'?'unavailable':label,outcome==='send'?{}:optional,outcome==='send'?'send':kind==='wait'?'wait':'poll');
          assert.deepEqual(records[0],{event:'pulse.transport',...detail},kind+'/'+outcome);
          if(['wait','poll','siblings'].includes(kind)) {
            assert.equal(result.response.status,418);assert.deepEqual(JSON.parse(result.response.body),{code:'PULSE_FETCH_NETWORK',detail});
          } else if(kind==='s3') {const body=JSON.parse(result.response.body);assert.equal(body.status,'failed');assert.equal(body.reason,'transport');assert(!('detail' in body));}
          else assert.equal(result.response.status,502);
        } else if(outcome==='timeout') {
          if(kind==='poll')assert.deepEqual(JSON.parse(result.response.body),{code:'PULSE_FETCH_TIMEOUT',detail:null});
          if(kind==='forward')assert.equal(result.response.status,504);
          if(kind==='s3')assert.equal(JSON.parse(result.response.body).reason,'timeout');
          assert.equal(result.monotonicMs,1000);
        } else if(kind!=='siblings') {assert.equal(records.length,0);assert.equal(result.response.status,200);}
        assert.equal(result.trace.filter(x=>x.name==='send_downstream').length,1);
        assert(result.outboundRequests.length<=(kind==='siblings'?2:1),'no retry');
        if(outcome!=='timeout')assert.equal(result.transportResources.pendingRequests,0,'all dispatched siblings settled');
        const diagnostics=JSON.stringify(records);for(const secret of ['private-request-body','private-authorization',...Object.values(secrets)])assert(!diagnostics.includes(secret));
        report.cases.push({kind,outcome,tag:wire?.tag??null,status:'passed'});
      }
      if(kind==='poll') {
        const run=(fixtures,extra={})=>tc.executeFastlyNativePlatformCapabilities({wasm},{request:{method:'POST',path:'/recover'},fixtures,allowHandledTransportError:true,allowHandledFetchDeadlineError:true,sendErrorDetailLayout:'managed',...extra});
        const failed={transportStatus:1,sendErrorDetail:{tag:3,mask:6,dnsRcode:4,dnsInfo:5}};
        const second={transportStatus:1,delayMs:600,sendErrorDetail:{tag:23,mask:8,tlsAlert:99}};
        const recovered=run({[origin+'/object']:failed,[origin+'/second']:second});
        assert.deepEqual(JSON.parse(recovered.response.body).detail,expected(second.sendErrorDetail,'tls_alert_received',{tlsAlert:99},'poll'));
        assert.equal(recovered.outboundRequests.length,2);assert.equal(recovered.transportResources.pendingRequests,0);
        const late=run({[origin+'/object']:{...failed,delayMs:1400},[origin+'/second']:{body:'recovered',delayMs:600}});
        assert.equal(late.response.body,'recovered');assert.equal(late.instance.exports.pulse_fastly_fetch_unreaped(),0);assert.equal(diagnostic(late).length,0,'cleanup discards late failure details');
        const deadline=run({[origin+'/object']:failed,[origin+'/second']:{body:'recovered'}},{request:{method:'POST'},hostcallDelayMs:{'fastly_http_req.pending_req_poll_v2':1000}});
        assert.deepEqual(JSON.parse(deadline.response.body),{code:'PULSE_FETCH_TIMEOUT',detail:null});
        const fatal=run({[origin+'/object']:{...failed,transportStatus:3}},{request:{method:'POST'}});assert.equal(fatal.response.status,500);
        const dropped=run({[origin+'/object']:failed},{request:{method:'POST'},logEndpointFailure:true});
        assert.equal(dropped.response.status,418);assert.equal(dropped.logs.length,0);assert.equal(JSON.parse(dropped.response.body).detail.dnsRcode,4);
        report.cases.push({kind,outcome:'recovery-new-failure-cleanup-timeout-fatal-log-failure',status:'passed'});
      }
      if(process.env.PULSE_VICEROY_BIN&&['wait','poll','s3','forward'].includes(kind))report.local.push(await replay(wasmFile,built.outDir,kind));
    }
    report.status='passed';if(!options.quiet)console.log(JSON.stringify(report));return report;
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
async function replay(wasmFile,dir,kind) {
  const key=path.join(dir,'local.key'),cert=path.join(dir,'local.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'pipe'});
  const launcher=cli.inspectFastlyComputeLauncher({viceroyBinary:process.env.PULSE_VICEROY_BIN,required:true});
  const results=[];
  for(const mode of ['socket-reset','untrusted-tls']) {
    let count=0,tlsFailures=0,server;
    const originServer=mode==='socket-reset'?http.createServer((req,res)=>{count++;req.resume();req.socket.write('HTTP/1.1 200 OK\r\n',()=>req.socket.destroy());}):https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{count++;res.end('unexpected');});
    originServer.on('tlsClientError',()=>tlsFailures++);
    await new Promise(r=>originServer.listen(0,'127.0.0.1',r));
    try {
      const manifestFile=path.join(dir,'fastly.toml');fs.writeFileSync(manifestFile,cli.renderFastlyLocalConfig({name:'transport-details',secretStores:{secrets},backends:{origin:{url:`${mode==='socket-reset'?'http':'https'}://127.0.0.1:${originServer.address().port}`,useSni:false}}}));
      server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile,manifestFile,startTimeoutMs:60000});
      // The launcher readiness connection can invoke the guest; exclude startup traffic.
      count=0;tlsFailures=0;server.logs.stdout='';server.logs.stderr='';
      const response=await cli.requestFastlyCompute(server,{method:'POST',body:'private-request-body'});
      assert.equal(count,mode==='socket-reset'?1:0,kind+'/'+mode+' origin count');
      const body=response.body.toString();assert.equal(response.status,kind==='s3'?200:kind==='forward'?502:418);
      const logs=server.logs.stdout+'\n'+server.logs.stderr;
      const match=logs.match(/\{"event":"pulse.transport"[^\n]*\}/);assert(match,'real host diagnostic');
      const detail=JSON.parse(match[0]);assert.equal(detail.provider,'fastly');
      // Viceroy may leave the ABI record uninitialized. Record that honestly.
      if(detail.tag===null)assert.deepEqual(detail,{event:'pulse.transport',...expected(null,'unavailable',{},kind==='wait'?'wait':'poll',detail.status)});
      assert.equal(detail.dnsRcode,null);assert.equal(detail.tlsAlert,null);
      if(['wait','poll'].includes(kind)){const {event,...record}=detail;assert.deepEqual(JSON.parse(body),{code:'PULSE_FETCH_NETWORK',detail:record});}
      assert(!logs.includes('private-request-body'));for(const value of Object.values(secrets))assert(!logs.includes(value));
      results.push({mode,originRequests:count,tlsFailures,status:response.status,detail});
    } finally {if(server)await server.stop();originServer.closeAllConnections();await new Promise(r=>originServer.close(r));}
  }
  return {kind,engine:launcher.inspection.version,engineSha256:createHash('sha256').update(fs.readFileSync(launcher.inspection.binary)).digest('hex'),results};
}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
