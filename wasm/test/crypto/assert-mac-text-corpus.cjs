#!/usr/bin/env node
'use strict';

// MAC-00 evidence only: an independent oracle, not an implementation of the
// Pulse effect. No provider, compiler, package runtime or network is exercised.
const assert = require('node:assert/strict');
const { createHmac, timingSafeEqual, webcrypto } = require('node:crypto');
const corpus = require('./mac-text-v1.json');
const { messageBytesMaximum, keyBytesMinimum, keyBytesMaximum, tagBytes, envelopeBytesMaximum } = corpus.limits;
const encode = value => Buffer.from(value, 'utf8');
const wellFormed = value => typeof value === 'string' && value.isWellFormed();
const expand = spec => spec && typeof spec === 'object' && spec.repeat !== undefined
  ? spec.repeat.repeat(spec.count) + (spec.suffix ?? '') : spec;
const secret = spec => spec?.bytes !== undefined ? Buffer.alloc(spec.count, spec.bytes) : expand(spec);

// This deliberately small model checks corpus classifications and precedence.
// The actual effect must consume this corpus independently in MAC-02/03.
async function classify(row) {
  const text = expand(row.message);
  if (row.algorithm !== undefined && row.algorithm !== 'HS256') return 'invalid-input';
  if (typeof text !== 'string') return 'invalid-input';
  if (text.length > messageBytesMaximum) return 'too-large';
  if (!wellFormed(text)) return 'invalid-input';
  const data = encode(text);
  if (data.length > messageBytesMaximum) return 'too-large';
  if (typeof row.tag !== 'string' || row.tag.length !== tagBytes * 2 || /[^0-9a-f]/u.test(row.tag)) return 'invalid-input';
  if (row.state === 'unavailable') return 'unavailable';
  if (row.state === 'lookup-failed') return 'realization-failure';
  const value = secret(row.secret);
  if (!Buffer.isBuffer(value) && !wellFormed(value)) return 'invalid-key';
  const key = Buffer.isBuffer(value) ? value : encode(value);
  if (key.length < keyBytesMinimum || key.length > keyBytesMaximum) return 'invalid-key';
  try {
    if (row.state === 'verify-failed') return 'realization-failure';
    const tag = Buffer.from(row.tag, 'hex');
    const expected = createHmac('sha256', key).update(data).digest();
    const valid = timingSafeEqual(expected, tag);
    const imported = await webcrypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    assert.equal(await webcrypto.subtle.verify('HMAC', imported, tag, data), valid, row.id);
    return valid ? 'valid' : 'invalid-authenticator';
  } finally { key.fill(0); }
}

async function main() {
  assert.equal(corpus.version, 'pulse.crypto.mac-text-corpus.v1');
  assert.deepEqual(corpus.limits, { messageBytesMaximum: 65536, keyBytesMinimum: 32, keyBytesMaximum: 4096, tagBytes: 32, envelopeBytesMaximum: 458752 });
  const seen = new Set();
  const vectors = new Map(corpus.vectors.map(row => [row.id, row]));
  for (const row of corpus.vectors) {
    assert.ok(!seen.has(row.id), row.id); seen.add(row.id);
    assert.equal(encode(expand(row.message)).length, row.messageBytes, row.id);
    assert.equal(await classify(row), 'valid', row.id);
  }
  for (const row of corpus.cases) {
    assert.ok(!seen.has(row.id), row.id); seen.add(row.id);
    const base = vectors.get(row.vector);
    assert.ok(base, row.id);
    const input = { ...base, ...row.overrides, id: row.id };
    if (row.flipTagByte !== undefined) {
      const tag = Buffer.from(base.tag, 'hex');
      assert.ok(Number.isInteger(row.flipTagByte) && row.flipTagByte >= 0 && row.flipTagByte < tagBytes, row.id);
      tag[row.flipTagByte] ^= 1;
      input.tag = tag.toString('hex');
    }
    assert.equal(await classify(input), row.expected, row.id);
  }
  // Actual JSON encoding of the worst legal text (all NULs) exceeds the
  // general 256 KiB envelope. The proposed operation-only cap accommodates it.
  const worst = vectors.get('maximum-nul');
  const encoded = Buffer.byteLength(JSON.stringify({ text: expand(worst.message), tag: worst.tag, algorithm: 'HS256', key: { type: 'secret', binding: 'B'.repeat(256) } }));
  assert.ok(encoded > 256 * 1024 && encoded <= envelopeBytesMaximum);
  assert.deepEqual(new Set(corpus.cases.map(row => row.expected).concat('valid')), new Set(corpus.statuses));
  console.log('MAC-00 reference corpus: ' + corpus.vectors.length + ' known answers, ' + corpus.cases.length + ' classification cases; worst escaped fixture ' + encoded + ' bytes. No Pulse runtime evidence.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
