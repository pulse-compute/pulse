'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const {createConditionalKvAuthority} = require('../../../packages/provider-fastly/src/testing/conditional-kv-host.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main(packedRoot) {
  const installed = createRequire(path.join(packedRoot, 'package.json'));
  const tc = acceptanceToolchain(packedRoot);
  const fixture = path.resolve(__dirname, '../fixtures/projects/bounded-read-loops');
  const cwd = fs.mkdtempSync(path.join(packedRoot, 'read-loop-'));
  const checks = [];
  try {
    fs.cpSync(path.join(fixture, 'src'), path.join(cwd, 'src'), {recursive:true});
    fs.cpSync(path.join(fixture, '.pulse'), path.join(cwd, '.pulse'), {recursive:true});
    const entry = path.join(cwd, 'src/index.ts');
    let source = fs.readFileSync(entry, 'utf8').replace("  return ctx.text(state.visits +", "  if(state.visits===64&&key!=='')return ctx.text('incomplete',{status:409})\n  return ctx.text(state.visits +");
    source = source.replace('export default app', `app.get('/kv',async(ctx)=>{let key=ctx.req.header('x-start')||'';let count=0;
      for(let i=0;i<64&&key!=='';i++){const row=await ctx.kv<{next:string}>('pages').getVersioned(key);if(row.status!=='found')return ctx.text('unavailable',{status:503});key=row.value.next;count++}
      if(key!=='')return ctx.text('incomplete',{status:409});return ctx.text(''+count)});\nexport default app`);
    source=source.replace('export default app',`app.post('/copy',async(ctx)=>{const input=await ctx.req.text();let output='';
      for(let chunk=0;chunk<512;chunk++){let part='';for(let slot=0;slot<64;slot++){const i=chunk*64+slot;if(i>0&&i+1<input.length)part+=input[i]}output+=part}
      return ctx.text(output)});\nexport default app`);
    fs.writeFileSync(entry, source);
    const config = path.join(cwd, '.pulse/config.ts');
    fs.writeFileSync(config, fs.readFileSync(config,'utf8').replace("secretStore: 'app_secrets',", "secretStore: 'app_secrets', kv: { pages: 'pages' },"));
    const projects = Object.fromEntries(['node','javascript','fastly'].map(profile=>[profile,tc.resolveProject({cwd,profile})]));
    const native = tc.compileNativeProjectInMemory(projects.node);
    const js = tc.prepareJavascriptApplication(projects.javascript);
    const fastly = tc.compileFastly(projects.fastly);
    const codecs = installed('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(native.plan.schemas.registry);
    const nodeModule = path.dirname(installed.resolve('@pulse-compute/provider-node/toolchain'));
    const {createNodeKvReference} = installed(path.join(nodeModule,'runtime/conditional-kv.js'));
    const secrets = {S3_ID:'fixture-id',S3_KEY:'fixture-secret-012345678901234567890123456789'};
    const pages = n => Array.from({length:n},(_,i)=>({next:i+1<n?'p'+(i+2):'',action:'',values:[1]}));
    const rows = [
      {name:'zero',pages:[],body:'0:0::99'},
      {name:'one',pages:pages(1),body:'1:101::99'},
      {name:'pure-inner-loop',pages:[{next:'',action:'',values:[1,-1,2,99]}],body:'1:103::99'},
      {name:'continue-and-break',pages:[{next:'p2',action:'continue',values:[1]},{next:'p3',action:'break',values:[2]}],body:'2:3:p3:99'},
      {name:'early-return',pages:[{next:'p2',action:'return',values:[3]}],body:'found:0:3'},
      {name:'exact-64',pages:pages(64),body:'64:6464::99'},
      {name:'65-incomplete',pages:pages(65),reads:64,body:'incomplete',status:409},
      {name:'cycle-incomplete',pages:[{next:'p1',action:'continue',values:[1]}],reads:64,body:'incomplete',status:409},
      {name:'missing-page',pages:pages(4),missing:2,reads:2,body:'unavailable',status:503},
      {name:'failed-page',pages:pages(4),failed:2,reads:2,body:'unavailable',status:503},
    ];
    for (const target of ['node','javascript','fastly']) {
      for(const row of rows) {
        const urls=[];
        const request={method:'GET',path:'/pages',url:'https://app.example.invalid/pages',headers:[['x-start',row.pages.length?'p1':'']],body:''};
        const responses=Object.fromEntries(row.pages.map((page,i)=>['https://objects.example.invalid/pages/p'+(i+1), {status:i+1===row.missing?404:i+1===row.failed?500:200,body:JSON.stringify(page)}]));
        const fetchImplementation=async(input,init)=>{const r=new Request(input,init);urls.push(r.url);const response=responses[r.url];assert.ok(response);return new Response(response.body,{status:response.status})};
        let response;
        if(target==='node') {const result=await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects.node.providerConfig,{request,strict:false,secrets,fetchImplementation}));response=result.response;assert.equal(result.effectCount,urls.length*2-(row.missing||row.failed?1:0));}
        if(target==='javascript'){const result=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{headers:request.headers}),{strict:false,schemaCodecs:codecs,secrets,s3:projects.javascript.providerConfig.bindings.s3,fetchImplementation});response={status:result.status,body:await result.text()};}
        if(target==='fastly'){response=tc.executeFastlyNativePlatformCapabilities(fastly,{request,secrets,secretStore:'app_secrets',fixtures:Object.fromEntries(Object.entries(responses).map(([url,r])=>['GET '+url,{...r,headers:[['content-length',String(Buffer.byteLength(r.body))]]}])),onOutboundRequest:r=>urls.push(r.url)}).response;}
        assert.equal(response.status,row.status||200,target+'/'+row.name);assert.equal(response.body,row.body,target+'/'+row.name);
        const count=row.reads??row.pages.length;assert.equal(urls.length,count);
        assert.deepEqual(urls,Array.from({length:count},(_,i)=>'https://objects.example.invalid/pages/p'+(row.name==='cycle-incomplete'?1:i+1)));
        checks.push({target,name:row.name,reads:count,status:'passed'});
      }
      for(const count of [0,1,64,65]) {
        const reference=createNodeKvReference({kvInstanceId:'packed-read-loop'}),authority=createConditionalKvAuthority();authority.stores.set('pages',new Map());
        for(let i=0;i<count;i++){const value={next:i+1<count?'p'+(i+2):''};await reference.kv('pages').put('p'+(i+1),value);authority.seed('pages','p'+(i+1),JSON.stringify({__pulseKv:1,value}));}
        const request={method:'GET',path:'/kv',url:'https://app.example.invalid/kv',headers:[['x-start',count?'p1':'']],body:''};let response;
        if(target==='node')response=(await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects.node.providerConfig,{request,strict:false,kvReference:reference}))).response;
        if(target==='javascript'){const r=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{headers:request.headers}),{strict:false,kvReference:reference});response={status:r.status,body:await r.text()};}
        if(target==='fastly')response=tc.executeFastlyNativePlatformCapabilities(fastly,{request,conditionalKv:{authority}}).response;
        assert.equal(response.status,count===65?409:200);assert.equal(response.body,count===65?'incomplete':String(count));checks.push({target,name:'kv-'+count,status:'passed'});
      }
    }
    // A valid escaped field must coexist with a read-loop route. Copying bounded
    // chunks preserves its exact bytes without quadratic full-output prefixes.
    for(const target of ['node','javascript','fastly']) {
      const body=JSON.stringify({reason:'\u0001'.repeat(4000)});
      const request={method:'POST',path:'/copy',url:'https://app.example.invalid/copy',headers:[],body};let response;
      if(target==='node')response=(await tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions(projects.node.providerConfig,{request,strict:false}))).response;
      if(target==='javascript'){const r=await tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{method:'POST',body}),{strict:false});response={status:r.status,body:await r.text()};}
      if(target==='fastly')response=tc.executeFastlyNativePlatformCapabilities(fastly,{request}).response;
      assert.equal(response.status,200);assert.equal(response.body,body.slice(1,-1));checks.push({target,name:'bounded-escaped-field-copy',status:'passed'});
    }
    for(const target of ['node','javascript']) {
      const request={method:'GET',path:'/pages',url:'https://app.example.invalid/pages',headers:[['x-start','p1']],body:''};
      const run=(fetchImplementation,options)=>target==='node'?tc.executeCanonicalNativeModule(native.native,tc.driver.executionOptions({...projects.node.providerConfig,maxDurationMs:options?.maxDurationMs},{request,strict:false,secrets,fetchImplementation,...options})):tc.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{headers:request.headers}),{strict:false,schemaCodecs:codecs,secrets,s3:projects.javascript.providerConfig.bindings.s3,fetchImplementation,...options});
      let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({next:'p2',action:'',values:[1]}));};
      const limited=run(fetcher,{maxEffects:3});
      if(target==='node')await assert.rejects(limited,{code:'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED'});else assert.equal((await limited).status,500);
      assert.equal(calls,2);checks.push({target,name:'cumulative-effects',status:'passed'});
      let time=0;const timers=new Map();calls=0;
      const clock={now:()=>time,setTimeout(fn,ms){const id={};timers.set(id,{fn,at:time+ms});return id},clearTimeout(id){timers.delete(id)}};
      await assert.rejects(run(async()=>{calls++;time+=4;for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.fn()}return new Response(JSON.stringify({next:'p2',action:'',values:[1]}));},{maxDurationMs:10,requestClock:clock}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
      assert.equal(calls,3);assert.equal(timers.size,0);checks.push({target,name:'cumulative-deadline',status:'passed'});
      for(const lateFailure of [false,true]) {
        calls=0;const abort=new AbortController();let ready,settle;const admitted=new Promise(resolve=>{ready=resolve});
        const pending=run(async()=>{if(++calls===1)return new Response(JSON.stringify({next:'p2',action:'',values:[1]}));ready();return new Promise((resolve,reject)=>{settle=()=>lateFailure?reject(new Error('late')):resolve(new Response('{}'))});},{signal:abort.signal});
        const rejected=assert.rejects(pending,e=>/CANCELLED|ABORTED/.test(e.code)||e.name==='AbortError');await admitted;abort.abort();await rejected;settle();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);checks.push({target,name:'cancel-late-'+lateFailure,status:'passed'});
      }
    }
    assert.equal(checks.length,53);
    return {status:'passed',checks,providerReality:false,artifacts:{node:hash(native.native.wasm),fastly:hash(fastly.wasm)}};
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main};
