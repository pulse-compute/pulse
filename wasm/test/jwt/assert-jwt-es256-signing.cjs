#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, verify } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const root = path.resolve(__dirname, '../../..');
const NOW = 1800000000;

async function main() {
  const tc = acceptanceToolchain();
  const cwd = fs.mkdtempSync(path.join(__dirname, '.es-sign-'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = pair.privateKey.export({ format: 'jwk' });
  const publicKey = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'rotation-1' };
  const secret = JSON.stringify(key);
  let executions = 0;
  try {
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'jwt']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    const policy = `{ algorithm: 'ES256', key: { type: 'secret', binding: 'SIGNING_KEY' }, kid: 'rotation-1', expiresInSeconds: 3600 }`;
    const source = `import { Pulse } from '@pulse-compute/pulse'; import { jwt } from '@pulse-compute/jwt';
const app = new Pulse({auto:true});
app.post('/sign', async ctx => { const claims = await ctx.req.json(); const token = await jwt.sign(ctx, claims, ${policy}); ctx.log.info(token); return ctx.text(token); });
app.get('/parallel', async ctx => { const tokens = await ctx.parallel({first:jwt.sign(ctx,{sub:'first'},${policy}),second:jwt.sign(ctx,{sub:'second'},${policy})}); return ctx.json(tokens); });
app.get('/verify', async ctx => { const result = await jwt.verify(ctx,jwt.bearer(ctx.req),{algorithms:['ES256'],key:{type:'jwks',keys:[${JSON.stringify(publicKey)}]},issuer:'issuer',audience:'worker',requiredClaims:['sub','iat','exp']}); return ctx.text(result.claims.sub); });
export default app;`;
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source);
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['ES256'] } };
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) config[`${host}-${target}`] = {
      host, target, ...(host === 'fastly' ? { fastly: { bindings: { secretStore: 'app_secrets' } } } : {})
    };
    const writeConfig = () => fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
    writeConfig();
    const projects = Object.fromEntries(Object.keys(config).filter(id => id !== 'pulse').map(profile => [profile, tc.resolveProject({ cwd, profile })]));
    // Issuance alone must not require a static verification key artifact.
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), source.split('\n').filter(line => !line.startsWith("app.get('/verify'")).join('\n'));
    const signingOnly = tc.buildProject(projects['fastly-native']);
    const signingOnlyWasm = fs.readFileSync(path.join(signingOnly.outDir, 'bin/main.wasm'));
    const signed = tc.executeFastlyNativePlatformCapabilities({wasm:signingOnlyWasm}, {
      request:{method:'POST',path:'/sign',url:'https://sign.test/sign',body:'{}'},
      secrets:{SIGNING_KEY:secret},clockUnixSeconds:NOW,
    });
    assert.equal(signed.response.status,200);validate(signed.response.body,{});executions++;
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
      undefined, JSON.stringify(publicKey), '{', secret.replace('{','{"kty":"EC",'),
      ...[
        { ...key, d: Buffer.alloc(32).toString('base64url') },
        { ...key, ...generateKeyPairSync('ec', {namedCurve:'prime256v1'}).publicKey.export({format:'jwk'}) },
        { ...key, alg:'HS256' }, { ...key, crv:'P-384' }, { ...key, use:'enc' },
        { ...key, key_ops:['verify'] }, { ...key, kid:'rotation-2' }, { ...key, x5u:'https://invalid.test' },
        { ...key, d:key.d+'=' },
      ].map(value => JSON.stringify(value)),
    ];
    const cases = [
      { claims:{iss:'issuer',aud:'worker',sub:'scheduler',scope:'reconcile',epoch:7} },
      { claims:{unicode:'é😀',nested:[null,true,1.25]} }, { claims:{} },
      { claims:{x:'x'.repeat(boundary)} }, { claims:{x:'x'.repeat(boundary+1)},failed:true },
      ...['iat','exp','nbf'].map(name => ({claims:{[name]:NOW},failed:true})),
      ...invalidKeys.map(secret => ({claims:{sub:'invalid-key'},secret,failed:true})),
      {route:'/parallel'}, {route:'/verify'}, {route:'/verify',tampered:true,failed:true},
    ];
    const issued = {};
    function validate(token, claims) {
      const [header,payload,signature] = token.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')), {alg:'ES256',typ:'JWT',kid:'rotation-1'});
      assert.equal(verify('sha256',Buffer.from(header+'.'+payload),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
      assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')), {...claims,iat:NOW,exp:NOW+3600});
    }
    for (const row of cases) for (const [mode, project] of Object.entries(projects)) {
      const material = Object.hasOwn(row,'secret') ? row.secret : secret;
      const secrets = material === undefined ? {} : {SIGNING_KEY:material};
      const route = row.route || '/sign';
      const token = row.tampered ? issued[mode].replace(/\.[^.]+\./, '.eyJzdWIiOiJ0YW1wZXJlZCJ9.') : issued[mode];
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
        } else assert.match(error.code,/^PULSE_JWT_(KEY_INVALID|CLAIMS_INVALID|LIMIT_EXCEEDED|SIGNATURE_INVALID)$/);
        assert.equal(JSON.stringify(error).includes(key.d),false);
        executions++; continue;
      }
      if (row.failed) assert.ok(result.response.status >= 400,`${mode}: expected failure`);
      else {
        assert.equal(result.response.status,200,`${mode}: ${result.response.body}`);
        if (route === '/verify') assert.equal(result.response.body,'scheduler');
        else if (route === '/parallel') {const tokens=JSON.parse(result.response.body);validate(tokens.first,{sub:'first'});validate(tokens.second,{sub:'second'});}
        else {validate(result.response.body,row.claims);if(row.claims.sub === 'scheduler')issued[mode]=result.response.body;}
      }
      const diagnostics = JSON.stringify([observations,logs,result.trace,result.logs]);
      assert.equal(diagnostics.includes(key.d),false);
      if (!row.failed && route === '/sign') assert.equal(diagnostics.includes(result.response.body),false);
      executions++;
    }
    config.pulse.crypto=[];writeConfig();
    for (const profile of Object.keys(projects)) assert.throws(()=>tc.inspectProject(tc.resolveProject({cwd,profile})),/ES256/);
    console.log(JSON.stringify({status:'passed',executions,targets:Object.keys(projects),providerReality:false}));
  } finally { fs.rmSync(cwd,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error.stack||error);console.error(JSON.stringify({detail:error.detail,diagnostics:error.diagnostics}));process.exitCode=1;});
