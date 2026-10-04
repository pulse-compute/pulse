'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host.js');

function requestClock() {
  let now = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) { const id = {}; timers.set(id, {fn, at: now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    pending: () => timers.size
  };
}

async function send(url, route, bytes, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url + route, {method:'POST', headers:{'content-type':'text/plain', ...headers}}, response => {
      const chunks=[]; response.on('data', value=>chunks.push(value));
      response.once('error',reject);
      response.once('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8'),headers:response.headers}));
    });
    request.once('error',reject);request.setTimeout(5000,()=>request.destroy(new Error('HTTP response did not settle')));
    // Explicitly split every scalar/invalid sequence at transport writes.
    for (const byte of bytes) request.write(Buffer.from([byte]));
    request.end();
  });
}

async function main(options={}) {
  const tc=acceptanceToolchain(options.packedRoot);
  const repo=path.resolve(__dirname,'../../..');
  const cwd=fs.mkdtempSync(path.join(options.packedRoot || __dirname,'.http-input-'));
  const rows=[];
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  try {
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
    if(options.packedRoot) fs.symlinkSync(path.join(options.packedRoot,'node_modules'),path.join(cwd,'node_modules'),'junction');
    else {
      fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
      for(const entry of require('../../../scripts/package-support.cjs').PACKAGE_SET) fs.symlinkSync(path.join(repo,entry.dir),path.join(cwd,'node_modules',entry.name),'junction');
    }
    fs.writeFileSync(path.join(cwd,'package.json'),'{"private":true}');
    const installed=createRequire(path.join(cwd,'package.json'));
    const {createNodeKvReference}=installed(path.join(path.dirname(installed.resolve('@pulse-compute/provider-node/toolchain')),'runtime/conditional-kv.js'));
    const {createNodeProviderAdapter}=installed('@pulse-compute/provider-node/runtime/canonical-api-runtime');
    const lifecycle=installed('@pulse-compute/provider-node/javascript/lifecycle');
    // KV registration includes index '8' and the property name 'code'; both can
    // overlap an admitted error discriminator before body decoding fails.
    const seed={items:Array(9).fill('private-fixture'),code:'PULSE'};
    const source=`import {Pulse} from '@pulse-compute/pulse';
import {jwt} from '@pulse-compute/jwt';
const app=new Pulse({auto:true});
app.use('/raw',async(ctx,next)=>{const before=await ctx.kv('proof').getVersioned('seed');return next();});
app.post('/raw',async ctx=>{const raw=await ctx.req.text();const again=await ctx.req.text();if(raw!==again)return ctx.text('snapshot changed',{status:500});const write=await ctx.kv('proof').insertIfAbsent('after-input',1);return ctx.text(raw,{status:201});});
app.post('/auth',async ctx=>{const verified=await jwt.verify(ctx,jwt.bearer(ctx.req),{algorithms:['HS256'],key:{type:'secret',binding:'JWT_KEY'}});const write=await ctx.kv('proof').insertIfAbsent('after-auth',1);return ctx.text('accepted',{status:201});});
app.post('/deny',async ctx=>ctx.json({outcome:'not-accepted'},{status:403}));
app.post('/unknown',async ctx=>ctx.json({outcome:'unknown'},{status:503}));
app.post('/commit',async ctx=>{const result=await ctx.kv('proof').insertIfAbsent('command',1);if(result.status==='stored')return ctx.json({outcome:'accepted'},{status:201});if(result.status==='conflict')return ctx.json({outcome:'not-accepted'},{status:409});if(result.status==='unknown')return ctx.json({outcome:'unknown'},{status:503});return ctx.json({outcome:'not-accepted'},{status:503});});
app.error(async(error,ctx,next)=>{if(error.code==='PULSE_REQUEST_BODY_INVALID_UTF8'){const retry=await ctx.req.text();const forbidden=await ctx.kv('proof').insertIfAbsent('after-retry',1);return ctx.text(retry);}return next(error);});
app.error(async(error,ctx,next)=>{if(error.code==='PULSE_REQUEST_BODY_INVALID_UTF8')return ctx.text(error.code,{status:400});if(error.code==='PULSE_BODY_TOO_LARGE')return ctx.text(error.code,{status:413});return ctx.text('denied',{status:401,headers:{'www-authenticate':'Bearer'}});});
export default app;`;
    fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
    const config={pulse:{entry:'src/index.ts',defaultProfile:'node-native',strict:false}};
    for(const [host,target] of [['node','native'],['node','javascript'],['fastly','native']])config[`${host}-${target}`]={host,target,outDir:`dist/${host}-${target}`,schemas:{maxBytes:64},crypto:{HS256:{realization:target==='javascript'?'runtime-builtin':'guest-source:pulse-hmac-as'}},[host]:{maxDurationMs:10000,...(host==='fastly'?{bindings:{secretStore:'secrets',kv:{proof:'proof'}}}:{})},dev:{maxBodyBytes:64,watch:false,secrets:{JWT_KEY:'private-fixture'},kv:{proof:{command:1,seed}}}};
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const projects=Object.fromEntries(Object.keys(config).filter(k=>k!=='pulse').map(profile=>[profile,tc.resolveProject({cwd,profile})]));
    const native=tc.compileNativeProjectInMemory(projects['node-native']);
    const jsBuild=tc.buildProject(projects['node-javascript']);assert.equal(jsBuild.status,'built');
    const js=installed(jsBuild.files.entry);
    const fastly=tc.compileFastly(projects['fastly-native']);
    const invalid=['80','bf','c0af','c1bf','c2','c328','e08080','eda080','edbfbf','e282','e228a1','f0808080','f4908080','f5808080','f09f98','ff'];
    const valid=['','ascii','\u0000','�(','é中😀','\ufefftext','a'.repeat(60)+'😀'];
    const cases=[...invalid.map(hex=>({name:hex,bytes:Buffer.from(hex,'hex'),status:400})),...valid.map(text=>({name:JSON.stringify(text),bytes:Buffer.from(text),status:201,text})),{name:'over-limit',bytes:Buffer.alloc(65,97),status:413},{name:'invalid-over-limit',bytes:Buffer.alloc(65,255),status:413}];
    for(const mode of Object.keys(projects)) {
      for(const test of cases) {
        let response,writes=0;
        const request={method:'POST',path:'/raw',url:'https://proof.test/raw',headers:[['content-type','text/plain']],body:test.bytes,chunkBytes:1};
        if(mode==='fastly-native') {
          const authority=createConditionalKvAuthority();authority.stores.set('proof',new Map());
          authority.seed('proof','seed',JSON.stringify({__pulseKv:1,value:seed}));
          const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request,conditionalKv:{authority,onCall(stage){if(stage==='insert')writes++;}}});response=result.response;
          assert.equal(result.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='send_downstream').length,1,'one terminal response');
        } else {
          const kvReference=createNodeKvReference({kv:{proof:{seed}},kvHooks:{prepare(effect){if(effect.kind!=='kv.getVersioned')writes++;}}});
          const runtime={request,strict:false,maxRequestBodyBytes:64,kvReference,adapter:createNodeProviderAdapter({kvReference})};
          if(mode==='node-native')response=(await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects[mode].providerConfig,runtime))).response;
          else {const value=await tc.executeNodeJavascriptApplication(js,new Request(request.url,{method:'POST',headers:request.headers,body:test.bytes}),runtime);response={status:value.status,body:Buffer.from(await value.arrayBuffer()).toString('utf8')};}
        }
        assert.equal(response.status,test.status,`${mode}: ${test.name}`);
        assert.equal(writes,test.status===201?1:0,`${mode}: no storage after rejection`);
        if(test.text!==undefined)assert.equal(response.body,test.text,`${mode}: exact text`);
        rows.push({mode,case:test.name,status:response.status,writes});
      }
      let preparations=0;
      const kvReference=createNodeKvReference({kvHooks:{prepare(){preparations++;}}});
      const authority=createConditionalKvAuthority();authority.stores.set('proof',new Map());
      for(const [route,status,outcome,headers] of [
        ['/auth',401,null,[]], ['/auth',401,null,[['authorization','Bearer broken']]],
        ['/deny',403,'not-accepted',[]], ['/unknown',503,'unknown',[]],
        ['/commit',201,'accepted',[]], ['/commit',409,'not-accepted',[]]
      ]) {
        const before=preparations;
        const request={method:'POST',path:route,url:'https://proof.test'+route,body:'',headers};
        let response;
        if(mode==='fastly-native') {
          const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request,conditionalKv:{authority,onCall(stage){if(stage==='insert')preparations++;}}});
          response=result.response;
          assert.equal(result.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='send_downstream').length,1);
        } else {
          const runtime={request,kvReference,strict:false};
          if(mode==='node-native')response=(await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects[mode].providerConfig,runtime))).response;
          else {const value=await tc.executeNodeJavascriptApplication(js,new Request(request.url,{method:'POST',headers}),runtime);response={status:value.status,body:await value.text()};}
        }
        assert.equal(response.status,status,`${mode}: ${route}`);
        if(outcome)assert.equal(JSON.parse(response.body).outcome,outcome);
        assert.equal(preparations-before,route==='/commit'?1:0,`${mode}: denied work must not prepare storage`);
        rows.push({mode,case:route,status,preparations:preparations-before,...(outcome?{outcome}:{})});
      }
    }
    // The real Node ingress adapters must receive bytes, not repaired strings.
    for(const target of ['native','javascript']) {
      const active=await tc.startDevServer(projects[`node-${target}`],{port:0,watch:false});let finishes=0;
      active.server.on('request',(_req,res)=>res.once('finish',()=>finishes++));
      try {
        for(const test of cases){const response=await send(active.ready.url,'/raw',test.bytes);assert.equal(response.status,test.status,`${target} HTTP: ${test.name}`);if(test.text!==undefined)assert.equal(response.body,test.text);}
        for(const [route,status,outcome,headers] of [['/auth',401,null,{}],['/auth',401,null,{authorization:'Bearer broken'}],['/deny',403,'not-accepted',{}],['/unknown',503,'unknown',{}],['/commit',409,'not-accepted',{}]]) {
          const response=await send(active.ready.url,route,Buffer.alloc(0),headers);assert.equal(response.status,status,`${target} HTTP ${route}`);
          if(outcome)assert.equal(JSON.parse(response.body).outcome,outcome);
          if(route==='/auth')assert.equal(response.headers['www-authenticate'],'Bearer');
        }
        assert.equal(finishes,cases.length+5);rows.push({mode:`node-${target}-http`,requests:finishes,status:'passed'});
      } finally {active.server.closeAllConnections();await new Promise(resolve=>active.server.close(resolve));}
    }
    // A real conditional write can commit before acknowledgement fails. Keep
    // unknown through built JavaScript + the HTTP lifecycle and compiled Wasm.
    for(const mode of Object.keys(projects)) {
      let response,committed;
      if(mode==='fastly-native') {
        const authority=createConditionalKvAuthority();authority.stores.set('proof',new Map());
        const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request:{method:'POST',path:'/commit',body:''},conditionalKv:{authority,onCall(stage){return stage==='insert_wait'?{status:1}:{};}}});response=result.response;committed=!!authority.get('proof','command');
      } else {
        const kvReference=createNodeKvReference({kvHooks:{afterCommit(){throw new Error('lost acknowledgement');}}});
        if(mode==='node-native')response=(await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects[mode].providerConfig,{request:{method:'POST',path:'/commit',body:''},kvReference,adapter:createNodeProviderAdapter({kvReference}),strict:false}))).response;
        else {
          const server=await lifecycle.listenNodeJavascriptApplication(js,{port:0,kvReference,maxDurationMs:10000,strict:false});
          try{response=await send(`http://127.0.0.1:${server.address().port}`,'/commit',Buffer.alloc(0));}finally{server.closeAllConnections();await lifecycle.closeNodeJavascriptServer(server);}
        }
        committed=kvReference.kv('proof').get('command')===1;
      }
      assert.equal(committed,true);assert.equal(response.status,503);assert.equal(JSON.parse(response.body).outcome,'unknown');rows.push({mode,case:'committed-acknowledgement-lost',status:503,committed:true,outcome:'unknown'});
    }
    // Expiry after dispatch cannot claim rollback or leak a late success body.
    {
      let finishes=0;
      const clock=requestClock();
      let acknowledge;
      const lateAcknowledgement=new Promise(resolve=>{acknowledge=resolve;});
      const kvReference=createNodeKvReference({kvHooks:{async afterCommit(){clock.advance(31);await lateAcknowledgement;}}});
      const server=await lifecycle.listenNodeJavascriptApplication(js,{port:0,kvReference,maxDurationMs:30,requestClock:clock,strict:false});
      server.on('request',(_req,res)=>res.once('finish',()=>finishes++));
      try {
        const response=await send(`http://127.0.0.1:${server.address().port}`,'/commit',Buffer.alloc(0));
        assert.equal(response.status,504);assert.equal(response.body,'Gateway Timeout');
        acknowledge();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(kvReference.kv('proof').get('command'),1);assert.equal(finishes,1);assert.equal(clock.pending(),0);
        rows.push({mode:'node-javascript-http',case:'deadline-after-commit',status:504,committed:true,responses:finishes});
      }finally{acknowledge();server.closeAllConnections();await lifecycle.closeNodeJavascriptServer(server);}
      const authority=createConditionalKvAuthority();authority.stores.set('proof',new Map());
      const result=tc.executeFastlyNativePlatformCapabilities(fastly,{request:{method:'POST',path:'/commit',body:''},conditionalKv:{authority,onCall(stage){return stage==='insert'?{readyDelayMs:15000}:{};}}});
      assert.equal(result.response.status,504);assert.ok(authority.get('proof','command'));
      assert.equal(result.trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='send_downstream').length,1);
      rows.push({mode:'fastly-native',case:'deadline-after-commit',status:504,committed:true,responses:1});
    }
    // Without a Router error lane, the provider still denies invalid text and
    // suppresses every later effect instead of returning repaired input.
    fs.writeFileSync(path.join(cwd,'src/index.ts'),source.slice(0,source.indexOf('app.error('))+'export default app;');
    const defaultFastly=tc.compileFastly(tc.resolveProject({cwd,profile:'fastly-native'}));
    for(const bytes of [Buffer.from('c328','hex'),Buffer.alloc(65,255)]) {
      let writes=0;const authority=createConditionalKvAuthority();authority.stores.set('proof',new Map());
      const result=tc.executeFastlyNativePlatformCapabilities(defaultFastly,{request:{method:'POST',path:'/raw',body:bytes,chunkBytes:1},conditionalKv:{authority,onCall(stage){if(stage==='insert')writes++;}}});
      assert.equal(result.response.status,bytes.length>64?413:400);assert.equal(writes,0);
      rows.push({mode:'fastly-native',case:'default-body-error',status:result.response.status,writes});
    }
    for(const target of ['native','javascript']) {
      const active=await tc.startDevServer(tc.resolveProject({cwd,profile:`node-${target}`}),{port:0,watch:false});
      try {const response=await send(active.ready.url,'/raw',Buffer.from('c328','hex'));assert.equal(response.status,target==='javascript'?500:400,`${target} default: ${JSON.stringify(response)}`);rows.push({mode:`node-${target}-http`,case:'default-body-error',status:response.status,parityDebt:target==='javascript'});}
      finally{active.server.closeAllConnections();await new Promise(resolve=>active.server.close(resolve));}
    }
    const result={status:'passed',providerReality:false,sourceSha256:hash(source),fastlyWasmSha256:hash(fastly.wasm),rows};
    if(!options.quiet)console.log(JSON.stringify(result));return result;
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
if(require.main===module)main({packedRoot:process.argv[2]}).catch(error=>{console.error(error);console.error(JSON.stringify(error.diagnostics));process.exitCode=1;});
