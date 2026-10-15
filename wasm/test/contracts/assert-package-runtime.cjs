'use strict';
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { capturePackageHttp, closePackageHttp, capturePackageRequest, normalizePackageBindings,
  executePackageOperation, validateRuntimeArtifact } = require('../../../packages/provider-node/src/runtime/package-operations.js');

// An independent, tiny ABI consumer. No protocol package or lowerer registration.
function moduleBytes(status = 2, repeat = false, maximum = 32) {
  const u = n => { const a = []; do { const b = n & 127; n >>>= 7; a.push(b | (n ? 128 : 0)); } while(n); return a; };
  const s = n => { const a = u(n); if (a.at(-1) & 64) a.push(0); return a; };
  const vec = xs => [ ...u(xs.length), ...xs.flat() ];
  const str = x => [ ...u(x.length), ...Buffer.from(x) ];
  const section = (id, bytes) => [id, ...u(bytes.length), ...bytes];
  const names = ['start','resume','buffer','capacity','output_ptr','output_len','aux_ptr','aux_len'];
  const values = [status, repeat ? status : 0, 4096, 65536, 1024, 15, 2048, 32];
  const code = values.map(v => { const b = [0, 0x41, ...s(v), 0x0b]; return [...u(b.length), ...b]; });
  const data = [...Buffer.from('private-message')];
  return Buffer.from([0,97,115,109,1,0,0,0,
    ...section(1, vec([[0x60,0,1,0x7f],[0x60,1,0x7f,1,0x7f]])),
    ...section(3,vec(names.map((_,i)=>[i===1?1:0]))),
    ...section(5,[1,...(maximum === null ? [0,2] : [1,2,...u(maximum)])]),
    ...section(7,vec([...names.map((n,i)=>[...str(n),0,i]),[...str('memory'),2,0]])),
    ...section(10,vec(code)), ...section(11,[1,0,0x41,...s(1024),0x0b,...u(data.length),...data])]);
}
function artifact(status = 2, repeat = false, maximum = 32) {
  const wasm = moduleBytes(status, repeat, maximum);
  return {version:'pulse.package-runtime-binding.v1',id:'independent.v1',package:'@independent/protocol',contractId:'independent.protocol',
    kind:'package-runtime-wasm',mediaType:'application/wasm',data:{abi:'pulse.package-wasm.v1',wasm:wasm.toString('base64'),
      sha256:createHash('sha256').update(wasm).digest('hex'),operations:[{name:'execute',configuration:'v1',capabilities:['http.snapshot','crypto.sha256','crypto.hmac-sha256']}]}};
}
const binding = {package:'@independent/protocol',contractId:'independent.protocol',artifact:'independent.v1',operations:['execute'],
  secret:'PRIVATE_KEY',keyId:'test-key',keyVersion:'1',trustDomain:'test',origin:'https://example.test'};
const effect = {kind:'package.invoke',providerKind:'package',operation:'invoke',capability:'package.invoke',result:'string',
  package:binding.package,contractId:binding.contractId,payload:{artifact:binding.artifact,binding:'test',operation:'execute',configuration:'v1'}};
const request = {method:'pOsT',target:'/a/../b?x=%2f',headers:[['X-Test','one'],['x-test','two']],body:Buffer.from('original-body')};
const key = 'this-is-a-private-test-key-32-bytes';
const realization = {algorithms:['SHA-256','HMAC-SHA256'].map(algorithm=>({algorithm,available:true,realization:'guest-source:pulse-hmac-as'}))};
async function main() {
  validateRuntimeArtifact(artifact());
  for (const max of [null,33]) assert.throws(()=>validateRuntimeArtifact(artifact(2,false,max)));
  for (const change of [a=>a.version='v2',a=>a.data.abi='v2',a=>a.data.sha256='0'.repeat(64),a=>a.data.operations[0].capabilities.push('ambient.secret')]) {
    const a=artifact();change(a); assert.throws(()=>validateRuntimeArtifact(a));
  }
  assert.throws(()=>normalizePackageBindings({test:{...binding,secretBytes:key}}));
  assert.throws(()=>capturePackageHttp({...request,body:new Uint8Array(65537)},{origin:binding.origin,direction:'inbound'}));
  for (const target of ['https://example.test/a','//other/a','/a#b','/a\\b','/a b']) assert.throws(()=>capturePackageHttp({...request,target},{origin:binding.origin,direction:'inbound'}));
  let keyReads=0, calls=0, keyCopy, messageCopy;
  const snapshot=capturePackageHttp(request,{origin:binding.origin,direction:'inbound'});
  const options={packageBindings:{test:binding},packageArtifacts:[artifact()],packageHttp:snapshot,cryptoRealization:realization,
    cryptoVerifier:{bytes:{sha256:async data=>new Uint8Array(createHash('sha256').update(data).digest()),
      hmacSha256:async(k,data)=>{calls++;keyCopy=k;messageCopy=data;return new Uint8Array(createHmac('sha256',k).update(data).digest());}}}};
  const lookup=async name=>{keyReads++;assert.equal(name,'PRIVATE_KEY');return key;};
  assert.equal(await executePackageOperation(effect,options,lookup),'private-message');
  assert.equal(keyReads,1);assert.equal(calls,1);
  assert.ok(keyCopy.every(n=>n===0));assert.ok(messageCopy.every(n=>n===0));
  for (const extra of [{packageHttp:{}},{packageHttp:undefined},{packageBindings:{}},{packageArtifacts:[]},
    {packageArtifacts:[artifact(),artifact()]},{cryptoRealization:{}},{packageBindings:{test:{...binding,origin:'https://other.test'}}}]) {
    await assert.rejects(executePackageOperation(effect,{...options,...extra},lookup),{message:'Package operation could not complete.'});
  }
  for (const payload of [{...effect.payload,key},{...effect.payload,configuration:'changed'},{...effect.payload,operation:'other'}]) {
    await assert.rejects(executePackageOperation({...effect,payload},options,lookup));
  }
  const denied=artifact();denied.data.operations[0].capabilities=[];
  await assert.rejects(executePackageOperation(effect,{...options,packageArtifacts:[denied]},lookup),{code:'PULSE_PACKAGE_CAPABILITY_UNAVAILABLE'});
  const before=calls;
  await assert.rejects(executePackageOperation(effect,{...options,packageArtifacts:[artifact(2,true)]},lookup));
  assert.equal(calls-before,4,'bounded crypto command count');
  await assert.rejects(executePackageOperation(effect,options,async()=>{throw new Error(key);}),error=>!String(error).includes(key));
  // Cancellation during a host await must never resume or return a completed result.
  const controller=new AbortController();let release, entered;
  const pendingCrypto=new Promise(r=>entered=r), cancellation=new Error('request cancelled');
  const cancelled=executePackageOperation(effect,{...options,signal:controller.signal,
    cryptoVerifier:{bytes:{hmacSha256:async(k,data)=>{keyCopy=k;messageCopy=data;entered();return new Promise(r=>release=r);}}}},lookup);
  await pendingCrypto; controller.abort(cancellation);const late=new Uint8Array(32).fill(9);release(late);
  await assert.rejects(cancelled,error=>error===cancellation);
  assert.ok(keyCopy.every(n=>n===0));assert.ok(messageCopy.every(n=>n===0));assert.ok(late.every(n=>n===0));
  const closed=executePackageOperation(effect,options,async()=>{closePackageHttp(snapshot);return key;});
  await assert.rejects(closed,{code:'PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE'});
  await assert.rejects(executePackageOperation(effect,options,lookup),{code:'PULSE_PACKAGE_SNAPSHOT_UNAVAILABLE'});
  // The provider capture hook accepts transport originals and owns handle disposal.
  const captured=capturePackageRequest({method:request.method,url:request.target,rawHeaders:request.headers.flat()},request.body,{packageBindings:{test:binding}});
  assert.equal(captured.version,'pulse.provider-package-http.v1');
  assert.equal(await executePackageOperation(effect,{...options,...captured.options},lookup),'private-message');
  captured.close();await assert.rejects(executePackageOperation(effect,{...options,...captured.options},lookup));
  console.log('Trusted package Wasm ABI, bounded grants, private staging, capture ownership and late-result fencing passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
