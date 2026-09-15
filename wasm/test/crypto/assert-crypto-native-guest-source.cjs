#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const {
  normalizeCryptoConfiguration,
  normalizeCryptoRequirements,
  defineCryptoTargetCapabilities
} = require('../../packages/contracts/src/crypto/contracts.js');
const {
  planProjectCrypto
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const {
  compileCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  createNodeProviderAdapter
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  EXAMPLES,
  compileExample
} = require('../support/canonical-projects.cjs');
const {
  pulseHmacAssemblyScriptSource
} = require('../../../packages/crypto/pulsewasm.native.cjs');

const vectors = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'packages', 'crypto', 'conformance', 'hs256.json'),
  'utf8'
));
const resultCodes = Object.freeze({
  valid: 1,
  invalidAuthenticator: 0,
  invalidKey: -1,
  invalidInput: -2,
  realizationFailure: -3
});

function selectedPlan(targetDescriptor = NODE_NATIVE_TARGET_DESCRIPTOR) {
  return planProjectCrypto({
    declaration: normalizeCryptoConfiguration(['HS256']),
    requirements: normalizeCryptoRequirements([{
      algorithm: 'HS256',
      requestedBy: '@pulse-compute/crypto'
    }]),
    targetDescriptor,
    target: 'native',
    profile: 'native'
  });
}

function compiledWithCrypto(realizationPlan = selectedPlan()) {
  const base = compileExample(EXAMPLES.hello).compiled;
  return Object.freeze({
    ...base,
    cryptoRealizationPlan: realizationPlan
  });
}

function stage(memory, inputs) {
  const padding = 64;
  const start = memory.buffer.byteLength;
  const required = inputs.reduce(
    (total, input) => total + Math.max(input.length, 1) + padding,
    padding
  );
  memory.grow(Math.ceil(required / 65536));
  const view = new Uint8Array(memory.buffer);
  const pointers = [];
  let cursor = start + padding;
  for (const input of inputs) {
    pointers.push(cursor);
    view.set(input, cursor);
    cursor += Math.max(input.length, 1) + padding;
  }
  return Object.freeze(pointers);
}

function verify(controller, key, data, tag) {
  const [keyPointer, dataPointer, tagPointer] = stage(
    controller.exports.memory,
    [key, data, tag]
  );
  return controller.exports.pulse_crypto_hs256_verify(
    keyPointer,
    key.length,
    dataPointer,
    data.length,
    tagPointer,
    tag.length
  );
}

function digest(controller, data) {
  const output = Buffer.alloc(32);
  const [dataPointer, outputPointer] = stage(
    controller.exports.memory,
    [data, output]
  );
  const status = controller.exports.pulse_crypto_sha256_digest(
    dataPointer,
    data.length,
    outputPointer,
    output.length
  );
  assert.equal(status, resultCodes.valid);
  return Buffer.from(new Uint8Array(
    controller.exports.memory.buffer,
    outputPointer,
    output.length
  ));
}

function controllerFor(compiled) {
  return nativeHost.instantiateCanonicalNativeModule(compiled, {
    providerAdapter: createNodeProviderAdapter()
  });
}

const realizationPlan = selectedPlan();
assert.equal(realizationPlan.algorithms[0].targetImplemented, true);
assert.equal(realizationPlan.algorithms[0].targetStatus, 'implemented-c3');
assert.equal(realizationPlan.algorithms[0].realization, 'guest-source:pulse-hmac-as');
assert.equal(realizationPlan.algorithms[0].kind, 'guest-source');
assert.equal(realizationPlan.automaticFallback, false);

const nativePlan = buildCanonicalNativePlan(compiledWithCrypto(realizationPlan));
assert.deepEqual(nativePlan.crypto, realizationPlan);
assert.equal(nativePlan.ownership.providerNeutral, true);

const first = compileCanonicalNativePlan(nativePlan, { cwd: repoRoot });
const second = compileCanonicalNativePlan(nativePlan, { cwd: os.tmpdir() });
const optimized = compileCanonicalNativePlan(nativePlan, {
  cwd: repoRoot,
  nativeOptimization: 'experimental-native-size'
});
assert.deepEqual(first.wasm, second.wasm, 'Native crypto Wasm must be path-independent');
assert.equal(first.source, second.source, 'Native crypto source must be path-independent');
assert.equal(first.wat, second.wat, 'Native crypto WAT must be path-independent');
assert.equal(first.guestUnits.length, 0, 'HS256 guest-source must not create a guest unit');
assert.equal(first.guestLink, undefined, 'HS256 guest-source must not invoke guest linking');
assert.equal(first.manifest.crypto.active, true);
assert.equal(first.manifest.crypto.realizationPlanHash, realizationPlan.planHash);
assert.equal(first.manifest.crypto.automaticFallback, false);
assert.equal(first.manifest.crypto.algorithms.length, 1);

const sourceContract = pulseHmacAssemblyScriptSource();
const cryptoEvidence = first.manifest.crypto.algorithms[0];
assert.equal(cryptoEvidence.realization, 'guest-source:pulse-hmac-as');
assert.equal(cryptoEvidence.backend, 'pulse-hmac-as');
assert.equal(cryptoEvidence.backendVersion, 'pulse-hmac-as.v1');
assert.equal(cryptoEvidence.owner, '@pulse-compute/crypto');
assert.equal(cryptoEvidence.packageVersion, sourceContract.packageVersion);
assert.equal(cryptoEvidence.language, 'assemblyscript');
assert.equal(cryptoEvidence.license, 'Apache-2.0');
assert.equal(cryptoEvidence.origin, 'package-source');
assert.equal(cryptoEvidence.sourceIncluded, true);
assert.deepEqual(cryptoEvidence.provenance, [
  'NIST FIPS 180-4',
  'RFC 2104',
  'RFC 4231'
]);
assert.equal(cryptoEvidence.sourceFile, 'as/pulse-hmac-as.ts');
assert.equal(cryptoEvidence.sourceSha256, sourceContract.sourceSha256);
assert.equal(cryptoEvidence.sourceBytes, sourceContract.sourceBytes);
assert.deepEqual(cryptoEvidence.imports, []);
assert.deepEqual(cryptoEvidence.exports, [
  'pulse_crypto_hs256_verify',
  'pulse_crypto_sha256_digest',
  'pulse_crypto_bytes_frame_v1',
  'pulse_crypto_digest_frame_v1',
  'pulse_crypto_sha256_bytes_v1',
  'pulse_crypto_hmac_sha256_bytes_v1'
]);
assert.deepEqual(cryptoEvidence.resourceLimits, {
  hmacKeyBytesMinimum: 32,
  hmacKeyBytesMaximum: 4 * 1024,
  macDataBytesMaximum: 1024 * 1024,
  hs256TagBytes: 32,
  byteOperationKeyBytesMaximum: 8192,
  byteOperationDataBytesMaximum: 32768,
  digestDataBytesMaximum: 2097152,
  byteOperationOutputBytes: 32,
  byteOperationFrameBytes: 40992,
  digestFrameBytes: 2097184
});
assert.deepEqual(cryptoEvidence.resultCodes, resultCodes);
assert.deepEqual(cryptoEvidence.comparison, {
  mode: 'constant-time-full-tag-scan',
  bytes: 32,
  earlyMismatchReturn: false
});
assert.equal(first.source.includes(sourceContract.source.trimEnd()), true);
assert.equal(first.inspection.imports.some((entry) => /wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false);

for (const compiled of [first, optimized]) {
  const exports = new Set(compiled.inspection.exports.map((entry) => entry.name));
  assert.equal(exports.has('pulse_crypto_hs256_verify'), true);
  assert.equal(exports.has('pulse_crypto_sha256_digest'), true);
  assert.equal(compiled.manifest.crypto.algorithms[0].sourceSha256, sourceContract.sourceSha256);

  const controller = controllerFor(compiled);
  const byteCrypto = require('../../../packages/crypto/pulsewasm.native.cjs').bindNativeDigestMac(controller.exports);
  for (const algorithm of ['SHA-256', 'HMAC-SHA256']) {
    const selected = planProjectCrypto({
      declaration: normalizeCryptoConfiguration([algorithm]),
      requirements: normalizeCryptoRequirements([{ algorithm, requestedBy: '@pulse-compute/crypto' }]),
      targetDescriptor: NODE_NATIVE_TARGET_DESCRIPTOR, target: 'native', profile: 'native'
    });
    const bridge = require('../../packages/host-runtime/src/runtime/native-crypto-verifier.js').createNativeGuestSourceCryptoVerifier({ exports: controller.exports, plan: { crypto: selected } });
    assert.equal(bridge.realization.algorithms[0].available, true);
    assert.deepEqual(Object.keys(bridge.verifier.bytes), [algorithm === 'SHA-256' ? 'sha256' : 'hmacSha256'], 'only the selected byte authority is exposed');
  }
  for (const keyLength of [0, 1, 20, 32, 64, 65, 4096, 4100, 8192]) {
    const key = Buffer.alloc(keyLength, 0x0b), data = Buffer.from('Hi There');
    assert.equal(Buffer.from(byteCrypto.hmacSha256(key, data)).toString('hex'), crypto.createHmac('sha256', key).update(data).digest('hex'));
  }
  for (const length of [0, 1, 55, 56, 64, 32768, 2097152]) {
    const bytes = Buffer.alloc(length, 0xab);
    assert.equal(Buffer.from(byteCrypto.sha256(bytes)).toString('hex'), crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  assert.throws(() => byteCrypto.sha256(Buffer.alloc(2097153)));
  assert.throws(() => byteCrypto.hmacSha256(Buffer.alloc(32), Buffer.alloc(32769)));
  const digestFrame = controller.exports.pulse_crypto_digest_frame_v1();
  assert.equal(new Uint8Array(controller.exports.memory.buffer, digestFrame, 2097184).every(byte => byte === 0), true);
  assert.throws(() => byteCrypto.hmacSha256(Buffer.alloc(8193), Buffer.alloc(0)));
  const frame = controller.exports.pulse_crypto_bytes_frame_v1();
  for (let i = 0; i < 100; i++) { byteCrypto.hmacSha256(Buffer.alloc(32), Buffer.alloc(32)); assert.equal(controller.exports.pulse_crypto_bytes_frame_v1(), frame); }
  assert.equal(new Uint8Array(controller.exports.memory.buffer, frame, 40992).every((byte) => byte === 0), true, 'Crypto staging frame is wiped');
  assert.equal(controller.exports.pulse_crypto_sha256_bytes_v1(-1, 10, frame, 32), -2);
  assert.equal(controller.exports.pulse_crypto_sha256_bytes_v1(frame, 0, frame, 31), -2);
  assert.equal(controller.exports.pulse_crypto_hs256_verify(frame, 1, frame, 0, frame, 32), -1, 'JWT still rejects short HMAC keys');
  assert.equal(
    digest(controller, Buffer.alloc(0)).toString('hex'),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'FIPS 180-4 empty-message SHA-256'
  );
  assert.equal(
    digest(controller, Buffer.from('abc', 'ascii')).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'FIPS 180-4 abc SHA-256'
  );

  for (const vector of vectors.publishedVectors) {
    const key = Buffer.alloc(vector.keyLength, vector.keyByte);
    const data = Buffer.from(vector.dataHex, 'hex');
    const tag = Buffer.from(vector.tagHex, 'hex');
    assert.equal(verify(controller, key, data, tag), resultCodes.valid, vector.id);

    for (const index of [0, 15, 31]) {
      const invalidTag = Buffer.from(tag);
      invalidTag[index] ^= 0x01;
      assert.equal(
        verify(controller, key, data, invalidTag),
        resultCodes.invalidAuthenticator,
        `${vector.id} mismatch at ${index}`
      );
    }
  }
}

const controller = controllerFor(first);
const key = Buffer.alloc(32, 0x2a);
const empty = Buffer.alloc(0);
const emptyTag = crypto.createHmac('sha256', key).update(empty).digest();
assert.equal(verify(controller, key, empty, emptyTag), resultCodes.valid);

const maximumData = Buffer.alloc(1024 * 1024, 0xa5);
const maximumTag = crypto.createHmac('sha256', key).update(maximumData).digest();
assert.equal(verify(controller, key, maximumData, maximumTag), resultCodes.valid);
assert.equal(
  controller.exports.pulse_crypto_hs256_verify(0, key.length, 0, maximumData.length + 1, 0, 32),
  resultCodes.invalidInput
);
assert.equal(verify(controller, Buffer.alloc(31, 0x2a), empty, emptyTag), resultCodes.invalidKey);
assert.equal(
  controller.exports.pulse_crypto_hs256_verify(0, 4097, 0, 0, 0, 32),
  resultCodes.invalidKey
);
assert.equal(verify(controller, Buffer.alloc(32, 0x2b), empty, emptyTag), resultCodes.invalidAuthenticator);
assert.equal(verify(controller, key, Buffer.from([1]), emptyTag), resultCodes.invalidAuthenticator);
assert.equal(verify(controller, key, empty, emptyTag.subarray(0, 31)), resultCodes.invalidInput);

const [validKeyPointer, validDataPointer, validTagPointer] = stage(
  controller.exports.memory,
  [key, empty, emptyTag]
);
const memoryEnd = controller.exports.memory.buffer.byteLength;
assert.doesNotThrow(() => {
  assert.equal(
    controller.exports.pulse_crypto_hs256_verify(
      memoryEnd - 8,
      32,
      validDataPointer,
      0,
      validTagPointer,
      32
    ),
    resultCodes.invalidKey
  );
  assert.equal(
    controller.exports.pulse_crypto_hs256_verify(
      validKeyPointer,
      32,
      memoryEnd - 8,
      32,
      validTagPointer,
      32
    ),
    resultCodes.invalidInput
  );
  assert.equal(
    controller.exports.pulse_crypto_hs256_verify(
      validKeyPointer,
      32,
      validDataPointer,
      0,
      memoryEnd - 8,
      32
    ),
    resultCodes.invalidInput
  );
}, 'malformed ranges must normalize without trapping or reading out of bounds');

const comparisonStart = sourceContract.source.indexOf('// Every authenticator byte participates');
const comparisonEnd = sourceContract.source.indexOf('const result = mismatch', comparisonStart);
assert.ok(comparisonStart >= 0 && comparisonEnd > comparisonStart);
const comparisonBody = sourceContract.source.slice(comparisonStart, comparisonEnd);
assert.match(comparisonBody, /for \(let index: i32 = 0; index < __PULSE_CRYPTO_HS256_TAG_BYTES; index \+= 1\)/);
assert.match(comparisonBody, /mismatch \|=/);
assert.doesNotMatch(comparisonBody, /\breturn\b/, 'comparison must not return on a mismatched byte');

const sensitiveKey = Buffer.from('native-secret-value-not-for-report!!', 'ascii');
const sensitiveTag = crypto.createHmac('sha256', sensitiveKey).update('payload').digest();
assert.equal(verify(controller, sensitiveKey, Buffer.from('payload'), sensitiveTag), resultCodes.valid);
const report = JSON.stringify({
  realizationPlan,
  nativePlan,
  manifest: first.manifest
});
assert.equal(report.includes(sensitiveKey.toString('ascii')), false);
assert.equal(report.includes(sensitiveKey.toString('hex')), false);
assert.equal(report.includes(sensitiveTag.toString('hex')), false);

const unavailableTarget = {
  crypto: defineCryptoTargetCapabilities({
    target: 'native',
    algorithms: [{
      algorithm: 'HS256',
      realization: 'guest-source:pulse-hmac-as',
      implemented: false,
      status: 'unavailable-proof'
    }]
  })
};
const unavailablePlan = buildCanonicalNativePlan(compiledWithCrypto(selectedPlan(unavailableTarget)));
assert.throws(
  () => compileCanonicalNativePlan(unavailablePlan, { cwd: repoRoot }),
  (error) => {
    assert.equal(error && error.code, 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE');
    assert.equal(error && error.detail && error.detail.automaticFallback, false);
    return true;
  },
  'an unavailable selected realization must fail without backend substitution'
);

console.log('ok - Native guest-source HS256 is bounded, vector-correct, constant-time by structure, optimized, redacted, and fallback-free');
