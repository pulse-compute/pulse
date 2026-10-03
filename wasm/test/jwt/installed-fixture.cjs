'use strict';
const crypto = require('node:crypto');

// Fresh test-only authority. Private material stays in the temporary harness,
// never in application source, build inputs, diagnostics or acceptance reports.
function fixture(algorithm) {
  const pairs = ['old', 'new'].map(kid => {
    if (algorithm === 'HS256') return { kid, secret: crypto.randomBytes(32).toString('hex') };
    const pair = algorithm === 'ES256'
      ? crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { kid, pair, secret: JSON.stringify(pair.privateKey.export({ format: 'jwk' })),
      public: { ...pair.publicKey.export({ format: 'jwk' }), kid } };
  });
  const secrets = { OLD_KEY: pairs[0].secret, NEW_KEY: pairs[1].secret, BAD_KEY: 'invalid-test-key' };
  const options = index => ({ algorithm, key: { type: 'secret', binding: index ? 'NEW_KEY' : 'OLD_KEY' }, kid: pairs[index].kid, expiresInSeconds: 600 });
  const verifyOptions = (mode = 'overlap') => ({ algorithms: [algorithm],
    key: algorithm === 'HS256' ? { type: 'secret', binding: mode === 'overlap' ? 'OLD_KEY' : 'NEW_KEY' }
      : { type: 'jwks', keys: mode === 'overlap' ? pairs.map(p => p.public) : mode === 'retired' ? [pairs[1].public] : [{ ...pairs[1].public, kid: 'old' }, { ...pairs[0].public, kid: 'decoy' }] },
    issuer: 'issuer', audience: 'worker', requiredClaims: ['sub', 'iat', 'exp'] });
  const json = JSON.stringify;
  const claims = { iss: 'issuer', aud: 'worker', sub: 'worker' };
  let source = `import { Pulse } from '@pulse-compute/pulse'; import { jwt } from '@pulse-compute/jwt';
const app = new Pulse({auto:true});
app.get('/health', async ctx => ctx.text('healthy'));
`;
  for (const i of [0, 1]) {
    source += `app.get('/sign-${pairs[i].kid}', async ctx => { const token = await jwt.sign(ctx, ${json(claims)}, ${json(options(i))}); return ctx.text(token); });\n`;
  }
  source += `app.get('/sign-bad', async ctx => { const token = await jwt.sign(ctx, ${json(claims)}, ${json({ ...options(0), key: {type:'secret',binding:'BAD_KEY'} })}); return ctx.text(token); });\n`;
  for (const mode of ['overlap', 'retired', 'wrong-key']) source += `app.get('/${mode}', async ctx => { const result = await jwt.verify(ctx, jwt.bearer(ctx.req), ${json(verifyOptions(mode))}); return ctx.text(result.claims.sub); });\n`;
  source += "app.error(async (error, ctx, next) => ctx.text('denied', {status:401}));\nexport default app;\n";
  function token(index, kid = pairs[index].kid) {
    const input = Buffer.from(json({alg:algorithm,typ:'JWT',kid})).toString('base64url') + '.'
      + Buffer.from(json({...claims,iat:Math.floor(Date.now()/1000)-5,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    const signature = algorithm === 'HS256' ? crypto.createHmac('sha256', pairs[index].secret).update(input).digest()
      : crypto.sign('sha256', Buffer.from(input), algorithm === 'ES256' ? {key:pairs[index].pair.privateKey,dsaEncoding:'ieee-p1363'} : pairs[index].pair.privateKey);
    return input + '.' + signature.toString('base64url');
  }
  const old = token(0), current = token(1);
  const rows = [];
  function add(name, route, bearer, denied = false, override = {}) {
    rows.push({name,request:{method:'GET',path:route,...(bearer?{headers:{authorization:'Bearer '+bearer}}:{})},secrets:{...secrets,...override},expect:{status:denied?401:200,...(denied?{text:'denied'}:route.startsWith('/sign-')?{}:{text:'worker'})}});
  }
  add('issue old', '/sign-old'); add('issue new', '/sign-new');
  add('accept old during overlap', '/overlap', old);
  add('accept new during overlap', '/overlap', current, false, algorithm === 'HS256' ? {OLD_KEY:secrets.NEW_KEY} : {});
  add('reject retired old key', '/retired', old, true); add('accept retained new key', '/retired', current);
  add('selected wrong key never retries', '/wrong-key', old, true);
  add('reject signature mutation', '/overlap', old.slice(0,-12)+'AAAAAAAAAAAA', true);
  add('reject malformed signing key', '/sign-bad', null, true);
  add('healthy issuance after failures', '/sign-new');
  return { algorithm, source, rows, secrets, pairs, old, current, verifyOptions, options,
    crypto: algorithm === 'HS256' ? ['HS256','HMAC-SHA256'] : [algorithm],
    validate(value) {
      const [h,p,s]=value.split('.'), input=Buffer.from(h+'.'+p), signature=Buffer.from(s,'base64url');
      return algorithm==='HS256'
        ? crypto.timingSafeEqual(crypto.createHmac('sha256',pairs[1].secret).update(input).digest(),signature)
        : crypto.verify('sha256',input,algorithm==='ES256'?{key:pairs[1].pair.publicKey,dsaEncoding:'ieee-p1363'}:pairs[1].pair.publicKey,signature);
    } };
}
module.exports = { fixture };
