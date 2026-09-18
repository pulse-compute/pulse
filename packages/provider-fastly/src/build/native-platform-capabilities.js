'use strict';
const applicationErrors = require('./native-application-errors.js');

const crypto = require('node:crypto');
const { nativeStringFields, nativeStringConcat, nativeStringTrim, nativeStringIndex, needsNativeValueFailureGuard } = require('./native-string-values.js');
const conditionalKv = require('./kv-native.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CANONICAL_NATIVE_PLAN_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const {
  GUEST_UNIT_CONTRIBUTION_FIELDS,
  normalizeCanonicalGuestUnitContribution
} = require('@pulse-compute/wasm-contracts/package/package-contract');
const {
  EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION,
  appendAssemblyScriptOptimizationArgs
} = require('@pulse-compute/wasm-build-support/native-optimization');

function loadBuildSupport() {
  try { return require('@pulse-compute/wasm-build-support/assemblyscript-compile'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/build-support/src/assemblyscript-compile.js');
    }
    throw error;
  }
}

function loadNativeGenerator() {
  try { return require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/runtime-core-as/src/compiler/canonical-native.js');
    }
    throw error;
  }
}

function loadJwtNativeSource() {
  try { return require('@pulse-compute/jwt/pulsewasm-native'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../jwt/pulsewasm.native.cjs');
    }
    throw error;
  }
}

function loadGuestUnitStage() {
  try { return require('@pulse-compute/wasm-guest-link/stage'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/wasm-guest-link/src/stage.js');
    }
    throw error;
  }
}

function loadGuestMemoryContract() {
  try { return require('@pulse-compute/wasm-guest-link'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return require('../../../../wasm/packages/wasm-guest-link/src/index.js');
    }
    throw error;
  }
}

function loadGuestToolchain() {
  try { return require('@pulse-compute/wasm-guest-link/toolchain'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/wasm-guest-link/src/toolchain.js');
    }
    throw error;
  }
}

const { resolveAsc } = loadBuildSupport();
const { generateCanonicalNativeAssemblyScript } = loadNativeGenerator();
const { pulseJwtAssemblyScriptSource } = loadJwtNativeSource();
const {
  GUEST_LINK_STAGE_INVOCATION_VERSION,
  realizeGuestLinkStage
} = loadGuestUnitStage();
const { memoryAbiV2, es256FrameV2 } = loadGuestMemoryContract();
const { runTool: runGuestTool, binaryenIdentity } = loadGuestToolchain();

const FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION = 'pulse.fastly-native-platform-capabilities.v1';
const FASTLY_NATIVE_PLATFORM_CAPABILITIES_GENERATOR_VERSION = 'pulse.fastly-native-platform-capabilities-generator.v1';
const FASTLY_NATIVE_PLATFORM_CAPABILITIES_COMPILER_VERSION = 'pulse.fastly-native-platform-capabilities-compiler.v1';
const FASTLY_NATIVE_PLATFORM_CAPABILITIES_ABI_VERSION = 1;
const FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES = 1024 * 1024;
const FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES = 65536;
const FASTLY_NATIVE_SIZE_OPTIMIZATION = EXPERIMENTAL_NATIVE_SIZE_OPTIMIZATION;

const FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS = Object.freeze([
  ...conditionalKv.KV_IMPORTS.map((key) => Object.freeze(key.split(':'))),
  ...require('./s3-native.js').S3_IMPORTS.map((key) => Object.freeze(key.split(':'))),
  Object.freeze(['fastly_abi', 'init']),
  Object.freeze(['fastly_http_req', 'body_downstream_get']),
  Object.freeze(['fastly_http_req', 'method_get']),
  Object.freeze(['fastly_http_req', 'uri_get']),
  Object.freeze(['fastly_http_req', 'header_value_get']),
  Object.freeze(['fastly_http_req', 'header_names_get']),
  Object.freeze(['fastly_http_req', 'header_values_get']),
  Object.freeze(['fastly_http_req', 'new']),
  Object.freeze(['fastly_http_req', 'method_set']),
  Object.freeze(['fastly_http_req', 'uri_set']),
  Object.freeze(['fastly_http_req', 'header_insert']),
  Object.freeze(['fastly_http_req', 'send_async']),
  Object.freeze(['fastly_http_req', 'pending_req_wait']),
  Object.freeze(['fastly_http_resp', 'new']),
  Object.freeze(['fastly_http_resp', 'header_append']),
  Object.freeze(['fastly_http_resp', 'header_value_get']),
  Object.freeze(['fastly_http_resp', 'status_get']),
  Object.freeze(['fastly_http_resp', 'status_set']),
  Object.freeze(['fastly_http_resp', 'send_downstream']),
  Object.freeze(['fastly_http_body', 'new']),
  Object.freeze(['fastly_http_body', 'read']),
  Object.freeze(['fastly_http_body', 'write']),
  Object.freeze(['fastly_config_store', 'open']),
  Object.freeze(['fastly_config_store', 'get']),
  Object.freeze(['fastly_secret_store', 'open']),
  Object.freeze(['fastly_secret_store', 'get']),
  Object.freeze(['fastly_secret_store', 'plaintext']),
  Object.freeze(['fastly_kv_store', 'open']),
  Object.freeze(['fastly_kv_store', 'lookup']),
  Object.freeze(['fastly_kv_store', 'lookup_wait_v2']),
  Object.freeze(['fastly_kv_store', 'insert']),
  Object.freeze(['fastly_kv_store', 'insert_wait']),
  Object.freeze(['fastly_log', 'endpoint_get']),
  Object.freeze(['fastly_log', 'write']),
  Object.freeze(['wasi_snapshot_preview1', 'clock_time_get'])
].filter(([module, name], index, entries) => entries.findIndex((item) => item[0] === module && item[1] === name) === index));

const FASTLY_NATIVE_PLATFORM_CAPABILITIES_REQUIRED_IMPORTS = Object.freeze([
  Object.freeze(['fastly_abi', 'init']),
  Object.freeze(['fastly_http_req', 'body_downstream_get']),
  Object.freeze(['fastly_http_resp', 'send_downstream']),
  Object.freeze(['fastly_http_body', 'new']),
  Object.freeze(['fastly_http_body', 'write'])
]);

const FASTLY_NATIVE_PLATFORM_EFFECT_KIND = Object.freeze({
  fetch: 1,
  'config.get': 2,
  'secret.get': 3,
  'kv.get': 4,
  'kv.put': 5,
  'grip.channel': 6,
  'grip.hold': 7,
  'grip.publish': 8,
  'grip.broadcast': 9,
  'assets.lookup': 10,
  'jwt.verify': 11,
  'jwt.sign': 20,
  's3.head': 12,
  's3.getText': 13,
  's3.putText': 14,
  'kv.getVersioned': 15,
  'kv.insertIfAbsent': 16,
  'kv.compareAndSwap': 17,
  'time.now': 18,
  'crypto.digestText': 19
});

const FASTLY_NATIVE_PLATFORM_CAPABILITIES_ALLOWED_IMPORTS = new Set([
  ...FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS.map(([moduleName, name]) => `${moduleName}:${name}`)
]);

const FASTLY_NATIVE_PLATFORM_EFFECT_KINDS = Object.freeze([
  'time.now',
  'crypto.digestText',
  'fetch',
  'config.get',
  'secret.get',
  'kv.get',
  'kv.put',
  ...conditionalKv.KV_CONDITIONAL_KINDS,
  'grip.channel',
  'grip.hold',
  'grip.publish',
  'grip.broadcast',
  'assets.lookup',
  'jwt.verify',
  'jwt.sign',
  's3.head',
  's3.getText',
  's3.putText'
]);

const FASTLY_NATIVE_PLATFORM_CAPABILITY_KINDS = new Set([
  'time.now',
  'crypto.digestText',
  'config.get',
  'secret.get',
  'kv.get',
  'kv.put',
  ...conditionalKv.KV_CONDITIONAL_KINDS,
  'assets.lookup',
  'grip.channel',
  'grip.hold',
  'grip.publish',
  'grip.broadcast',
  'jwt.verify',
  'jwt.sign',
  's3.head',
  's3.getText',
  's3.putText'
]);

class FastlyNativePlatformCapabilitiesError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativePlatformCapabilitiesError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) if (value[key] !== undefined) output[key] = stableObject(value[key]);
  return output;
}

function stableStringify(value, space = 0) {
  return JSON.stringify(stableObject(value), null, space);
}

function canonicalGuestContribution(selection) {
  return normalizeCanonicalGuestUnitContribution(Object.fromEntries(
    GUEST_UNIT_CONTRIBUTION_FIELDS.map((field) => [field, selection && selection[field]])
  ));
}

function guestLinkOptimizationPosture(value) {
  return value
    && (
      value === true
      || value === 'experimental-native-size'
      || (typeof value === 'object' && value.mode === 'experimental-native-size')
    )
    ? 'native-size'
    : 'native-default';
}

function quote(value) {
  return JSON.stringify(String(value));
}

function fail(message, code, detail = {}) {
  throw new FastlyNativePlatformCapabilitiesError(message, code, detail);
}

function packageFacts(_plan, options = {}) {
  const realizationArtifacts = options.realizationArtifacts || [];
  const guestUnits = options.guestUnits || [];
  return Object.freeze({
    realizationArtifacts: Object.freeze([...realizationArtifacts]),
    guestUnits: Object.freeze([...guestUnits])
  });
}

function selectedJwtCrypto(plan) {
  const hasJwt = (plan.effects || []).some((effect) => effect.kind === 'jwt.verify');
  const hasSign = (plan.effects || []).some((effect) => effect.kind === 'jwt.sign');
  const signer = plan.crypto?.algorithms.find(entry => entry.algorithm === 'HMAC-SHA256');
  if (hasSign && (!signer || signer.realization !== 'guest-source:pulse-hmac-as'
    || signer.implementation !== 'pulse-hmac-as.v1' || signer.kind !== 'guest-source'
    || signer.targetImplemented !== true || signer.automaticFallback !== false)) {
    fail('JWT signing requires the explicitly selected HMAC-SHA256 guest.', 'PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID');
  }
  if (!hasJwt) return hasSign ? Object.freeze({ ...signer, guestUnitRequired: false }) : undefined;
  const algorithms = plan.crypto && Array.isArray(plan.crypto.algorithms)
    ? plan.crypto.algorithms.filter((entry) => ['HS256', 'ES256'].includes(entry.algorithm))
    : [];
  if (algorithms.length !== 1) {
    fail(
      'Fastly Native JWT requires one exact crypto realization.',
      'PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID',
      { algorithms, automaticFallback: false }
    );
  }
  const selected = algorithms[0];
  const hs256 = selected.algorithm === 'HS256'
    && selected.realization === 'guest-source:pulse-hmac-as'
    && selected.implementation === 'pulse-hmac-as.v1'
    && selected.kind === 'guest-source'
    && selected.targetImplemented === true;
  const es256 = selected.algorithm === 'ES256'
    && selected.realization === 'guest-linked:pulse-es256-rustcrypto-p256'
    && selected.implementation === 'rustcrypto.p256-0.13.2.ecdsa-0.16.9.sha2-0.10.9.v1'
    && selected.kind === 'guest-linked'
    && selected.targetImplemented === true;
  if ((!hs256 && !es256) || selected.automaticFallback !== false) {
    fail(
      'Fastly Native JWT selected an unavailable or non-exact crypto realization.',
      'PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID',
      { selected, automaticFallback: false }
    );
  }
  return Object.freeze({
    algorithm: selected.algorithm,
    realization: selected.realization,
    implementation: selected.implementation,
    kind: selected.kind,
    guestUnitRequired: es256,
    automaticFallback: false
  });
}

function decodeP256Coordinate(value, artifactId, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(
      'Fastly Native ES256 key artifacts require canonical base64url coordinates.',
      'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
      { artifactId, field }
    );
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) {
    fail(
      'Fastly Native ES256 key artifacts require exactly 32-byte coordinates.',
      'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
      { artifactId, field, bytes: bytes.length }
    );
  }
  return bytes;
}

function normalizedEs256Jwk(value, artifactId) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.kty !== 'EC'
    || value.crv !== 'P-256'
    || (value.alg !== undefined && value.alg !== 'ES256')
    || (value.use !== undefined && value.use !== 'sig')
    || (
      value.key_ops !== undefined
      && (
        !Array.isArray(value.key_ops)
        || value.key_ops.length !== 1
        || value.key_ops[0] !== 'verify'
      )
    )
    || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'x5c', 'x5u', 'x5t', 'x5t#S256']
      .some((name) => Object.prototype.hasOwnProperty.call(value, name))
  ) {
    fail(
      'Fastly Native ES256 key artifacts contain an invalid public JWK.',
      'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
      { artifactId }
    );
  }
  const x = decodeP256Coordinate(value.x, artifactId, 'x');
  const y = decodeP256Coordinate(value.y, artifactId, 'y');
  return Object.freeze({
    kid: value.kid === undefined ? undefined : String(value.kid),
    bytes: Buffer.concat([x, y])
  });
}

function resolveEs256KeyArtifacts(plan, facts) {
  const artifacts = new Map(facts.realizationArtifacts.map((artifact) => [
    String(artifact && artifact.id || ''),
    artifact
  ]));
  const records = [];
  for (const [effectIndex, effect] of (plan.effects || []).entries()) {
    if (effect.kind !== 'jwt.verify' || !['jwk', 'jwks'].includes(effect.resource.keyType)) {
      continue;
    }
    const artifactId = effect.resource.keyArtifactId;
    const artifact = artifacts.get(artifactId);
    if (
      !artifact
      || artifact.version !== 'pulse.jwt-es256-key-artifact.v1'
      || artifact.contractId !== 'pulse.jwt'
      || artifact.package !== '@pulse-compute/jwt'
      || artifact.kind !== 'jwt-es256-static-public-key'
      || artifact.mediaType !== 'application/vnd.pulse.jwt-es256-key+json'
      || artifact.id !== artifactId
      || artifact.materialHash !== sha256(stableStringify(artifact.data))
      || !artifact.data
      || artifact.data.type !== effect.resource.keyType
    ) {
      fail(
        'Fastly Native ES256 requires the exact private package key artifact selected by lowering.',
        'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
        { effectId: effect.id, artifactId, automaticFallback: false }
      );
    }
    const keys = artifact.data.type === 'jwk'
      ? [artifact.data.key]
      : artifact.data.keys;
    if (
      !Array.isArray(keys)
      || keys.length === 0
      || keys.length > 16
    ) {
      fail(
        'Fastly Native ES256 key artifacts require one bounded static JWK set.',
        'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
        { effectId: effect.id, artifactId, keyCount: keys && keys.length }
      );
    }
    const normalized = keys.map((key) => normalizedEs256Jwk(key, artifactId));
    const kids = normalized.map((key) => key.kid).filter((kid) => kid !== undefined);
    if (new Set(kids).size !== kids.length) {
      fail(
        'Fastly Native ES256 key artifacts reject duplicate kid values.',
        'PULSE_FASTLY_NATIVE_JWT_KEY_ARTIFACT_INVALID',
        { effectId: effect.id, artifactId }
      );
    }
    records.push(Object.freeze({
      effectIndex,
      effectId: effect.id,
      artifactId,
      type: artifact.data.type,
      materialHash: artifact.materialHash,
      keys: Object.freeze(normalized)
    }));
  }
  return Object.freeze(records);
}

function byteAssignments(name, bytes) {
  return [
    `function ${name}(): Uint8Array {`,
    `  const output = new Uint8Array(${bytes.length})`,
    ...[...bytes].map((value, index) => `  unchecked(output[${index}] = ${value})`),
    '  return output',
    '}'
  ].join('\n');
}

function es256KeyArtifactSource(records) {
  if (records.length === 0) {
    return 'function __pulse_fastly_jwt_resolve_es256_key(effectIndex: i32, kid: string | null): Uint8Array | null { void effectIndex; void kid; return null }';
  }
  const lines = [];
  for (const record of records) {
    for (const [keyIndex, key] of record.keys.entries()) {
      lines.push(byteAssignments(
        `__pulse_fastly_es256_key_${record.effectIndex}_${keyIndex}`,
        key.bytes
      ));
    }
  }
  lines.push(
    'function __pulse_fastly_jwt_resolve_es256_key(effectIndex: i32, kid: string | null): Uint8Array | null {',
    '  switch (effectIndex) {'
  );
  for (const record of records) {
    lines.push(`    case ${record.effectIndex}: {`);
    if (record.type === 'jwk') {
      const key = record.keys[0];
      if (key.kid !== undefined) {
        lines.push(`      if (kid !== null && kid != ${quote(key.kid)}) return null`);
      }
      lines.push(`      return __pulse_fastly_es256_key_${record.effectIndex}_0()`);
    } else {
      lines.push('      if (kid !== null) {');
      for (const [keyIndex, key] of record.keys.entries()) {
        if (key.kid !== undefined) {
          lines.push(`        if (kid == ${quote(key.kid)}) return __pulse_fastly_es256_key_${record.effectIndex}_${keyIndex}()`);
        }
      }
      lines.push('        return null', '      }');
      if (record.keys.length === 1) {
        lines.push(`      return __pulse_fastly_es256_key_${record.effectIndex}_0()`);
      } else {
        lines.push('      return null');
      }
    }
    lines.push('    }');
  }
  lines.push('    default: return null', '  }', '}');
  return lines.join('\n');
}

function jwtCryptoCompositionSource(selected) {
  if (!selected || selected.algorithm === 'HMAC-SHA256') {
    return [
      'function __pulse_fastly_jwt_capture_signing_input(input: Uint8Array): void { void input }',
      'function __pulse_fastly_jwt_crypto_verify(algorithm: string, key: Uint8Array, data: Uint8Array, signature: Uint8Array): i32 { void algorithm; void key; void data; void signature; return -3 }'
    ].join('\n');
  }
  if (selected.algorithm === 'HS256') {
    return String.raw`
function __pulse_fastly_jwt_capture_signing_input(input: Uint8Array): void {
  const digest = new Uint8Array(32)
  if (pulse_crypto_sha256_digest(input.dataStart, input.byteLength, digest.dataStart, digest.byteLength) == 1) {
    __pulse_fastly_jwt_record_signing_input(input.byteLength, __pulse_jwt_hex(digest))
  }
  for (let index: i32 = 0; index < digest.byteLength; index += 1) unchecked(digest[index] = 0)
}
function __pulse_fastly_jwt_crypto_verify(algorithm: string, key: Uint8Array, data: Uint8Array, signature: Uint8Array): i32 {
  if (algorithm != "HS256") return -2
  return pulse_crypto_hs256_verify(
    key.dataStart,
    key.byteLength,
    data.dataStart,
    data.byteLength,
    signature.dataStart,
    signature.byteLength,
  )
}`;
  }
  return String.raw`
const __PULSE_FASTLY_ES256_FRAME_POINTER: i32 = ${memoryAbiV2.layout.invocationFrame.start}
const __PULSE_FASTLY_ES256_FRAME_CAPACITY: i32 = ${es256FrameV2.capacityBytes}
function __pulse_fastly_es256_clear_frame(): void {
  for (let index: i32 = 0; index < __PULSE_FASTLY_ES256_FRAME_CAPACITY; index += 1) {
    store<u8>(__PULSE_FASTLY_ES256_FRAME_POINTER + index, 0)
  }
}
function __pulse_fastly_jwt_capture_signing_input(input: Uint8Array): void {
  __pulse_fastly_jwt_record_signing_input(input.byteLength, "")
}
function __pulse_fastly_jwt_crypto_verify(algorithm: string, key: Uint8Array, data: Uint8Array, signature: Uint8Array): i32 {
  if (algorithm != "ES256" || key.byteLength != 64 || signature.byteLength != 64 || data.byteLength > ${es256FrameV2.signingInputBytesMaximum}) return -2
  __pulse_fastly_es256_clear_frame()
  const totalLength = (192 + data.byteLength + 15) & ~15
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 0, ${es256FrameV2.magic})
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 4, ${es256FrameV2.version})
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 8, ${es256FrameV2.headerBytes})
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 12, totalLength)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 16, 1)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 20, 0)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 24, 192)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 28, data.byteLength)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 32, 64)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 36, 64)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 40, 128)
  store<u32>(__PULSE_FASTLY_ES256_FRAME_POINTER + 44, 64)
  for (let index: i32 = 0; index < key.byteLength; index += 1) store<u8>(__PULSE_FASTLY_ES256_FRAME_POINTER + 64 + index, unchecked(key[index]))
  for (let index: i32 = 0; index < signature.byteLength; index += 1) store<u8>(__PULSE_FASTLY_ES256_FRAME_POINTER + 128 + index, unchecked(signature[index]))
  for (let index: i32 = 0; index < data.byteLength; index += 1) store<u8>(__PULSE_FASTLY_ES256_FRAME_POINTER + 192 + index, unchecked(data[index]))
  const status = __pulse_crypto_es256_link_anchor(
    __PULSE_FASTLY_ES256_FRAME_POINTER,
    __PULSE_FASTLY_ES256_FRAME_CAPACITY,
  )
  __pulse_fastly_es256_clear_frame()
  return status
}`;
}

function fastlyGuestLinkedStartWrapperWat() {
  return `(module
  (import "pulse_fastly_primary" "__pulse_initialize" (func $initialize))
  (import "pulse_fastly_primary" "pulse_fastly_handle" (func $handle))
  (global $initialized (mut i32) (i32.const 0))
  (func (export "_start")
    (if (i32.eqz (global.get $initialized))
      (then
        (call $initialize)
        (global.set $initialized (i32.const 1))
      )
    )
    (call $handle)
  )
)
`;
}

function validatePlanBoundary(plan, options = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('Fastly native platform capability realization requires a canonical native plan.');
  if (plan.version !== CANONICAL_NATIVE_PLAN_VERSION) {
    fail(`Fastly native platform capability realization requires ${CANONICAL_NATIVE_PLAN_VERSION}.`, 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_PLAN_VERSION_UNSUPPORTED', { version: plan.version });
  }
  if (!plan.ownership || plan.ownership.providerNeutral !== true || plan.ownership.javascriptRuntime !== false) {
    fail('Fastly native platform capability realization requires a provider-neutral plan without JavaScript runtime ownership.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_PLAN_OWNERSHIP_INVALID', { ownership: plan.ownership });
  }
  const effects = plan.effects || [];
  const unsupported = effects.filter((effect) => !FASTLY_NATIVE_PLATFORM_EFFECT_KINDS.includes(effect.kind));
  if (unsupported.length > 0) {
    fail('Fastly native realization supports fetch, config, secret, KV, Assets, JWT, and the first-party GRIP capability contract.', 'PULSE_FASTLY_NATIVE_PLATFORM_EFFECT_KIND_UNSUPPORTED', {
      effects: unsupported.map((entry) => ({ id: entry.id, kind: entry.kind, package: entry.package, contractId: entry.contractId }))
    });
  }
  const platformEffects = effects.filter((effect) => FASTLY_NATIVE_PLATFORM_CAPABILITY_KINDS.has(effect.kind));
  if (platformEffects.length === 0 && options.requirePlatformCapability !== false) {
    fail('Pass98 requires at least one Fastly platform capability effect.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITY_REQUIRED');
  }
  const packageEffects = effects.filter((effect) => effect.package || effect.contractId);
  const unsupportedPackages = packageEffects.filter((effect) => {
    const grip = effect.package === '@pulse-compute/grip'
      && effect.contractId === 'pulse.grip'
      && String(effect.kind).startsWith('grip.');
    const assets = effect.package === '@pulse-compute/assets'
      && effect.contractId === 'pulse.assets'
      && effect.kind === 'assets.lookup';
    const jwt = effect.package === '@pulse-compute/jwt'
      && effect.contractId === 'pulse.jwt'
      && ['verify', 'sign'].includes(effect.operation)
      && effect.kind === `jwt.${effect.operation}` && effect.capability === effect.kind;
    const s3 = effect.package === '@pulse-compute/s3' && effect.contractId === 'pulse.s3'
      && ['head', 'getText', 'putText'].includes(effect.operation) && effect.kind === `s3.${effect.operation}` && effect.capability === effect.kind;
    const digest = effect.package === '@pulse-compute/crypto' && effect.contractId === 'pulse.crypto'
      && effect.operation === 'digestText' && effect.kind === 'crypto.digestText' && effect.capability === effect.kind;
    return !grip && !assets && !jwt && !s3 && !digest;
  });
  if (unsupportedPackages.length > 0) {
    fail('Fastly native realization only accepts the trusted first-party Assets, GRIP, JWT, S3, and Crypto digest package contracts.', 'PULSE_FASTLY_NATIVE_PLATFORM_PACKAGE_UNSUPPORTED', {
      effects: unsupportedPackages.map((entry) => ({ id: entry.id, kind: entry.kind, package: entry.package, contractId: entry.contractId }))
    });
  }
  const declaredPackageEffects = ((plan.packages && plan.packages.effects) || []);
  const unsupportedDeclarations = declaredPackageEffects.filter((effect) => {
    const grip = effect.package === '@pulse-compute/grip'
      && effect.contractId === 'pulse.grip'
      && String(effect.kind).startsWith('grip.');
    const assets = effect.package === '@pulse-compute/assets'
      && effect.contractId === 'pulse.assets'
      && effect.kind === 'assets.lookup';
    const jwt = effect.package === '@pulse-compute/jwt'
      && effect.contractId === 'pulse.jwt'
      && ['verify', 'sign'].includes(effect.operation)
      && effect.kind === `jwt.${effect.operation}` && effect.capability === effect.kind;
    const s3 = effect.package === '@pulse-compute/s3' && effect.contractId === 'pulse.s3'
      && ['head', 'getText', 'putText'].includes(effect.operation) && effect.kind === `s3.${effect.operation}` && effect.capability === effect.kind;
    const digest = effect.package === '@pulse-compute/crypto' && effect.contractId === 'pulse.crypto'
      && effect.operation === 'digestText' && effect.kind === 'crypto.digestText' && effect.capability === effect.kind;
    return !grip && !assets && !jwt && !s3 && !digest;
  });
  if (unsupportedDeclarations.length > 0) {
    fail('Fastly native package realization is restricted to the Assets, GRIP, JWT, S3, and Crypto digest contracts.', 'PULSE_FASTLY_NATIVE_PLATFORM_PACKAGE_UNSUPPORTED', { effects: unsupportedDeclarations });
  }
  for (const effect of effects.filter((entry) => ['jwt.verify', 'jwt.sign'].includes(entry.kind))) {
    const resource = effect.resource;
    const knownShape = resource
      && !Object.keys(resource)
        .some((name) => !['keyType', 'keyArtifactId', 'secretBinding'].includes(name));
    const namedSecret = knownShape
      && resource.keyType === 'secret'
      && resource.keyArtifactId === null
      && typeof resource.secretBinding === 'string'
      && resource.secretBinding.length > 0;
    const staticPublicKey = knownShape
      && ['jwk', 'jwks'].includes(resource.keyType)
      && typeof resource.keyArtifactId === 'string'
      && resource.keyArtifactId.length > 0
      && resource.secretBinding === null;
    if (!namedSecret && (!staticPublicKey || effect.kind === 'jwt.sign')) {
      fail('Fastly Native JWT requires one exact named-secret or bounded static public-key descriptor.', 'PULSE_FASTLY_NATIVE_JWT_KEY_DESCRIPTOR_INVALID', {
        effectId: effect.id,
        resource,
        automaticFallback: false
      });
    }
  }
  if (!plan.entry || !Array.isArray(plan.entry.body)) {
    fail('Fastly native platform capability realization requires a canonical handler entry body.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_ENTRY_INVALID');
  }
  return plan;
}

function literalOriginFromExpression(expression) {
  if (!expression || typeof expression !== 'object') return undefined;
  if (expression.kind === 'literal' && typeof expression.value === 'string') {
    try { return new URL(expression.value).origin; }
    catch (_) { return undefined; }
  }
  if (expression.kind === 'template') {
    const first = (expression.parts || [])[0];
    if (first && first.kind === 'text') {
      try { return new URL(first.value).origin; }
      catch (_) { return undefined; }
    }
  }
  return undefined;
}

function stringBinding(value, label, code, detail = {}) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  if (!normalized) fail(`${label} is required for Pass98 native Fastly realization.`, code, detail);
  return normalized;
}

function inputExpression(effect, name) {
  const found = (effect.inputs || []).find((entry) => entry.name === name);
  return found && found.value;
}

function literalString(expression) {
  return expression && expression.kind === 'literal' && typeof expression.value === 'string'
    ? expression.value
    : undefined;
}

function literalObjectField(expression, name) {
  if (!expression || expression.kind !== 'object' || !Array.isArray(expression.entries)) return undefined;
  const entry = expression.entries.find((item) => item
    && item.kind === 'property'
    && item.key
    && item.key.kind === 'literal'
    && item.key.value === name);
  return entry && literalString(entry.value);
}

function resolveCapabilityBindings(plan, options = {}) {
  const source = options.bindings && typeof options.bindings === 'object' ? options.bindings : options;
  const byEffect = source.effectBackends || options.effectBackends || {};
  const byOrigin = source.backends || options.backends || {};
  const kvMap = source.kv || options.kv || {};
  const gripInput = source.grip || options.grip || {};
  const effects = plan.effects || [];
  const hasConfig = effects.some((effect) => effect.kind === 'config.get');
  const hasSecret = effects.some((effect) => (
    effect.kind === 'secret.get' || ['s3.head', 's3.getText', 's3.putText'].includes(effect.kind)
    || (['jwt.verify', 'jwt.sign'].includes(effect.kind) && effect.resource && effect.resource.keyType === 'secret')
  ));
  const hasGripHold = effects.some((effect) => effect.kind === 'grip.hold');
  const hasGripBroadcast = effects.some((effect) => effect.kind === 'grip.broadcast');
  const hasGripPublish = effects.some((effect) => effect.kind === 'grip.publish') || hasGripBroadcast;
  const gripAuthentication = gripInput.authentication && typeof gripInput.authentication === 'object'
    ? gripInput.authentication
    : undefined;
  const gripSecretRef = gripAuthentication && String(gripAuthentication.secretRef || '').trim();
  if (gripAuthentication && String(gripAuthentication.scheme || 'bearer').toLowerCase() !== 'bearer') {
    fail('Fastly GRIP broadcast supports only bearer authentication.', 'PULSE_FASTLY_NATIVE_GRIP_AUTH_SCHEME_UNSUPPORTED');
  }
  if (gripAuthentication && !gripSecretRef) {
    fail('Fastly GRIP bearer authentication requires a named secret reference.', 'PULSE_FASTLY_NATIVE_GRIP_SECRET_REFERENCE_MISSING');
  }
  const configStore = hasConfig
    ? stringBinding(source.configStore, 'Fastly configStore binding', 'PULSE_FASTLY_NATIVE_CONFIG_STORE_MISSING')
    : '';
  const secretStore = hasSecret || gripSecretRef
    ? stringBinding(source.secretStore, 'Fastly secretStore binding', 'PULSE_FASTLY_NATIVE_SECRET_STORE_MISSING')
    : '';

  const kv = [];
  for (const [index, effect] of effects.entries()) {
    if (effect.kind !== 'kv.get' && effect.kind !== 'kv.put' && !conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind) && effect.kind !== 'assets.lookup') continue;
    const packagePayload = inputExpression(effect, 'payload');
    const logical = effect.resource && effect.resource.kind === 'literal'
      && effect.kind !== 'assets.lookup'
      ? String(effect.resource.value)
      : literalString(inputExpression(effect, 'store')) || literalObjectField(packagePayload, 'store');
    if (!logical) {
      fail(`KV-backed effect ${effect.id} requires a static logical namespace.`, 'PULSE_FASTLY_NATIVE_KV_NAMESPACE_DYNAMIC', {
        effectId: effect.id,
        resource: effect.resource
      });
    }
    if (conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind) && Buffer.byteLength(logical, 'utf8') > conditionalKv.KV_CONDITIONAL_LIMITS.namespaceBytes) fail('Conditional KV namespace exceeds its portable bound.', 'PULSE_FASTLY_NATIVE_KV_NAMESPACE_DYNAMIC');
    const physical = stringBinding(
      kvMap[logical],
      `Fastly KV binding for ${logical}`,
      'PULSE_FASTLY_NATIVE_KV_STORE_MISSING',
      { logical, effectId: effect.id }
    );
    kv.push(Object.freeze({ index, effectId: effect.id, kind: effect.kind, logical, physical }));
  }

  if (hasGripHold && gripInput.directHold === false) {
    fail(
      'Pass98 realizes direct GRIP hold headers only; Fanout handoff remains outside this atomic pass.',
      'PULSE_FASTLY_NATIVE_GRIP_FANOUT_DEFERRED'
    );
  }

  const backends = [];
  const fetch = [];
  const gripPublish = [];
  let publishUrl = '';
  let publishBackend = '';
  if (hasGripPublish) {
    publishUrl = stringBinding(
      hasGripBroadcast ? gripInput.publishEndpoint : (gripInput.publishUrl || gripInput.publishEndpoint),
      hasGripBroadcast ? 'Fastly GRIP publishEndpoint binding' : 'Fastly GRIP publishUrl binding',
      'PULSE_FASTLY_NATIVE_GRIP_PUBLISH_URL_MISSING'
    );
    let derivedBackend;
    try { derivedBackend = byOrigin[new URL(publishUrl).origin]; }
    catch (_) { /* stringBinding below reports a stable binding diagnostic */ }
    publishBackend = stringBinding(
      gripInput.publishBackend || derivedBackend,
      'Fastly GRIP publish backend binding',
      'PULSE_FASTLY_NATIVE_GRIP_PUBLISH_BACKEND_MISSING'
    );
  }

  for (const [index, effect] of effects.entries()) {
    if (effect.kind !== 'fetch' && effect.kind !== 'grip.publish' && effect.kind !== 'grip.broadcast') continue;
    let origin = null;
    let url = null;
    let backend;
    if (effect.kind === 'grip.publish' || effect.kind === 'grip.broadcast') {
      url = publishUrl;
      try { origin = new URL(url).origin; }
      catch (_) { origin = null; }
      backend = publishBackend;
    } else {
      const urlInput = inputExpression(effect, 'url');
      origin = effect.resource && effect.resource.origin
        ? String(effect.resource.origin)
        : literalOriginFromExpression(urlInput) || null;
      backend = byEffect[effect.id]
        || (origin && byOrigin[origin])
        || (effect.resource && effect.resource.value && byOrigin[effect.resource.value]);
      if ((typeof backend !== 'string' || backend.trim() === '') && !origin) {
        const configured = [...new Set(Object.values(byOrigin).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
        if (configured.length === 1) backend = configured[0];
      }
      if (typeof backend !== 'string' || backend.trim() === '') {
        fail(`Fastly native effect ${effect.id} has no static backend binding.`, 'PULSE_FASTLY_BACKEND_REQUIRED', {
          effectId: effect.id,
          effectIndex: index,
          origin,
          hint: `Provide bindings.backends[${JSON.stringify(origin || '<origin>')}] or an explicit effect backend.`
        });
      }
      backend = backend.trim();
    }
    const binding = Object.freeze({
      index,
      effectId: effect.id,
      kind: effect.kind,
      origin,
      url,
      backend,
      ...(effect.kind === 'grip.broadcast' && gripSecretRef ? { authSecretRef: gripSecretRef } : {})
    });
    backends.push(binding);
    if (effect.kind === 'fetch') fetch.push(binding);
    else gripPublish.push(binding);
  }

  return Object.freeze({
    maxDurationMs: require('@pulse-compute/runtime/host').normalizeRequestDuration(options.maxDurationMs),
    configStore,
    secretStore,
    s3: require('../toolchain/s3.js').resolveFastlyS3(effects.map((effect) => ({ ...effect, payload: { contentType: literalObjectField(inputExpression(effect, 'payload'), 'contentType') || undefined } })), source.s3),
    kv: Object.freeze(kv),
    fetch: Object.freeze(fetch),
    backends: Object.freeze(backends),
    grip: Object.freeze({
      directHold: gripInput.directHold !== false,
      authentication: gripSecretRef ? Object.freeze({ scheme: 'bearer', secretRef: gripSecretRef }) : undefined,
      publish: Object.freeze(gripPublish)
    })
  });
}

function planRequiresFetchBodyRead(plan) {
  for (const effect of plan.effects || []) {
    if (effect.kind !== 'fetch') continue;
    const result = effect.result || {};
    const decoder = effect.decoder || result.decoder;
    const decoderKind = typeof decoder === 'string' ? decoder : decoder && decoder.kind;
    if (result.valueKind === 'json' || result.valueKind === 'text' || decoderKind === 'json' || decoderKind === 'text') return true;
  }

  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (
      value.kind === 'method-call' &&
      (value.method === 'json' || value.method === 'text') &&
      value.receiver && value.receiver.valueKind === 'fetch-response'
    ) return true;
    if (Array.isArray(value)) return value.some(visit);
    return Object.values(value).some(visit);
  }
  return visit(plan.entry);
}

function requiredImportsForPlan(plan, bindings) {
  const keys = new Set([
    'fastly_abi:init',
    'fastly_http_req:body_downstream_get',
    'fastly_http_req:method_get',
    'fastly_http_req:uri_get',
    'fastly_http_resp:new',
    'fastly_http_resp:status_set',
    'fastly_http_resp:send_downstream',
    'fastly_http_body:new',
    'fastly_http_body:write'
  ]);
  if (bindings && bindings.maxDurationMs !== undefined) { keys.add('wasi_snapshot_preview1:clock_time_get'); keys.add('fastly_async_io:select'); }
  const kinds = new Set((plan.effects || []).map((effect) => effect.kind));
  if (kinds.has('fetch') || kinds.has('grip.publish') || kinds.has('grip.broadcast')) {
    for (const key of [
      'fastly_http_req:new', 'fastly_http_req:method_set', 'fastly_http_req:uri_set',
      'fastly_http_req:header_insert', 'fastly_http_req:send_async', 'fastly_http_req:pending_req_wait'
    ]) keys.add(key);
  }
  if (planRequiresFetchBodyRead(plan)) keys.add('fastly_http_body:read');
  if (kinds.has('config.get')) for (const key of ['fastly_config_store:open', 'fastly_config_store:get']) keys.add(key);
  const gripAuthenticationRequired = kinds.has('grip.broadcast')
    && (!bindings || Boolean(bindings.grip && bindings.grip.authentication));
  const jwtSecretRequired = (plan.effects || []).some((effect) => (
    ['jwt.verify', 'jwt.sign'].includes(effect.kind)
    && effect.resource
    && effect.resource.keyType === 'secret'
  ));
  if (kinds.has('secret.get') || jwtSecretRequired || gripAuthenticationRequired) {
    for (const key of ['fastly_secret_store:open', 'fastly_secret_store:get', 'fastly_secret_store:plaintext']) keys.add(key);
  }
  for (const kind of conditionalKv.KV_CONDITIONAL_KINDS) if (kinds.has(kind)) for (const key of conditionalKv.kvImports(kind)) keys.add(key);
  if (kinds.has('jwt.verify') || kinds.has('jwt.sign') || kinds.has('time.now')) keys.add('wasi_snapshot_preview1:clock_time_get');
  if (kinds.has('kv.get') || kinds.has('kv.put') || kinds.has('assets.lookup')) keys.add('fastly_kv_store:open');
  if (kinds.has('kv.get') || kinds.has('assets.lookup')) for (const key of ['fastly_kv_store:lookup', 'fastly_kv_store:lookup_wait_v2', 'fastly_http_body:read']) keys.add(key);
  if (kinds.has('kv.put')) for (const key of ['fastly_kv_store:insert', 'fastly_kv_store:insert_wait']) keys.add(key);
  if (kinds.has('grip.hold')) keys.add('fastly_http_resp:header_append');
  if (plan.logging && plan.logging.enabledStatements > 0) {
    keys.add('fastly_log:endpoint_get');
    keys.add('fastly_log:write');
  }
  if (kinds.has('s3.head') || kinds.has('s3.getText') || kinds.has('s3.putText')) for (const key of require('./s3-native.js').S3_IMPORTS) keys.add(key);
  return Object.freeze([...keys].sort());
}

function stripPulseHostImports(source) {
  return String(source)
    .split('\n')
    .filter((line) => !line.startsWith('@external("pulse_host",'))
    .join('\n');
}

function generateSchemaRuntime(plan) {
  const registry = plan.schemas && plan.schemas.registry ? plan.schemas.registry : { schemas: [], maxBytes: FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES, contentTypePolicy: 'accept-json-or-missing' };
  const schemas = registry.schemas || [];
  const nodeLines = [];
  let nodeIndex = 0;

  function emitNode(schemaIndex, node) {
    const currentIndex = nodeIndex++;
    const functionName = `__pulse_fastly_schema_${schemaIndex}_${currentIndex}`;
    const child = node.kind === 'nullable'
      ? emitNode(schemaIndex, node.value)
      : node.kind === 'array'
        ? emitNode(schemaIndex, node.element)
        : undefined;
    const fields = node.kind === 'object'
      ? node.fields.map((field) => Object.freeze({ field, apply: emitNode(schemaIndex, field.value) }))
      : [];
    const body = [`function ${functionName}(valueHandle: i32): i32 {`, '  const input = __pulse_fastly_value(valueHandle)'];
    if (node.kind === 'nullable') {
      body.push('  if (input.kind == PULSE_VALUE_NULL) return valueHandle');
      body.push(`  return ${child}(valueHandle)`);
    } else if (node.kind === 'array') {
      body.push('  if (input.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  const output = host_value_array()');
      body.push('  for (let index = 0; index < input.values.length; index += 1) {');
      body.push(`    const item = ${child}(unchecked(input.values[index]))`);
      body.push('    if (item <= 0) return 0');
      body.push('    host_value_array_push(output, item)');
      body.push('  }');
      body.push('  return output');
    } else if (node.kind === 'object') {
      body.push('  if (input.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 50, -1); return 0 }');
      body.push('  const output = host_value_object()');
      fields.forEach(({ field, apply }, fieldIndex) => {
        body.push(`  const key_${currentIndex}_${fieldIndex} = __pulse_fastly_string_value(${quote(field.name)})`);
        if (!field.required) body.push(`  if (__pulse_fastly_find(input, ${quote(field.name)}) >= 0) {`);
        body.push(`  const field_${currentIndex}_${fieldIndex} = host_value_property(valueHandle, key_${currentIndex}_${fieldIndex})`);
        body.push(`  if (__pulse_fastly_value(field_${currentIndex}_${fieldIndex}).kind == PULSE_VALUE_UNDEFINED) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 51, -1); return 0 }`);
        body.push(`  const projected_${currentIndex}_${fieldIndex} = ${apply}(field_${currentIndex}_${fieldIndex})`);
        body.push(`  if (projected_${currentIndex}_${fieldIndex} <= 0) return 0`);
        body.push(`  host_value_object_set(output, key_${currentIndex}_${fieldIndex}, projected_${currentIndex}_${fieldIndex})`);
        if (!field.required) body.push('  }');
      });
      body.push('  return output');
    } else if (node.kind === 'string') {
      body.push('  if (input.kind != PULSE_VALUE_STRING) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'boolean') {
      body.push('  if (input.kind != PULSE_VALUE_BOOLEAN) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'i32') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number) || input.number < -2147483648.0 || input.number > 2147483647.0 || Math.floor(input.number) != input.number) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'u32') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number) || input.number < 0.0 || input.number > 4294967295.0 || Math.floor(input.number) != input.number) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'f64') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number)) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'string-enum') {
      const allowed = node.values.map((value) => `input.text == ${quote(value)}`).join(' || ') || 'false';
      body.push(`  if (input.kind != PULSE_VALUE_STRING || !(${allowed})) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 54, -1); return 0 }`);
      body.push('  return valueHandle');
    } else {
      throw new TypeError(`Unsupported Fastly native schema node ${String(node.kind)}.`);
    }
    body.push('}', '');
    nodeLines.push(...body);
    return functionName;
  }

  const roots = schemas.map((schema, schemaIndex) => emitNode(schemaIndex, schema.root));
  const lines = [
    `const __PULSE_SCHEMA_MAX_BYTES: i32 = ${Number(registry.maxBytes || FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES)}`,
    `const __PULSE_SCHEMA_REQUIRE_JSON: bool = ${registry.contentTypePolicy === 'require-json' ? 'true' : 'false'}`,
    '',
    ...nodeLines,
    'function __pulse_fastly_schema_apply(schemaId: string, valueHandle: i32, encode: bool): i32 {',
    '  if (schemaId.length == 0) return valueHandle'
  ];
  for (const [schemaIndex, schema] of schemas.entries()) {
    lines.push(`${schemaIndex === 0 ? '  if' : '  else if'} (schemaId == ${quote(schema.id)}) {`);
    lines.push(`    const projected = ${roots[schemaIndex]}(valueHandle)`);
    lines.push('    if (projected <= 0) return 0');
    lines.push('    const input = __pulse_fastly_json(projected, 0)');
    lines.push(`    const normalized = encode ? __pulse_schema_encode_${schemaIndex}(input) : __pulse_schema_decode_${schemaIndex}(input)`);
    lines.push('    return __pulse_fastly_parse_json(normalized)');
    lines.push('  }');
  }
  lines.push('  __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1)');
  lines.push('  return 0');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function effectResultSource(plan, bindings) {
  const lines = ['function __pulse_fastly_effect_kind(effectIndex: i32): i32 {', '  switch (effectIndex) {'];
  for (const [index, effect] of (plan.effects || []).entries()) lines.push(`    case ${index}: return ${FASTLY_NATIVE_PLATFORM_EFFECT_KIND[effect.kind]}`);
  lines.push('    default: return 0', '  }', '}', '');

  lines.push('function __pulse_fastly_backend(effectIndex: i32): string {', '  switch (effectIndex) {');
  for (const binding of bindings.backends) lines.push(`    case ${binding.index}: return ${quote(binding.backend)}`);
  lines.push('    default: return ""', '  }', '}', '');

  lines.push(`function __pulse_fastly_config_store(effectIndex: i32): string { return ${quote(bindings.configStore)} }`, '');
  lines.push(`function __pulse_fastly_secret_store(effectIndex: i32): string { return ${quote(bindings.secretStore)} }`, '');
  lines.push('function __pulse_fastly_jwt_secret_binding(effectIndex: i32): string {', '  switch (effectIndex) {');
  for (const [index, effect] of (plan.effects || []).entries()) {
    if (['jwt.verify', 'jwt.sign'].includes(effect.kind) && effect.resource.keyType === 'secret') {
      lines.push(`    case ${index}: return ${quote(effect.resource.secretBinding)}`);
    }
  }
  lines.push('    default: return ""', '  }', '}', '');
  lines.push('function __pulse_fastly_kv_store(effectIndex: i32): string {', '  switch (effectIndex) {');
  for (const binding of bindings.kv) lines.push(`    case ${binding.index}: return ${quote(binding.physical)}`);
  lines.push('    default: return ""', '  }', '}', '');
  lines.push('function __pulse_fastly_grip_publish_url(effectIndex: i32): string {', '  switch (effectIndex) {');
  for (const binding of bindings.grip.publish) lines.push(`    case ${binding.index}: return ${quote(binding.url)}`);
  lines.push('    default: return ""', '  }', '}', '');
  lines.push('function __pulse_fastly_grip_auth_ref(effectIndex: i32): string {', '  switch (effectIndex) {');
  for (const binding of bindings.grip.publish) lines.push(`    case ${binding.index}: return ${quote(binding.authSecretRef || '')}`);
  lines.push('    default: return ""', '  }', '}', '');

  lines.push('function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {');
  lines.push('  switch (effectIndex) {');
  for (const [index, effect] of (plan.effects || []).entries()) {
    const result = effect.result || {};
    const decoder = result.decoder;
    const waiter = conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind) ? '__pulse_fastly_kv_conditional_wait' : ['s3.head', 's3.getText', 's3.putText'].includes(effect.kind) ? '__pulse_fastly_s3_wait' : effect.kind === 'fetch'
      ? '__pulse_fastly_wait_fetch'
      : effect.kind === 'grip.publish'
        ? '__pulse_fastly_wait_grip_publish'
        : effect.kind === 'grip.broadcast'
          ? '__pulse_fastly_wait_grip_broadcast'
        : effect.kind === 'assets.lookup'
          ? '__pulse_fastly_wait_assets'
        : effect.kind === 'kv.get'
        ? '__pulse_fastly_wait_kv_get'
        : effect.kind === 'kv.put'
          ? '__pulse_fastly_wait_kv_put'
          : '__pulse_fastly_wait_ready';
    lines.push(`    case ${index}: {`);
    lines.push(`      const response = ${waiter}(effectIndex)`);
    lines.push('      if (response <= 0) return 0');
    if (effect.kind === 'fetch' && (result.valueKind === 'json' || (decoder && decoder.kind === 'json' && result.valueKind !== 'fetch-response'))) {
      const args = (decoder && decoder.arguments) || [];
      const schemaId = args.length === 1 && args[0].kind === 'literal' && typeof args[0].value === 'string' ? args[0].value : '';
      lines.push(`      return host_fetch_json(response, ${schemaId ? `__pulse_fastly_string_value(${quote(schemaId)})` : 'host_value_undefined()'})`);
    } else if (effect.kind === 'fetch' && (result.valueKind === 'text' || (decoder && decoder.kind === 'text'))) {
      lines.push('      return host_fetch_text(response)');
    } else {
      lines.push('      return response');
    }
    lines.push('    }');
  }
  lines.push('    default: __pulse_fastly_fail(PULSE_ERROR_STATE, 61, effectIndex); return 0');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function effectDispatchSource(plan) {
  const handlerByKind = Object.freeze({
    'time.now': '__pulse_fastly_time_begin',
    'crypto.digestText': '__pulse_fastly_digest_begin',
    fetch: '__pulse_fastly_fetch_begin',
    'config.get': '__pulse_fastly_config_begin',
    'secret.get': '__pulse_fastly_secret_begin',
    'jwt.verify': '__pulse_fastly_jwt_begin',
    'jwt.sign': '__pulse_fastly_jwt_sign_begin',
    's3.head': '__pulse_fastly_s3_begin',
    's3.getText': '__pulse_fastly_s3_begin',
    's3.putText': '__pulse_fastly_s3_begin',
    'kv.get': '__pulse_fastly_kv_get_begin',
    'kv.put': '__pulse_fastly_kv_put_begin',
    ...Object.fromEntries(conditionalKv.KV_CONDITIONAL_KINDS.map(kind => [kind, '__pulse_fastly_kv_conditional_begin'])),
    'assets.lookup': '__pulse_fastly_assets_begin',
    'grip.channel': '__pulse_fastly_grip_channel_begin',
    'grip.hold': '__pulse_fastly_grip_hold_begin',
    'grip.publish': '__pulse_fastly_grip_publish_begin',
    'grip.broadcast': '__pulse_fastly_grip_publish_begin'
  });
  const kinds = [...new Set((plan.effects || []).map((effect) => effect.kind))];
  const lines = [
    'function host_effect_begin(effectIndex: i32, payload: i32): void {',
    ...(needsNativeValueFailureGuard(plan) ? ['  if (__pulse_fastly_last_error != PULSE_ERROR_NONE) return'] : []),
    '  if (effectIndex < 0 || effectIndex >= PULSE_FASTLY_EFFECT_COUNT || unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_NONE) { __pulse_fastly_fail(PULSE_ERROR_STATE, 46, effectIndex); return }',
    '  const payloadValue = __pulse_fastly_value(payload)',
    '  if (payloadValue.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 47, effectIndex); return }',
    '  unchecked(__pulse_fastly_payloads[effectIndex] = payload)',
    '  const kind = __pulse_fastly_effect_kind(effectIndex)'
  ];
  const handlers = kinds
    .map((kind) => Object.freeze({ kind, handler: handlerByKind[kind] }))
    .filter((entry) => entry.handler);
  handlers.forEach((entry, index) => {
    lines.push(`  ${index === 0 ? 'if' : 'else if'} (kind == ${FASTLY_NATIVE_PLATFORM_EFFECT_KIND[entry.kind]}) ${entry.handler}(effectIndex, payloadValue)`);
  });
  lines.push(handlers.length === 0
    ? '  __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 123, effectIndex)'
    : '  else __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 123, effectIndex)');
  lines.push('}');
  return lines.join('\n');
}

function fastlyRuntimeSource(plan, bindings, options = {}) {
  const effectCount = (plan.effects || []).length;
  const jwtCrypto = options.jwtCrypto || selectedJwtCrypto(plan);
  const es256KeyRecords = options.es256KeyRecords || Object.freeze([]);
  const jwtReality = options.jwtReality && options.jwtReality.enabled === true
    ? options.jwtReality
    : undefined;
  const jwtCaseSource = jwtReality
    ? '__pulse_fastly_request_header_text("x-pulse-e2-case")'
    : '""';
  const jwtWrongSecretBinding = jwtReality && String(jwtReality.wrongSecretBinding || '').trim();
  const jwtShortSecretBinding = jwtReality && String(jwtReality.shortSecretBinding || '').trim();
  const jwtClockOverride = jwtReality && Number.isFinite(Number(jwtReality.clockUnixSeconds))
    ? `${Number(jwtReality.clockUnixSeconds)}.0`
    : '';
  const jwtBindingOverrides = [
    jwtWrongSecretBinding ? `if (caseId == "wrong-key") return ${quote(jwtWrongSecretBinding)};` : '',
    jwtShortSecretBinding ? `if (caseId == "undersized-secret") return ${quote(jwtShortSecretBinding)};` : ''
  ].filter(Boolean).join('; ');
  const jwtEvidenceSource = jwtReality
    ? String.raw`
function __pulse_fastly_jwt_error_name(): string {
  if (__pulse_fastly_jwt_error == 0) return ""
  if (__pulse_fastly_jwt_error == 1) return "PULSE_JWT_TOKEN_REQUIRED"
  if (__pulse_fastly_jwt_error == 2) return "PULSE_JWT_BEARER_INVALID"
  if (__pulse_fastly_jwt_error == 3) return "PULSE_JWT_MALFORMED"
  if (__pulse_fastly_jwt_error == 4) return "PULSE_JWT_LIMIT_EXCEEDED"
  if (__pulse_fastly_jwt_error == 5) return "PULSE_JWT_ALGORITHM_NOT_ALLOWED"
  if (__pulse_fastly_jwt_error == 6) return "PULSE_JWT_KEY_INVALID"
  if (__pulse_fastly_jwt_error == 7) return "PULSE_JWT_SIGNATURE_INVALID"
  if (__pulse_fastly_jwt_error == 8) return "PULSE_JWT_CLOCK_INVALID"
  if (__pulse_fastly_jwt_error == 9) return "PULSE_JWT_CLAIMS_INVALID"
  if (__pulse_fastly_jwt_error == 10) return "PULSE_JWT_CLAIMS_SCHEMA_INVALID"
  if (__pulse_fastly_jwt_error == 11) return "PULSE_JWT_OPERATION_FAILED"
  return "PULSE_RUNTIME_FAILED"
}
function __pulse_fastly_jwt_evidence_headers(output: __PulseFastlyValue): void {
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-status", __pulse_fastly_jwt_error == 0 ? "success" : "error"))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-code", __pulse_fastly_jwt_error_name()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-category", __pulse_fastly_jwt_error == 11 ? "crypto-realization" : ""))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-case", __pulse_fastly_jwt_case_id()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-secret-calls", __pulse_fastly_jwt_secret_calls.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-crypto-calls", __pulse_fastly_jwt_crypto_calls.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-clock-calls", __pulse_fastly_jwt_clock_calls.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-schema-calls", __pulse_fastly_jwt_schema_calls.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-claims-parsed", __pulse_fastly_jwt_claims_parsed.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-verified", __pulse_fastly_jwt_verified.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-order", __pulse_fastly_jwt_event_order))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-signing-bytes", __pulse_fastly_jwt_signing_input_bytes.toString()))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-signing-sha256", __pulse_fastly_jwt_signing_input_sha256))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-realization", ${quote(jwtCrypto && jwtCrypto.realization || "")}))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-implementation", ${quote(jwtCrypto && jwtCrypto.implementation || "")}))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-fallback", "false"))
  output.headers.push(new __PulseFastlyHeader("x-pulse-e2-realization-attempts", __pulse_fastly_jwt_crypto_calls.toString()))
}
function __pulse_fastly_jwt_attach_evidence(handle: i32): void {
  const value = __pulse_fastly_value(handle)
  if (value.kind == PULSE_VALUE_RESPONSE) __pulse_fastly_jwt_evidence_headers(value)
}
function __pulse_fastly_jwt_send_error(): void {
  const output = new __PulseFastlyValue()
  output.kind = PULSE_VALUE_RESPONSE
  output.status = 400
  output.text = ""
  output.headers.push(new __PulseFastlyHeader("content-type", "text/plain; charset=utf-8"))
  __pulse_fastly_jwt_evidence_headers(output)
  __pulse_fastly_send_result(__pulse_fastly_put(output))
}
`
    : String.raw`
function __pulse_fastly_jwt_attach_evidence(handle: i32): void { void handle }
function __pulse_fastly_jwt_send_error(): void {}
`;
  const gripAuthentication = bindings.grip && bindings.grip.authentication;
  const gripSecretSource = gripAuthentication
    ? 'function __pulse_fastly_grip_secret(effectIndex: i32, name: string): string { const store = __pulse_fastly_open_secret_store(effectIndex); if (__pulse_fastly_last_error != 0) return ""; const keyBytes = __pulse_fastly_utf8(name); const secretOut = __pulse_fastly_out_i32(); let status = fastly_secret_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, changetype<usize>(secretOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 140, effectIndex); return "" } const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); status = fastly_secret_store_plaintext(__pulse_fastly_out_value(secretOut), buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 141, effectIndex); return "" } return __pulse_fastly_remember_secret(__pulse_fastly_decode(buffer, __pulse_fastly_out_value(written))) }'
    : '';
  const gripAuthorizationSource = gripAuthentication
    ? `const secret = __pulse_fastly_grip_secret(effectIndex, ${quote(gripAuthentication.secretRef)}); if (__pulse_fastly_last_error != 0) return; headers.keys.push("authorization"); headers.values.push(__pulse_fastly_string_value("Bearer " + secret));`
    : '';
  return String.raw`
@external("fastly_abi", "init") declare function fastly_abi_init(version: i64): i32
@external("fastly_http_req", "body_downstream_get") declare function fastly_http_req_body_downstream_get(requestOut: usize, bodyOut: usize): i32
@external("fastly_http_req", "method_get") declare function fastly_http_req_method_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "uri_get") declare function fastly_http_req_uri_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "header_value_get") declare function fastly_http_req_header_value_get(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "new") declare function fastly_http_req_new(handleOut: usize): i32
@external("fastly_http_req", "method_set") declare function fastly_http_req_method_set(handle: i32, method: usize, methodLength: i32): i32
@external("fastly_http_req", "uri_set") declare function fastly_http_req_uri_set(handle: i32, uri: usize, uriLength: i32): i32
@external("fastly_http_req", "header_insert") declare function fastly_http_req_header_insert(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32
@external("fastly_http_req", "send_async") declare function fastly_http_req_send_async(handle: i32, body: i32, backend: usize, backendLength: i32, pendingOut: usize): i32
@external("fastly_http_req", "pending_req_wait") declare function fastly_http_req_pending_req_wait(handle: i32, responseOut: usize, bodyOut: usize): i32
@external("fastly_http_resp", "new") declare function fastly_http_resp_new(handleOut: usize): i32
@external("fastly_http_resp", "header_append") declare function fastly_http_resp_header_append(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32
@external("fastly_http_resp", "header_value_get") declare function fastly_http_resp_header_value_get(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_http_resp", "status_get") declare function fastly_http_resp_status_get(handle: i32, statusOut: usize): i32
@external("fastly_http_resp", "status_set") declare function fastly_http_resp_status_set(handle: i32, status: i32): i32
@external("fastly_http_resp", "send_downstream") declare function fastly_http_resp_send_downstream(handle: i32, body: i32, streaming: i32): i32
@external("fastly_http_body", "new") declare function fastly_http_body_new(handleOut: usize): i32
@external("fastly_http_body", "read") declare function fastly_http_body_read(handle: i32, buffer: usize, bufferLength: i32, readOut: usize): i32
@external("fastly_http_body", "write") declare function fastly_http_body_write(handle: i32, buffer: usize, bufferLength: i32, end: i32, writtenOut: usize): i32
@external("fastly_config_store", "open") declare function fastly_config_store_open(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_config_store", "get") declare function fastly_config_store_get(handle: i32, key: usize, keyLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_secret_store", "open") declare function fastly_secret_store_open(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_secret_store", "get") declare function fastly_secret_store_get(handle: i32, key: usize, keyLength: i32, secretOut: usize): i32
@external("fastly_secret_store", "plaintext") declare function fastly_secret_store_plaintext(secret: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_kv_store", "open") declare function fastly_kv_store_open(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_kv_store", "lookup") declare function fastly_kv_store_lookup(store: i32, key: usize, keyLength: i32, configMask: i32, config: usize, lookupOut: usize): i32
@external("fastly_kv_store", "lookup_wait_v2") declare function fastly_kv_store_lookup_wait_v2(handle: i32, bodyOut: usize, metadata: usize, metadataLength: i32, writtenOut: usize, generationOut: usize, kvErrorOut: usize): i32
@external("fastly_kv_store", "insert") declare function fastly_kv_store_insert(store: i32, key: usize, keyLength: i32, body: i32, configMask: i32, config: usize, insertOut: usize): i32
@external("fastly_kv_store", "insert_wait") declare function fastly_kv_store_insert_wait(handle: i32, kvErrorOut: usize): i32
@external("fastly_log", "endpoint_get") declare function fastly_log_endpoint_get(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_log", "write") declare function fastly_log_write(handle: i32, message: usize, messageLength: i32, writtenOut: usize): i32
@external("wasi_snapshot_preview1", "clock_time_get") declare function wasi_snapshot_preview1_clock_time_get(clockId: i32, precision: i64, timeOut: usize): i32

const PULSE_FASTLY_EFFECTS_ABI_VERSION: i64 = ${FASTLY_NATIVE_PLATFORM_CAPABILITIES_ABI_VERSION}
const PULSE_FASTLY_BUFFER_BYTES: i32 = ${FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES}
const PULSE_FASTLY_EFFECT_COUNT: i32 = ${effectCount}
const PULSE_EFFECT_FETCH: i32 = 1
const PULSE_EFFECT_CONFIG_GET: i32 = 2
const PULSE_EFFECT_SECRET_GET: i32 = 3
const PULSE_EFFECT_KV_GET: i32 = 4
const PULSE_EFFECT_KV_PUT: i32 = 5
const PULSE_EFFECT_GRIP_CHANNEL: i32 = 6
const PULSE_EFFECT_GRIP_HOLD: i32 = 7
const PULSE_EFFECT_GRIP_PUBLISH: i32 = 8
const PULSE_EFFECT_ASSETS_LOOKUP: i32 = 10
const PULSE_EFFECT_JWT_VERIFY: i32 = 11
const FASTLY_STATUS_OK: i32 = 0
const FASTLY_STATUS_BUFLEN: i32 = 4
const FASTLY_STATUS_NONE: i32 = 10
const PULSE_VALUE_UNDEFINED: i32 = 0
const PULSE_VALUE_NULL: i32 = 1
const PULSE_VALUE_BOOLEAN: i32 = 2
const PULSE_VALUE_NUMBER: i32 = 3
const PULSE_VALUE_STRING: i32 = 4
const PULSE_VALUE_ARRAY: i32 = 5
const PULSE_VALUE_OBJECT: i32 = 6
const PULSE_VALUE_FETCH: i32 = 7
const PULSE_VALUE_RESPONSE: i32 = 8
const PULSE_ERROR_NONE: i32 = 0
const PULSE_ERROR_VALUE: i32 = 1001
const PULSE_ERROR_UNSUPPORTED: i32 = 1002
const PULSE_ERROR_HOSTCALL: i32 = 1003
const PULSE_ERROR_JSON: i32 = 1004
const PULSE_ERROR_SCHEMA: i32 = 1005
const PULSE_ERROR_TRANSPORT: i32 = 1006
const PULSE_ERROR_STATE: i32 = 1007
const PULSE_ERROR_JWT: i32 = 1008
const PULSE_ERROR_REQUEST_BODY: i32 = 1009

class __PulseFastlyValue {
  kind: i32 = PULSE_VALUE_UNDEFINED
  boolean: i32 = 0
  number: f64 = 0.0
${nativeStringFields}
  // Scalar handles do not need collection backing stores.
  private keysStorage: Array<string> | null = null
  get keys(): Array<string> {
    if (this.keysStorage === null) this.keysStorage = new Array<string>()
    return this.keysStorage!
  }
  // Scalar handles do not need collection backing stores.
  private valuesStorage: Array<i32> | null = null
  get values(): Array<i32> {
    if (this.valuesStorage === null) this.valuesStorage = new Array<i32>()
    return this.valuesStorage!
  }
  responseHandle: i32 = 0
  bodyHandle: i32 = 0
  bodyLoaded: i32 = 0
  status: i32 = 200
  // Scalar handles do not need collection backing stores.
  private headersStorage: Array<__PulseFastlyHeader> | null = null
  get headers(): Array<__PulseFastlyHeader> {
    if (this.headersStorage === null) this.headersStorage = new Array<__PulseFastlyHeader>()
    return this.headersStorage!
  }
  immutable: bool = false
}
class __PulseFastlyHeader {
  constructor(public name: string, public value: string) {}
}
class __PulseJsonParser {
  source: string
  index: i32 = 0
  failed: bool = false
  tooLarge: bool = false
  entries: i32 = 0
  constructor(source: string, public conditionalKv: bool = false) { this.source = source }
  skip(): void { while (this.index < this.source.length) { const c = this.source.charCodeAt(this.index); if (c != 32 && c != 9 && c != 10 && c != 13) return; this.index += 1 } }
  parse(): i32 { this.skip(); const value = this.value(0); this.skip(); if (this.index != this.source.length) this.failed = true; return this.failed ? 0 : value }
  value(depth: i32): i32 {
    this.skip(); if (this.conditionalKv && (depth > ${conditionalKv.KV_CONDITIONAL_LIMITS.depth + 1} || ++this.entries > ${conditionalKv.KV_CONDITIONAL_LIMITS.entries + 2})) { this.failed = true; this.tooLarge = true; return 0 }
    if (this.index >= this.source.length || (!this.conditionalKv && depth > ${plan.effects.some(effect => conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind)) ? 128 : 64})) { this.failed = true; return 0 }
    const c = this.source.charCodeAt(this.index)
    if (c == 34) return __pulse_fastly_string_value(this.string())
    if (c == 123) return this.object(depth + 1)
    if (c == 91) return this.array(depth + 1)
    if (this.source.substr(this.index, 4) == "true") { this.index += 4; return host_value_boolean(1) }
    if (this.source.substr(this.index, 5) == "false") { this.index += 5; return host_value_boolean(0) }
    if (this.source.substr(this.index, 4) == "null") { this.index += 4; return host_value_null() }
    if (c == 45 || (c >= 48 && c <= 57)) return this.numberValue()
    this.failed = true; return 0
  }
  string(): string {
    // Find a bounded span, then decode each UTF-16 unit once. Concatenating one
    // character at a time exhausts stub/fixed memory on a valid maximum KV value.
    const start = this.index + 1; let end = start;
    while (end < this.source.length) {
      const c = this.source.charCodeAt(end);
      if (c == 34) break;
      if (c == 92) end += 1;
      end += 1;
    }
    if (end >= this.source.length) { this.failed = true; return "" }
    const output = new Uint16Array(end - start); let count = 0; this.index = start;
    while (this.index < end) {
      let c = this.source.charCodeAt(this.index++);
      if (c == 92) {
        if (this.index >= end) { this.failed = true; return "" }
        c = this.source.charCodeAt(this.index++);
        if (c == 34 || c == 92 || c == 47) {}
        else if (c == 98) c = 8;
        else if (c == 102) c = 12;
        else if (c == 110) c = 10;
        else if (c == 114) c = 13;
        else if (c == 116) c = 9;
        else if (c == 117) {
          if (this.index + 4 > end) { this.failed = true; return "" }
          c = 0;
          for (let i = 0; i < 4; i++) {
            const d = this.source.charCodeAt(this.index++);
            const digit = d >= 48 && d <= 57 ? d - 48 : d >= 65 && d <= 70 ? d - 55 : d >= 97 && d <= 102 ? d - 87 : -1;
            if (digit < 0) { this.failed = true; return "" }
            c = (c << 4) | digit;
          }
        } else { this.failed = true; return "" }
      } else if (c < 32) { this.failed = true; return "" }
      output[count++] = u16(c);
    }
    this.index = end + 1;
    return String.UTF16.decodeUnsafe(output.dataStart, count * 2);
  }
  numberValue(): i32 {
    const start = this.index
    if (this.source.charCodeAt(this.index) == 45) { this.index += 1; if (this.index >= this.source.length) { this.failed = true; return 0 } }
    let c = this.source.charCodeAt(this.index)
    if (c == 48) {
      this.index += 1
      if (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c >= 48 && c <= 57) { this.failed = true; return 0 } }
    } else if (c >= 49 && c <= 57) {
      this.index += 1
      while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
    } else { this.failed = true; return 0 }
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 46) {
      this.index += 1
      if (this.index >= this.source.length) { this.failed = true; return 0 }
      c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) { this.failed = true; return 0 }
      while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
    }
    if (this.index < this.source.length) {
      c = this.source.charCodeAt(this.index)
      if (c == 69 || c == 101) {
        this.index += 1
        if (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c == 43 || c == 45) this.index += 1 }
        if (this.index >= this.source.length) { this.failed = true; return 0 }
        c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) { this.failed = true; return 0 }
        while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
      }
    }
    return host_value_number(F64.parseFloat(this.source.substring(start, this.index)))
  }
  array(depth: i32): i32 {
    const output = host_value_array(); this.index += 1; this.skip()
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 93) { this.index += 1; return output }
    while (!this.failed) {
      host_value_array_push(output, this.value(depth)); this.skip()
      if (this.index >= this.source.length) { this.failed = true; break }
      const c = this.source.charCodeAt(this.index); this.index += 1
      if (c == 93) break
      if (c != 44) { this.failed = true; break }
    }
    return output
  }
  object(depth: i32): i32 {
    const output = host_value_object(); this.index += 1; this.skip()
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 125) { this.index += 1; return output }
    while (!this.failed) {
      this.skip(); if (this.index >= this.source.length || this.source.charCodeAt(this.index) != 34) { this.failed = true; break }
      const key = this.string(); this.skip()
      if (this.conditionalKv && __pulse_fastly_find(__pulse_fastly_value(output), key) >= 0) { this.failed = true; break }
      if (this.index >= this.source.length || this.source.charCodeAt(this.index) != 58) { this.failed = true; break }
      this.index += 1; host_value_object_set(output, __pulse_fastly_string_value(key), this.value(depth)); this.skip()
      if (this.index >= this.source.length) { this.failed = true; break }
      const c = this.source.charCodeAt(this.index); this.index += 1
      if (c == 125) break
      if (c != 44) { this.failed = true; break }
    }
    return output
  }
}

const PULSE_FASTLY_PENDING_NONE: i32 = 0
const PULSE_FASTLY_PENDING_ASYNC: i32 = 1
const PULSE_FASTLY_PENDING_READY: i32 = 2
@lazy const __pulse_fastly_values = new Array<__PulseFastlyValue>()
// Primitive handles have value semantics. Bounded caches keep admitted scalar
// validation loops from retaining a fresh boxed value for every iteration.
@lazy const __pulse_fastly_scalar_handles = new StaticArray<i32>(4)
@lazy const __pulse_fastly_integer_handles = new StaticArray<i32>(65536)
@lazy const __pulse_fastly_character_handles = new StaticArray<i32>(65537)
@lazy const __pulse_fastly_literal_handles = new Map<string, i32>()
@lazy const __pulse_fastly_pending = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __pulse_fastly_pending_mode = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __pulse_fastly_payloads = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __pulse_fastly_ready = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
@lazy const __pulse_fastly_grip_channels = new Array<string>()
@lazy const __pulse_fastly_redactions = new Array<string>()
let __pulse_fastly_request_handle: i32 = 0
let __pulse_fastly_request_body_handle: i32 = 0
let __pulse_fastly_request_method: string = ""
let __pulse_fastly_request_url: string = ""
let __pulse_fastly_request_path: string = ""
let __pulse_fastly_request_body: string = ""
let __pulse_fastly_request_body_loaded: i32 = 0
let __pulse_fastly_last_error: i32 = 0
let __pulse_fastly_error_stage: i32 = 0
let __pulse_fastly_error_effect: i32 = -1
let __pulse_fastly_log_handle: i32 = -1
let __pulse_fastly_jwt_error: i32 = 0
let __pulse_fastly_jwt_secret_calls: i32 = 0
let __pulse_fastly_jwt_crypto_calls: i32 = 0
let __pulse_fastly_jwt_clock_calls: i32 = 0
let __pulse_fastly_jwt_schema_calls: i32 = 0
let __pulse_fastly_jwt_claims_parsed: i32 = 0
let __pulse_fastly_jwt_verified: i32 = 0
let __pulse_fastly_jwt_signing_input_bytes: i32 = 0
let __pulse_fastly_jwt_signing_input_sha256: string = ""
let __pulse_fastly_jwt_event_order: string = ""

function __pulse_fastly_fail(code: i32, stage: i32, effectIndex: i32): void { if (__pulse_fastly_last_error == 0) { __pulse_fastly_last_error = code; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effectIndex } }
function __pulse_fastly_out_i32(): StaticArray<i32> { return new StaticArray<i32>(1) }
function __pulse_fastly_out_value(out: StaticArray<i32>): i32 { return load<i32>(changetype<usize>(out)) }
function __pulse_fastly_utf8(value: string): ArrayBuffer { return String.UTF8.encode(value, false) }
function __pulse_fastly_decode(buffer: Uint8Array, length: i32): string { return String.UTF8.decodeUnsafe(buffer.dataStart, length, false) }
function __pulse_fastly_put(value: __PulseFastlyValue): i32 { __pulse_fastly_values.push(value); return __pulse_fastly_values.length }
function __pulse_fastly_value(handle: i32): __PulseFastlyValue { if (handle <= 0 || handle > __pulse_fastly_values.length) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return new __PulseFastlyValue() } return unchecked(__pulse_fastly_values[handle - 1]) }
${nativeStringConcat}
${nativeStringTrim}
${nativeStringIndex}
function __pulse_fastly_deep_freeze(handle: i32): void { const value = __pulse_fastly_value(handle); if (value.immutable) return; value.immutable = true; if (value.kind == PULSE_VALUE_ARRAY || value.kind == PULSE_VALUE_OBJECT) for (let index = 0; index < value.values.length; index += 1) __pulse_fastly_deep_freeze(unchecked(value.values[index])) }
function __pulse_fastly_string_value(value: string): i32 {
  const index = value.length == 0 ? 65536 : value.length == 1 ? value.charCodeAt(0) : -1;
  if (index >= 0) { const cached = unchecked(__pulse_fastly_character_handles[index]); if (cached != 0) return cached }
  const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_STRING; item.text = value;
  const handle = __pulse_fastly_put(item);
  if (index >= 0) unchecked(__pulse_fastly_character_handles[index] = handle);
  return handle
}
function __pulse_fastly_find(object: __PulseFastlyValue, key: string): i32 { for (let i = 0; i < object.keys.length; i += 1) if (unchecked(object.keys[i]) == key) return i; return -1 }
function __pulse_fastly_number_string(value: f64): string { if (value >= -9007199254740991.0 && value <= 9007199254740991.0 && Math.floor(value) == value) return i64(value).toString(); return value.toString() }
function __pulse_fastly_string(handle: i32): string { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_STRING) return value.text; if (value.kind == PULSE_VALUE_NUMBER) return __pulse_fastly_number_string(value.number); if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean != 0 ? "true" : "false"; if (value.kind == PULSE_VALUE_NULL) return "null"; if (value.kind == PULSE_VALUE_UNDEFINED) return "undefined"; return __pulse_fastly_json(handle, 0) }
function __pulse_fastly_remember_secret(value: string): string { if (value.length == 0) return value; for (let i = 0; i < __pulse_fastly_redactions.length; i += 1) if (unchecked(__pulse_fastly_redactions[i]) == value) return value; __pulse_fastly_redactions.push(value); return value }
function __pulse_fastly_replace_secret(input: string, secret: string): string { if (secret.length == 0) return input; let source = input; let output = ""; while (true) { const index = source.indexOf(secret); if (index < 0) return output + source; output += source.substring(0, index) + "<redacted>"; source = source.substring(index + secret.length) } }
function __pulse_fastly_redact(input: string): string { let output = input; for (let i = 0; i < __pulse_fastly_redactions.length; i += 1) output = __pulse_fastly_replace_secret(output, unchecked(__pulse_fastly_redactions[i])); return output }
function host_log(level: i32, messageHandle: i32): void { let endpoint = __pulse_fastly_log_handle; if (endpoint == -2) return; if (endpoint == -1) { const name = __pulse_fastly_utf8("stdout"); const out = __pulse_fastly_out_i32(); if (fastly_log_endpoint_get(changetype<usize>(name), name.byteLength, changetype<usize>(out)) != FASTLY_STATUS_OK) { __pulse_fastly_log_handle = -2; return } endpoint = __pulse_fastly_out_value(out); __pulse_fastly_log_handle = endpoint } let label = "unknown"; if (level == 1) label = "error"; else if (level == 2) label = "warn"; else if (level == 3) label = "info"; else if (level == 4) label = "debug"; const bytes = __pulse_fastly_utf8("[pulse:" + label + "] " + __pulse_fastly_redact(__pulse_fastly_string(messageHandle)) + "\n"); const written = __pulse_fastly_out_i32(); fastly_log_write(endpoint, changetype<usize>(bytes), bytes.byteLength, changetype<usize>(written)) }
function __pulse_fastly_number(handle: i32): f64 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_NUMBER) return value.number; if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean != 0 ? 1.0 : 0.0; if (value.kind == PULSE_VALUE_STRING) return F64.parseFloat(value.text); return 0.0 }
function __pulse_fastly_hex(value: i32): string { return String.fromCharCode(value < 10 ? 48 + value : 87 + value) }
function __pulse_fastly_is_unpaired(value: string, i: i32): bool {
  const c = value.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) return i + 1 >= value.length || value.charCodeAt(i + 1) < 0xdc00 || value.charCodeAt(i + 1) > 0xdfff;
  if (c >= 0xdc00 && c <= 0xdfff) return i == 0 || value.charCodeAt(i - 1) < 0xd800 || value.charCodeAt(i - 1) > 0xdbff;
  return false;
}
function __pulse_fastly_quote(value: string): string {
  // Count once and write UTF-16 units once. Repeated concatenation can allocate
  // gigabytes for a valid bounded string when every byte needs JSON escaping.
  let size = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    size += c == 34 || c == 92 || c == 8 || c == 9 || c == 10 || c == 12 || c == 13 ? 2 : (c < 32 || __pulse_fastly_is_unpaired(value, i)) ? 6 : 1;
  }
  const out = new Uint16Array(size); let cursor = 0; out[cursor++] = 34;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c == 34 || c == 92) { out[cursor++] = 92; out[cursor++] = u16(c); }
    else if (c == 8 || c == 9 || c == 10 || c == 12 || c == 13) {
      out[cursor++] = 92; out[cursor++] = c == 8 ? 98 : c == 9 ? 116 : c == 10 ? 110 : c == 12 ? 102 : 114;
    } else if (c < 32 || __pulse_fastly_is_unpaired(value, i)) {
      out[cursor++] = 92; out[cursor++] = 117;
      out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 12) & 15)); out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 8) & 15));
      out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 4) & 15)); out[cursor++] = u16('0123456789abcdef'.charCodeAt(c & 15));
    } else out[cursor++] = u16(c);
  }
  out[cursor] = 34;
  return String.UTF16.decodeUnsafe(out.dataStart, out.byteLength);
}
function __pulse_fastly_json_parts(handle: i32, depth: i32, parts: Array<string>): void {
  if (depth > ${plan.effects.some(effect => conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind)) ? 128 : 64}) { __pulse_fastly_fail(PULSE_ERROR_JSON, 2, -1); parts.push("null"); return }
  const value = __pulse_fastly_value(handle)
  if (value.kind == PULSE_VALUE_BOOLEAN) { parts.push(value.boolean != 0 ? "true" : "false"); return }
  if (value.kind == PULSE_VALUE_NUMBER) { parts.push(__pulse_fastly_number_string(value.number)); return }
  if (value.kind == PULSE_VALUE_STRING) { parts.push(__pulse_fastly_quote(value.text)); return }
  if (value.kind == PULSE_VALUE_ARRAY) { parts.push("["); for (let i = 0; i < value.values.length; i += 1) { if (i > 0) parts.push(","); __pulse_fastly_json_parts(unchecked(value.values[i]), depth + 1, parts) } parts.push("]"); return }
  if (value.kind == PULSE_VALUE_OBJECT) { parts.push("{"); for (let i = 0; i < value.keys.length; i += 1) { if (i > 0) parts.push(","); parts.push(__pulse_fastly_quote(unchecked(value.keys[i]))); parts.push(":"); __pulse_fastly_json_parts(unchecked(value.values[i]), depth + 1, parts) } parts.push("}"); return }
  parts.push("null")
}
function __pulse_fastly_json(handle: i32, depth: i32): string {
  // Join once, avoiding a complete copy of a multi-MiB leaf at every ancestor
  // and at every following member in the response or effect result.
  const parts = new Array<string>(); __pulse_fastly_json_parts(handle, depth, parts);
  return parts.join("")
}
function __pulse_fastly_parse_json(text: string): i32 { const parser = new __PulseJsonParser(text); const value = parser.parse(); if (parser.failed || value <= 0) { __pulse_fastly_fail(PULSE_ERROR_JSON, 3, -1); return 0 } return value }
function __pulse_fastly_path(uri: string): string { let start = 0; const scheme = uri.indexOf("://"); if (scheme >= 0) { const slash = uri.indexOf("/", scheme + 3); start = slash >= 0 ? slash : uri.length } let end = uri.length; const query = uri.indexOf("?", start); if (query >= 0 && query < end) end = query; const fragment = uri.indexOf("#", start); if (fragment >= 0 && fragment < end) end = fragment; return start >= end ? "/" : uri.substring(start, end) }
function __pulse_fastly_read_req_string(kind: i32): string { const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = kind == 0 ? fastly_http_req_method_get(__pulse_fastly_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)) : fastly_http_req_uri_get(__pulse_fastly_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 10 + kind, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_read_body(handle: i32, effectIndex: i32, requestText: bool = false): string {
  const chunks = new Array<Uint8Array>(); let total = 0;
  while (true) {
    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();
    const status = fastly_http_body_read(handle, buffer.dataStart, buffer.length, changetype<usize>(read));
    if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 20, effectIndex); return "" }
    const count = __pulse_fastly_out_value(read);
    if (count < 0 || count > buffer.length) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 20, effectIndex); return "" }
    if (!count) break;
    total += count;
    if (total > __PULSE_SCHEMA_MAX_BYTES && __PULSE_SCHEMA_MAX_BYTES > 0) { __pulse_fastly_fail(requestText ? PULSE_ERROR_REQUEST_BODY : PULSE_ERROR_SCHEMA, 21, effectIndex); return "" }
    chunks.push(buffer.subarray(0, count));
  }
  // UTF-8 scalars may straddle host read chunks. Decode the bounded body once.
  const bytes = new Uint8Array(total); let offset = 0;
  for (let i = 0; i < chunks.length; i++) { bytes.set(chunks[i], offset); offset += chunks[i].length; }
  if (requestText && !__pulse_request_utf8_valid(bytes)) { __pulse_fastly_fail(PULSE_ERROR_REQUEST_BODY, 24, effectIndex); return "" }
  return __pulse_fastly_decode(bytes, total);
}
function __pulse_fastly_request_header_text(name: string): string { const nameBytes = __pulse_fastly_utf8(name); const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = fastly_http_req_header_value_get(__pulse_fastly_request_handle, changetype<usize>(nameBytes), nameBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status == FASTLY_STATUS_NONE) return ""; if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 22, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_fetch_header_text(responseHandle: i32, name: string): string { const nameBytes = __pulse_fastly_utf8(name); const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = fastly_http_resp_header_value_get(responseHandle, changetype<usize>(nameBytes), nameBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status == FASTLY_STATUS_NONE) return ""; if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 23, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_fetch_body(value: __PulseFastlyValue): string { if (value.bodyLoaded == 0) { value.text = __pulse_fastly_read_body(value.bodyHandle, -1); value.bodyLoaded = 1 } return value.text }

function __pulse_fastly_scalar(kind: i32, boolean: i32, slot: i32): i32 {
  const cached = unchecked(__pulse_fastly_scalar_handles[slot]); if (cached != 0) return cached;
  const item = new __PulseFastlyValue(); item.kind = kind; item.boolean = boolean;
  const handle = __pulse_fastly_put(item); unchecked(__pulse_fastly_scalar_handles[slot] = handle); return handle
}
function host_value_undefined(): i32 { return __pulse_fastly_scalar(PULSE_VALUE_UNDEFINED, 0, 0) }
function host_value_null(): i32 { return __pulse_fastly_scalar(PULSE_VALUE_NULL, 0, 1) }
function host_value_boolean(value: i32): i32 { return __pulse_fastly_scalar(PULSE_VALUE_BOOLEAN, value != 0 ? 1 : 0, value != 0 ? 3 : 2) }
function host_value_number(value: f64): i32 {
  // Preserve negative zero, NaN, infinities and nonintegral values exactly.
  const cacheable = value >= 0 && value < 65536 && Math.floor(value) == value && (value != 0 || 1.0 / value > 0);
  const index = cacheable ? i32(value) : -1;
  if (index >= 0) { const cached = unchecked(__pulse_fastly_integer_handles[index]); if (cached != 0) return cached }
  const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_NUMBER; item.number = value;
  const handle = __pulse_fastly_put(item); if (index >= 0) unchecked(__pulse_fastly_integer_handles[index] = handle); return handle
}
function host_value_string(pointer: i32, length: i32): i32 {
  const text = changetype<string>(pointer);
  if (text.length > 1 && text.length <= 128 && __pulse_fastly_literal_handles.has(text)) return __pulse_fastly_literal_handles.get(text);
  const handle = __pulse_fastly_string_value(text);
  if (text.length > 1 && text.length <= 128 && __pulse_fastly_literal_handles.size < 1024) __pulse_fastly_literal_handles.set(text, handle);
  return handle
}
function host_value_array(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_ARRAY; return __pulse_fastly_put(item) }
function host_value_array_push(target: i32, value: i32): void { const item = __pulse_fastly_value(target); if (item.kind != PULSE_VALUE_ARRAY || item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 30, -1); return } item.values.push(value) }
function host_value_array_spread(target: i32, source: i32): void { const from = __pulse_fastly_value(source); if (from.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 31, -1); return } for (let i = 0; i < from.values.length; i += 1) host_value_array_push(target, unchecked(from.values[i])) }
function host_value_object(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_OBJECT; return __pulse_fastly_put(item) }
function host_value_object_set(target: i32, keyHandle: i32, value: i32): void { const item = __pulse_fastly_value(target); if (item.kind != PULSE_VALUE_OBJECT || item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 32, -1); return } const key = __pulse_fastly_string(keyHandle); const index = __pulse_fastly_find(item, key); if (index >= 0) unchecked(item.values[index] = value); else { item.keys.push(key); item.values.push(value) } }
function host_value_object_spread(target: i32, source: i32): void { const from = __pulse_fastly_value(source); if (from.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 33, -1); return } for (let i = 0; i < from.keys.length; i += 1) host_value_object_set(target, __pulse_fastly_string_value(unchecked(from.keys[i])), unchecked(from.values[i])) }
function host_value_property(target: i32, keyHandle: i32): i32 { const item = __pulse_fastly_value(target); const key = __pulse_fastly_string(keyHandle); if (item.kind == PULSE_VALUE_OBJECT) { const index = __pulse_fastly_find(item, key); return index >= 0 ? unchecked(item.values[index]) : host_value_undefined() } if (item.kind == PULSE_VALUE_FETCH && key == "status") { const out = __pulse_fastly_out_i32(); const status = fastly_http_resp_status_get(item.responseHandle, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 34, -1); return 0 } return host_value_number(__pulse_fastly_out_value(out)) } if ((item.kind == PULSE_VALUE_STRING || item.kind == PULSE_VALUE_ARRAY) && key == "length") return host_value_number(item.kind == PULSE_VALUE_STRING ? item.textLength : item.values.length); return host_value_undefined() }
function host_value_property_set(target: i32, key: i32, value: i32): i32 { host_value_object_set(target, key, value); return value }
function host_value_element(target: i32, keyHandle: i32): i32 { const item = __pulse_fastly_value(target); if (item.kind == PULSE_VALUE_STRING) return __pulse_fastly_string_index(item, keyHandle); if (item.kind == PULSE_VALUE_ARRAY) { const index = i32(__pulse_fastly_number(keyHandle)); return index >= 0 && index < item.values.length ? unchecked(item.values[index]) : host_value_undefined() } return host_value_property(target, keyHandle) }
function host_value_element_set(target: i32, keyHandle: i32, value: i32): i32 { const item = __pulse_fastly_value(target); if (item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 35, -1); return 0 } if (item.kind == PULSE_VALUE_ARRAY) { const index = i32(__pulse_fastly_number(keyHandle)); if (index < 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 35, -1); return 0 } while (item.values.length <= index) item.values.push(host_value_undefined()); unchecked(item.values[index] = value); return value } return host_value_property_set(target, keyHandle, value) }
function host_value_truthy(handle: i32): i32 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_UNDEFINED || value.kind == PULSE_VALUE_NULL) return 0; if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean; if (value.kind == PULSE_VALUE_NUMBER) return value.number != 0.0 && !isNaN(value.number) ? 1 : 0; if (value.kind == PULSE_VALUE_STRING) return value.textLength > 0 ? 1 : 0; return 1 }
function host_value_nullish(handle: i32): i32 { const kind = __pulse_fastly_value(handle).kind; return kind == PULSE_VALUE_UNDEFINED || kind == PULSE_VALUE_NULL ? 1 : 0 }
function host_value_binary(operator: i32, leftHandle: i32, rightHandle: i32): i32 { const left = __pulse_fastly_value(leftHandle); const right = __pulse_fastly_value(rightHandle); if (operator == 0 || operator == 2) { let equal = false; if (left.kind == right.kind) { if (left.kind == PULSE_VALUE_UNDEFINED || left.kind == PULSE_VALUE_NULL) equal = true; else if (left.kind == PULSE_VALUE_BOOLEAN) equal = left.boolean == right.boolean; else if (left.kind == PULSE_VALUE_NUMBER) equal = left.number == right.number; else if (left.kind == PULSE_VALUE_STRING) equal = left.text == right.text; else equal = leftHandle == rightHandle } return host_value_boolean(equal ? 1 : 0) } if (operator == 1 || operator == 3) { const result = host_value_binary(operator == 1 ? 0 : 2, leftHandle, rightHandle); return host_value_boolean(host_value_truthy(result) == 0 ? 1 : 0) } if (operator == 8) { if (left.kind == PULSE_VALUE_STRING || right.kind == PULSE_VALUE_STRING) return __pulse_fastly_concat(leftHandle, rightHandle); return host_value_number(__pulse_fastly_number(leftHandle) + __pulse_fastly_number(rightHandle)) } if (left.kind == PULSE_VALUE_STRING && right.kind == PULSE_VALUE_STRING) { if (operator == 4) return host_value_boolean(left.text < right.text ? 1 : 0); if (operator == 5) return host_value_boolean(left.text <= right.text ? 1 : 0); if (operator == 6) return host_value_boolean(left.text > right.text ? 1 : 0); if (operator == 7) return host_value_boolean(left.text >= right.text ? 1 : 0); } if (operator == 4) return host_value_boolean(__pulse_fastly_number(leftHandle) < __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 5) return host_value_boolean(__pulse_fastly_number(leftHandle) <= __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 6) return host_value_boolean(__pulse_fastly_number(leftHandle) > __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 7) return host_value_boolean(__pulse_fastly_number(leftHandle) >= __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 9) return host_value_number(__pulse_fastly_number(leftHandle) - __pulse_fastly_number(rightHandle)); if (operator == 10) return host_value_number(__pulse_fastly_number(leftHandle) * __pulse_fastly_number(rightHandle)); if (operator == 11) return host_value_number(__pulse_fastly_number(leftHandle) / __pulse_fastly_number(rightHandle)); if (operator == 12) return host_value_number(__pulse_fastly_number(leftHandle) % __pulse_fastly_number(rightHandle)); if (operator == 14) return host_value_truthy(leftHandle) != 0 ? rightHandle : leftHandle; if (operator == 15) return host_value_truthy(leftHandle) != 0 ? leftHandle : rightHandle; if (operator == 16) return host_value_nullish(leftHandle) == 0 ? leftHandle : rightHandle; __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 36, -1); return 0 }
function host_value_unary(operator: i32, handle: i32): i32 { if (operator == 0) return host_value_boolean(host_value_truthy(handle) == 0 ? 1 : 0); if (operator == 1) return host_value_number(__pulse_fastly_number(handle)); if (operator == 2) return host_value_number(-__pulse_fastly_number(handle)); if (operator == 5) return host_value_undefined(); __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 37, -1); return 0 }

function host_request_method(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_method) }
function host_request_url(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_url) }
function __pulse_router_segments(value: string): Array<string> { let start = 0; let end = value.length; while (start < end && value.charCodeAt(start) == 47) start += 1; while (end > start && value.charCodeAt(end - 1) == 47) end -= 1; if (start >= end) return new Array<string>(); return value.substring(start, end).split("/") }
function __pulse_router_match_text(path: string, pattern: string): bool { const actual = __pulse_router_segments(path); const expected = __pulse_router_segments(pattern); const wildcard = expected.length > 0 && unchecked(expected[expected.length - 1]) == "*"; if ((!wildcard && actual.length != expected.length) || (wildcard && actual.length < expected.length - 1)) return false; const limit = wildcard ? expected.length - 1 : expected.length; for (let i = 0; i < limit; i += 1) { const part = unchecked(expected[i]); if (part.length > 0 && part.charCodeAt(0) == 58) { if (unchecked(actual[i]).length == 0) return false } else if (unchecked(actual[i]) != part) return false } return true }
function __pulse_router_param_text(path: string, pattern: string, name: string): string | null { const actual = __pulse_router_segments(path); const expected = __pulse_router_segments(pattern); const target = ":" + name; for (let i = 0; i < expected.length; i += 1) if (unchecked(expected[i]) == target) return unchecked(actual[i]); return null }
function host_router_match(path: i32, pattern: i32): i32 { return host_value_boolean(__pulse_router_match_text(__pulse_fastly_string(path), __pulse_fastly_string(pattern)) ? 1 : 0) }
function host_router_param(path: i32, pattern: i32, name: i32): i32 { const value = __pulse_router_param_text(__pulse_fastly_string(path), __pulse_fastly_string(pattern), __pulse_fastly_string(name)); return value === null ? host_value_undefined() : __pulse_fastly_string_value(value) }
function host_request_path(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_path) }
function host_request_headers(): i32 { return __pulse_request_headers_read() }
function host_request_header(name: i32): i32 { const value = __pulse_fastly_request_header_text(__pulse_fastly_string(name)); return value.length == 0 ? host_value_undefined() : __pulse_fastly_string_value(value) }
function host_request_text(): i32 { if (__pulse_request_body_failure != 0) { __pulse_fastly_fail(PULSE_ERROR_REQUEST_BODY, __pulse_request_body_failure, -1); return 0 } if (__pulse_fastly_request_body_loaded == 0) { __pulse_fastly_request_body = __pulse_fastly_read_body(__pulse_fastly_request_body_handle, -1, true); __pulse_fastly_request_body_loaded = 1; if (__pulse_fastly_last_error == PULSE_ERROR_REQUEST_BODY) __pulse_request_body_failure = __pulse_fastly_error_stage } if (__pulse_fastly_last_error != 0) return 0; return __pulse_fastly_string_value(__pulse_fastly_request_body) }
function host_request_json(schema: i32): i32 { const parsed = __pulse_fastly_parse_json(__pulse_fastly_string(host_request_text())); if (parsed <= 0) return 0; const schemaValue = __pulse_fastly_value(schema); return schemaValue.kind == PULSE_VALUE_STRING ? __pulse_fastly_schema_apply(schemaValue.text, parsed, false) : parsed }
function __pulse_fastly_headers_from_options(options: __PulseFastlyValue, output: __PulseFastlyValue): void { const index = __pulse_fastly_find(options, "headers"); if (index < 0) return; const headers = __pulse_fastly_value(unchecked(options.values[index])); if (headers.kind == PULSE_VALUE_OBJECT) { for (let i = 0; i < headers.keys.length; i += 1) { const name = unchecked(headers.keys[i]); const value = __pulse_fastly_value(unchecked(headers.values[i])); if (value.kind == PULSE_VALUE_ARRAY) { for (let j = 0; j < value.values.length; j += 1) output.headers.push(new __PulseFastlyHeader(name, __pulse_fastly_string(unchecked(value.values[j])))) } else output.headers.push(new __PulseFastlyHeader(name, __pulse_fastly_string(unchecked(headers.values[i])))) } return } if (headers.kind == PULSE_VALUE_ARRAY) { for (let i = 0; i < headers.values.length; i += 1) { const pair = __pulse_fastly_value(unchecked(headers.values[i])); if (pair.kind != PULSE_VALUE_ARRAY || pair.values.length < 2) continue; output.headers.push(new __PulseFastlyHeader(__pulse_fastly_string(unchecked(pair.values[0])), __pulse_fastly_string(unchecked(pair.values[1])))) } } }
function __pulse_fastly_response(value: i32, optionsHandle: i32, json: bool): i32 { const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const options = __pulse_fastly_value(optionsHandle); let bodyValue = value; if (options.kind == PULSE_VALUE_OBJECT) { const statusIndex = __pulse_fastly_find(options, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(options.values[statusIndex]))); const schemaIndex = __pulse_fastly_find(options, "schema"); if (json && schemaIndex >= 0) { bodyValue = __pulse_fastly_schema_apply(__pulse_fastly_string(unchecked(options.values[schemaIndex])), value, true); if (bodyValue <= 0) return 0 } __pulse_fastly_headers_from_options(options, output) } output.text = json ? __pulse_fastly_json(bodyValue, 0) : __pulse_fastly_string(value); let hasContentType = false; for (let i = 0; i < output.headers.length; i += 1) if (unchecked(output.headers[i]).name.toLowerCase() == "content-type") hasContentType = true; if (!hasContentType) output.headers.push(new __PulseFastlyHeader("content-type", json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")); return __pulse_fastly_put(output) }
function host_response_json(value: i32, options: i32): i32 { return __pulse_fastly_response(value, options, true) }
function host_schema_decode(text: i32, schema: i32): i32 {
  const id = __pulse_fastly_value(schema)
  if (id.kind != PULSE_VALUE_STRING || id.text.length == 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1); return 0 }
  const input = __pulse_fastly_value(text)
  if (input.kind != PULSE_VALUE_STRING) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }
  if (String.UTF8.byteLength(input.text) > __PULSE_SCHEMA_MAX_BYTES) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 21, -1); return 0 }
  const parsed = __pulse_fastly_parse_json(input.text)
  if (parsed <= 0) return 0
  const decoded = __pulse_fastly_schema_apply(id.text, parsed, false)
  if (decoded <= 0) return 0
  __pulse_fastly_deep_freeze(decoded)
  return decoded
}
function host_schema_encode(value: i32, schema: i32): i32 {
  const id = __pulse_fastly_value(schema)
  if (id.kind != PULSE_VALUE_STRING || id.text.length == 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1); return 0 }
  const projected = __pulse_fastly_schema_apply(id.text, value, true)
  if (projected <= 0) return 0
  const text = __pulse_fastly_json(projected, 0)
  if (String.UTF8.byteLength(text) > __PULSE_SCHEMA_MAX_BYTES) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 21, -1); return 0 }
  return __pulse_fastly_string_value(text)
}
function host_response_text(value: i32, options: i32): i32 { return __pulse_fastly_response(value, options, false) }
function host_response_custom(specHandle: i32): i32 { const spec = __pulse_fastly_value(specHandle); if (spec.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 40, -1); return 0 } const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const statusIndex = __pulse_fastly_find(spec, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(spec.values[statusIndex]))); const bodyIndex = __pulse_fastly_find(spec, "body"); if (bodyIndex >= 0) output.text = __pulse_fastly_string(unchecked(spec.values[bodyIndex])); __pulse_fastly_headers_from_options(spec, output); return __pulse_fastly_put(output) }
function __pulse_fastly_grip_frame_channels(options: __PulseFastlyValue, output: __PulseFastlyValue): bool { const channelsIndex = __pulse_fastly_find(options, "channels"); const channelIndex = __pulse_fastly_find(options, "channel"); let count = 0; if (channelsIndex >= 0) { const channels = __pulse_fastly_value(unchecked(options.values[channelsIndex])); if (channels.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 133, -1); return false } for (let i = 0; i < channels.values.length; i += 1) { const channel = __pulse_fastly_string(unchecked(channels.values[i])).trim(); if (channel.length == 0 || channel.indexOf(",") >= 0 || channel.indexOf("\r") >= 0 || channel.indexOf("\n") >= 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 134, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Channel", channel)); count += 1 } } else if (channelIndex >= 0) { const channel = __pulse_fastly_string(unchecked(options.values[channelIndex])).trim(); if (channel.length == 0 || channel.indexOf(",") >= 0 || channel.indexOf("\r") >= 0 || channel.indexOf("\n") >= 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 134, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Channel", channel)); count = 1 } if (count == 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 135, -1); return false } return true }
function __pulse_fastly_grip_frame(options: __PulseFastlyValue, output: __PulseFastlyValue): bool { for (let i = output.headers.length - 1; i >= 0; i -= 1) { const name = unchecked(output.headers[i]).name.toLowerCase(); if (name == "grip-hold" || name == "grip-channel" || name == "grip-timeout") output.headers.splice(i, 1) } const modeIndex = __pulse_fastly_find(options, "mode"); const mode = modeIndex < 0 ? "stream" : __pulse_fastly_string(unchecked(options.values[modeIndex])); if (mode != "stream" && mode != "response") { __pulse_fastly_fail(PULSE_ERROR_VALUE, 136, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Hold", mode)); if (!__pulse_fastly_grip_frame_channels(options, output)) return false; const timeoutIndex = __pulse_fastly_find(options, "timeoutMs"); if (timeoutIndex >= 0) { const timeout = __pulse_fastly_number(unchecked(options.values[timeoutIndex])); if (timeout < 0.0 || Math.floor(timeout) != timeout) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 137, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Timeout", i64(timeout).toString())) } return true }
function host_grip_is_websocket(): i32 { const contentType = __pulse_fastly_request_header_text("content-type").toLowerCase(); const accept = __pulse_fastly_request_header_text("accept").toLowerCase(); const upgrade = __pulse_fastly_request_header_text("upgrade").toLowerCase(); const connection = __pulse_fastly_request_header_text("connection").toLowerCase(); let connectionUpgrade = false; const tokens = connection.split(","); for (let i = 0; i < tokens.length; i += 1) if (unchecked(tokens[i]).trim() == "upgrade") connectionUpgrade = true; return host_value_boolean(contentType.indexOf("application/websocket-events") >= 0 || accept.indexOf("application/websocket-events") >= 0 || (upgrade == "websocket" && connectionUpgrade) ? 1 : 0) }
function host_grip_subscribe(responseHandle: i32, optionsHandle: i32): i32 { const output = __pulse_fastly_value(responseHandle); const options = __pulse_fastly_value(optionsHandle); if (output.kind != PULSE_VALUE_RESPONSE || options.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 138, -1); return 0 } return __pulse_fastly_grip_frame(options, output) ? responseHandle : 0 }
function host_grip_handoff(optionsHandle: i32): i32 { const options = __pulse_fastly_value(optionsHandle); if (options.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 139, -1); return 0 } const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const statusIndex = __pulse_fastly_find(options, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(options.values[statusIndex]))); const bodyIndex = __pulse_fastly_find(options, "body"); if (bodyIndex >= 0) output.text = __pulse_fastly_string(unchecked(options.values[bodyIndex])); __pulse_fastly_headers_from_options(options, output); let hasContentType = false; for (let i = 0; i < output.headers.length; i += 1) if (unchecked(output.headers[i]).name.toLowerCase() == "content-type") hasContentType = true; if (!hasContentType) output.headers.push(new __PulseFastlyHeader("Content-Type", "application/websocket-events")); return __pulse_fastly_grip_frame(options, output) ? __pulse_fastly_put(output) : 0 }
function host_kv_namespace(name: i32): i32 { return name }
function host_fetch_text(responseHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 42, -1); return 0 } return __pulse_fastly_string_value(__pulse_fastly_fetch_body(response)) }
function host_fetch_json(responseHandle: i32, schemaHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 43, -1); return 0 } if (__PULSE_SCHEMA_REQUIRE_JSON) { const contentType = __pulse_fastly_fetch_header_text(response.responseHandle, "content-type"); if (contentType.length == 0 || contentType.toLowerCase().indexOf("json") < 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 44, -1); return 0 } } const parsed = __pulse_fastly_parse_json(__pulse_fastly_fetch_body(response)); if (parsed <= 0) return 0; const schema = __pulse_fastly_value(schemaHandle); return schema.kind == PULSE_VALUE_STRING ? __pulse_fastly_schema_apply(schema.text, parsed, false) : parsed }
function host_fetch_header(responseHandle: i32, nameHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 45, -1); return 0 } const value = __pulse_fastly_fetch_header_text(response.responseHandle, __pulse_fastly_string(nameHandle)); return value.length == 0 ? host_value_undefined() : __pulse_fastly_string_value(value) }
function __pulse_fastly_payload_field(payload: __PulseFastlyValue, name: string): i32 { const index = __pulse_fastly_find(payload, name); return index < 0 ? host_value_undefined() : unchecked(payload.values[index]) }
function __pulse_fastly_ready_effect(effectIndex: i32, handle: i32): void { unchecked(__pulse_fastly_ready[effectIndex] = handle); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_READY) }
function __pulse_fastly_open_config_store(effectIndex: i32): i32 { const nameBytes = __pulse_fastly_utf8(__pulse_fastly_config_store(effectIndex)); const out = __pulse_fastly_out_i32(); const status = fastly_config_store_open(changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 110, effectIndex); return 0 } return __pulse_fastly_out_value(out) }
function __pulse_fastly_open_secret_store(effectIndex: i32): i32 { const nameBytes = __pulse_fastly_utf8(__pulse_fastly_secret_store(effectIndex)); const out = __pulse_fastly_out_i32(); const status = fastly_secret_store_open(changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 111, effectIndex); return 0 } return __pulse_fastly_out_value(out) }
function __pulse_fastly_open_kv_store(effectIndex: i32): i32 { const nameBytes = __pulse_fastly_utf8(__pulse_fastly_kv_store(effectIndex)); const out = __pulse_fastly_out_i32(); const status = fastly_kv_store_open(changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 112, effectIndex); return 0 } return __pulse_fastly_out_value(out) }
function __pulse_fastly_config_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const name = __pulse_fastly_string(__pulse_fastly_payload_field(payload, "name")); const store = __pulse_fastly_open_config_store(effectIndex); if (__pulse_fastly_last_error != 0) return; const keyBytes = __pulse_fastly_utf8(name); const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = fastly_config_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status == FASTLY_STATUS_NONE) { __pulse_fastly_ready_effect(effectIndex, host_value_undefined()); return } if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 113, effectIndex); return } __pulse_fastly_ready_effect(effectIndex, __pulse_fastly_string_value(__pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)))) }
function __pulse_fastly_secret_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const name = __pulse_fastly_string(__pulse_fastly_payload_field(payload, "name")); const store = __pulse_fastly_open_secret_store(effectIndex); if (__pulse_fastly_last_error != 0) return; const keyBytes = __pulse_fastly_utf8(name); const secretOut = __pulse_fastly_out_i32(); let status = fastly_secret_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, changetype<usize>(secretOut)); if (status == FASTLY_STATUS_NONE) { __pulse_fastly_ready_effect(effectIndex, host_value_undefined()); return } if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 114, effectIndex); return } const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); status = fastly_secret_store_plaintext(__pulse_fastly_out_value(secretOut), buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 115, effectIndex); return } const secret = __pulse_fastly_remember_secret(__pulse_fastly_decode(buffer, __pulse_fastly_out_value(written))); __pulse_fastly_ready_effect(effectIndex, __pulse_fastly_string_value(secret)) }
function __pulse_fastly_jwt_case_id(): string { return ${jwtCaseSource} }
function __pulse_fastly_jwt_fail_code(effectIndex: i32, code: i32, stage: i32): i32 { if (__pulse_fastly_jwt_error == 0) __pulse_fastly_jwt_error = code; __pulse_fastly_fail(PULSE_ERROR_JWT, stage, effectIndex); return 0 }
function __pulse_fastly_jwt_key_descriptor_valid(effectIndex: i32): bool { return __pulse_fastly_jwt_case_id() != "malformed-secret-descriptor" }
function __pulse_fastly_jwt_effect_secret_binding(effectIndex: i32): string { const caseId = __pulse_fastly_jwt_case_id(); ${jwtBindingOverrides} return __pulse_fastly_jwt_secret_binding(effectIndex) }
function __pulse_fastly_jwt_resolve_secret(effectIndex: i32): Uint8Array { __pulse_fastly_jwt_secret_calls += 1; __pulse_fastly_jwt_event_order += "S"; const store = __pulse_fastly_open_secret_store(effectIndex); if (__pulse_fastly_last_error != 0) return new Uint8Array(0); const name = __pulse_fastly_jwt_effect_secret_binding(effectIndex); const keyBytes = __pulse_fastly_utf8(name); const secretOut = __pulse_fastly_out_i32(); let status = fastly_secret_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, changetype<usize>(secretOut)); if (status == FASTLY_STATUS_NONE) return new Uint8Array(0); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 224, effectIndex); return new Uint8Array(0) } const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); status = fastly_secret_store_plaintext(__pulse_fastly_out_value(secretOut), buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 225, effectIndex); return new Uint8Array(0) } const length = __pulse_fastly_out_value(written); const output = new Uint8Array(length); for (let index = 0; index < length; index += 1) unchecked(output[index] = buffer[index]); __pulse_fastly_remember_secret(__pulse_fastly_decode(buffer, length)); for (let index = 0; index < length; index += 1) unchecked(buffer[index] = 0); return output }
function __pulse_fastly_jwt_force_crypto_failure(effectIndex: i32): bool { const caseId = __pulse_fastly_jwt_case_id(); return caseId == "runtime-realization-failure" || caseId == "realization-failure-distinct" || caseId == "no-fallback" }
function __pulse_fastly_jwt_record_crypto_attempt(): void { __pulse_fastly_jwt_crypto_calls += 1; __pulse_fastly_jwt_event_order += "A" }
function __pulse_fastly_jwt_record_claims_parsed(): void { __pulse_fastly_jwt_claims_parsed = 1; __pulse_fastly_jwt_event_order += "P" }
function __pulse_fastly_jwt_record_verified(): void { __pulse_fastly_jwt_verified = 1; __pulse_fastly_jwt_event_order += "V" }
function __pulse_fastly_jwt_record_signing_input(bytes: i32, digest: string): void { __pulse_fastly_jwt_signing_input_bytes = bytes; __pulse_fastly_jwt_signing_input_sha256 = digest }
function __pulse_fastly_jwt_capture_clock(effectIndex: i32): f64 { __pulse_fastly_jwt_clock_calls += 1; __pulse_fastly_jwt_event_order += "C"; const out = new StaticArray<i64>(1); const status = wasi_snapshot_preview1_clock_time_get(0, 1, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 226, effectIndex); return NaN } ${jwtClockOverride ? `return ${jwtClockOverride}` : 'return f64(load<i64>(changetype<usize>(out))) / 1000000000.0'} }
function __pulse_fastly_jwt_validate_schema(effectIndex: i32, schemaId: string, claimsHandle: i32): i32 { __pulse_fastly_jwt_schema_calls += 1; __pulse_fastly_jwt_event_order += "H"; if (__pulse_fastly_jwt_case_id() == "claims-schema-failure-after-registered-claims") return 0; return __pulse_fastly_schema_apply(schemaId, claimsHandle, false) }
function __pulse_fastly_jwt_sign_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const result = pulse_jwt_fastly_sign(effectIndex, unchecked(__pulse_fastly_payloads[effectIndex])); if (result > 0 && __pulse_fastly_last_error == 0) __pulse_fastly_ready_effect(effectIndex, result) }
function __pulse_fastly_jwt_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const result = pulse_jwt_fastly_verify(effectIndex, unchecked(__pulse_fastly_payloads[effectIndex])); if (result > 0 && __pulse_fastly_last_error == 0) __pulse_fastly_ready_effect(effectIndex, result) }
function __pulse_fastly_start_request(effectIndex: i32, url: string, method: string, headers: __PulseFastlyValue, body: string, backend: string): void { const requestOut = __pulse_fastly_out_i32(); let status = fastly_http_req_new(changetype<usize>(requestOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 70, effectIndex); return } const requestHandle = __pulse_fastly_out_value(requestOut); const bodyOut = __pulse_fastly_out_i32(); status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71, effectIndex); return } const bodyHandle = __pulse_fastly_out_value(bodyOut); const methodBytes = __pulse_fastly_utf8(method); status = fastly_http_req_method_set(requestHandle, changetype<usize>(methodBytes), methodBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 72, effectIndex); return } const urlBytes = __pulse_fastly_utf8(url); status = fastly_http_req_uri_set(requestHandle, changetype<usize>(urlBytes), urlBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 73, effectIndex); return } if (headers.kind == PULSE_VALUE_OBJECT) { for (let i = 0; i < headers.keys.length; i += 1) { const nameBytes = __pulse_fastly_utf8(unchecked(headers.keys[i])); const valueBytes = __pulse_fastly_utf8(__pulse_fastly_string(unchecked(headers.values[i]))); status = fastly_http_req_header_insert(requestHandle, changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(valueBytes), valueBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 74, effectIndex); return } } } if (body.length > 0) { status = __pulse_fastly_write_body(bodyHandle, body); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 75, effectIndex); return } } if (backend.length == 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 76, effectIndex); return } const backendBytes = __pulse_fastly_utf8(backend); const pendingOut = __pulse_fastly_out_i32(); status = fastly_http_req_send_async(requestHandle, bodyHandle, changetype<usize>(backendBytes), backendBytes.byteLength, changetype<usize>(pendingOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 77, effectIndex); return } unchecked(__pulse_fastly_pending[effectIndex] = __pulse_fastly_out_value(pendingOut)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_ASYNC) }
function __pulse_fastly_fetch_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const urlIndex = __pulse_fastly_find(payload, "url"); if (urlIndex < 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 48, effectIndex); return } const url = __pulse_fastly_string(unchecked(payload.values[urlIndex])); const initIndex = __pulse_fastly_find(payload, "init"); const init = initIndex >= 0 ? __pulse_fastly_value(unchecked(payload.values[initIndex])) : new __PulseFastlyValue(); let method = "GET"; let body = ""; let headers = new __PulseFastlyValue(); headers.kind = PULSE_VALUE_OBJECT; if (init.kind == PULSE_VALUE_OBJECT) { const methodIndex = __pulse_fastly_find(init, "method"); if (methodIndex >= 0) method = __pulse_fastly_string(unchecked(init.values[methodIndex])).toUpperCase(); const headersIndex = __pulse_fastly_find(init, "headers"); if (headersIndex >= 0) headers = __pulse_fastly_value(unchecked(init.values[headersIndex])); const bodyIndex = __pulse_fastly_find(init, "body"); const jsonIndex = __pulse_fastly_find(init, "json"); if (bodyIndex >= 0) { const bodyValue = unchecked(init.values[bodyIndex]); const bodyObject = __pulse_fastly_value(bodyValue); body = bodyObject.kind == PULSE_VALUE_STRING ? bodyObject.text : __pulse_fastly_json(bodyValue, 0) } else if (jsonIndex >= 0) { body = __pulse_fastly_json(unchecked(init.values[jsonIndex]), 0); let hasContentType = false; for (let i = 0; i < headers.keys.length; i += 1) if (unchecked(headers.keys[i]).toLowerCase() == "content-type") hasContentType = true; if (!hasContentType) { headers.keys.push("content-type"); headers.values.push(__pulse_fastly_string_value("application/json; charset=utf-8")) } } } __pulse_fastly_start_request(effectIndex, url, method, headers, body, __pulse_fastly_backend(effectIndex)) }
function __pulse_fastly_kv_get_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const store = __pulse_fastly_open_kv_store(effectIndex); if (__pulse_fastly_last_error != 0) return; const key = __pulse_fastly_string(__pulse_fastly_payload_field(payload, "key")); const keyBytes = __pulse_fastly_utf8(key); const lookupOut = __pulse_fastly_out_i32(); const config = new StaticArray<i32>(1); const status = fastly_kv_store_lookup(store, changetype<usize>(keyBytes), keyBytes.byteLength, 0, changetype<usize>(config), changetype<usize>(lookupOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 116, effectIndex); return } unchecked(__pulse_fastly_pending[effectIndex] = __pulse_fastly_out_value(lookupOut)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_ASYNC) }
function __pulse_fastly_assets_payload(payload: __PulseFastlyValue): __PulseFastlyValue { const value = __pulse_fastly_value(__pulse_fastly_payload_field(payload, "payload")); if (value.kind != PULSE_VALUE_OBJECT) __pulse_fastly_fail(PULSE_ERROR_VALUE, 146, -1); return value }
function __pulse_fastly_assets_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const value = __pulse_fastly_assets_payload(payload); if (__pulse_fastly_last_error != 0) return; const store = __pulse_fastly_open_kv_store(effectIndex); if (__pulse_fastly_last_error != 0) return; const key = __pulse_fastly_string(__pulse_fastly_payload_field(value, "key")); const keyBytes = __pulse_fastly_utf8(key); const lookupOut = __pulse_fastly_out_i32(); const config = new StaticArray<i32>(1); const status = fastly_kv_store_lookup(store, changetype<usize>(keyBytes), keyBytes.byteLength, 0, changetype<usize>(config), changetype<usize>(lookupOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 147, effectIndex); return } unchecked(__pulse_fastly_pending[effectIndex] = __pulse_fastly_out_value(lookupOut)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_ASYNC) }
function __pulse_fastly_kv_put_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const store = __pulse_fastly_open_kv_store(effectIndex); if (__pulse_fastly_last_error != 0) return; const key = __pulse_fastly_string(__pulse_fastly_payload_field(payload, "key")); const value = __pulse_fastly_payload_field(payload, "value"); const bodyOut = __pulse_fastly_out_i32(); let status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 117, effectIndex); return } const body = __pulse_fastly_out_value(bodyOut); status = __pulse_fastly_write_body(body, "{\"__pulseKv\":1,\"value\":" + __pulse_fastly_json(value, 0) + "}"); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 118, effectIndex); return } const keyBytes = __pulse_fastly_utf8(key); const insertOut = __pulse_fastly_out_i32(); const config = new StaticArray<i64>(4); status = fastly_kv_store_insert(store, changetype<usize>(keyBytes), keyBytes.byteLength, body, 0, changetype<usize>(config), changetype<usize>(insertOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 119, effectIndex); return } unchecked(__pulse_fastly_pending[effectIndex] = __pulse_fastly_out_value(insertOut)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_ASYNC) }
function __pulse_fastly_grip_add_channel(channel: string): void { if (channel.length == 0) return; for (let i = 0; i < __pulse_fastly_grip_channels.length; i += 1) if (unchecked(__pulse_fastly_grip_channels[i]) == channel) return; __pulse_fastly_grip_channels.push(channel) }
function __pulse_fastly_grip_payload(payload: __PulseFastlyValue): __PulseFastlyValue { return __pulse_fastly_value(__pulse_fastly_payload_field(payload, "payload")) }
function __pulse_fastly_grip_channel_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const value = __pulse_fastly_grip_payload(payload); if (value.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 120, effectIndex); return } const channel = __pulse_fastly_string(__pulse_fastly_payload_field(value, "channel")); const prefixHandle = __pulse_fastly_payload_field(value, "prefix"); const prefixValue = __pulse_fastly_value(prefixHandle); const prefix = prefixValue.kind == PULSE_VALUE_UNDEFINED ? "" : __pulse_fastly_string(prefixHandle); __pulse_fastly_grip_add_channel(prefix + channel); __pulse_fastly_ready_effect(effectIndex, host_value_boolean(1)) }
function __pulse_fastly_grip_hold_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const value = __pulse_fastly_grip_payload(payload); if (value.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 121, effectIndex); return } const modeHandle = __pulse_fastly_payload_field(value, "mode"); const modeValue = __pulse_fastly_value(modeHandle); const mode = modeValue.kind == PULSE_VALUE_UNDEFINED ? "stream" : __pulse_fastly_string(modeHandle); const explicitHandle = __pulse_fastly_payload_field(value, "channels"); const explicit = __pulse_fastly_value(explicitHandle); if (explicit.kind == PULSE_VALUE_ARRAY) for (let i = 0; i < explicit.values.length; i += 1) __pulse_fastly_grip_add_channel(__pulse_fastly_string(unchecked(explicit.values[i]))); const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; output.headers.push(new __PulseFastlyHeader("content-type", "application/octet-stream")); output.headers.push(new __PulseFastlyHeader("grip-hold", mode)); for (let i = 0; i < __pulse_fastly_grip_channels.length; i += 1) output.headers.push(new __PulseFastlyHeader("grip-channel", unchecked(__pulse_fastly_grip_channels[i]))); const timeoutHandle = __pulse_fastly_payload_field(value, "timeoutMs"); if (__pulse_fastly_value(timeoutHandle).kind != PULSE_VALUE_UNDEFINED) output.headers.push(new __PulseFastlyHeader("grip-timeout", i32(Math.max(0.0, __pulse_fastly_number(timeoutHandle))).toString())); __pulse_fastly_ready_effect(effectIndex, __pulse_fastly_put(output)) }
${gripSecretSource}
function __pulse_fastly_grip_publish_begin(effectIndex: i32, payload: __PulseFastlyValue): void { const valueHandle = __pulse_fastly_payload_field(payload, "payload"); const value = __pulse_fastly_value(valueHandle); if (value.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 122, effectIndex); return } const headers = new __PulseFastlyValue(); headers.kind = PULSE_VALUE_OBJECT; headers.keys.push("content-type"); headers.values.push(__pulse_fastly_string_value("application/json; charset=utf-8")); headers.keys.push("accept"); headers.values.push(__pulse_fastly_string_value("application/json")); ${gripAuthorizationSource} const body = __pulse_fastly_json(valueHandle, 0); if (String.UTF8.encode(body, false).byteLength > PULSE_FASTLY_BUFFER_BYTES) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 145, effectIndex); return } __pulse_fastly_start_request(effectIndex, __pulse_fastly_grip_publish_url(effectIndex), "POST", headers, body, __pulse_fastly_backend(effectIndex)) }
${effectDispatchSource(plan)}
function __pulse_fastly_wait_fetch(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_ASYNC) { __pulse_fastly_fail(PULSE_ERROR_STATE, 80, effectIndex); return 0 } const pending = unchecked(__pulse_fastly_pending[effectIndex]); const responseOut = __pulse_fastly_out_i32(); const bodyOut = __pulse_fastly_out_i32(); const status = fastly_http_req_pending_req_wait(pending, changetype<usize>(responseOut), changetype<usize>(bodyOut)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE); unchecked(__pulse_fastly_pending[effectIndex] = 0); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 81, effectIndex); return 0 } const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_FETCH; value.responseHandle = __pulse_fastly_out_value(responseOut); value.bodyHandle = __pulse_fastly_out_value(bodyOut); return __pulse_fastly_put(value) }
function __pulse_fastly_wait_grip_publish(effectIndex: i32): i32 { const responseHandle = __pulse_fastly_wait_fetch(effectIndex); if (responseHandle <= 0) return 0; const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 129, effectIndex); return 0 } const statusOut = __pulse_fastly_out_i32(); const statusCall = fastly_http_resp_status_get(response.responseHandle, changetype<usize>(statusOut)); if (statusCall != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 130, effectIndex); return 0 } const originStatus = __pulse_fastly_out_value(statusOut); if (originStatus < 200 || originStatus > 299) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 131, effectIndex); return 0 } const outer = __pulse_fastly_value(unchecked(__pulse_fastly_payloads[effectIndex])); const publicationHandle = __pulse_fastly_payload_field(outer, "payload"); const publication = __pulse_fastly_value(publicationHandle); if (publication.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 132, effectIndex); return 0 } const receipt = host_value_object(); host_value_object_set(receipt, __pulse_fastly_string_value("published"), host_value_boolean(1)); for (let i = 0; i < publication.keys.length; i += 1) host_value_object_set(receipt, __pulse_fastly_string_value(unchecked(publication.keys[i])), unchecked(publication.values[i])); const options = host_value_object(); host_value_object_set(options, __pulse_fastly_string_value("status"), host_value_number(202.0)); return host_response_json(receipt, options) }
function __pulse_fastly_wait_grip_broadcast(effectIndex: i32): i32 { const responseHandle = __pulse_fastly_wait_fetch(effectIndex); if (responseHandle <= 0) return 0; const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 142, effectIndex); return 0 } const statusOut = __pulse_fastly_out_i32(); const statusCall = fastly_http_resp_status_get(response.responseHandle, changetype<usize>(statusOut)); if (statusCall != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 143, effectIndex); return 0 } const originStatus = __pulse_fastly_out_value(statusOut); if (originStatus < 200 || originStatus > 299) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 144, effectIndex); return 0 } const receipt = host_value_object(); host_value_object_set(receipt, __pulse_fastly_string_value("accepted"), host_value_boolean(1)); host_value_object_set(receipt, __pulse_fastly_string_value("status"), host_value_number(f64(originStatus))); return receipt }
function __pulse_fastly_wait_ready(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_READY) { __pulse_fastly_fail(PULSE_ERROR_STATE, 124, effectIndex); return 0 } const value = unchecked(__pulse_fastly_ready[effectIndex]); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE); unchecked(__pulse_fastly_pending[effectIndex] = 0); unchecked(__pulse_fastly_ready[effectIndex] = 0); return value }
function __pulse_fastly_wait_kv_get(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_mode[effectIndex]) == PULSE_FASTLY_PENDING_READY) return __pulse_fastly_wait_ready(effectIndex); if (unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_ASYNC) { __pulse_fastly_fail(PULSE_ERROR_STATE, 125, effectIndex); return 0 } const pending = unchecked(__pulse_fastly_pending[effectIndex]); const bodyOut = __pulse_fastly_out_i32(); const metadata = new Uint8Array(1); const written = __pulse_fastly_out_i32(); const generation = new StaticArray<i64>(1); const kvError = __pulse_fastly_out_i32(); const status = fastly_kv_store_lookup_wait_v2(pending, changetype<usize>(bodyOut), metadata.dataStart, 0, changetype<usize>(written), changetype<usize>(generation), changetype<usize>(kvError)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE); unchecked(__pulse_fastly_pending[effectIndex] = 0); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 125, effectIndex); return 0 } const errorCode = __pulse_fastly_out_value(kvError); if (errorCode == 3) return host_value_undefined(); if (errorCode != 1) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 128, effectIndex); return 0 } const text = __pulse_fastly_read_body(__pulse_fastly_out_value(bodyOut), effectIndex); if (__pulse_fastly_last_error != 0) return 0; const parser = new __PulseJsonParser(text); const parsed = parser.parse(); if (parser.failed || parsed <= 0) return __pulse_fastly_string_value(text); const object = __pulse_fastly_value(parsed); if (object.kind == PULSE_VALUE_OBJECT) { const marker = __pulse_fastly_find(object, "__pulseKv"); const value = __pulse_fastly_find(object, "value"); if (marker >= 0 && value >= 0 && __pulse_fastly_number(unchecked(object.values[marker])) == 1.0) return unchecked(object.values[value]) } return parsed }
function __pulse_fastly_asset_content_type(key: string): string { const dot = key.lastIndexOf("."); const extension = dot < 0 ? "" : key.substring(dot + 1).toLowerCase(); if (extension == "css") return "text/css; charset=utf-8"; if (extension == "html") return "text/html; charset=utf-8"; if (extension == "js" || extension == "mjs") return "text/javascript; charset=utf-8"; if (extension == "json") return "application/json; charset=utf-8"; if (extension == "svg") return "image/svg+xml"; if (extension == "txt") return "text/plain; charset=utf-8"; if (extension == "webp") return "image/webp"; if (extension == "png") return "image/png"; if (extension == "jpg" || extension == "jpeg") return "image/jpeg"; if (extension == "gif") return "image/gif"; if (extension == "ico") return "image/x-icon"; return "application/octet-stream" }
function __pulse_fastly_asset_text(text: string): string { const parser = new __PulseJsonParser(text); const parsed = parser.parse(); if (parser.failed || parsed <= 0) return text; const object = __pulse_fastly_value(parsed); if (object.kind != PULSE_VALUE_OBJECT) return text; const marker = __pulse_fastly_find(object, "__pulseKv"); const value = __pulse_fastly_find(object, "value"); if (marker < 0 || value < 0 || __pulse_fastly_number(unchecked(object.values[marker])) != 1.0) return text; return __pulse_fastly_string(unchecked(object.values[value])) }
function __pulse_fastly_wait_assets(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_ASYNC) { __pulse_fastly_fail(PULSE_ERROR_STATE, 148, effectIndex); return 0 } const pending = unchecked(__pulse_fastly_pending[effectIndex]); const bodyOut = __pulse_fastly_out_i32(); const metadata = new Uint8Array(1); const written = __pulse_fastly_out_i32(); const generation = new StaticArray<i64>(1); const kvError = __pulse_fastly_out_i32(); const status = fastly_kv_store_lookup_wait_v2(pending, changetype<usize>(bodyOut), metadata.dataStart, 0, changetype<usize>(written), changetype<usize>(generation), changetype<usize>(kvError)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE); unchecked(__pulse_fastly_pending[effectIndex] = 0); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 149, effectIndex); return 0 } const outer = __pulse_fastly_value(unchecked(__pulse_fastly_payloads[effectIndex])); const payload = __pulse_fastly_assets_payload(outer); if (__pulse_fastly_last_error != 0) return 0; const key = __pulse_fastly_string(__pulse_fastly_payload_field(payload, "key")); const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; const errorCode = __pulse_fastly_out_value(kvError); output.status = errorCode == 3 ? 404 : 200; if (errorCode != 1 && errorCode != 3) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 150, effectIndex); return 0 } const headersHandle = __pulse_fastly_payload_field(payload, "headers"); const headers = __pulse_fastly_value(headersHandle); let hasContentType = false; if (headers.kind == PULSE_VALUE_OBJECT) { for (let i = 0; i < headers.keys.length; i += 1) { const name = unchecked(headers.keys[i]); if (name.toLowerCase() == "content-type") hasContentType = true; output.headers.push(new __PulseFastlyHeader(name, __pulse_fastly_string(unchecked(headers.values[i])))) } } if (!hasContentType) output.headers.push(new __PulseFastlyHeader("content-type", output.status == 200 ? __pulse_fastly_asset_content_type(key) : "text/plain; charset=utf-8")); const cacheHandle = __pulse_fastly_payload_field(payload, "cacheControl"); if (__pulse_fastly_value(cacheHandle).kind != PULSE_VALUE_UNDEFINED) output.headers.push(new __PulseFastlyHeader("cache-control", __pulse_fastly_string(cacheHandle))); const methodHandle = __pulse_fastly_payload_field(payload, "method"); const method = __pulse_fastly_value(methodHandle).kind == PULSE_VALUE_UNDEFINED ? "GET" : __pulse_fastly_string(methodHandle).toUpperCase(); if (output.status == 200 && method != "HEAD") { const text = __pulse_fastly_read_body(__pulse_fastly_out_value(bodyOut), effectIndex); if (__pulse_fastly_last_error != 0) return 0; output.text = __pulse_fastly_asset_text(text) } return __pulse_fastly_put(output) }
function __pulse_fastly_wait_kv_put(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_mode[effectIndex]) != PULSE_FASTLY_PENDING_ASYNC) { __pulse_fastly_fail(PULSE_ERROR_STATE, 126, effectIndex); return 0 } const pending = unchecked(__pulse_fastly_pending[effectIndex]); const kvError = __pulse_fastly_out_i32(); const status = fastly_kv_store_insert_wait(pending, changetype<usize>(kvError)); unchecked(__pulse_fastly_pending_mode[effectIndex] = PULSE_FASTLY_PENDING_NONE); unchecked(__pulse_fastly_pending[effectIndex] = 0); if (status != FASTLY_STATUS_OK || __pulse_fastly_out_value(kvError) != 1) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 127, effectIndex); return 0 } return host_value_boolean(1) }
function __pulse_fastly_write_body(bodyHandle: i32, value: string): i32 { const bytes = __pulse_fastly_utf8(value); let offset = 0; while (offset < bytes.byteLength) { const written = __pulse_fastly_out_i32(); const status = fastly_http_body_write(bodyHandle, changetype<usize>(bytes) + offset, bytes.byteLength - offset, 0, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) return status; const count = __pulse_fastly_out_value(written); if (count <= 0) return 1; offset += count } return FASTLY_STATUS_OK }
function __pulse_fastly_send_result(handle: i32): i32 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_FETCH) return fastly_http_resp_send_downstream(value.responseHandle, value.bodyHandle, 0); if (value.kind != PULSE_VALUE_RESPONSE) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 90, -1); return PULSE_ERROR_VALUE } const responseOut = __pulse_fastly_out_i32(); let status = fastly_http_resp_new(changetype<usize>(responseOut)); if (status != FASTLY_STATUS_OK) return status; const responseHandle = __pulse_fastly_out_value(responseOut); const bodyOut = __pulse_fastly_out_i32(); status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) return status; const bodyHandle = __pulse_fastly_out_value(bodyOut); status = fastly_http_resp_status_set(responseHandle, value.status); if (status != FASTLY_STATUS_OK) return status; for (let i = 0; i < value.headers.length; i += 1) { const header = unchecked(value.headers[i]); const nameBytes = __pulse_fastly_utf8(header.name); const valueBytes = __pulse_fastly_utf8(header.value); status = fastly_http_resp_header_append(responseHandle, changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(valueBytes), valueBytes.byteLength); if (status != FASTLY_STATUS_OK) return status } status = __pulse_fastly_write_body(bodyHandle, value.text); if (status != FASTLY_STATUS_OK) return status; return fastly_http_resp_send_downstream(responseHandle, bodyHandle, 0) }

${jwtEvidenceSource}
${es256KeyArtifactSource(es256KeyRecords)}
${jwtCryptoCompositionSource(jwtCrypto)}
${generateSchemaRuntime(plan)}
${effectResultSource(plan, bindings)}
`;
}

function driverSource(plan, options = {}) {
  const entryName = options.guestLinked === true
    ? 'pulse_fastly_handle'
    : '_start';
  return String.raw`
export function pulse_fastly_last_error(): i32 { return __pulse_fastly_last_error }
export function pulse_fastly_error_stage(): i32 { return __pulse_fastly_error_stage }
export function pulse_fastly_error_effect(): i32 { return __pulse_fastly_error_effect }
export function pulse_fastly_jwt_error(): i32 { return __pulse_fastly_jwt_error }
export function pulse_fastly_jwt_secret_calls(): i32 { return __pulse_fastly_jwt_secret_calls }
export function pulse_fastly_jwt_crypto_calls(): i32 { return __pulse_fastly_jwt_crypto_calls }
export function pulse_fastly_jwt_clock_calls(): i32 { return __pulse_fastly_jwt_clock_calls }
export function pulse_fastly_jwt_schema_calls(): i32 { return __pulse_fastly_jwt_schema_calls }
export function ${entryName}(): void {
  __pulse_fastly_last_error = fastly_abi_init(PULSE_FASTLY_EFFECTS_ABI_VERSION)
  if (__pulse_fastly_last_error != FASTLY_STATUS_OK) { __pulse_fastly_jwt_send_error(); return }
  const handles = new StaticArray<i32>(2)
  const downstreamStatus = fastly_http_req_body_downstream_get(changetype<usize>(handles), changetype<usize>(handles) + 4)
  if (downstreamStatus != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 100, -1); __pulse_fastly_jwt_send_error(); return }
  __pulse_fastly_request_handle = load<i32>(changetype<usize>(handles))
  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)
  __pulse_fastly_request_method = __pulse_fastly_read_req_string(0)
  if (__pulse_fastly_last_error != 0) { __pulse_fastly_jwt_send_error(); return }
  __pulse_fastly_request_url = __pulse_fastly_read_req_string(1)
  if (__pulse_fastly_last_error != 0) { __pulse_fastly_jwt_send_error(); return }
  __pulse_fastly_request_path = __pulse_fastly_path(__pulse_fastly_request_url)
  let runStatus = pulse_start()
${applicationErrors.enabled(plan) ? applicationErrors.driverLoop(plan) : `  while (runStatus == 1 && __pulse_fastly_last_error == 0) {
    for (let effectIndex = 0; effectIndex < PULSE_FASTLY_EFFECT_COUNT; effectIndex += 1) {
      if (unchecked(__pulse_fastly_pending_mode[effectIndex]) == PULSE_FASTLY_PENDING_NONE) continue
      const result = __pulse_fastly_resolve_effect(effectIndex)
      if (result <= 0 || __pulse_fastly_last_error != 0) { __pulse_fastly_jwt_send_error(); return }
      if (pulse_set_effect_result(effectIndex, result) != 1) { __pulse_fastly_fail(PULSE_ERROR_STATE, 101, effectIndex); __pulse_fastly_jwt_send_error(); return }
    }
    runStatus = pulse_resume()
  }`}
  if (__pulse_fastly_last_error != 0) { __pulse_fastly_jwt_send_error(); return }
  if (runStatus != 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 102, -1); __pulse_fastly_jwt_send_error(); return }
  const result = pulse_result_handle()
  if (result <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 103, -1); __pulse_fastly_jwt_send_error(); return }
  __pulse_fastly_jwt_attach_evidence(result)
  const sendStatus = __pulse_fastly_send_result(result)
  if (sendStatus != FASTLY_STATUS_OK) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 104, -1)
}
`;
}

function capabilityImports(effect) {
  if (effect.kind === 'time.now') return ['wasi_snapshot_preview1.clock_time_get'];
  if (effect.kind === 'config.get') return ['fastly_config_store.open', 'fastly_config_store.get'];
  if (effect.kind === 'secret.get') return ['fastly_secret_store.open', 'fastly_secret_store.get', 'fastly_secret_store.plaintext'];
  if (['jwt.verify', 'jwt.sign'].includes(effect.kind)) {
    return [
      ...(effect.resource && effect.resource.keyType === 'secret'
        ? [
            'fastly_secret_store.open',
            'fastly_secret_store.get',
            'fastly_secret_store.plaintext'
          ]
        : []),
      'wasi_snapshot_preview1.clock_time_get'
    ];
  }
  if (conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind)) return conditionalKv.kvImports(effect.kind).map(key => key.replace(':', '.'));
  if (effect.kind === 'kv.get') return ['fastly_kv_store.open', 'fastly_kv_store.lookup', 'fastly_kv_store.lookup_wait_v2', 'fastly_http_body.read'];
  if (effect.kind === 'kv.put') return ['fastly_kv_store.open', 'fastly_kv_store.insert', 'fastly_kv_store.insert_wait', 'fastly_http_body.new', 'fastly_http_body.write'];
  if (effect.kind === 'assets.lookup') return ['fastly_kv_store.open', 'fastly_kv_store.lookup', 'fastly_kv_store.lookup_wait_v2', 'fastly_http_body.read'];
  if (effect.kind === 'fetch' || effect.kind === 'grip.publish' || effect.kind === 'grip.broadcast') {
    return [
      'fastly_http_req.new',
      'fastly_http_req.send_async',
      'fastly_http_req.pending_req_wait',
      ...(effect.kind === 'grip.broadcast' ? ['fastly_secret_store.open', 'fastly_secret_store.get', 'fastly_secret_store.plaintext'] : [])
    ];
  }
  if (effect.kind === 'grip.hold') return ['fastly_http_resp.new', 'fastly_http_resp.header_append', 'fastly_http_resp.send_downstream'];
  return [];
}

function generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options = {}) {
  validatePlanBoundary(plan, options);
  const facts = packageFacts(plan, options);
  const jwtCrypto = selectedJwtCrypto(plan);
  const es256KeyRecords = jwtCrypto && jwtCrypto.algorithm === 'ES256'
    ? resolveEs256KeyArtifacts(plan, facts)
    : Object.freeze([]);
  if (jwtCrypto && jwtCrypto.guestUnitRequired && facts.guestUnits.length !== 1) {
    fail(
      'Fastly Native ES256 requires exactly one synchronized linked guest unit.',
      'PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID',
      {
        selected: facts.guestUnits.map((entry) => entry.id),
        automaticFallback: false
      }
    );
  }
  if (jwtCrypto && !jwtCrypto.guestUnitRequired && facts.guestUnits.length !== 0) {
    fail(
      'Fastly Native JWT received an unselected guest unit.',
      'PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID',
      {
        selected: facts.guestUnits.map((entry) => entry.id),
        automaticFallback: false
      }
    );
  }
  const bindings = resolveCapabilityBindings(plan, options);
  const portable = generateCanonicalNativeAssemblyScript(plan, options);
  const portableSource = stripPulseHostImports(portable.source);
  const hasJwt = (plan.effects || []).some((effect) => effect.kind === 'jwt.verify');
  const hasSign = plan.effects.some(effect => effect.kind === 'jwt.sign');
  const jwtSource = hasJwt || hasSign ? pulseJwtAssemblyScriptSource({ includeSigning: hasSign }) : undefined;
  let source = [
    '/* Generated by Pulse Pass98 Fastly native platform capability compiler. */',
    'export function __pulse_fastly_abort(message: string | null, fileName: string | null = null, line: u32 = 0, column: u32 = 0): void { unreachable() }',
    '',
    fastlyRuntimeSource(plan, bindings, {
      ...options,
      jwtCrypto,
      es256KeyRecords
    }),
    jwtSource ? jwtSource.source : '',
    require('./s3-native.js').s3NativeSource(plan, bindings),
    require('./time-native.js').timeNativeSource(plan),
    require('./digest-native.js').digestNativeSource(plan),
    conditionalKv.kvNativeSource(plan),
    require('./native-request-body.js').runtimeSource(),
    require('./native-request-headers.js').runtimeSource(),
    applicationErrors.enabled(plan) ? applicationErrors.runtimeSource() : '',
    portableSource,
    driverSource(plan, { guestLinked: facts.guestUnits.length > 0 }),
    ''
  ].join('\n');
  if (applicationErrors.enabled(plan)) source = applicationErrors.instrument(source);
  source = require('./native-request-headers.js').instrument(source, applicationErrors.enabled(plan), /\bhost_request_headers\(/.test(portableSource));
  source = require('./native-request-body.js').instrument(source, applicationErrors.enabled(plan));
  source = require('./request-budget.js').instrumentRequestBudget(source, bindings.maxDurationMs, plan);
  const effectKinds = Object.freeze((plan.effects || []).reduce((output, effect) => {
    output[effect.kind] = (output[effect.kind] || 0) + 1;
    return output;
  }, {}));
  const capabilityDiagnostics = Object.freeze((plan.effects || []).map((effect, index) => Object.freeze({
    index,
    id: effect.id,
    kind: effect.kind,
    capability: effect.capability,
    package: effect.package,
    contractId: effect.contractId,
    imports: Object.freeze(capabilityImports(effect))
  })));
  const manifest = Object.freeze({
    version: FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
    generatorVersion: FASTLY_NATIVE_PLATFORM_CAPABILITIES_GENERATOR_VERSION,
    abiVersion: FASTLY_NATIVE_PLATFORM_CAPABILITIES_ABI_VERSION,
    planVersion: plan.version,
    planHash: plan.planHash,
    sourceHash: sha256(source),
    portableGeneratorVersion: portable.version,
    portableSourceHash: portable.sourceHash,
    schemaCodecs: portable.manifest.schemaCodecs,
    crypto: portable.manifest.crypto,
    jwt: jwtSource
      ? Object.freeze({
          status: jwtCrypto && jwtCrypto.algorithm === 'ES256'
            ? 'implemented-g4'
            : 'implemented-e2',
          package: jwtSource.owner,
          packageVersion: jwtSource.packageVersion,
          sourceId: jwtSource.id,
          sourceFile: jwtSource.sourceFile,
          sourceBytes: jwtSource.sourceBytes,
          sourceSha256: jwtSource.sourceSha256,
          sourceIncluded: true,
          semanticOwnership: jwtSource.semanticOwnership,
          providerAuthorities: jwtSource.providerAuthorities,
          cryptoRealization: jwtCrypto.realization,
          cryptoImplementation: jwtCrypto.implementation,
          keyArtifactCount: es256KeyRecords.length,
          automaticFallback: false
        })
      : Object.freeze({ status: 'inactive' }),
    effectCount: (plan.effects || []).length,
    effectKinds,
    continuationCount: (plan.continuations || []).length,
    groupedContinuationCount: (plan.continuations || []).filter((entry) => (entry.effectIds || []).length > 1).length,
    bindings,
    backends: bindings.backends,
    capabilityDiagnostics,
    allowedImports: FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS,
    requiredImports: requiredImportsForPlan(plan, bindings),
    requiredExports: Object.freeze([
      '_start',
      'pulse_fastly_last_error',
      'pulse_fastly_error_stage',
      'pulse_fastly_error_effect',
      'pulse_plan_hash_ptr',
      'pulse_plan_hash_length',
      ...(bindings.maxDurationMs === undefined ? [] : ['pulse_fastly_request_expired'])
    ]),
    policy: Object.freeze({
      nativeFastly: true,
      provider: 'fastly',
      providerNeutralInput: true,
      javascriptRuntime: false,
      jsComputeRuntime: false,
      wasi: bindings.maxDurationMs !== undefined || hasJwt || hasSign || bindings.s3.length || plan.effects.some(effect => conditionalKv.KV_CONDITIONAL_KINDS.includes(effect.kind)) ? 'clock_time_get only' : false,
      effects: FASTLY_NATIVE_PLATFORM_EFFECT_KINDS.join(', '),
      continuations: true,
      groupedEffects: 'existing fetch start-before-wait ordering remains intact',
      config: 'Fastly Config Store open/get with undefined for missing values',
      secrets: 'Fastly Secret Store open/get/plaintext; proof traces redact plaintext values',
      jwt: hasJwt || hasSign
        ? `package-owned compact-JWS, registered-claim, and bounded issuance semantics composed with ${jwtCrypto.realization}; provider-owned request, secret, clock, schema, and transport`
        : 'inactive',
      kv: 'Fastly KV Store async lookup/insert; conditional operations preserve u64 generations, bounded readiness, strict Pulse envelopes and uncertain dispatch',
      assets: 'Fastly KV Store lookup with provider-owned content type, cache headers, and GET/HEAD body ownership',
      grip: 'canonical stateless framing plus bound, secret-referenced broadcast HTTP realization and stable acknowledgement',
      logging: 'best-effort redacted writes to the provider-owned stdout logging endpoint',
      schemas: 'fetch JSON decode and structured response encode',
      opaqueResponse: 'origin fetch response/body handles and direct GRIP hold responses pass through without JavaScript runtime ownership',
      transportErrors: 'host status failures remain distinct from HTTP response status',
      platformCapabilities: (plan.effects || []).some((effect) => FASTLY_NATIVE_PLATFORM_CAPABILITY_KINDS.has(effect.kind)),
      canonicalBuildLifecycle: options.canonicalBuild === true,
      realFastlyExecution: false
    }),
    harness: options.jwtReality && options.jwtReality.enabled === true
      ? Object.freeze({
          id: 'pulse.jwt-native-reality.e2',
          classifiedAsTargetBehavior: false,
          clockOverride: Number(options.jwtReality.clockUnixSeconds),
          caseHeader: 'x-pulse-e2-case'
        })
      : undefined
  });
  return Object.freeze({
    version: FASTLY_NATIVE_PLATFORM_CAPABILITIES_GENERATOR_VERSION,
    source,
    sourceHash: manifest.sourceHash,
    manifest,
    bindings,
    portable,
    realizationArtifacts: facts.realizationArtifacts,
    guestUnits: facts.guestUnits,
    jwtCrypto,
    es256KeyRecords
  });
}

function inspectFastlyNativePlatformCapabilitiesWasm(input) {
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(bytes)) fail('Generated Fastly native platform capabilities module is not valid WebAssembly.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_WASM_INVALID');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind }));
  const exports = WebAssembly.Module.exports(module).map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }));
  const unexpected = imports.filter((entry) => !FASTLY_NATIVE_PLATFORM_CAPABILITIES_ALLOWED_IMPORTS.has(`${entry.module}:${entry.name}`));
  if (unexpected.length > 0) fail('Generated Fastly native platform capabilities module imports functions outside the Pass98 ABI.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORT_UNSUPPORTED', { unexpected, imports });
  const forbidden = imports.filter((entry) => /pulse_host|js[_-]?compute/i.test(`${entry.module}:${entry.name}`));
  if (forbidden.length > 0) fail('Generated Fastly native platform capabilities module imports a forbidden runtime.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_RUNTIME_FORBIDDEN', { forbidden });
  const imported = new Set(imports.map((entry) => `${entry.module}:${entry.name}`));
  const missingImports = FASTLY_NATIVE_PLATFORM_CAPABILITIES_REQUIRED_IMPORTS.map(([moduleName, name]) => `${moduleName}:${name}`).filter((key) => !imported.has(key));
  if (missingImports.length > 0) fail('Generated Fastly native platform capabilities module is missing required host imports.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORT_MISSING', { missingImports, imports });
  const exportNames = new Set(exports.map((entry) => entry.name));
  const requiredExports = ['_start', 'memory', 'pulse_fastly_last_error', 'pulse_fastly_error_stage', 'pulse_fastly_error_effect', 'pulse_start', 'pulse_resume', 'pulse_set_effect_result', 'pulse_result_handle'];
  const missingExports = requiredExports.filter((name) => !exportNames.has(name));
  if (missingExports.length > 0) fail('Generated Fastly native platform capabilities module is missing required exports.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_EXPORT_MISSING', { missingExports, exports });
  if (bytes.length > FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES) fail('Generated Fastly native platform capabilities module exceeds the Pass98 size ceiling.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_WASM_TOO_LARGE', { bytes: bytes.length, maxBytes: FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES });
  return Object.freeze({
    valid: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
    magic: bytes.subarray(0, 8).toString('hex'),
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    importModules: Object.freeze([...new Set(imports.map((entry) => entry.module))].sort())
  });
}

function compileFastlyNativePlatformCapabilitiesPlan(plan, options = {}) {
  const generated = generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options);
  const cwd = path.resolve(options.cwd || process.cwd());
  const compilerFallback = path.resolve(__dirname, '..', '..', '..', '..', 'wasm', 'packages', 'compiler');
  const asc = resolveAsc(cwd) || resolveAsc(compilerFallback);
  if (!asc) fail('AssemblyScript compiler dependency was not found for Fastly native platform capabilities realization.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_ASC_MISSING', { cwd, compilerFallback });
  const schemaCodecsActive = generated.manifest.schemaCodecs && generated.manifest.schemaCodecs.active === true;
  const nativeOptimization = options.nativeOptimization
    || (options.experimentalNativeSize === true ? FASTLY_NATIVE_SIZE_OPTIMIZATION : undefined);
  let jsonAs;
  if (schemaCodecsActive) {
    let transform;
    try {
      transform = require.resolve('json-as', { paths: [compilerFallback, cwd] });
    } catch (error) {
      fail(
        'The lockfile-pinned json-as transform was not found for Fastly Native schema codec compilation.',
        'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_JSON_AS_MISSING',
        { cwd, package: 'json-as', version: '1.5.0', cause: error && error.message }
      );
    }
    const packageRoot = path.resolve(transform, '..', '..', '..');
    const dependencyRoot = path.dirname(packageRoot);
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== '1.5.0') {
      fail(
        'Fastly Native schema codec compilation requires json-as 1.5.0 exactly.',
        'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_JSON_AS_VERSION_INVALID',
        { expected: '1.5.0', actual: packageJson.version, packageRoot }
      );
    }
    jsonAs = Object.freeze({ transform, dependencyRoot, version: packageJson.version });
  }
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-native-platform-'));
  const requestedOutDir = options.outDir ? path.resolve(options.outDir) : undefined;
  const outputDir = requestedOutDir || stagingDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFile = path.join(stagingDir, 'fastly-native-platform-capabilities.as.ts');
  const wasmFile = path.join(outputDir, options.wasmFile || 'fastly-native-platform-capabilities.wasm');
  const watFile = path.join(outputDir, options.watFile || 'fastly-native-platform-capabilities.wat');
  const guestLinked = generated.guestUnits.length > 0;
  // asc resolves custom runtimes like module names and appends ".ts".
  const fixedMemoryRuntimeModule = path.join(__dirname, 'fixed-memory-runtime.as');
  const fixedMemoryRuntimeFile = `${fixedMemoryRuntimeModule}.ts`;
  const assemblyScriptWasmFile = guestLinked
    ? path.join(stagingDir, 'fastly-native-platform-capabilities.primary.wasm')
    : wasmFile;
  const assemblyScriptWatFile = guestLinked
    ? path.join(stagingDir, 'fastly-native-platform-capabilities.primary.wat')
    : watFile;
  try {
    fs.writeFileSync(sourceFile, generated.source, 'utf8');
    const args = [
      asc.script,
      path.basename(sourceFile),
      '--outFile', assemblyScriptWasmFile,
      '--textFile', assemblyScriptWatFile,
      '--runtime', guestLinked
        ? fixedMemoryRuntimeModule
        : (schemaCodecsActive ? 'incremental' : 'stub'),
      '--noAssert',
      '--optimize'
    ];
    const optimization = appendAssemblyScriptOptimizationArgs(args, nativeOptimization);
    if (!guestLinked && plan.effects.some(effect => effect.kind === 'crypto.digestText' || effect.kind.startsWith('s3.'))) {
      args.push('--maximumMemory', '4096');
    }
    if (generated.guestUnits.length > 0) {
      args.push(
        '--disable', 'bulk-memory',
        '--disable', 'nontrapping-f2i',
        '--disable', 'sign-extension',
        '--importMemory',
        '--noExportMemory',
        '--initialMemory', String(memoryAbiV2.minimumPages),
        '--maximumMemory', String(memoryAbiV2.maximumPages),
        '--memoryBase', String(memoryAbiV2.layout.primaryStatic.start),
        '--exportStart', '__pulse_initialize'
      );
    }
    args.push('--use', 'abort=fastly-native-platform-capabilities.as/__pulse_fastly_abort');
    if (schemaCodecsActive) {
      args.push(
        '--exportRuntime',
        '--transform', jsonAs.transform,
        '--path', path.join(compilerFallback, 'node_modules'),
        '--path', jsonAs.dependencyRoot
      );
    }
    const startedAt = Date.now();
    const result = spawnSync(asc.executable, args, {
      cwd: stagingDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number(options.timeoutMs || 180000),
      env: schemaCodecsActive
        ? { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' }
        : process.env
    });
    const assemblyScriptDurationMs = Date.now() - startedAt;
    if (result.error || result.status !== 0 || !fs.existsSync(assemblyScriptWasmFile)) {
      fail('AssemblyScript failed to compile the Fastly native platform capabilities module.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_ASC_FAILED', {
        status: result.status,
        signal: result.signal,
        error: result.error && result.error.message,
        stdout: String(result.stdout || '').slice(-24000),
        stderr: String(result.stderr || '').slice(-24000),
        source: generated.source,
        durationMs: assemblyScriptDurationMs
      });
    }
    let startWrapper;
    if (guestLinked) {
      const wrapperWatFile = path.join(stagingDir, 'fastly-native-start-wrapper.wat');
      const wrapperWasmFile = path.join(stagingDir, 'fastly-native-start-wrapper.wasm');
      fs.writeFileSync(wrapperWatFile, fastlyGuestLinkedStartWrapperWat(), 'utf8');
      const wrapperStartedAt = Date.now();
      const assembled = runGuestTool(
        'wasm-as',
        [wrapperWatFile, '--mvp-features', '-o', wrapperWasmFile],
        {
          cwd: stagingDir,
          timeoutMs: Number(options.timeoutMs || 180000),
          failureMessage: 'Fastly Native start wrapper assembly failed.'
        }
      );
      const merged = runGuestTool(
        'wasm-merge',
        [
          assemblyScriptWasmFile,
          'pulse_fastly_primary',
          wrapperWasmFile,
          'pulse_fastly_entry',
          '--mvp-features',
          '-o',
          wasmFile
        ],
        {
          cwd: stagingDir,
          timeoutMs: Number(options.timeoutMs || 180000),
          failureMessage: 'Fastly Native start wrapper composition failed.'
        }
      );
      runGuestTool(
        'wasm-dis',
        [wasmFile, '--mvp-features', '-o', watFile],
        {
          cwd: stagingDir,
          timeoutMs: Number(options.timeoutMs || 180000),
          failureMessage: 'Fastly Native start wrapper text emission failed.'
        }
      );
      startWrapper = Object.freeze({
        status: 'composed',
        initialization: 'exported-start-called-once-per-instance-before-handler',
        implicitStartSection: false,
        binaryen: binaryenIdentity(),
        wasmAs: assembled.tool,
        wasmMerge: merged.tool,
        fixedMemoryRuntime: Object.freeze({
          file: 'src/build/fixed-memory-runtime.as.ts',
          bytes: fs.statSync(fixedMemoryRuntimeFile).size,
          sha256: sha256(fs.readFileSync(fixedMemoryRuntimeFile)),
          primaryHeapStart: memoryAbiV2.layout.unallocated.start,
          primaryHeapEndExclusive: memoryAbiV2.layout.unallocated.endExclusive,
          invocationFrameExcluded: true,
          memoryGrow: false,
          bulkMemory: false
        }),
        durationMs: Date.now() - wrapperStartedAt
      });
    }
    const primaryWasm = fs.readFileSync(wasmFile);
    const primaryWat = fs.existsSync(watFile) ? fs.readFileSync(watFile, 'utf8') : '';
    const primaryArtifact = Object.freeze({
      bytes: primaryWasm.length,
      sha256: sha256(primaryWasm)
    });
    let realization = Object.freeze({
      plan,
      generated,
      source: generated.source,
      sourceHash: generated.sourceHash,
      realizationArtifacts: generated.realizationArtifacts,
      guestUnits: generated.guestUnits,
      wasm: primaryWasm,
      wat: primaryWat,
      durationMs: assemblyScriptDurationMs
    });
    if (generated.guestUnits.length > 0) {
      const stageResult = realizeGuestLinkStage({
        version: GUEST_LINK_STAGE_INVOCATION_VERSION,
        primaryWasm: realization.wasm,
        guestUnits: generated.guestUnits.map((selection) => Object.freeze({
          contribution: canonicalGuestContribution(selection),
          packageRoot: selection.packageRoot
        })),
        projectRoot: path.resolve(options.projectRoot || cwd),
        profile: String(options.profile || 'fastly-native'),
        finalWasmPolicy: options.targetDescriptor && options.targetDescriptor.finalWasmPolicy,
        synchronizedPackages: options.synchronizedPackages,
        optimizationPosture: guestLinkOptimizationPosture(nativeOptimization)
      });
      realization = Object.freeze({
        ...realization,
        wasm: stageResult.wasm,
        wat: stageResult.wat,
        guestUnits: stageResult.guestUnits,
        guestLink: Object.freeze({
          version: stageResult.version,
          plan: stageResult.plan,
          report: stageResult.report,
          audit: stageResult.audit,
          materialization: stageResult.materialization,
          finalArtifact: stageResult.finalArtifact,
          providerPackaging: stageResult.providerPackaging,
          fallback: stageResult.fallback
        })
      });
    }
    const wasm = realization.wasm;
    const wat = realization.wat;
    if (requestedOutDir && generated.guestUnits.length > 0) {
      fs.writeFileSync(wasmFile, wasm);
      fs.writeFileSync(watFile, wat, 'utf8');
    }
    const inspection = inspectFastlyNativePlatformCapabilitiesWasm(wasm);
    const imported = new Set(inspection.imports.map((entry) => `${entry.module}:${entry.name}`));
    const requiredImports = requiredImportsForPlan(plan, generated.bindings);
    const missingRequiredImports = requiredImports.filter((key) => !imported.has(key));
    if (missingRequiredImports.length > 0) fail('Generated Fastly native platform capabilities module is missing plan-required host imports.', 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORT_MISSING', { missingRequiredImports, imports: inspection.imports, requiredImports });
    const manifest = Object.freeze({
      ...generated.manifest,
      compilerVersion: FASTLY_NATIVE_PLATFORM_CAPABILITIES_COMPILER_VERSION,
      assemblyScript: Object.freeze({ package: 'assemblyscript', version: require(path.join(asc.packageRoot, 'package.json')).version }),
      jsonAs: jsonAs
        ? Object.freeze({ package: 'json-as', version: jsonAs.version, transform: true, strict: true, mode: 'NAIVE', fastPath: false })
        : undefined,
      optimization,
      wasm: Object.freeze({ bytes: inspection.bytes, sha256: inspection.sha256, magic: inspection.magic }),
      wat: Object.freeze({ bytes: Buffer.byteLength(wat), sha256: sha256(wat) }),
      importModules: inspection.importModules,
      imports: inspection.imports,
      requiredImports,
      exports: inspection.exports,
      primaryArtifact,
      startWrapper,
      ...(realization.guestLink ? {
        guestUnitPlan: realization.guestLink.plan,
        guestLinkReport: realization.guestLink.report,
        finalWasmAudit: realization.guestLink.audit,
        providerPackaging: realization.guestLink.providerPackaging
      } : {})
    });
    const durationMs = Date.now() - startedAt;
    return Object.freeze({
      version: FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
      compilerVersion: FASTLY_NATIVE_PLATFORM_CAPABILITIES_COMPILER_VERSION,
      plan,
      generated,
      source: generated.source,
      sourceHash: generated.sourceHash,
      realizationArtifacts: generated.realizationArtifacts,
      guestUnits: realization.guestUnits,
      guestLink: realization.guestLink,
      wasm,
      wat,
      inspection,
      manifest,
      durationMs,
      assemblyScriptDurationMs,
      primaryArtifact,
      startWrapper,
      output: requestedOutDir ? Object.freeze({ outDir: outputDir, wasmFile, watFile }) : undefined
    });
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function writeFastlyNativePlatformCapabilitiesModule(compiled, outDir, options = {}) {
  if (!compiled || !Buffer.isBuffer(compiled.wasm) || !compiled.manifest || !compiled.plan) throw new TypeError('writeFastlyNativePlatformCapabilitiesModule requires a compiled Pass98 module.');
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  const sourceFile = path.join(target, options.sourceFile || 'fastly-native-platform-capabilities.as.ts');
  const wasmFile = path.join(target, options.wasmFile || 'fastly-native-platform-capabilities.wasm');
  const watFile = path.join(target, options.watFile || 'fastly-native-platform-capabilities.wat');
  const planFile = path.join(target, options.planFile || 'canonical-native-plan.json');
  const manifestFile = path.join(target, options.manifestFile || 'fastly-native-platform-capabilities-manifest.json');
  fs.writeFileSync(sourceFile, compiled.source, 'utf8');
  fs.writeFileSync(wasmFile, compiled.wasm);
  fs.writeFileSync(watFile, compiled.wat, 'utf8');
  fs.writeFileSync(planFile, `${stableStringify(compiled.plan, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestFile, `${stableStringify(compiled.manifest, 2)}\n`, 'utf8');
  return Object.freeze({ target, sourceFile, wasmFile, watFile, planFile, manifestFile, manifest: compiled.manifest });
}

module.exports = Object.freeze({
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_GENERATOR_VERSION,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_COMPILER_VERSION,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_ABI_VERSION,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_BUFFER_BYTES,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_MAX_WASM_BYTES,
  FASTLY_NATIVE_SIZE_OPTIMIZATION,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS,
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_REQUIRED_IMPORTS,
  FASTLY_NATIVE_PLATFORM_EFFECT_KIND,
  FastlyNativePlatformCapabilitiesError,
  resolveCapabilityBindings,
  planRequiresFetchBodyRead,
  requiredImportsForPlan,
  generateFastlyNativePlatformCapabilitiesAssemblyScript,
  compileFastlyNativePlatformCapabilitiesPlan,
  inspectFastlyNativePlatformCapabilitiesWasm,
  writeFastlyNativePlatformCapabilitiesModule,
  stableStringify
});
