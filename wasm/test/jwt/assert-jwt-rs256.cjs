#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, verify, sign, constants, publicDecrypt, privateEncrypt } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const root = path.resolve(__dirname, '../../..');
// Share a captured clock across injected hosts; CLI harnesses use wall time.
const NOW = Math.floor(Date.now() / 1000);

async function main(bits) {
  const tc = acceptanceToolchain();
  const cwd = fs.mkdtempSync(path.join(__dirname, '.rs-sign-'));
  const pair = generateKeyPairSync('rsa', { modulusLength: bits });
  const key = pair.privateKey.export({ format: 'jwk' });
  const publicKey = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'rotation-1' };
  const secret = JSON.stringify(key);
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const external = (header = {alg:'RS256',kid:'rotation-1',typ:'JWT'}, padding) => {
    const input = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify({iss:'issuer',aud:'worker',sub:'scheduler',iat:NOW,exp:NOW+3600})).toString('base64url');
    return input + '.' + sign('sha256', Buffer.from(input), padding ? {key:pair.privateKey,padding,saltLength:32} : pair.privateKey).toString('base64url');
  };
  let executions = 0;
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'jwt']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, 'tests'));
    const harnessCases = [
      {name:'issue',request:{method:'POST',path:'/sign',body:'{}'},secrets:{SIGNING_KEY:secret},expect:{status:200}},
      {name:'verify',request:{method:'GET',path:'/verify',headers:{authorization:'Bearer '+external()}},expect:{status:200,text:'scheduler'}}
    ];
    fs.writeFileSync(path.join(cwd,'tests/pulse.harness.ts'),'export default '+JSON.stringify(harnessCases));
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    const policy = `{ algorithm: 'RS256', key: { type: 'secret', binding: 'SIGNING_KEY' }, kid: 'rotation-1', expiresInSeconds: 3600 }`;
    const source = `import { Pulse } from '@pulse-compute/pulse'; import { jwt } from '@pulse-compute/jwt';
const app = new Pulse({auto:true});
app.post('/sign', async ctx => { const claims = await ctx.req.json(); const token = await jwt.sign(ctx, claims, ${policy}); ctx.log.info(token); return ctx.text(token); });
app.get('/parallel', async ctx => { const tokens = await ctx.parallel({first:jwt.sign(ctx,{sub:'first'},${policy}),second:jwt.sign(ctx,{sub:'second'},${policy})}); return ctx.json(tokens); });
app.get('/verify', async ctx => { const result = await jwt.verify(ctx,jwt.bearer(ctx.req),{algorithms:['RS256'],key:{type:'jwks',keys:[${JSON.stringify(publicKey)},${JSON.stringify({...publicKey,kid:"rotation-2"})}]},issuer:'issuer',audience:'worker',requiredClaims:['sub','iat','exp']}); return ctx.text(result.claims.sub); });
app.get('/es', async ctx => { const token = await jwt.sign(ctx, {sub:'es'}, {algorithm:'ES256', key:{type:'secret',binding:'ES_KEY'},expiresInSeconds:60}); return ctx.text(token); });
export default app;`;
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source);
    const config = { pulse: { entry: 'src/index.ts', tests:'tests/pulse.harness.ts', defaultProfile: 'node-native', strict: false, crypto: ['RS256', 'ES256'] } };
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) config[`${host}-${target}`] = {
      host, target, ...(host === 'fastly' ? { fastly: { bindings: { secretStore: 'app_secrets' } } } : {})
    };
    const writeConfig = () => fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
    writeConfig();
    const projects = Object.fromEntries(Object.keys(config).filter(id => id !== 'pulse').map(profile => [profile, tc.resolveProject({ cwd, profile })]));
    for (const profile of Object.keys(projects).filter(id=>id.endsWith('javascript'))) {
      const inspection = tc.inspectProject(projects[profile]);
      assert.equal(inspection.provider.targetSupport.project.status, 'eligible');
    }
    // Issuance alone must not require a static verification key artifact.
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source.split('\n').filter(line => !line.startsWith("app.get('/verify'")).join('\n'));
    const signingOnly = tc.buildProject(projects['fastly-native']);
    const signingOnlyWasm = fs.readFileSync(path.join(signingOnly.outDir, 'bin/main.wasm'));
    const signed = tc.executeFastlyNativePlatformCapabilities({wasm:signingOnlyWasm}, {
      request:{method:'POST',path:'/sign',url:'https://sign.test/sign',body:'{}'},
      secrets:{SIGNING_KEY:secret},clockUnixSeconds:NOW,
    });
    assert.equal(signed.response.status,200);validate(signed.response.body,{});executions++;
    // Normal CLI verification-only build also needs no secret signing binding.
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source.split('\n').filter(line => !line.startsWith('app.') || line.startsWith("app.get('/verify'")).join('\n'));
    const verifyOnly = tc.buildProject(projects['fastly-native']);
    const verified = tc.executeFastlyNativePlatformCapabilities({wasm:fs.readFileSync(path.join(verifyOnly.outDir,'bin/main.wasm'))}, {request:{method:'GET',path:'/verify',url:'https://sign.test/verify',headers:[['authorization','Bearer '+external()]]},clockUnixSeconds:NOW});
    assert.equal(verified.response.body,'scheduler');executions++;
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source);
    const node = tc.compileNativeProjectInMemory(projects['node-native']);
    const built = tc.buildProject(projects['fastly-native']);
    assert.equal(built.status, 'built');
    const wasm = fs.readFileSync(path.join(built.outDir, 'bin/main.wasm'));
    const fastly = { wasm, inspection: { imports: WebAssembly.Module.imports(new WebAssembly.Module(wasm)) } };
    assert.equal(fastly.inspection.imports.some(({module}) => /pulse_host|js[_-]?compute|pulse_crypto_es256/i.test(module)), false);
    const js = tc.prepareJavascriptApplication(projects['node-javascript']);
    const boundary = 8192 - Buffer.byteLength(JSON.stringify({x:'',iat:NOW,exp:NOW+3600}));
    const invalidKeys = [
      undefined, JSON.stringify(publicKey), '{', secret.replace('{','{"kty":"RSA",'),
      ...[
        { ...key, d: Buffer.alloc(32).toString('base64url') },
        { ...key, ...generateKeyPairSync('rsa', {modulusLength:2048}).publicKey.export({format:'jwk'}) },
        { ...key, alg:'HS256' }, { ...key, oth:[] }, { ...key, use:'enc' },
        { ...key, key_ops:['verify'] }, { ...key, kid:'rotation-2' }, { ...key, x5u:'https://invalid.test' },
        { ...key, d:key.d+'=' },
      ].map(value => JSON.stringify(value)),
    ];
    const validExternal = external(), parts = validExternal.split('.');
    const padded = publicDecrypt({key:pair.publicKey,padding:constants.RSA_NO_PADDING},Buffer.from(parts[2],'base64url'));
    const paddingFailures = [0,1,2,padded.length-52,padded.length-40].map(index => {
      const block = Buffer.from(padded); block[index] ^= 1;
      return parts.slice(0,2).join('.') + '.' + privateEncrypt({key:pair.privateKey,padding:constants.RSA_NO_PADDING},block).toString('base64url');
    });
    const cases = [
      ...paddingFailures.map(token=>({route:'/verify',token,failed:true})),
      { claims:{iss:'issuer',aud:'worker',sub:'scheduler',scope:'reconcile',epoch:7} },
      { claims:{unicode:'é😀',nested:[null,true,1.25]} }, { claims:{} },
      { claims:{x:'x'.repeat(boundary)} }, { claims:{x:'x'.repeat(boundary+1)},failed:true },
      ...['iat','exp','nbf'].map(name => ({claims:{[name]:NOW},failed:true})),
      ...invalidKeys.map(secret => ({claims:{sub:'invalid-key'},secret,failed:true})),
      {route:'/parallel'}, {route:'/es'}, {route:'/verify'},
      {route:'/verify',token:external()},
      {route:'/verify',token:external({alg:'RS256',typ:'JWT'}),failed:true},
      {route:'/verify',token:external({alg:'RS256',kid:'unknown'}),failed:true},
      {route:'/verify',token:external({alg:'HS256',kid:'rotation-1'}),failed:true},
      {route:'/verify',token:external({alg:'PS256',kid:'rotation-1'}),failed:true},
      {route:'/verify',token:external(undefined,constants.RSA_PKCS1_PSS_PADDING),failed:true}, {route:'/verify',tampered:true,failed:true},
    ];
    const issued = {};
    function validate(token, claims) {
      const [header,payload,signature] = token.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')), {alg:'RS256',typ:'JWT',kid:'rotation-1'});
      assert.equal(verify('sha256',Buffer.from(header+'.'+payload),pair.publicKey,Buffer.from(signature,'base64url')),true);
      assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')), {...claims,iat:NOW,exp:NOW+3600});
    }
    for (const row of cases) for (const [mode, project] of Object.entries(projects)) {
      const material = Object.hasOwn(row,'secret') ? row.secret : secret;
      const secrets = { ...(material === undefined ? {} : {SIGNING_KEY:material}), ES_KEY:JSON.stringify(ec.privateKey.export({format:'jwk'})) };
      const route = row.route || '/sign';
      const token = row.tampered ? issued[mode].replace(/\.[^.]+\./, '.eyJzdWIiOiJ0YW1wZXJlZCJ9.') : row.token || issued[mode];
      const request = {method:row.route?'GET':'POST',path:route,url:'https://sign.test'+route,
        headers:route === '/verify' ? [['authorization','Bearer '+token]] : [],...(row.route?{}:{body:JSON.stringify(row.claims)})};
      const observations = [], logs = [];
      let result;
      try {
        if (mode === 'fastly-native') result = tc.executeFastlyNativePlatformCapabilities(fastly,{request,secrets,clockUnixSeconds:NOW,allowHandledJwtError:true});
        else if (mode === 'node-native') result = await tc.executeCanonicalNativeModule(node.native,tc.driver.executionOptions(project.providerConfig,{request,secrets,strict:false,
          captureJwtWallClock:()=>({trusted:true,unixEpochSeconds:NOW}),onEffectObservation:event=>observations.push(event),log:event=>logs.push(event)}));
        else {
          const execute = mode === 'node-javascript' ? tc.executeNodeJavascriptApplication : executeFastlyJavascriptApplication;
          const response = await execute(js.loaded.application,new Request(request.url,{method:request.method,body:request.body,headers:request.headers}),{
            secrets,bindings:{secretStore:'app_secrets'},strict:false,
            apis:{SecretStore:class {async get(name){return secrets[name] === undefined ? null : {plaintext:()=>secrets[name]};}}},
            jwtCaptureWallClock:()=>({trusted:true,unixEpochSeconds:NOW}),onEffectObservation:event=>observations.push(event),log:event=>logs.push(event),
          });
          result = {response:{status:response.status,body:await response.text()}};
        }
      } catch (error) {
        assert.equal(row.failed,true,`${mode}: unexpected ${error.stack}`);
        if (mode === 'fastly-native') {
          assert.equal(error.code,'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');
          assert.equal(error.detail.lastError,1008, `case ${cases.indexOf(row)}: ${JSON.stringify(error.detail)}`);
        } else assert.match(error.code,/^PULSE_JWT_(KEY_INVALID|CLAIMS_INVALID|LIMIT_EXCEEDED|SIGNATURE_INVALID|ALGORITHM_NOT_ALLOWED)$/);
        assert.equal(JSON.stringify(error).includes(key.d),false);
        executions++; continue;
      }
      if (row.failed) assert.ok(result.response.status >= 400,`${mode}: expected failure`);
      else {
        assert.equal(result.response.status,200,`${mode}: ${result.response.body}`);
        if (route === '/verify') assert.equal(result.response.body,'scheduler');
        else if (route === '/es') {
          const [h,p,t] = result.response.body.split('.'), data = Buffer.from(h+'.'+p), signature = Buffer.from(t,'base64url');
          assert.equal(verify('sha256',data,{key:ec.publicKey,dsaEncoding:'ieee-p1363'},signature),true);
        }
        else if (route === '/parallel') {const tokens=JSON.parse(result.response.body);validate(tokens.first,{sub:'first'});validate(tokens.second,{sub:'second'});}
        else {validate(result.response.body,row.claims);if(row.claims.sub === 'scheduler')issued[mode]=result.response.body;}
      }
      const diagnostics = JSON.stringify([observations,logs,result.trace,result.logs]);
      assert.equal(diagnostics.includes(key.d),false);
      if (!row.failed && route === '/sign') assert.equal(diagnostics.includes(result.response.body),false);
      executions++;
    }
    if (bits === 4096) {
      for (const form of ['signing-only','verification-only','combined']) {
        const app = source.split('\n').filter(line => !line.startsWith('app.') || form === 'combined'
          || (form === 'verification-only' ? line.startsWith("app.get('/verify'") : !line.startsWith("app.get('/verify'"))).join('\n');
        fs.writeFileSync(path.join(cwd,'src/index.ts'),app);
        for (const profile of Object.keys(projects)) {
          const project = tc.resolveProject({cwd,profile});
          const inspection = tc.inspectProject(project);
          if (profile.endsWith('javascript')) assert.equal(inspection.provider.targetSupport.project.status,'eligible');
          const build = tc.buildProject(project);
          assert.equal(build.status,'built');
          const tests = await tc.runProjectTests(project, form === 'combined' ? {} : {caseName:form === 'signing-only'?'issue':'verify'});
          assert.equal(tests.summary.failed,0,JSON.stringify({profile,form,summary:tests.summary,cases:tests.cases}));
          // Private test fixtures are not application build inputs.
          for (const file of fs.readdirSync(build.outDir,{recursive:true})) {
            const full = path.join(build.outDir,file);
            if (fs.statSync(full).isFile()) assert.equal(fs.readFileSync(full).includes(Buffer.from(key.d)),false, 'private JWK leaked into build');
          }
        }
      }
      fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
    }
    // The existing fixed-memory linker rejects the allocating HMAC guest.
    config.pulse.crypto=['RS256','ES256','HMAC-SHA256'];writeConfig();
    assert.throws(()=>tc.compileNativeProjectInMemory(tc.resolveProject({cwd,profile:'node-native'})), /forbidden start|fixed-memory|MVP/);
    config.pulse.crypto=['ES256'];writeConfig();
    for (const profile of Object.keys(projects)) assert.throws(()=>tc.inspectProject(tc.resolveProject({cwd,profile})),/RS256/);
    console.log(JSON.stringify({status:'passed',bits,executions,targets:Object.keys(projects),providerReality:false}));
  } finally { fs.rmSync(cwd,{recursive:true,force:true}); }
}
(async()=>{for(const bits of [2048,3072,4096]) await main(bits);})().catch(error=>{console.error(error.stack||error);console.error(JSON.stringify({detail:error.detail,diagnostics:error.diagnostics}));process.exitCode=1;});
