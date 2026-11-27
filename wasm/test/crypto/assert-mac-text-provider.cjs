#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {executeMacText,createJavascriptMacText}=require('../../../packages/crypto/src/provider.cjs');
const {bindNativeMacTextVerifier}=require('../../../packages/crypto/pulsewasm.native.cjs');
const corpus=require('./mac-text-v1.json');
const expand=spec=>spec&&typeof spec==='object'&&spec.repeat!==undefined?spec.repeat.repeat(spec.count)+(spec.suffix||''):spec;
const secret=spec=>spec?.bytes!==undefined?new Uint8Array(spec.count).fill(spec.bytes):expand(spec);
const effect=(message,tag,algorithm='HS256')=>({package:'@pulse-compute/crypto',contractId:'pulse.crypto',providerKind:'crypto',kind:'crypto.verifyMacText',capability:'crypto.verifyMacText',operation:'verifyMacText',payload:{algorithm,key:{type:'secret',binding:'REQUEST_PROOF_KEY'},message,tag}});
const selected={automaticFallback:false,algorithms:[{algorithm:'HS256',realization:'guest-source:pulse-hmac-as',implementation:'pulse-hmac-as.v1',available:true}]};
async function main(){
  const rows=corpus.vectors.map(v=>({...v,expected:'valid'}));
  for(const c of corpus.cases){const row={...corpus.vectors.find(v=>v.id===c.vector),...c.overrides,id:c.id,expected:c.expected};if(c.flipTagByte!==undefined){const bytes=Buffer.from(row.tag,'hex');bytes[c.flipTagByte]^=1;row.tag=bytes.toString('hex');}rows.push(row);}
  for(const row of rows){
    let calls=0;
    const lookup=()=>{calls++;if(row.state==='lookup-failed')throw Error('PRIVATE LOOKUP');return secret(row.secret)};
    const subtle=row.state==='unavailable'?null:row.state==='verify-failed'?{importKey:webcrypto.subtle.importKey.bind(webcrypto.subtle),verify(){throw Error('PRIVATE VERIFY')}}:webcrypto.subtle;
    const result=await createJavascriptMacText({secretLookup:lookup,macSubtle:subtle})(effect(expand(row.message),row.tag,row.algorithm));
    assert.deepEqual(result,{status:row.expected},row.id);assert.ok(Object.isFrozen(result));
    if(['invalid-input','too-large','unavailable'].includes(row.expected))assert.equal(calls,0,row.id);
  }
  const base=rows[1], input=effect(base.message,base.tag), owned=new Uint8Array(32).fill(42);
  let staged;
  for(const outcome of [{status:'valid'},{status:'valid',key:'PRIVATE'},undefined,'throw']){
    const result=await executeMacText(input,{secretLookup:()=>owned,cryptoRealization:selected,cryptoVerifier:{macText:{verify(request){staged=request;assert.notEqual(request.key.bytes,owned);if(outcome==='throw')throw Error('PRIVATE');return outcome}}}});
    assert.equal(result.status,outcome?.status==='valid'&&!outcome.key?'valid':'realization-failure');
    for(const bytes of [staged.key.bytes,staged.data,staged.tag])assert.ok(bytes.every(b=>b===0),'owned staging wiped');
    assert.ok(owned.every(b=>b===42),'provider storage unchanged');
  }
  for(const value of [null,undefined,{},[],31,new Uint8Array(31),new Uint8Array(4097),'\ud800'.repeat(32),'é'.repeat(2049)])assert.deepEqual(await createJavascriptMacText({secretLookup:()=>value})(input),{status:'invalid-key'});
  let calls=0;
  for(const options of [{},{cryptoRealization:selected},{cryptoRealization:{algorithms:[{...selected.algorithms[0],algorithm:'HMAC-SHA256'}]},cryptoVerifier:{macText:{verify(){throw Error('must not call')}}}}]){
    assert.deepEqual(await executeMacText(input,{...options,secretLookup(){calls++;return owned}}),{status:'unavailable'});
  }
  assert.equal(calls,0);
  for(const subtle of [null,{}, {importKey(){throw Error('PRIVATE IMPORT')},verify(){return true}}, {importKey(){return {}},verify(){return 'true'}}]){
    const result=await createJavascriptMacText({secretLookup:()=>owned,macSubtle:subtle})(input);
    assert.equal(result.status,typeof subtle?.verify==='function'?'realization-failure':'unavailable');
  }
  // Host catches a Wasm trap and erases the reusable borrowed frame. Also
  // reacquire memory after growth, never retain a detached pre-call view.
  const memory=new WebAssembly.Memory({initial:3});
  const exports={memory,pulse_crypto_bytes_frame_v1:()=>1024,pulse_crypto_hs256_verify(){memory.grow(1);throw new WebAssembly.RuntimeError('injected trap')}};
  const native=bindNativeMacTextVerifier(exports);
  assert.throws(()=>native.verify({key:{bytes:owned},data:new Uint8Array(65536).fill(5),tag:new Uint8Array(32).fill(9)}),WebAssembly.RuntimeError);
  assert.ok(new Uint8Array(memory.buffer,1024,73760).every(b=>b===0));
  // Pending lookup/verification cancellation outranks every projected status.
  for(const stage of ['lookup','verify']){
    const abort=new AbortController();let release,entered;
    const pending=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
    const work=executeMacText(input,{signal:abort.signal,secretLookup:()=>{if(stage==='lookup'){entered();return pending}return owned},cryptoRealization:selected,cryptoVerifier:{macText:{verify(request){staged=request;entered();return pending}}}});
    await started;abort.abort(new Error('MAC cancellation'));release(stage==='lookup'?owned:{status:'valid'});
    await assert.rejects(work,/MAC cancellation/);
    if(stage==='verify')for(const bytes of [staged.key.bytes,staged.data,staged.tag])assert.ok(bytes.every(b=>b===0));
  }
  // Separate requests may overlap even though author-level parallel MAC calls
  // remain inadmissible. Owned buffers never alias between pending invocations.
  const captures=[],releases=[];
  const concurrentOptions={secretLookup:()=>owned,cryptoRealization:selected,cryptoVerifier:{macText:{verify(request){captures.push(request);return new Promise(resolve=>releases.push(resolve))}}}};
  const first=executeMacText(input,concurrentOptions),second=executeMacText(input,concurrentOptions);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(captures.length,2);assert.notEqual(captures[0].key.bytes,captures[1].key.bytes);
  releases[0]({status:'valid'});await first;
  assert.ok(captures[0].key.bytes.every(b=>b===0));assert.ok(captures[1].key.bytes.every(b=>b===42));
  releases[1]({status:'invalid-authenticator'});await second;assert.ok(captures[1].key.bytes.every(b=>b===0));
  const {verifyMacText}=await import('../../../packages/crypto/dist/index.js');
  for(const execute of [require('../../../packages/provider-node/src/javascript/runtime-host.js').executeNodeJavascriptApplication,require('../../../packages/provider-fastly/src/javascript/runtime-host.js').executeFastlyJavascriptApplication]){
    let release,entered,projection=0,staging;
    const pending=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve}),abort=new AbortController();
    const task=execute(async ctx=>{const r=await verifyMacText(ctx,base.message,base.tag,{algorithm:'HS256',key:{type:'secret',binding:'REQUEST_PROOF_KEY'}});projection++;return ctx.json(r)},new Request('https://mac.test/'),{
      strict:false,signal:abort.signal,capabilities:{secret:()=>owned},bindings:{secretStore:'app_secrets'},apis:{SecretStore:class{get(){return{plaintext:()=>owned}}}},
      macSubtle:{importKey:async(_format,bytes)=>{staging=bytes;return{}},verify(){entered();return pending}}
    });
    await started;abort.abort(Error('request aborted'));await assert.rejects(task,/request aborted/);release(true);release(false);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(projection,0,'late/duplicate completion cannot resume author code');
    assert.ok(new Uint8Array(staging).every(b=>b===0));
  }
  console.log('ok - 40 corpus outcomes, explicit authority, validation precedence, snapshots, failures, frame trap cleanup, cancellation and late completion');
}
main().catch(error=>{console.error(error);process.exitCode=1});
