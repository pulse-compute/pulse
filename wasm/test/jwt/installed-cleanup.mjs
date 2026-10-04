import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
import nodeJwt from '@pulse-compute/provider-node/javascript/jwt-verifier';
import { signJwtWithCrypto } from '@pulse-compute/jwt/provider';

const fixtures = JSON.parse(fs.readFileSync(new URL('./cleanup-fixtures.json', import.meta.url)));
const { createNodeJavascriptJwtVerify } = nodeJwt;
let checks = 0;
for (const fixture of fixtures) {
  const effect = { package:'@pulse-compute/jwt',contractId:'pulse.jwt',providerKind:'jwt',kind:'jwt.sign',operation:'sign',
    capability:'jwt.sign',result:'string',payload:{claims:{sub:'worker'},options:fixture.options} };
  for (const timing of ['before', 'during']) {
    const controller = new AbortController(); let clocks = 0, secrets = 0;
    if (timing === 'before') controller.abort();
    const sign = createNodeJavascriptJwtVerify({secretLookup:async()=>{secrets++;controller.abort();return fixture.secret;},
      captureWallClock:()=>{clocks++;return {trusted:true,unixEpochSeconds:1800000000};}});
    await assert.rejects(sign(effect,{signal:controller.signal}),error=>['PULSE_JWT_OPERATION_FAILED','PULSE_JWT_KEY_INVALID'].includes(error.code));
    assert.equal(clocks,0);assert.equal(secrets,timing==='before'?0:1);checks++;
  }
  // The package/provider seam owns temporary byte buffers, including when a
  // selected crypto operation throws. No fallback crypto is supplied here.
  const retained=[];
  const operation=async (key,data)=>{retained.push(key,data);throw Error('injected crypto failure');};
  const crypto={bytes:{hmacSha256:operation,es256Sign:operation,rs256Sign:operation}};
  await assert.rejects(signJwtWithCrypto(effect.payload,{
    resolveSecret:async()=>fixture.secret,
    captureWallClock:()=>({trusted:true,unixEpochSeconds:1800000000}),
    registerRedactionValue() {}
  },crypto));
  assert.ok(retained.length>0,'crypto failure must occur after temporary bytes are allocated');
  for(const bytes of retained) assert.ok(bytes instanceof Uint8Array && bytes.every(byte=>byte===0),'temporary bytes must be cleared');
  checks++;
  const healthy=createNodeJavascriptJwtVerify({secretLookup:async()=>fixture.secret,captureWallClock:()=>({trusted:true,unixEpochSeconds:1800000000})});
  const token=await healthy(effect,{});assert.equal(typeof token,'string');assert.equal(token.split('.').length,3);
  const [h,p,s]=token.split('.'), input=Buffer.from(h+'.'+p), signature=Buffer.from(s,'base64url');
  const publicKey=fixture.publicKey&&createPublicKey({key:fixture.publicKey,format:'jwk'});
  assert.ok(fixture.algorithm==='HS256'
    ? timingSafeEqual(createHmac('sha256',fixture.secret).update(input).digest(),signature)
    : verify('sha256',input,fixture.algorithm==='ES256'?{key:publicKey,dsaEncoding:'ieee-p1363'}:publicKey,signature),'independent signature verification');
  checks++;
}
console.log(JSON.stringify({status:'passed',checks,algorithms:fixtures.map(f=>f.algorithm),provider:'node-javascript',injectedCryptoFailure:true}));
