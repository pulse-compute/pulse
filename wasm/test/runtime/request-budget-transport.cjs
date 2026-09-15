'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const {compileFastlyNativePlatformCapabilitiesPlan} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const tc = acceptanceToolchain();
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
function clock() {
  let time = 0; const timers = new Map();
  return {now:()=>time,setTimeout(fn,ms){const id={};timers.set(id,{fn,at:time+ms});return id;},clearTimeout(id){timers.delete(id);},
    advance(ms){time+=ms;for(const[id,t]of[...timers])if(t.at<=time){timers.delete(id);t.fn();}},pending:()=>timers.size};
}
async function main() {
  const cwd = fs.mkdtempSync(path.join(__dirname, '.deadline-'));
  try {
    fs.mkdirSync(path.join(cwd,'src')); fs.mkdirSync(path.join(cwd,'.pulse'));
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','s3']) fs.symlinkSync(path.resolve(__dirname,'../../../packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {Pulse} from '@pulse-compute/pulse'
import {s3} from '@pulse-compute/s3'
const app = new Pulse({auto:true});
app.post('/step', async ctx => {
 const first = await s3.putText(ctx,'objects','first','one');
 const second = await s3.putText(ctx,'objects','second','two');
 const checkpoint = await ctx.kv('catalog').insertIfAbsent('checkpoint',1);
 return ctx.text('done');
});
app.post('/body', async ctx => { const raw = await ctx.req.text(); const after = await ctx.config.get('after-body'); return ctx.text(raw); });
export default app;
`);
    const bindings = structuredClone(require('../s3/o1/bindings.json'));
    bindings.fastly.bindings.kv = {catalog:'catalog'};
    const config = {pulse:{entry:'src/index.ts',defaultProfile:'node-native',strict:false,crypto:['SHA-256','HMAC-SHA256']}};
    for(const provider of ['node','fastly']) for(const target of ['native','javascript']) {
      config[`${provider}-${target}`] = {host:provider,target,[provider]:{...bindings[provider],maxDurationMs:10000}};
      if(provider==='node') config[`${provider}-${target}-http`] = {host:provider,target,node:{...bindings.node,maxDurationMs:50},dev:{host:'127.0.0.1',port:8787,watch:false,config:{'after-body':'yes'}}};
    }
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const projects=Object.fromEntries(['node-native','node-javascript','fastly-native'].map(profile=>[profile,tc.resolveProject({cwd,profile})]));
    const node=tc.compileNativeProjectInMemory(projects['node-native']);
    const js=tc.prepareJavascriptApplication(projects['node-javascript']);
    const fastly=compileFastlyNativePlatformCapabilitiesPlan(tc.compileNativeProjectInMemory(projects['fastly-native']).plan,
      {cwd,bindings:projects['fastly-native'].providerConfig.bindings,maxDurationMs:10000,canonicalBuild:true});
    const secrets={S3_ACCESS_KEY_ID:'deadline-fixture',S3_SECRET_ACCESS_KEY:'deadline-fixture-secret'};
    for(const delay of [0,6000]) for(const mode of Object.keys(projects)) {
      const c=clock(),sent=[]; const request={method:'POST',path:'/step',url:'https://app.test/step',body:'',headers:[]};
      if(mode==='fastly-native') {
        const authority=createConditionalKvAuthority(); authority.stores.set('catalog',new Map());
        const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request,secrets,secretStore:'app_secrets',conditionalKv:{authority},
          fixtures:{'PUT https://objects.example.invalid/o1-fixture/first':{status:200,body:'',headers:[['content-length','0']],delayMs:delay},
            'PUT https://objects.example.invalid/o1-fixture/second':{status:200,body:'',headers:[['content-length','0']],delayMs:delay}},
          onOutboundRequest(request){sent.push(request.method);}});
        assert.equal(result.response.status,delay?504:200);
        const inserts=result.trace.filter(x=>x.module==='pulse_kv_evidence' && x.name==='insert');
        assert.equal(inserts.length,delay?0:1,'No checkpoint dispatch after cumulative S3 expiry');
      } else {
        const fetchImplementation=async()=>{sent.push('PUT');c.advance(delay);return {status:200,headers:[['content-length','0']],body:new Response('').body};};
        const options={request,secrets,kv:{},maxDurationMs:10000,requestClock:c,fetchImplementation,strict:false};
        const execute=()=>mode==='node-native'
          ? tc.executeCanonicalNativeModule(node.native,tc.driver.executionOptions(projects[mode].providerConfig,options))
          : tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{method:'POST'}),{...options,s3:bindings.node.bindings.s3});
        if(delay) await assert.rejects(execute(),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
        else { const result=await execute(); assert.equal(mode==='node-native'?result.response.status:result.status,200); }
        assert.equal(c.pending(),0);
      }
      assert.equal(sent.length,2);
    }
    // Actual Node HTTP admission, not a direct execution approximation: leave
    // the request body incomplete and wait for the provider's timeout response.
    for(const target of ['native','javascript']) {
      const project=tc.resolveProject({cwd,profile:`node-${target}-http`});
      const active=await tc.startDevServer(project,{port:0,watch:false});
      try {
        const response=await new Promise((resolve,reject)=>{
          const request=http.request(active.ready.url+'/body',{method:'POST',headers:{'content-type':'text/plain','content-length':'100'}},res=>{
            let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body}));
          });
          request.on('error',reject);request.setTimeout(5000,()=>request.destroy(new Error('HTTP admission deadline did not respond')));
          request.write('partial');
        });
        assert.equal(response.status,504,`${target}: delayed inbound body`);
      } finally {active.server.closeAllConnections();await new Promise(resolve=>active.server.close(resolve));}
    }
    console.log('ok - deadline covers cumulative S3 preparation on three targets and real Node Native/JS HTTP body admission');
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
