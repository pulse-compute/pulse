'use strict';

const {
  CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
  CRYPTO_ES256_GUEST_LINKED_REALIZATION,
  CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
  CRYPTO_REALIZATION_PLAN_VERSION
} = require('@pulse-compute/wasm-contracts/crypto/contracts');

const NATIVE_CRYPTO_VERIFIER_VERSION = 'pulse.native-crypto-verifier.v1';
const HS256_REALIZATION = 'guest-source:pulse-hmac-as';
const HS256_EXPORT = 'pulse_crypto_hs256_verify';
const ES256_EXPORT = 'pulse_crypto_es256_verify';
const ES256_REALIZATION = CRYPTO_ES256_GUEST_LINKED_REALIZATION;
const PAGE_BYTES = 64 * 1024;
const GUARD_BYTES = PAGE_BYTES;
const KEY_BYTES_MINIMUM = 32;
const KEY_BYTES_MAXIMUM = 4 * 1024;
const DATA_BYTES_MAXIMUM = 1024 * 1024;
const TAG_BYTES = 32;
const MAX_SIGNED_POINTER = 0x7fffffff;
const ES256_MEMORY_BYTES = 32 * PAGE_BYTES;
const ES256_FRAME_POINTER = 8 * PAGE_BYTES;
const ES256_FRAME_CAPACITY = 16_640;
const ES256_FRAME_MAGIC = 0x3253_4550;
const ES256_FRAME_HEADER_BYTES = 64;
const ES256_KEY_BYTES = 64;
const ES256_SIGNATURE_BYTES = 64;
const ES256_DATA_BYTES_MAXIMUM = 16_340;

const RESULT_BY_CODE = Object.freeze({
  1: 'valid',
  0: 'invalid-authenticator',
  '-1': 'invalid-key',
  '-2': 'invalid-input',
  '-3': 'realization-failure'
});

function result(status) {
  return Object.freeze({ status });
}

function ownData(value, name) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function bytes(value) {
  return value instanceof Uint8Array ? value : undefined;
}

function selectedAlgorithm(plan, algorithm, realization, kind, implementation) {
  if (
    !plan
    || typeof plan !== 'object'
    || !plan.crypto
    || plan.crypto.version !== CRYPTO_REALIZATION_PLAN_VERSION
    || plan.crypto.target !== 'native'
    || plan.crypto.automaticFallback !== false
    || !Array.isArray(plan.crypto.algorithms)
  ) return undefined;
  const matches = plan.crypto.algorithms.filter((entry) => (
    entry
    && entry.algorithm === algorithm
    && entry.realization === realization
    && entry.kind === kind
    && entry.implementation === implementation
    && entry.automaticFallback === false
    && entry.targetImplemented === true
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function selectedHs256(plan) {
  return selectedAlgorithm(
    plan,
    'HS256',
    HS256_REALIZATION,
    'guest-source',
    CRYPTO_GUEST_SOURCE_IMPLEMENTATION
  );
}

function selectedEs256(plan) {
  return selectedAlgorithm(
    plan,
    'ES256',
    ES256_REALIZATION,
    'guest-linked',
    CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION
  );
}

function normalizeRequest(request) {
  const algorithm = ownData(request, 'algorithm');
  const key = ownData(request, 'key');
  const keyType = ownData(key, 'type');
  const keyBytes = bytes(ownData(key, 'bytes'));
  const data = bytes(ownData(request, 'data'));
  const tag = bytes(ownData(request, 'tag'));
  if (
    algorithm !== 'HS256'
    || keyType !== 'hmac-key-bytes'
    || !keyBytes
    || !data
    || !tag
  ) return Object.freeze({ result: result('invalid-input') });
  if (
    keyBytes.byteLength < KEY_BYTES_MINIMUM
    || keyBytes.byteLength > KEY_BYTES_MAXIMUM
  ) return Object.freeze({ result: result('invalid-key') });
  if (
    data.byteLength > DATA_BYTES_MAXIMUM
    || tag.byteLength !== TAG_BYTES
  ) return Object.freeze({ result: result('invalid-input') });
  return Object.freeze({ keyBytes, data, tag });
}

function normalizeSignatureRequest(request) {
  const algorithm = ownData(request, 'algorithm');
  const key = ownData(request, 'key');
  const keyType = ownData(key, 'type');
  const keyBytes = bytes(ownData(key, 'bytes'));
  const data = bytes(ownData(request, 'data'));
  const signature = bytes(ownData(request, 'signature'));
  if (
    algorithm !== 'ES256'
    || keyType !== 'p256-public-key-bytes'
    || !keyBytes
    || !data
    || !signature
  ) return Object.freeze({ result: result('invalid-input') });
  if (keyBytes.byteLength !== ES256_KEY_BYTES) {
    return Object.freeze({ result: result('invalid-key') });
  }
  if (
    data.byteLength > ES256_DATA_BYTES_MAXIMUM
    || signature.byteLength !== ES256_SIGNATURE_BYTES
  ) return Object.freeze({ result: result('invalid-input') });
  return Object.freeze({ keyBytes, data, signature });
}

function stage(memory, inputs) {
  const payloadBytes = inputs.reduce((total, input) => total + input.byteLength, 0);
  const oldEnd = memory.buffer.byteLength;
  const required = GUARD_BYTES + payloadBytes + 48;
  const pages = Math.ceil(required / PAGE_BYTES);
  const newEnd = oldEnd + pages * PAGE_BYTES;
  if (
    !Number.isSafeInteger(newEnd)
    || newEnd > MAX_SIGNED_POINTER
    || memory.grow(pages) < 0
  ) return undefined;

  const view = new Uint8Array(memory.buffer);
  const pointers = [];
  let cursor = oldEnd + GUARD_BYTES;
  for (const input of inputs) {
    cursor = (cursor + 15) & ~15;
    pointers.push(cursor);
    view.set(input, cursor);
    cursor += input.byteLength;
  }
  return Object.freeze({
    pointers: Object.freeze(pointers),
    wipe() {
      new Uint8Array(memory.buffer).fill(0, oldEnd + GUARD_BYTES, cursor);
    }
  });
}

function align16(value) {
  return (value + 15) & ~15;
}

function stageEs256Frame(memory, normalized) {
  if (
    !(memory instanceof WebAssembly.Memory)
    || memory.buffer.byteLength !== ES256_MEMORY_BYTES
  ) return undefined;
  const totalLength = align16(192 + normalized.data.byteLength);
  if (totalLength > ES256_FRAME_CAPACITY) return undefined;
  const frame = new Uint8Array(
    memory.buffer,
    ES256_FRAME_POINTER,
    ES256_FRAME_CAPACITY
  );
  frame.fill(0);
  const words = new DataView(
    memory.buffer,
    ES256_FRAME_POINTER,
    ES256_FRAME_HEADER_BYTES
  );
  const fields = [
    [0, ES256_FRAME_MAGIC],
    [4, 2],
    [8, ES256_FRAME_HEADER_BYTES],
    [12, totalLength],
    [16, 1],
    [20, 0],
    [24, 192],
    [28, normalized.data.byteLength],
    [32, 64],
    [36, ES256_KEY_BYTES],
    [40, 128],
    [44, ES256_SIGNATURE_BYTES]
  ];
  for (const [offset, value] of fields) words.setUint32(offset, value, true);
  frame.set(normalized.keyBytes, 64);
  frame.set(normalized.signature, 128);
  frame.set(normalized.data, 192);
  return Object.freeze({
    pointer: ES256_FRAME_POINTER,
    capacity: ES256_FRAME_CAPACITY,
    wipe() {
      new Uint8Array(
        memory.buffer,
        ES256_FRAME_POINTER,
        ES256_FRAME_CAPACITY
      ).fill(0);
    }
  });
}

function createNativeGuestSourceCryptoVerifier(input = {}) {
  const plan = input.plan;
  const moduleExports = input.exports;
  const selected = selectedHs256(plan);
  const selectedSignature = selectedEs256(plan);
  const memory = moduleExports && moduleExports.memory;
  const verifyHs256 = moduleExports && moduleExports[HS256_EXPORT];
  const verifyEs256 = moduleExports && moduleExports[ES256_EXPORT];
  const hs256Available = Boolean(
    selected
    && memory instanceof WebAssembly.Memory
    && typeof verifyHs256 === 'function'
  );
  const es256Available = Boolean(
    selectedSignature
    && memory instanceof WebAssembly.Memory
    && memory.buffer.byteLength === ES256_MEMORY_BYTES
    && typeof verifyEs256 === 'function'
  );
  const selectedRealizations = Object.freeze([
    ...(selected ? [Object.freeze({
      algorithm: 'HS256',
      realization: HS256_REALIZATION,
      implementation: CRYPTO_GUEST_SOURCE_IMPLEMENTATION,
      guestUnitRequired: false,
      available: hs256Available
    })] : []),
    ...(selectedSignature ? [Object.freeze({
      algorithm: 'ES256',
      realization: ES256_REALIZATION,
      implementation: CRYPTO_ES256_GUEST_LINKED_IMPLEMENTATION,
      guestUnitRequired: true,
      available: es256Available
    })] : [])
  ]);
  const realization = Object.freeze({
    version: NATIVE_CRYPTO_VERIFIER_VERSION,
    semanticOwner: '@pulse-compute/crypto',
    automaticFallback: false,
    algorithms: selectedRealizations,
    available: selectedRealizations.length > 0
      && selectedRealizations.every((entry) => entry.available),
    ...(selectedRealizations.length === 1 ? selectedRealizations[0] : {})
  });

  const verifier = Object.freeze({
    mac: Object.freeze({
      verify(request) {
        const normalized = normalizeRequest(request);
        if (normalized.result) return normalized.result;
        if (!hs256Available) return result('realization-failure');
        let staged;
        try {
          staged = stage(memory, [
            normalized.keyBytes,
            normalized.data,
            normalized.tag
          ]);
          if (!staged) return result('realization-failure');
          const [keyPointer, dataPointer, tagPointer] = staged.pointers;
          const code = verifyHs256(
            keyPointer,
            normalized.keyBytes.byteLength,
            dataPointer,
            normalized.data.byteLength,
            tagPointer,
            normalized.tag.byteLength
          );
          return result(RESULT_BY_CODE[String(code)] || 'realization-failure');
        } catch {
          return result('realization-failure');
        } finally {
          if (staged) staged.wipe();
        }
      }
    }),
    signature: Object.freeze({
      verify(request) {
        const normalized = normalizeSignatureRequest(request);
        if (normalized.result) return normalized.result;
        if (!es256Available) return result('realization-failure');
        let staged;
        try {
          staged = stageEs256Frame(memory, normalized);
          if (!staged) return result('realization-failure');
          const code = verifyEs256(staged.pointer, staged.capacity);
          return result(RESULT_BY_CODE[String(code)] || 'realization-failure');
        } catch {
          return result('realization-failure');
        } finally {
          if (staged) staged.wipe();
        }
      }
    })
  });

  return Object.freeze({ verifier, realization });
}

module.exports = Object.freeze({
  NATIVE_CRYPTO_VERIFIER_VERSION,
  createNativeGuestSourceCryptoVerifier
});
