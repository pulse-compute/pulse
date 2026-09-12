#!/usr/bin/env node
'use strict';

// Reference/design evidence only. No S3 runtime implementation is substituted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { normalizeCanonicalPackageEffect, createCanonicalPackageOperation } = require('../../packages/contracts/src/package/package-contract.js');
const { clonePackageEffectPayload } = require('../../../packages/runtime/src/internal/package-runtime.js');
const contract = require('./o1/contract.json');
const vectors = require('./o1/vectors.json');
const bindings = require('./o1/bindings.json');
const root = path.resolve(__dirname, '../../..');
const limits = contract.limits;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

// Pin externally published known answers, independently of a future signer.
assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(hmac(Buffer.alloc(20, 0x0b), 'Hi There').toString('hex'),
  'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
const v = vectors.signing;
const signedHeaders = 'host;range;x-amz-content-sha256;x-amz-date';
const emptyHash = sha256('');
const canonical = `GET\n${v.path}\n\nhost:${v.host}\nrange:${v.range}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${v.date}\n\n${signedHeaders}\n${emptyHash}`;
assert.equal(sha256(canonical), v.canonicalRequestSha256);
const day = v.date.slice(0, 8);
const scope = `${day}/${v.region}/s3/aws4_request`;
const signingKey = hmac(hmac(hmac(hmac(`AWS4${v.secretAccessKey}`, day), v.region), 's3'), 'aws4_request');
assert.equal(hmac(signingKey, `AWS4-HMAC-SHA256\n${v.date}\n${scope}\n${sha256(canonical)}`).toString('hex'), v.signature);

function encodeKeyReference(key) {
  assert.equal(key.isWellFormed(), true, 'key must contain Unicode scalar values');
  assert.ok(Buffer.byteLength(key) > 0 && Buffer.byteLength(key) <= limits.keyUtf8Bytes);
  assert.doesNotMatch(key, /[\u0000-\u001f\u007f-\u009f]/u);
  assert.equal(key.split('/').some((segment) => segment === '.' || segment === '..'), false);
  return key.split('/').map((part) => encodeURIComponent(part)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}
for (const { key, encoded } of vectors.keys) {
  assert.equal(encodeKeyReference(key), encoded);
  // Explicitly test the URL abstraction through which the bytes must pass.
  const url = new URL('https://objects.example.invalid');
  url.pathname = `/o1-fixture/${encoded}`;
  assert.equal(url.pathname, `/o1-fixture/${encoded}`);
  assert.equal(new Request(url).url, `https://objects.example.invalid/o1-fixture/${encoded}`);
}
for (const key of [...vectors.invalidKeys, 'a'.repeat(limits.keyUtf8Bytes + 1)]) {
  assert.throws(() => encodeKeyReference(key));
}
assert.equal(encodeKeyReference('雪'.repeat(341) + 'a').length, 3070);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
for (const body of vectors.bodies) {
  const bytes = Buffer.from(body.hex, 'hex');
  assert.equal(sha256(bytes), body.sha256);
  assert.equal(decoder.decode(bytes), body.text);
  assert.equal(Buffer.from(body.text).toString('hex'), body.hex);
}
for (const hex of vectors.invalidUtf8) assert.throws(() => decoder.decode(Buffer.from(hex, 'hex')));

// Exercise the current generic package seam using the proposed new identity.
for (const [index, op] of contract.lowering.operations.entries()) {
  const effect = {
    version: contract.lowering.effectVersion,
    contractId: contract.authority.contractId, package: contract.authority.npmPackage,
    import: contract.authority.lowerableSubpath,
    kind: op.kind, providerKind: 's3', capability: op.kind, operation: op.name,
    result: op.result, placement: 'await', range: { start: 0, end: 1 },
    resource: { binding: 'objects' },
    payload: { binding: 'objects', ...(op.method === 'PUT' ? { contentType: 'text/plain; charset=utf-8' } : {}) },
    runtimeInputs: op.runtimeInputs,
    providerRequirements: [op.kind, 'secret.get', 'time.wall-clock'],
    schemaReferences: [], redaction: ['key', 'text', 'sha256', 'etag', 'contentType'],
  };
  const normalized = normalizeCanonicalPackageEffect(effect, contract.authority);
  const operation = createCanonicalPackageOperation(normalized, contract.authority, index + 1);
  assert.deepEqual(operation.runtimeInputs, op.runtimeInputs);
  assert.deepEqual(operation.payload, effect.payload);
  assert.ok(Object.isFrozen(operation));
  assert.throws(() => normalizeCanonicalPackageEffect({ ...effect, credentials: 'forbidden' }, contract.authority));
  assert.throws(() => normalizeCanonicalPackageEffect({ ...effect, import: '@pulse-compute/assets' }, contract.authority));
  assert.throws(() => normalizeCanonicalPackageEffect({ ...effect, runtimeInputs: [...op.runtimeInputs, op.runtimeInputs[0]] }, contract.authority));
  // Dynamic inputs cannot overwrite authority-bearing static payload names.
  for (const input of op.runtimeInputs) assert.equal(Object.hasOwn(effect.payload, input.name), false);
}

// Real bridge serialization, including worst-case six-character JSON escapes.
const worstText = '\0'.repeat(limits.textUtf8Bytes);
const request = {
  binding: 'b'.repeat(limits.bindingNameBytes), key: '"'.repeat(limits.keyUtf8Bytes),
  text: worstText, contentType: '"'.repeat(limits.contentTypeBytes),
};
const response = {
  status: 'found', text: worstText, byteLength: limits.textUtf8Bytes, sha256: 'f'.repeat(64),
  etag: '\0'.repeat(limits.metadataValueBytes), contentType: '\0'.repeat(limits.metadataValueBytes),
};
for (const payload of [request, response]) {
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < limits.structuredEnvelopeBytes);
  assert.deepEqual(clonePackageEffectPayload(payload), payload);
}
assert.throws(() => clonePackageEffectPayload({ text: '\0'.repeat(limits.structuredEnvelopeBytes) }));

assert.deepEqual(bindings.node.bindings.s3.objects, Object.fromEntries(
  Object.entries(bindings.fastly.bindings.s3.objects).filter(([name]) => name !== 'backend')));

// Only this typecheck maps the future import to a draft. The Native runner must
// resolve an actual package and compile the same consumer without this mapping.
const program = ts.createProgram({
  rootNames: [path.join(__dirname, 'o1/types.ts'), path.join(__dirname, 'o1/native-read/src/index.ts')],
  options: {
    noEmit: true, strict: true, skipLibCheck: false, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    baseUrl: root, types: [],
    paths: {
      '@pulse-compute/runtime': ['packages/runtime/src/index.d.ts'],
      '@pulse-compute/pulse': ['packages/pulse/src/index.d.ts'],
      '@pulse-compute/s3': ['wasm/test/s3/o1/api.d.ts'],
    },
  },
});
assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);

if (!fs.existsSync(path.join(root, 'packages/s3/package.json'))) {
  const probe = spawnSync(process.execPath, [path.join(__dirname, 'run-native-read-acceptance.cjs')], { encoding: 'utf8' });
  assert.equal(probe.status, contract.nativeAcceptance.missingRealizationExitCode);
  assert.equal(JSON.parse(probe.stdout).status, 'blocked');
}
console.log('ok - S3 O1 design: typed subset, canonical input seam, key/body/signing vectors and bounded envelopes; no runtime support claim');
