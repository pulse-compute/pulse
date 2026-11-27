#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const corpus = require('./mac-text-v1.json');
const expand = spec => spec && typeof spec === 'object' && spec.repeat !== undefined ? spec.repeat.repeat(spec.count) + (spec.suffix || '') : spec;
const secret = spec => spec?.bytes !== undefined ? new Uint8Array(spec.count).fill(spec.bytes) : expand(spec);
async function main() {
  const t = acceptanceToolchain();
  const cwd = fs.mkdtempSync(path.join(__dirname, '.mac02-'));
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'crypto']) fs.symlinkSync(path.resolve(__dirname, '../../../packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';import {crypto} from '@pulse-compute/crypto';
const app=new Pulse({auto:true});app.post('/',async ctx=>{
 const input=await ctx.req.json<{message:string;tag:string}>();
 const proof=await crypto.verifyMacText(ctx,input.message,input.tag,{algorithm:'HS256',key:{type:'secret',binding:'REQUEST_PROOF_KEY'}});
 return ctx.json(proof);
});export default app;`);
    const config = { pulse: { entry: 'src/index.ts', strict: false, crypto: ['HS256'] } };
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) config[`${host}-${target}`] = { host, target, schemas: { maxBytes: 1048576 }, ...(host === 'fastly' ? { fastly: { ...(target==='native'?{maxDurationMs:1000}:{}), bindings: { secretStore: 'app_secrets' } } } : {}) };
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}))`);
    const projects = Object.fromEntries(Object.keys(config).filter(p=>p!=='pulse').map(profile=>[profile,t.resolveProject({cwd,profile})]));
    for (const profile of ['node-javascript','fastly-javascript']) assert.equal(t.inspectProject(projects[profile]).provider.targetSupport.project.status,'eligible',profile);
    // A blank configured store (rather than omission, which selects the
    // provider's documented default) must be rejected. Missing secret authority must fail admission even though the primary
    // effect is crypto.verifyMacText, not a standalone secret.get site.
    const configPath=path.join(cwd,'.pulse/config.ts');
    const original=fs.readFileSync(configPath,'utf8');
    const missing=structuredClone(config);
    missing['fastly-javascript'].fastly.bindings.secretStore=' ';
    missing['fastly-native'].fastly.bindings.secretStore=' ';
    fs.writeFileSync(configPath,`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(missing)}))`);
    const denied=t.inspectProject(t.resolveProject({cwd,profile:'fastly-javascript'}));
    assert.notEqual(denied.provider.targetSupport.project.status,'eligible');
    assert.throws(()=>t.compileFastly(t.resolveProject({cwd,profile:'fastly-native'})),error=>error.code==='PULSE_FASTLY_NATIVE_SECRET_STORE_MISSING');
    fs.writeFileSync(configPath,original);
    const node=t.compileNativeProjectInMemory(projects['node-native']);
    const fastly=t.compileFastly(projects['fastly-native']);
    const js=t.prepareJavascriptApplication(projects['node-javascript']);
    const rows=corpus.vectors.map(v=>({...v, expected:'valid'}));
    for(const c of corpus.cases){
      if(c.overrides?.algorithm || c.overrides?.state || c.id==='malformed-secret')continue; // provider fault/representation cases in the unit task
      const row={...corpus.vectors.find(v=>v.id===c.vector),...c.overrides,id:c.id,expected:c.expected};
      if(c.flipTagByte!==undefined){const bytes=Buffer.from(row.tag,'hex');bytes[c.flipTagByte]^=1;row.tag=bytes.toString('hex');}
      rows.push(row);
    }
    rows.push({id:'scalar-before-byte-limit',message:'é'.repeat(40000)+'\ud800',tag:'bad',secret:null,expected:'invalid-input'});
    let executions=0;
    for(const row of rows)for(const mode of Object.keys(projects)){
      const value=secret(row.secret), message=expand(row.message), secrets=value===null?{}:{REQUEST_PROOF_KEY:value};
      const request={method:'POST',path:'/',url:'https://mac.test/',headers:[['authorization','Bearer unchanged']],body:JSON.stringify({message,tag:row.tag})};
      let result, lookups=0;
      if(mode==='node-native') result=await t.executeCanonicalNativeModule(node.native,t.driver.executionOptions(projects[mode].providerConfig,{request,secrets,strict:false,maxRequestBodyBytes:1048576,maxStructuredBodyBytes:1048576}));
      else if(mode==='fastly-native'){
        result=t.executeFastlyNativePlatformCapabilities(fastly,{request,secrets,secretStore:'app_secrets',onSecretLookup(){lookups++}});
        const exports=result.instance.exports;
        const pointer=exports.pulse_crypto_bytes_frame_v1();
        assert.ok(new Uint8Array(exports.memory.buffer,pointer,73760).every(byte=>byte===0),`${row.id}: native frame wiped`);
      }else{
        const execute=mode==='node-javascript'?t.executeNodeJavascriptApplication:executeFastlyJavascriptApplication;
        const trace=[];
        const response=await execute(js.loaded.application,new Request(request.url,{method:'POST',body:request.body,headers:request.headers}),{strict:false,maxRequestBodyBytes:1048576,maxStructuredBodyBytes:1048576,
          capabilities:{secret(){lookups++;return value===null?undefined:value}},bindings:{secretStore:'app_secrets'},apis:{SecretStore:class{async get(){lookups++;return value===null?null:{plaintext:()=>value}}}},onEffectObservation:e=>trace.push(e)});
        result={response:{status:response.status,body:await response.text()},trace};
      }
      assert.equal(result.response.status,200,`${mode}: ${row.id}`);
      assert.deepEqual(JSON.parse(result.response.body),{status:row.expected},`${mode}: ${row.id}`);
      if(['invalid-input','too-large'].includes(row.expected)) assert.equal(lookups,0,`${mode}: validation before lookup`);
      assert.equal(JSON.stringify(result.trace).includes(row.tag),false,`${mode}: tag redacted`);
      if(typeof value==='string'&&value.length>=32)assert.equal(JSON.stringify(result.trace).includes(value),false,`${mode}: secret redacted`);
      executions++;
    }
    const vector=corpus.vectors[1], request={method:'POST',path:'/',body:JSON.stringify({message:vector.message,tag:vector.tag}),headers:[]};
    for(const [stage,fault,expected] of [['open',{status:10},'unavailable'],['open',{status:1},'realization-failure'],['get',{status:10},'invalid-key'],['get',{status:1},'realization-failure'],['plaintext',{status:1,fill:42},'realization-failure'],['plaintext',{status:4,fill:42,written:4097},'invalid-key'],['plaintext',{status:0,fill:42,written:31},'invalid-key']]){
      const result=t.executeFastlyNativePlatformCapabilities(fastly,{request,secrets:{REQUEST_PROOF_KEY:'*'.repeat(32)},secretStore:'app_secrets',secretFault:s=>s===stage?fault:undefined});
      assert.deepEqual(JSON.parse(result.response.body),{status:expected},stage);
      const e=result.instance.exports;assert.ok(new Uint8Array(e.memory.buffer,e.pulse_crypto_bytes_frame_v1(),73760).every(b=>b===0),'failure frame wiped');
    }
    // Real Node Native dispatch retains request ownership while an authorized
    // lookup is pending. Settling twice after cancellation cannot resume Wasm.
    const abort=new AbortController();let release,entered;
    const pending=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
    const nativeOptions={...t.driver.executionOptions(projects['node-native'].providerConfig,{request,secrets:{REQUEST_PROOF_KEY:'*'.repeat(32)},strict:false,signal:abort.signal})};
    const adapter=nativeOptions.providerAdapter;
    nativeOptions.providerAdapter={...adapter,dispatchEffect(effect,execution){
      if(effect.kind!=='crypto.verifyMacText')return adapter.dispatchEffect(effect,execution);
      return require('../../../packages/crypto/src/provider.cjs').executeMacText(effect,{...execution,secretLookup(){entered();return pending}});
    }};
    const cancelled=t.executeCanonicalNativeModule(node.native,nativeOptions);
    await started;abort.abort(Error('native MAC cancelled'));await assert.rejects(cancelled,/native MAC cancelled/);
    release('*'.repeat(32));release('+'.repeat(32));await new Promise(resolve=>setImmediate(resolve));
    const expired=t.executeFastlyNativePlatformCapabilities(fastly,{request,secrets:{REQUEST_PROOF_KEY:'*'.repeat(32)},secretStore:'app_secrets',secretDelayMs:1001});
    assert.equal(expired.response.status,504,'deadline outranks MAC projection');
    const e=expired.instance.exports;assert.ok(new Uint8Array(e.memory.buffer,e.pulse_crypto_bytes_frame_v1(),73760).every(b=>b===0));
    console.log(JSON.stringify({status:'passed',cases:rows.length,executions,targets:Object.keys(projects),providerReality:false}));
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
