#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCryptoLoweringPlan } = require('../../../packages/crypto/pulsewasm.compiler.cjs');
const { normalizeMacTextOptions, normalizeMacTextResult } = require('../../../packages/crypto/src/provider.cjs');
const { Router } = require('../../../packages/runtime/src/index.js');
const { executeRouter } = require('../../../packages/runtime/src/internal/index.js');
const bridge = require('../../../packages/runtime/src/package.js');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { inspectProject, buildProject, compileProject } = require('../../packages/cli/src/project-execution.js');
const options = { algorithm: 'HS256', key: { type: 'secret', binding: 'REQUEST_PROOF_KEY' } };
const literal = JSON.stringify(options);
const lower = (body, imported = '{crypto, verifyMacText}') => buildCryptoLoweringPlan({ sourceText: `import ${imported} from '@pulse-compute/crypto'; app.post('/', async ctx => {${body}});` });
const call = (name = 'crypto.verifyMacText', opts = literal) => `${name}(ctx, message, tag, ${opts})`;
async function main() {
  for (const [imported, name] of [['{crypto}', 'crypto.verifyMacText'], ['{crypto as c}', 'c.verifyMacText'], ['c', 'c.verifyMacText'], ['{verifyMacText as verify}', 'verify']]) {
    const plan = lower(`const result = await ${call(name)}`, imported);
    assert.equal(plan.hasErrors, false, JSON.stringify(plan.diagnostics));
    assert.deepEqual(plan.cryptoRequirements[0].algorithms, ['HS256']);
    const effect = plan.canonicalEffects[0];
    assert.equal(effect.result, 'mac-text-verification');
    assert.deepEqual(effect.providerRequirements, ['crypto.verifyMacText', 'secret.get']);
    assert.equal(effect.resource.secretBinding, options.key.binding);
    assert.deepEqual(effect.runtimeInputs.map(input => [input.name, input.argumentIndex]), [['message', 1], ['tag', 2]]);
    assert.deepEqual(effect.redaction, ['message', 'tag', 'key']);
  }
  for (const opts of [
    '{}', 'options', `{...${literal}}`, `{algorithm:'HS256',key:{type:'secret',binding:name}}`,
    `{algorithm:'HS512',key:{type:'secret',binding:'KEY'}}`, `{algorithm:'HMAC-SHA256',key:{type:'secret',binding:'KEY'}}`,
    `{algorithm:'HS256',key:{type:'hmac-key-bytes',bytes:secret}}`, `{algorithm:'HS256',key:{type:'secret',binding:''}}`,
    `{algorithm:'HS256',key:{type:'secret',binding:'KEY',extra:true}}`, `{algorithm:'HS256',key:{type:'secret',binding:'KEY'},extra:true}`,
    `{get algorithm(){return 'HS256'},key:{type:'secret',binding:'KEY'}}`, `{['algorithm']:'HS256',key:{type:'secret',binding:'KEY'}}`,
    `{algorithm:'HS256',algorithm:'HS256',key:{type:'secret',binding:'KEY'}}`,
    JSON.stringify({...options, key:{type:'secret',binding:'x'.repeat(257)}}),
    JSON.stringify({...options, key:{type:'secret',binding:'é'.repeat(129)}}),
    JSON.stringify({...options, key:{type:'secret',binding:'\ud800'}}),
    JSON.stringify({...options, key:{type:'secret',binding:'KEY\0'}}),
  ]) assert.equal(lower(`const r = await ${call(undefined, opts)}`).hasErrors, true, opts);
  for (const body of [
    `return await ${call()}`, `${call()}`, `const r = ${call()}`, `const r=await ctx.parallel({a:${call()}})`,
    `const f=crypto.verifyMacText`, `const f=verifyMacText`, `const c=crypto;const r=await ${call('c.verifyMacText')}`,
    `const r=await ${call("crypto['verifyMacText']")}`, `const crypto=other;const r=await ${call()}`,
    `const {verifyMacText}=other;const r=await ${call('verifyMacText')}`,
    `const r=await crypto.verifyMacText(other,message,tag,${literal})`, `const r=await crypto.verifyMacText(ctx,message,tag)`,
  ]) assert.equal(lower(body).hasErrors, true, body);
  const mixed = lower(`const a=await crypto.digestText(ctx,message);const b=await ${call()}`);
  assert.deepEqual(mixed.cryptoRequirements[0].algorithms, ['HS256', 'SHA-256']);
  assert.equal(lower('const c=crypto;const r=await c.mac.verify(request)').hasErrors, false);
  const privateMessage = 'PRIVATE-MESSAGE-SENTINEL', privateTag = 'ab'.repeat(32);
  const redacted = lower(`const r=await crypto.verifyMacText(ctx,${JSON.stringify(privateMessage)},${JSON.stringify(privateTag)},${literal})`);
  assert.equal(JSON.stringify(redacted).includes(privateMessage), false);
  assert.equal(JSON.stringify(redacted).includes(privateTag), false);

  let getters = 0;
  const invalidOptions = [null, {}, {...options, extra:true}, {...options, key:{...options.key, extra:true}},
    {get algorithm(){getters++;return 'HS256'},key:options.key}, {...options, key:{type:'secret',get binding(){getters++;return 'KEY'}}}];
  for (const value of invalidOptions) assert.equal(normalizeMacTextOptions(value), null);
  assert.equal(getters, 0);
  assert.equal(normalizeMacTextOptions({...options,key:{type:'secret',binding:' KEY '}}).key.binding, ' KEY ');
  for (const status of ['valid','invalid-authenticator','invalid-input','too-large','unavailable','invalid-key','realization-failure']) {
    assert.deepEqual(normalizeMacTextResult({status}), {status});
    assert.ok(Object.isFrozen(normalizeMacTextResult({status})));
  }
  for (const value of [null,{status:'valid',key:'secret'},{status:'unknown'},{get status(){throw Error('PRIVATE')}}]) {
    assert.deepEqual(normalizeMacTextResult(value), {status:'realization-failure'});
  }
  const { verifyMacText } = await import('../../../packages/crypto/dist/index.js');
  const app = new Router(), seen = [], observations = [];
  let retainedContext;
  let message = privateMessage, tag = privateTag, opts = options, result = {status:'valid'};
  app.get('/', async ctx => { retainedContext=ctx; const proof=await verifyMacText(ctx,message,tag,opts); return ctx.json(proof); });
  const run = () => executeRouter(app,new Request('https://mac.test/', {headers:{authorization:'Bearer existing-user-token'}}), {
    capabilities:{effect:async effect => {seen.push(effect); return result}}, onEffectObservation:entry=>observations.push(entry)
  });
  assert.deepEqual(await (await run()).json(), {status:'valid'});
  assert.equal(seen[0].payload.message, privateMessage);
  await assert.rejects(verifyMacText(retainedContext, '', '', {}), /closed|abort|complete/i);
  await assert.rejects(verifyMacText({}, '', '', options), error=>error.code==='PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED');
  assert.equal(JSON.stringify(observations).includes(privateMessage), false);
  assert.equal(JSON.stringify(observations).includes(privateTag), false);
  for (const value of invalidOptions) {opts=value; const before=seen.length; assert.deepEqual(await (await run()).json(),{status:'invalid-input'}); assert.equal(seen.length,before);}
  opts=options;
  for (const text of ['\0'.repeat(65536),'a'.repeat(1000000),'\0'.repeat(1000000)]) {
    message=text; tag='b'.repeat(1000000); await run();
    assert.equal(seen.at(-1).payload.message.length,Math.min(text.length,65537));
    assert.equal(seen.at(-1).payload.tag.length,65);
    assert.ok(Buffer.byteLength(JSON.stringify(seen.at(-1)))<458752);
  }
  assert.throws(()=>bridge.clonePackageEffectPayload({message:'\0'.repeat(65536)}), /maximum|exceed/i, 'Generic envelope remains 256 KiB');
  const raw=bridge.createPackageRuntime({package:'@pulse-compute/crypto',contractId:'pulse.crypto',providerKind:'crypto',operations:{verifyMacText:{kind:'crypto.verifyMacText',capability:'crypto.verifyMacText',result:'mac-text-verification'}}});
  const oversized = new Router(); let rejected=false; oversized.get('/',async ctx=>{assert.throws(()=>raw.effect(ctx,'verifyMacText',{message:'a'.repeat(458753)}), /maximum|exceed/i);rejected=true;return ctx.text('bounded')});
  await executeRouter(oversized,new Request('https://mac.test/'),{capabilities:{effect:async()=>{throw Error('must not dispatch')}}});
  assert.equal(rejected,true);
  result={status:'valid',message:privateMessage}; message=''; tag='a'.repeat(64);
  assert.deepEqual(await (await run()).json(), {status:'realization-failure'});

  const cwd=fs.mkdtempSync(path.join(__dirname,'.mac01-'));
  try {
    fs.mkdirSync(path.join(cwd,'src')); fs.mkdirSync(path.join(cwd,'.pulse'));
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','crypto'])fs.symlinkSync(path.resolve(__dirname,'../../../packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {Pulse} from '@pulse-compute/pulse';import {crypto} from '@pulse-compute/crypto';const app=new Pulse({auto:true});app.get('/',async ctx=>{const r=await crypto.verifyMacText(ctx,ctx.req.header('x-message')||'',ctx.req.header('x-proof')||'',${literal});return ctx.text(r.status)});export default app;`);
    for(const host of ['node','fastly'])for(const target of ['native','javascript'])for(const algorithms of [['HS256'],[]]) {
      fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify({pulse:{entry:'src/index.ts',crypto:algorithms,strict:false},test:{host,target,...(host==='fastly'?{fastly:{bindings:{secretStore:'app_secrets'}}}:{})}})}));`);
      const project=resolveProject({cwd,profile:'test'});
      let inspection; try { inspection=inspectProject(project); } catch(error) { inspection={code:error.code,diagnostics:error.diagnostics,detail:error.detail}; }
      const serialized=JSON.stringify(inspection);
      assert.ok(/crypto.verifyMacText|CRYPTO.*REQUIRED|CRYPTO.*DECLAR/.test(serialized), serialized);
      if (algorithms.length) {
        assert.equal(inspection.code, undefined, serialized);
        if (target === 'javascript') assert.equal(inspection.provider.targetSupport.project.status, 'eligible');
        const compiled = compileProject(project);
        const metadata = compiled.metadata;
        assert.ok(metadata.capabilities.includes('secret.get'));
        const { assertProviderSupports, CANONICAL_PROVIDER_CAPABILITIES } = require('../../packages/contracts/src/provider/canonical-provider.js');
        const capabilities=metadata.capabilities.filter(value=>value!=='secret.get' && CANONICAL_PROVIDER_CAPABILITIES.includes(value));
        assert.throws(() => assertProviderSupports(metadata, {id:'mac-test',capabilities,lowering:Object.fromEntries(capabilities.map(value=>[value,'test-only']))}), error=>error.code==='PULSE_PROVIDER_CAPABILITY_UNSUPPORTED' && error.detail.missing.includes('secret.get'));
      } else {
        assert.ok(inspection.diagnostics.some(row=>row.code==='PULSE_CRYPTO_CONFIG_REQUIRED'));
        assert.ok(inspection.diagnostics.some(row=>row.detail.automaticFallback===false));
      }
      if (!algorithms.length) assert.throws(()=>buildProject(project), error => JSON.stringify(error.diagnostics).includes('PULSE_CRYPTO_CONFIG_REQUIRED'));
    }
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
  console.log('ok - MAC-01 static admission, status projection, bounded trusted dispatch, redaction and explicit target and missing authority gates');
}
main().catch(error=>{console.error(error);process.exitCode=1});
