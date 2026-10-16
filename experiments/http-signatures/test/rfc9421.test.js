import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { createSignatureBase, signMessage, verifyMessage } from '../src/index.js';

// RFC 9421 Appendix B.2.5 public HMAC vector (not a production key).
const message = {url:'https://example.com/foo?param=Value&Pet=dog', method:'POST',
  headers:{ date:'Tue, 20 Apr 2021 02:07:55 GMT', 'content-type':'application/json' }};
const components = ['date', '@authority', 'content-type'];
const params = {created:1618884473, keyid:'test-shared-secret'};
const key = new TextEncoder().encode('example-test-key-that-is-32-byte-long');
const rfcKey = new Uint8Array(Buffer.from('uzvJfB4u3N0Jy4T7NZ75MDVcr8zSTInedJtkgcu46YW4XByzNJjxBdtjUkdJPBtbmHhIDi6pcl8jsasjlTMtDQ==', 'base64'));
const signatureBase = '"date": Tue, 20 Apr 2021 02:07:55 GMT\n"@authority": example.com\n"content-type": application/json\n"@signature-params": ("date" "@authority" "content-type");created=1618884473;keyid="test-shared-secret"';
const rfcSignature = 'sig-b25=:pxcQw6G3AjtMBQjwo8XzkZf/bws5LelbaMk5rGIGtE8=:';

test('RFC 9421 B.2.5 exact signature base and HMAC', async () => {
  assert.equal(createSignatureBase(message,{components,params}), signatureBase);
  const signed = await signMessage(message, {label:'sig-b25',components,params,key:rfcKey,crypto:webcrypto});
  assert.equal(signed.signature, rfcSignature);
  assert.equal(signed.signatureInput, 'sig-b25=("date" "@authority" "content-type");created=1618884473;keyid="test-shared-secret"');
  assert.equal(await verifyMessage(message,{...signed,label:'sig-b25',key:rfcKey,requiredKeyId:'test-shared-secret',requiredComponents:components,nowSeconds:1618884473,maxAgeSeconds:30,crypto:webcrypto}),true);
});

test('fail closed on altered covered component, missing coverage, freshness, algorithm and keyid', async () => {
  const params2 = {created:2000000000,keyid:'test-key',alg:'hmac-sha256'};
  const signed = await signMessage(message,{components:['@method','@target-uri','date'],params:params2,key,crypto:webcrypto});
  const policy={...signed,label:'sig1',key,requiredKeyId:'test-key',requiredComponents:['@method','@target-uri'],nowSeconds:2000000000,maxAgeSeconds:30,crypto:webcrypto};
  assert.equal(await verifyMessage(message,policy),true);
  assert.equal(await verifyMessage({...message,method:'GET'},policy),false);
  assert.equal(await verifyMessage(message,{...policy,requiredComponents:['content-digest']}),false);
  assert.equal(await verifyMessage(message,{...policy,nowSeconds:2000000031}),false);
  assert.equal(await verifyMessage(message,{...policy,requiredKeyId:'other-key'}),false);
  assert.equal(await verifyMessage(message,{...policy,signatureInput:signed.signatureInput.replace('hmac-sha256','ed25519')}),false);
  assert.equal(await verifyMessage(message,{...policy,signature:signed.signature.replace('=', '=AA')}),false);
});

test('reject unsafe coverage, malformed SF and ambiguous wire signatures', async () => {
  assert.throws(()=>createSignatureBase(message,{components:['@method','@method'],params}),/Repeated/);
  assert.throws(()=>createSignatureBase(message,{components:['content-type;sf'],params}),/Unsupported/);
  assert.throws(()=>createSignatureBase(message,{components:['missing-field'],params}),/Missing/);
  assert.throws(()=>createSignatureBase(message,{components:['@signature-params'],params}),/Unsupported/);
  const p={components,params,key:rfcKey,crypto:webcrypto,label:'sig-b25'};
  const signed=await signMessage(message,p);
  const policy={...signed,label:'sig-b25',key:rfcKey,requiredKeyId:'test-shared-secret',requiredComponents:components,nowSeconds:1618884473,maxAgeSeconds:30,crypto:webcrypto};
  assert.equal(await verifyMessage(message,{...policy,signatureInput:signed.signatureInput+', sig-b25=("date")'}),false);
  assert.equal(await verifyMessage(message,{...policy,signatureInput:signed.signatureInput.replace('"date"', '"date";sf')}),false);
  assert.equal(await verifyMessage(message,{...policy,signatureInput:signed.signatureInput.replace('created=1618884473','created=1618884473;created=1618884473')}),false);
});

test('reject non-ASCII raw signed header bytes', () => {
  assert.throws(()=>createSignatureBase({...message,headers:{date:'Tüe', 'content-type':'application/json'}},{components,params}), /Invalid HTTP field/);
});


test('select one labeled signature in a multi-signature dictionary', async () => {
  const first = await signMessage(message,{label:'first',components,params,key:rfcKey,crypto:webcrypto});
  const second = await signMessage(message,{label:'second',components:['@method','@query'],params:{created:1618884473,keyid:'test-shared-secret'},key:rfcKey,crypto:webcrypto});
  const both={signatureInput:first.signatureInput+', '+second.signatureInput,signature:first.signature+', '+second.signature};
  assert.equal(await verifyMessage(message,{...both,label:'second',key:rfcKey,requiredKeyId:'test-shared-secret',requiredComponents:['@method','@query'],nowSeconds:1618884473,maxAgeSeconds:30,crypto:webcrypto}),true);
  assert.equal(await verifyMessage({...message,url:'https://example.com/foo?param=changed'}, {...both,label:'second',key:rfcKey,requiredKeyId:'test-shared-secret',requiredComponents:['@method','@query'],nowSeconds:1618884473,maxAgeSeconds:30,crypto:webcrypto}), false);
});

test('response status and empty query follow RFC derived-component rules', async () => {
  assert.equal(createSignatureBase({status:200,headers:{'content-type':'application/json'}},{components:['@status'],params}), '"@status": 200\n"@signature-params": ("@status");created=1618884473;keyid="test-shared-secret"');
  assert.match(createSignatureBase({method:'GET',url:'https://example.com/',headers:{}},{components:['@query'],params}), /"@query": \?/);
  assert.throws(()=>createSignatureBase({...message,status:200},{components:['@status'],params}),/Status/);
  assert.throws(()=>createSignatureBase({status:200,url:message.url},{components:['@method'],params}),/HTTP method/);
  await assert.rejects(()=>signMessage(message,{components,params:{...params,alg:'ed25519'},key:rfcKey,crypto:webcrypto}),/Unsupported algorithm/);
});
