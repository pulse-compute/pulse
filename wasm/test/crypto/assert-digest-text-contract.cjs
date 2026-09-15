#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { buildCryptoLoweringPlan } = require('../../../packages/crypto/pulsewasm.compiler.cjs');
const { executeTextDigest, createJavascriptTextDigest, normalizeTextDigestResult } = require('../../../packages/crypto/src/provider.cjs');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { executeFastlyJavascriptApplication } = require('../../../packages/provider-fastly/src/javascript/runtime-host.js');
const effect = text => ({ package: '@pulse-compute/crypto', contractId: 'pulse.crypto', providerKind: 'crypto', operation: 'digestText', kind: 'crypto.digestText', capability: 'crypto.digestText', payload: { text } });
const lower = (body, imported = '{ crypto, digestText }') => buildCryptoLoweringPlan({ sourceText: `import ${imported} from '@pulse-compute/crypto'; app.post('/', async ctx => { ${body} });` });

async function main() {
  for (const [imported, call] of [['{ crypto, digestText }', 'crypto.digestText'], ['{ crypto as c }', 'c.digestText'], ['{ digestText as hash }', 'hash'], ['crypto', 'crypto.digestText']]) {
    const result = lower(`const r = await ${call}(ctx, text)`, imported);
    assert.equal(result.hasErrors, false, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.cryptoRequirements[0].algorithms, ['SHA-256']);
    assert.deepEqual(result.canonicalEffects[0].runtimeInputs, [{ name: 'text', argumentIndex: 1, source: 'package-call-argument' }]);
  }
  assert.equal(lower("const r = await ctx.parallel({ a: crypto.digestText(ctx, ''), b: digestText(ctx, text) })").hasErrors, false);
  for (const body of ["const r = await crypto.digestText(other, text)", "const r = await digestText(ctx)", "const r = await digestText(ctx, text, {})", "return await digestText(ctx, text)", "digestText(ctx, text)", "const r = digestText(ctx, text)", "const hash = crypto.digestText", "const hash = digestText", "const c = crypto; const r = await c.digestText(ctx, text)", "const r = await crypto['digestText'](ctx, text)", "const crypto = other; const r = await crypto.digestText(ctx, text)", "const { digestText } = other; const r = await digestText(ctx, text)"]) {
    assert.equal(lower(body).hasErrors, true, body);
  }
  assert.equal(lower('const r = await crypto.mac.verify(request)').hasErrors, false, 'Existing ordinary JavaScript verification stays separate.');
  assert.equal(lower('const c = crypto; const r = await c.mac.verify(request)').hasErrors, false, 'Existing JavaScript verification aliases stay separate.');
  for (const call of ["crypto.digestText(ctx, 'abc')", 'crypto.getRandomValues(value)', 'globalThis.crypto.digestText(ctx, text)']) assert.throws(() => compileCanonicalSource(`export default async ctx => { const r = await ${call}; return ctx.text('bad'); }`));

  const digest = createJavascriptTextDigest();
  assert.deepEqual(await digest(effect('')), { status: 'ok', byteLength: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  assert.deepEqual(await digest(effect('abc')), { status: 'ok', byteLength: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  let calls = 0;
  const unavailable = createJavascriptTextDigest({ digestSubtle: null });
  assert.deepEqual(await unavailable(effect('abc')), { status: 'failed', reason: 'unavailable' });
  const fail = createJavascriptTextDigest({ digestSubtle: { digest() { calls++; throw new Error('private failure detail'); } } });
  for (const text of ['\ud800', '\udc00', null, {}]) assert.deepEqual(await fail(effect(text)), { status: 'failed', reason: 'invalid-text' });
  for (const text of ['a'.repeat(32769), 'é'.repeat(16385)]) assert.deepEqual(await fail(effect(text)), { status: 'failed', reason: 'too-large' });
  assert.equal(calls, 0, 'Invalid text never reaches the byte primitive.');
  assert.deepEqual(await fail(effect('abc')), { status: 'failed', reason: 'realization-failure' });
  for (const output of [null, new ArrayBuffer(31), new Uint8Array(32)]) {
    assert.deepEqual(await createJavascriptTextDigest({ digestSubtle: { digest: async () => output } })(effect('abc')), { status: 'failed', reason: 'realization-failure' });
  }
  let data, output = new Uint8Array(32).fill(1);
  const native = { cryptoVerifier: { bytes: { sha256: async bytes => { data = bytes; return output; } } }, cryptoRealization: { algorithms: [{ algorithm: 'SHA-256', realization: 'guest-source:pulse-hmac-as', available: true, automaticFallback: false }] } };
  assert.equal((await executeTextDigest(effect('abc'), native)).sha256, '01'.repeat(32));
  assert.deepEqual([...data], [0, 0, 0]);
  assert.ok(output.every(value => value === 0));
  assert.deepEqual(await executeTextDigest(effect('abc'), { ...native, cryptoRealization: { algorithms: [] } }), { status: 'failed', reason: 'unavailable' });
  for (const value of [null, { status: 'ok', sha256: 'A'.repeat(64), byteLength: 0 }, { status: 'ok', sha256: 'a'.repeat(64), byteLength: 32769 }, { status: 'failed', reason: 'private detail' }, { status: 'failed', reason: 'unavailable', extra: true }, { get status() { throw new Error('must not read accessors'); } }]) assert.deepEqual(normalizeTextDigestResult(value), { status: 'failed', reason: 'realization-failure' });

  const { crypto } = await import('../../../packages/crypto/dist/index.js');
  for (const execute of [executeNodeJavascriptApplication, executeFastlyJavascriptApplication]) {
    const handler = async ctx => { const result = await crypto.digestText(ctx, 'abc'); return ctx.json(result); };
    const response = await execute(handler, new Request('https://digest.test/'), { digestSubtle: null, strict: false });
    assert.deepEqual(await response.json(), { status: 'failed', reason: 'unavailable' });
    const oversized = await execute(async ctx => {
      const result = await crypto.digestText(ctx, 'a'.repeat(1024 * 1024));
      return ctx.json(result);
    }, new Request('https://digest.test/'), { strict: false });
    assert.deepEqual(await oversized.json(), { status: 'failed', reason: 'too-large' }, 'Oversized input does not overflow the generic effect envelope.');
    const abort = new AbortController();
    let started, release;
    const waiting = new Promise(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const execution = execute(handler, new Request('https://digest.test/'), { signal: abort.signal, strict: false, digestSubtle: { digest() { started(); return pending; } } });
    await waiting;
    abort.abort(new Error('digest invocation cancelled'));
    await assert.rejects(execution, /digest invocation cancelled/);
    release(new ArrayBuffer(32));
  }
  console.log('ok - digest vectors, exact import admission, bounded failures, staging wipe, provider unavailability and cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
