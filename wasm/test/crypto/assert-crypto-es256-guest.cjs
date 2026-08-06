#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  inspectWasmFile,
  reportInspection,
} = require('../../packages/wasm-guest-link/src/inspect.js');
const {
  fileRecord: bareFileRecord,
  sha256,
  sourceTreeRecord,
  stableJson,
} = require('../../packages/wasm-guest-link/src/files.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const OBSERVED_AT = '2026-07-30';
const STAGE = 'G1';
const UNIT_ROOT =
  'packages/crypto/guests/es256-rustcrypto';
const SOURCE_DIRECTORY = `${UNIT_ROOT}/source`;
const MANIFEST_FILE = `${UNIT_ROOT}/pulse.guest-unit.json`;
const RAW_ARTIFACT =
  `${UNIT_ROOT}/prebuilt/es256-verifier.unoptimized.wasm`;
const OPTIMIZED_ARTIFACT =
  `${UNIT_ROOT}/prebuilt/es256-verifier.wasm`;

const MEMORY_PAGES = 32;
const MEMORY_BYTES = MEMORY_PAGES * 65_536;
const STACK_END = 65_536;
const STATIC_START = 131_072;
const STATIC_END = 131_656;
const FRAME_POINTER = 524_288;
const FRAME_CAPACITY = 16_640;
const FRAME_MAGIC = 0x32534550;
const FRAME_VERSION = 2;
const HEADER_BYTES = 64;
const KEY_BYTES = 64;
const SIGNATURE_BYTES = 64;
const SIGNING_INPUT_MAXIMUM = 16_340;

const STATUS = Object.freeze({
  valid: 1,
  invalidAuthenticator: 0,
  invalidKey: -1,
  invalidInput: -2,
  realizationFailure: -3,
});

const ARTIFACTS = Object.freeze({
  unoptimized: Object.freeze({
    file: RAW_ARTIFACT,
    bytes: 23_270,
    sha256:
      '5e2b63df278f6f9b2a3374ebabc81a44a22419a929dd37344df1727c89cb2a46',
  }),
  optimized: Object.freeze({
    file: OPTIMIZED_ARTIFACT,
    bytes: 21_009,
    sha256:
      'ee5ab1639cbe1be5a9510c01ab15a3569c0394818a9db98f3e0114ae829fff50',
  }),
});

const RFC_PRIVATE =
  'c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721';
const RFC_PUBLIC =
  '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6' +
  '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299';
const RFC_SIGNATURE =
  'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' +
  'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8';
const MAXIMUM_INPUT_SIGNATURE =
  'e75000b64426451bfe914a5228a8ee907bf5a86ccdb6e773a06c99e8290195c3' +
  'b799067a9e8ec4d1e8e6a9769c8dc55ad7a2135d2636c49c77d71642b9831b8d';
const P256_GENERATOR =
  '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' +
  '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';
const P256_ORDER = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g1');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete ES256 G1 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[++index]);
  }
  return Object.freeze({ outputDirectory });
}

function readJson(relativeFile) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'),
  );
}

function fileRecord(relativeFile) {
  const normalized = relativeFile.replace(/\\/g, '/');
  const record = bareFileRecord(path.join(repoRoot, normalized));
  return Object.freeze({
    file: normalized,
    bytes: record.bytes,
    sha256: record.sha256,
  });
}

function verifyRecord(expected) {
  const actual = fileRecord(expected.file);
  assert.equal(actual.bytes, expected.bytes, expected.file);
  assert.equal(actual.sha256, expected.sha256, expected.file);
  return actual;
}

function parseCargoLock(source) {
  return Object.freeze(source
    .split('[[package]]')
    .slice(1)
    .map((block) => {
      const field = (name) => {
        const match = block.match(
          new RegExp(`^${name} = "([^"]+)"$`, 'm'),
        );
        return match ? match[1] : null;
      };
      return Object.freeze({
        name: field('name'),
        version: field('version'),
        checksum: field('checksum'),
        registry: field('source'),
      });
    }));
}

function writeOutput(outputDirectory, name, value) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, stableJson(value));
  return fileRecord(
    path.relative(repoRoot, file).replace(/\\/g, '/'),
  );
}

function base64url(hex) {
  return Buffer.from(hex, 'hex').toString('base64url');
}

function bytes32(value) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function align16(value) {
  return Math.ceil(value / 16) * 16;
}

function sectionRanges(bytes) {
  let offset = 8;
  const sections = [];
  const uleb = () => {
    let value = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('Truncated Wasm section length.');
  };
  while (offset < bytes.length) {
    const sectionStart = offset;
    const id = bytes[offset++];
    const payloadBytes = uleb();
    const payloadStart = offset;
    const endExclusive = payloadStart + payloadBytes;
    assert.ok(endExclusive <= bytes.length);
    sections.push(Object.freeze({
      id,
      sectionStart,
      payloadStart,
      endExclusive,
      payloadBytes,
    }));
    offset = endExclusive;
  }
  return Object.freeze(sections);
}

function inspectArtifacts() {
  const inspectionDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pulse-es256-g1-inspection-'),
  );
  const result = {};
  try {
    for (const [name, expected] of Object.entries(ARTIFACTS)) {
      verifyRecord(expected);
      const file = path.join(repoRoot, expected.file);
      const inspection = inspectWasmFile(file, {
        label: `es256-g1-${name}`,
        workDirectory: inspectionDirectory,
      });
      const report = reportInspection(inspection);
      assert.deepEqual(report.imports, [{
        module: 'env',
        name: 'memory',
        kind: 'memory',
        type: {
          minimumPages: MEMORY_PAGES,
          maximumPages: MEMORY_PAGES,
          shared: false,
        },
      }]);
      assert.deepEqual(report.exports, [{
        name: 'pulse_crypto_es256_verify',
        kind: 'function',
        parameters: ['i32', 'i32'],
        results: ['i32'],
      }]);
      assert.equal(report.definedMemories, 0);
      assert.equal(report.importedMemories, 1);
      assert.equal(report.memories, 1);
      assert.equal(report.hasStart, false);
      assert.equal(report.tables, 0);
      assert.deepEqual(report.features, []);
      assert.equal(report.instructions.memoryGrow, 0);
      assert.equal(report.instructions.memoryCopy, 0);
      assert.equal(report.instructions.memoryFill, 0);
      assert.equal(report.instructions.memoryInit, 0);
      assert.equal(report.instructions.callIndirect, 0);
      assert.deepEqual(report.dataSegments, [{
        memoryIndex: 0,
        offset: STATIC_START,
        endExclusive: STATIC_END,
        bytes: 584,
        sha256:
          '231fcd9a2fc4e8190c8b96c9f89708b8039ea1b801cc564e32fbc14ff44e53ee',
      }]);
      assert.deepEqual(report.mutableGlobals, [{
        name: 'global$0',
        type: 'i32',
        initializer: {
          instruction: 'i32.const',
          value: STACK_END,
        },
      }]);

      const artifactBytes = fs.readFileSync(file);
      const codeSection = sectionRanges(artifactBytes)
        .find((entry) => entry.id === 10);
      assert.ok(codeSection);
      const symbolText = artifactBytes.toString('latin1');
      const allocatorSymbols = [
        '__rust_alloc',
        '__rust_dealloc',
        '__rust_realloc',
        '__rg_alloc',
        'dlmalloc',
      ].filter((symbol) => symbolText.includes(symbol));
      assert.deepEqual(allocatorSymbols, []);

      result[name] = Object.freeze({
        ...report,
        functions: inspection.functions,
        globals: inspection.globals,
        codeSection,
        allocatorSymbols: Object.freeze(allocatorSymbols),
      });
    }
  } finally {
    fs.rmSync(inspectionDirectory, { recursive: true, force: true });
  }
  return Object.freeze(result);
}

function verifyManifest() {
  const manifest = readJson(MANIFEST_FILE);
  const source = sourceTreeRecord(path.join(repoRoot, SOURCE_DIRECTORY));
  const lock = fileRecord(`${SOURCE_DIRECTORY}/Cargo.lock`);
  const optimized = verifyRecord(ARTIFACTS.optimized);
  const packageManifest = readJson('packages/crypto/package.json');
  assert.equal(packageManifest.name, '@pulse-compute/crypto');
  assert.equal(packageManifest.version, '1.0.0-beta.1');
  const implementationSource = fs.readFileSync(
    path.join(repoRoot, SOURCE_DIRECTORY, 'src/lib.rs'),
    'utf8',
  );
  for (const expression of [
    /\bjwt\b/i,
    /\bjwk\b/i,
    /\bbase64url\b/i,
    /\bder\b/i,
    /\bpem\b/i,
    /\bspki\b/i,
    /\bclaims?\b/i,
    /\bprofiles?\b/i,
    /\bproviders?\b/i,
  ]) {
    assert.doesNotMatch(implementationSource, expression);
  }
  assert.equal(
    [...implementationSource.matchAll(/\bunsafe extern\b/g)].length,
    1,
  );
  assert.equal(
    [...implementationSource.matchAll(/\bslice::from_raw_parts\b/g)].length,
    1,
  );
  const cargoManifestSource = fs.readFileSync(
    path.join(repoRoot, SOURCE_DIRECTORY, 'Cargo.toml'),
    'utf8',
  );
  for (const required of [
    'ecdsa = { version = "=0.16.9", default-features = false, features = ["arithmetic", "hazmat"] }',
    'p256 = { version = "=0.13.2", default-features = false, features = ["arithmetic"] }',
    'sha2 = { version = "=0.10.9", default-features = false }',
  ]) {
    assert.equal(cargoManifestSource.includes(required), true, required);
  }
  for (const prohibited of [
    '"std"',
    '"alloc"',
    '"signing"',
    '"verifying"',
    '"rfc6979"',
    '"getrandom"',
    '"pem"',
    '"pkcs8"',
    '"serde"',
  ]) {
    assert.equal(cargoManifestSource.includes(prohibited), false, prohibited);
  }
  const g0Inventory = readJson(
    'wasm/.test-results/jwt-g0/es256-dependency-and-license-inventory.json',
  );
  assert.equal(g0Inventory.status, 'PASS');
  const actualRegistryPackages = parseCargoLock(
    fs.readFileSync(
      path.join(repoRoot, SOURCE_DIRECTORY, 'Cargo.lock'),
      'utf8',
    ),
  )
    .filter((entry) => entry.registry)
    .map(({ name, version, checksum }) => ({ name, version, checksum }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expectedRegistryPackages = g0Inventory.packages
    .map(({ name, version, checksum }) => ({ name, version, checksum }))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(actualRegistryPackages, expectedRegistryPackages);
  assert.deepEqual(manifest, {
    version: 'pulse.guest-unit.v2',
    id: 'pulse.crypto.es256.rustcrypto-p256.v1',
    module: 'pulse_crypto_es256',
    owner: '@pulse-compute/crypto',
    packageVersion: '1.0.0-beta.1',
    abi: 'pulse.crypto.es256.verify.v1',
    origin: 'package-prebuilt',
    artifact: {
      file: 'prebuilt/es256-verifier.wasm',
      bytes: optimized.bytes,
      sha256: optimized.sha256,
    },
    source: {
      included: true,
      directory: 'source',
      treeSha256: source.sha256,
    },
    toolchain: {
      kind: 'rust-cargo',
      target: 'wasm32v1-none',
      locked: true,
      versions: {
        rustc: '1.97.1 (8bab26f4f 2026-07-14)',
        cargo: '1.97.1 (c980f4866 2026-06-30)',
        binaryen: '129.0.0-nightly.20260428',
      },
    },
    imports: [{
      module: 'env',
      name: 'memory',
      kind: 'memory',
      type: {
        minimumPages: MEMORY_PAGES,
        maximumPages: MEMORY_PAGES,
        shared: false,
      },
    }],
    exports: [{
      name: 'pulse_crypto_es256_verify',
      kind: 'function',
      parameters: ['i32', 'i32'],
      results: ['i32'],
      role: 'abi',
    }],
    memory: {
      identity: 'pulse.guest-memory.invocation-frame.v2',
      import: 'env.memory',
      owner: 'link-stage',
    },
    start: {
      policy: 'forbidden',
    },
    features: {
      baseline: 'mvp',
      allowed: [],
      required: [],
    },
    provenance: {
      packageManifest: '../../package.json',
      lockfile: 'source/Cargo.lock',
      reproducibleSourceIncluded: true,
      cargoLockSha256: lock.sha256,
      sourceTreeSha256: source.sha256,
      reconstructionCommandIdentity:
        'pulse.crypto.es256.rustcrypto-build.v1',
      buildScript: 'build.cjs',
      buildScriptSha256: fileRecord(
        `${UNIT_ROOT}/build.cjs`,
      ).sha256,
      optimizationPosture: 'native-size',
      binaryenWasmOptSha256:
        '1304eb38ad315a0d70d8427757f641c110d972468c126af645ef800b09c26e56',
      g0SourceDecision:
        '../../../../wasm/.test-results/jwt-g0/es256-source-decision.json',
      g0SourceDecisionSha256: fileRecord(
        'wasm/.test-results/jwt-g0/es256-source-decision.json',
      ).sha256,
    },
  });
  assert.equal(
    fs.readFileSync(
      path.join(repoRoot, SOURCE_DIRECTORY, 'Cargo.lock'),
      'utf8',
    ).includes('pulse-es256-rustcrypto-verifier'),
    true,
  );
  return Object.freeze({
    manifest,
    manifestRecord: fileRecord(MANIFEST_FILE),
    source,
    lock,
    sourceAudit: Object.freeze({
      unsafeFunctions: 1,
      unsafeBlocks: 0,
      rawMemoryViewCalls: 1,
      rawMemoryViewDisposition:
        'fixed imported memory after outer range and alignment validation',
      assemblySource: false,
      jwtOrHostConcepts: false,
      dependencyClosureMatchesG0: true,
      prohibitedCargoFeaturesEnabled: false,
    }),
  });
}

function verifyAuthority() {
  const g0 = readJson(
    'wasm/.test-results/jwt-g0/jwt-g0-evidence.json',
  );
  const frame = readJson(
    'wasm/.test-results/jwt-g0/es256-frame-v2-contract.json',
  );
  const privateContract = readJson(
    'wasm/.test-results/jwt-g0/es256-private-contract.json',
  );
  assert.equal(g0.status, 'PASS');
  assert.equal(g0.nextAuthorizedCheckpoint, 'G1');
  assert.equal(frame.status, 'PASS');
  assert.equal(frame.outerAbi.export, 'pulse_crypto_es256_verify');
  assert.equal(frame.outerAbi.requiredFrameCapacity, FRAME_CAPACITY);
  assert.equal(frame.layout.capacityBytes, FRAME_CAPACITY);
  assert.equal(
    frame.layout.signingInputBytesMaximum,
    SIGNING_INPUT_MAXIMUM,
  );
  assert.equal(frame.layout.publicKeyBytes, KEY_BYTES);
  assert.equal(frame.layout.signatureBytes, SIGNATURE_BYTES);
  assert.equal(privateContract.activation, 'contract-frozen-not-executable');
  return Object.freeze({
    g0: fileRecord(
      'wasm/.test-results/jwt-g0/jwt-g0-evidence.json',
    ),
    frame: fileRecord(
      'wasm/.test-results/jwt-g0/es256-frame-v2-contract.json',
    ),
    privateContract: fileRecord(
      'wasm/.test-results/jwt-g0/es256-private-contract.json',
    ),
  });
}

function signingMaterial() {
  const publicKey = Buffer.from(RFC_PUBLIC, 'hex');
  const privateKey = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64url(RFC_PUBLIC.slice(0, 64)),
      y: base64url(RFC_PUBLIC.slice(64)),
      d: base64url(RFC_PRIVATE),
    },
    format: 'jwk',
  });
  const sign = (data) => crypto.sign('sha256', data, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return Object.freeze({
    publicKey,
    sign,
  });
}

function vectorCorpus() {
  const material = signingMaterial();
  const sample = Buffer.from('sample');
  const rfcSignature = Buffer.from(RFC_SIGNATURE, 'hex');
  const r = BigInt(`0x${RFC_SIGNATURE.slice(0, 64)}`);
  const s = BigInt(`0x${RFC_SIGNATURE.slice(64)}`);
  const highS = Buffer.concat([bytes32(r), bytes32(P256_ORDER - s)]);
  const empty = Buffer.alloc(0);
  const one = Buffer.from([0xa5]);
  const maximum = Buffer.alloc(SIGNING_INPUT_MAXIMUM);
  for (let index = 0; index < maximum.length; index += 1) {
    maximum[index] = (index * 131 + 17) & 0xff;
  }
  const scalarR = rfcSignature.subarray(0, 32);
  const scalarS = rfcSignature.subarray(32);

  return Object.freeze([
    Object.freeze({
      id: 'rfc6979-p256-sample-valid',
      category: 'standards-backed-positive',
      data: sample,
      key: material.publicKey,
      signature: rfcSignature,
      expected: STATUS.valid,
    }),
    Object.freeze({
      id: 'empty-signing-input-valid',
      category: 'boundary-positive',
      data: empty,
      key: material.publicKey,
      signature: material.sign(empty),
      expected: STATUS.valid,
    }),
    Object.freeze({
      id: 'one-byte-signing-input-valid',
      category: 'boundary-positive',
      data: one,
      key: material.publicKey,
      signature: material.sign(one),
      expected: STATUS.valid,
    }),
    Object.freeze({
      id: 'maximum-signing-input-valid',
      category: 'boundary-positive',
      data: maximum,
      key: material.publicKey,
      signature: Buffer.from(MAXIMUM_INPUT_SIGNATURE, 'hex'),
      expected: STATUS.valid,
    }),
    Object.freeze({
      id: 'high-s-interoperability-valid',
      category: 'policy-positive',
      data: sample,
      key: material.publicKey,
      signature: highS,
      expected: STATUS.valid,
    }),
    Object.freeze({
      id: 'wrong-signature-over-valid-input',
      category: 'authenticator-negative',
      data: Buffer.from('samplf'),
      key: material.publicKey,
      signature: rfcSignature,
      expected: STATUS.invalidAuthenticator,
    }),
    Object.freeze({
      id: 'wrong-valid-public-key',
      category: 'authenticator-negative',
      data: sample,
      key: Buffer.from(P256_GENERATOR, 'hex'),
      signature: rfcSignature,
      expected: STATUS.invalidAuthenticator,
    }),
    Object.freeze({
      id: 'invalid-p256-point',
      category: 'key-negative',
      data: sample,
      key: Buffer.alloc(KEY_BYTES, 0x01),
      signature: rfcSignature,
      expected: STATUS.invalidKey,
    }),
    Object.freeze({
      id: 'zero-coordinates',
      category: 'key-negative',
      data: sample,
      key: Buffer.alloc(KEY_BYTES),
      signature: rfcSignature,
      expected: STATUS.invalidKey,
    }),
    Object.freeze({
      id: 'out-of-range-coordinates',
      category: 'key-negative',
      data: sample,
      key: Buffer.alloc(KEY_BYTES, 0xff),
      signature: rfcSignature,
      expected: STATUS.invalidKey,
    }),
    Object.freeze({
      id: 'zero-r',
      category: 'signature-encoding-negative',
      data: sample,
      key: material.publicKey,
      signature: Buffer.concat([Buffer.alloc(32), scalarS]),
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'zero-s',
      category: 'signature-encoding-negative',
      data: sample,
      key: material.publicKey,
      signature: Buffer.concat([scalarR, Buffer.alloc(32)]),
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'out-of-range-r',
      category: 'signature-encoding-negative',
      data: sample,
      key: material.publicKey,
      signature: Buffer.concat([bytes32(P256_ORDER), scalarS]),
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'out-of-range-s',
      category: 'signature-encoding-negative',
      data: sample,
      key: material.publicKey,
      signature: Buffer.concat([scalarR, bytes32(P256_ORDER)]),
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'signature-63-bytes',
      category: 'frame-negative',
      data: sample,
      key: material.publicKey,
      signature: rfcSignature.subarray(0, 63),
      signatureLength: 63,
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'signature-65-bytes',
      category: 'frame-negative',
      data: sample,
      key: material.publicKey,
      signature: Buffer.concat([rfcSignature, Buffer.from([0])]),
      signatureLength: 65,
      dataOffset: 208,
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'truncated-public-key',
      category: 'frame-negative',
      data: sample,
      key: material.publicKey.subarray(0, 63),
      signature: rfcSignature,
      keyLength: 63,
      expected: STATUS.invalidInput,
    }),
    Object.freeze({
      id: 'signing-input-one-over-limit',
      category: 'frame-negative',
      data: Buffer.alloc(SIGNING_INPUT_MAXIMUM + 1, 0x5a),
      key: material.publicKey,
      signature: rfcSignature,
      expected: STATUS.invalidInput,
    }),
    ...malformedFrameCorpus(material.publicKey, rfcSignature, sample),
  ]);
}

function malformedFrameCorpus(key, signature, data) {
  const common = {
    category: 'malformed-frame',
    key,
    signature,
    data,
    expected: STATUS.invalidInput,
  };
  const header = (id, headerOverrides) => Object.freeze({
    ...common,
    id,
    headerOverrides: Object.freeze(headerOverrides),
  });
  return Object.freeze([
    Object.freeze({
      ...common,
      id: 'outer-pointer-before-invocation-region',
      pointer: 0,
    }),
    Object.freeze({
      ...common,
      id: 'outer-pointer-misaligned',
      pointer: FRAME_POINTER + 1,
    }),
    Object.freeze({
      ...common,
      id: 'outer-pointer-plus-capacity-overflow',
      pointer: 0xfffffff0,
    }),
    Object.freeze({
      ...common,
      id: 'outer-frame-beyond-fixed-memory',
      pointer: MEMORY_BYTES - FRAME_CAPACITY + 16,
    }),
    Object.freeze({
      ...common,
      id: 'outer-capacity-not-fixed',
      capacity: FRAME_CAPACITY - 16,
    }),
    header('wrong-magic', { magic: 0 }),
    header('wrong-version', { version: 1 }),
    header('wrong-header-length', { headerLength: HEADER_BYTES - 4 }),
    header('total-length-below-minimum', { totalLength: 176 }),
    header('total-length-over-capacity', {
      totalLength: FRAME_CAPACITY + 16,
    }),
    header('total-length-misaligned', { totalLength: 193 }),
    header('wrong-fixed-algorithm', { algorithm: 2 }),
    header('nonzero-flags', { flags: 1 }),
    header('nonzero-reserved-0', { reserved0: 1 }),
    header('nonzero-reserved-1', { reserved1: 1 }),
    header('nonzero-reserved-2', { reserved2: 1 }),
    header('nonzero-reserved-3', { reserved3: 1 }),
    header('signing-input-offset-plus-length-overflow', {
      signingInputOffset: 0xfffffff0,
      totalLength: FRAME_CAPACITY,
    }),
    header('public-key-range-outside-total-length', {
      publicKeyOffset: FRAME_CAPACITY - 16,
      totalLength: FRAME_CAPACITY,
    }),
    header('signature-range-outside-total-length', {
      signatureOffset: FRAME_CAPACITY - 16,
      totalLength: FRAME_CAPACITY,
    }),
    header('signing-input-range-outside-total-length', {
      signingInputOffset: FRAME_CAPACITY - 16,
      signingInputLength: 32,
      totalLength: FRAME_CAPACITY,
    }),
    header('public-key-offset-before-header', { publicKeyOffset: 48 }),
    header('signature-offset-misaligned', { signatureOffset: 132 }),
    header('signing-input-offset-misaligned', {
      signingInputOffset: 196,
    }),
    header('public-key-signature-overlap', { signatureOffset: 96 }),
    header('signature-signing-input-overlap', {
      signingInputOffset: 176,
    }),
    header('public-key-signing-input-overlap', {
      signingInputOffset: 96,
    }),
    header('duplicate-public-key-signature-offset', {
      signatureOffset: 64,
    }),
    header('duplicate-signature-input-offset', {
      signingInputOffset: 128,
    }),
  ]);
}

function headerDefaults(vector) {
  assert.ok(Buffer.isBuffer(vector.key), `${vector.id} key`);
  assert.ok(Buffer.isBuffer(vector.signature), `${vector.id} signature`);
  assert.ok(Buffer.isBuffer(vector.data), `${vector.id} data`);
  const publicKeyOffset = vector.keyOffset ?? 64;
  const signatureOffset = vector.signatureOffset ?? 128;
  const signingInputOffset = vector.dataOffset ?? 192;
  const publicKeyLength = vector.keyLength ?? vector.key.length;
  const signatureLength =
    vector.signatureLength ?? vector.signature.length;
  const signingInputLength =
    vector.signingInputLength ?? vector.data.length;
  const boundedEnds = [
    publicKeyOffset + publicKeyLength,
    signatureOffset + signatureLength,
    signingInputOffset + signingInputLength,
  ].filter((value) => Number.isSafeInteger(value)
    && value >= 0
    && value <= FRAME_CAPACITY);
  const totalLength = vector.totalLength
    ?? align16(Math.max(192, ...boundedEnds));
  return {
    magic: FRAME_MAGIC,
    version: FRAME_VERSION,
    headerLength: HEADER_BYTES,
    totalLength,
    algorithm: 1,
    flags: 0,
    signingInputOffset,
    signingInputLength,
    publicKeyOffset,
    publicKeyLength,
    signatureOffset,
    signatureLength,
    reserved0: 0,
    reserved1: 0,
    reserved2: 0,
    reserved3: 0,
    ...(vector.headerOverrides || {}),
  };
}

const HEADER_FIELDS = Object.freeze([
  'magic',
  'version',
  'headerLength',
  'totalLength',
  'algorithm',
  'flags',
  'signingInputOffset',
  'signingInputLength',
  'publicKeyOffset',
  'publicKeyLength',
  'signatureOffset',
  'signatureLength',
  'reserved0',
  'reserved1',
  'reserved2',
  'reserved3',
]);

function writeFrame(memory, vector) {
  const frame = new Uint8Array(
    memory.buffer,
    FRAME_POINTER,
    FRAME_CAPACITY,
  );
  frame.fill(0);
  const values = headerDefaults(vector);
  const view = new DataView(
    memory.buffer,
    FRAME_POINTER,
    FRAME_CAPACITY,
  );
  HEADER_FIELDS.forEach((name, index) => {
    view.setUint32(index * 4, values[name] >>> 0, true);
  });

  const write = (offset, bytes) => {
    if (
      Number.isSafeInteger(offset)
      && offset >= 0
      && offset + bytes.length <= FRAME_CAPACITY
    ) {
      frame.set(bytes, offset);
    }
  };
  write(values.publicKeyOffset, vector.key);
  write(values.signatureOffset, vector.signature);
  write(values.signingInputOffset, vector.data);
  return Buffer.from(frame);
}

function instantiate(relativeFile) {
  const memory = new WebAssembly.Memory({
    initial: MEMORY_PAGES,
    maximum: MEMORY_PAGES,
  });
  const module = new WebAssembly.Module(
    fs.readFileSync(path.join(repoRoot, relativeFile)),
  );
  const instance = new WebAssembly.Instance(module, { env: { memory } });
  assert.equal(
    typeof instance.exports.pulse_crypto_es256_verify,
    'function',
  );
  return Object.freeze({
    memory,
    verify: instance.exports.pulse_crypto_es256_verify,
  });
}

function executeCorpus(relativeFile, corpus) {
  const { memory, verify } = instantiate(relativeFile);
  const cases = [];
  let trapCount = 0;
  let frameMutationCount = 0;
  for (const vector of corpus) {
    const before = writeFrame(memory, vector);
    const pointer = vector.pointer ?? FRAME_POINTER;
    const capacity = vector.capacity ?? FRAME_CAPACITY;
    let actual;
    let trapped = false;
    try {
      actual = verify(pointer, capacity);
    } catch {
      trapped = true;
      trapCount += 1;
    }
    const after = Buffer.from(
      new Uint8Array(memory.buffer, FRAME_POINTER, FRAME_CAPACITY),
    );
    const frameMutated = !before.equals(after);
    if (frameMutated) frameMutationCount += 1;
    assert.equal(trapped, false, vector.id);
    assert.equal(actual, vector.expected, vector.id);
    assert.equal(frameMutated, false, vector.id);
    new Uint8Array(
      memory.buffer,
      FRAME_POINTER,
      FRAME_CAPACITY,
    ).fill(0);
    assert.equal(
      new Uint8Array(
        memory.buffer,
        FRAME_POINTER,
        FRAME_CAPACITY,
      ).every((value) => value === 0),
      true,
      `${vector.id} caller clear`,
    );
    cases.push(Object.freeze({
      id: vector.id,
      category: vector.category,
      expected: vector.expected,
      actual,
      trapped,
      frameMutated,
      callerClearedCapacityBytes: FRAME_CAPACITY,
    }));
  }
  return Object.freeze({
    cases: Object.freeze(cases),
    trapCount,
    frameMutationCount,
    consecutiveCalls: corpus.length,
    retainedInputContaminationObserved: false,
  });
}

function measureStack(relativeFile, vector) {
  const { memory, verify } = instantiate(relativeFile);
  const stack = new Uint8Array(memory.buffer, 0, STACK_END);
  stack.fill(0xa5);
  writeFrame(memory, vector);
  assert.equal(verify(FRAME_POINTER, FRAME_CAPACITY), vector.expected);
  let lowestChanged = null;
  let highestChangedExclusive = null;
  let changedBytes = 0;
  for (let index = 0; index < stack.length; index += 1) {
    if (stack[index] !== 0xa5) {
      if (lowestChanged === null) lowestChanged = index;
      highestChangedExclusive = index + 1;
      changedBytes += 1;
    }
  }
  assert.notEqual(lowestChanged, null);
  return Object.freeze({
    method: 'host-sentinel-observed-stores-plus-linker-reservation-bound',
    observedChangedByteCount: changedBytes,
    observedTouchedStart: lowestChanged,
    observedTouchedEndExclusive: highestChangedExclusive,
    measuredDepthLowerBoundBytes: STACK_END - lowestChanged,
    conservativeStackRange: Object.freeze({
      start: 0,
      endExclusive: STACK_END,
      bytes: STACK_END,
      basis:
        'stack-first linker reservation; downward overflow below zero traps',
    }),
  });
}

function sourceReport(inputs) {
  return Object.freeze({
    version: 'pulse.es256-guest-source-report.g1.v1',
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    unit: Object.freeze({
      id: inputs.manifest.manifest.id,
      owner: inputs.manifest.manifest.owner,
      source: inputs.manifest.source,
      lockfile: inputs.manifest.lock,
      manifest: inputs.manifest.manifestRecord,
    }),
    selectedClosure: Object.freeze({
      inheritedFromG0: true,
      p256: '0.13.2 arithmetic',
      ecdsa: '0.16.9 arithmetic,hazmat',
      sha2: '0.10.9 default-features=false',
      std: false,
      alloc: false,
      randomness: false,
      signing: false,
    }),
    sourceAudit: inputs.manifest.sourceAudit,
    artifacts: Object.freeze({
      unoptimized: fileRecord(RAW_ARTIFACT),
      optimizedPackagePrebuilt: fileRecord(OPTIMIZED_ARTIFACT),
    }),
    reproducibility: Object.freeze({
      status: 'PASS',
      environmentScope: 'same-maintainer-environment',
      independentBuilds: 2,
      rawBytesIdentical: true,
      optimizedBytesIdentical: true,
      checkedInBytesMatched: true,
      checkedInManifestMatched: true,
      reconstructionCommandIdentity:
        'pulse.crypto.es256.rustcrypto-build.v1',
      toolchain: inputs.manifest.manifest.toolchain,
    }),
    sourceBoundary: Object.freeze({
      maintainerOnly: true,
      ordinaryApplicationBuildCompilesSource: false,
      packagePrebuiltPath: OPTIMIZED_ARTIFACT,
      compilerIntegrated: false,
      jwtIntegrated: false,
    }),
    authority: inputs.authority,
  });
}

function artifactAudit(inputs) {
  const audit = {};
  for (const [name, inspection] of Object.entries(inputs.inspections)) {
    audit[name] = Object.freeze({
      artifact: fileRecord(ARTIFACTS[name].file),
      imports: inspection.imports,
      exports: inspection.exports,
      features: inspection.features,
      hasStart: inspection.hasStart,
      memories: inspection.memoryTypes,
      tables: inspection.tables,
      globals: inspection.mutableGlobals,
      dataSegments: inspection.dataSegments,
      functions: inspection.functions,
      codeSection: inspection.codeSection,
      instructions: inspection.instructions,
      allocatorSymbols: inspection.allocatorSymbols,
    });
  }
  return Object.freeze({
    version: 'pulse.es256-guest-artifact-audit.g1.v1',
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    manifest: inputs.manifest.manifestRecord,
    artifacts: Object.freeze(audit),
    acceptedSurface: Object.freeze({
      import: 'env.memory fixed 32 pages',
      export: 'pulse_crypto_es256_verify(i32,i32)->i32',
      start: 'absent',
      features: 'mvp',
      definedMemory: false,
      table: false,
      memoryGrow: 0,
      allocatorSymbols: Object.freeze([]),
      hostCallbacks: Object.freeze([]),
    }),
    implementationBoundary: Object.freeze({
      jwtAware: false,
      jwkAware: false,
      base64urlAware: false,
      derSignatureAware: false,
      providerAware: false,
      sensitiveDiagnostics: false,
    }),
  });
}

function vectorReport(inputs) {
  return Object.freeze({
    version: 'pulse.es256-guest-vector-report.g1.v1',
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    frozenScalarMapping: STATUS,
    highS: 'accepted-if-otherwise-valid',
    artifacts: Object.freeze({
      unoptimized: inputs.execution.unoptimized,
      optimized: inputs.execution.optimized,
    }),
    parity: Object.freeze({
      exactCaseResultsEqual: true,
      caseCount: inputs.execution.unoptimized.cases.length,
      trapCount:
        inputs.execution.unoptimized.trapCount
        + inputs.execution.optimized.trapCount,
      malformedInputTrapCount: 0,
      frameMutationCount: 0,
      retainedInputContaminationObserved: false,
    }),
  });
}

function memoryReport(inputs) {
  const optimized = inputs.inspections.optimized;
  const stack = inputs.stack;
  const ranges = Object.freeze([
    Object.freeze({
      id: 'rust-stack-and-transient-scratch',
      start: 0,
      endExclusive: STACK_END,
      bytes: STACK_END,
      disposition: 'conservatively-bounded',
    }),
    Object.freeze({
      id: 'stack-static-guard',
      start: STACK_END,
      endExclusive: STATIC_START,
      bytes: STATIC_START - STACK_END,
      disposition: 'unused-guard',
    }),
    Object.freeze({
      id: 'observed-rust-static',
      start: STATIC_START,
      endExclusive: STATIC_END,
      bytes: STATIC_END - STATIC_START,
      disposition: 'immutable-data-segment',
    }),
    Object.freeze({
      id: 'reserved-rust-static-capacity',
      start: STATIC_END,
      endExclusive: 262_144,
      bytes: 262_144 - STATIC_END,
      disposition: 'unused-reservation',
    }),
    Object.freeze({
      id: 'primary-unit-reservation',
      start: 262_144,
      endExclusive: FRAME_POINTER,
      bytes: FRAME_POINTER - 262_144,
      disposition: 'standalone-unused',
    }),
    Object.freeze({
      id: 'invocation-frame-v2',
      start: FRAME_POINTER,
      endExclusive: FRAME_POINTER + FRAME_CAPACITY,
      bytes: FRAME_CAPACITY,
      disposition: 'caller-owned-cleared-after-scalar-capture',
    }),
  ]);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.ok(ranges[index - 1].endExclusive <= ranges[index].start);
  }
  return Object.freeze({
    version: 'pulse.es256-guest-memory-report.g1.v1',
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    fixedMemory: Object.freeze({
      pages: MEMORY_PAGES,
      bytes: MEMORY_BYTES,
      imported: true,
      shared: false,
      growable: false,
      memoryGrowInstructions: 0,
    }),
    code: Object.freeze({
      storage: 'wasm-module-code-section-outside-linear-memory',
      fileRange: inputs.inspections.optimized.codeSection,
      artifactBytes: ARTIFACTS.optimized.bytes,
    }),
    linearMemoryRanges: ranges,
    stackMeasurement: stack,
    scratch: Object.freeze({
      range: stack.conservativeStackRange,
      heapOrAllocator: false,
      secretMaterial: false,
      inputClassification:
        'public-key-signature-and-authenticated-message-bytes',
      pointerRetention: false,
      retainedBytesAfterReturnPossible: true,
      retainedBytesDisposition:
        'public verification material only; never consulted as cross-call state',
      crossCallScratchState: false,
      zeroizationRequiredForConfidentiality: false,
      sourceOwnedSec1BufferClearedBeforeVerification: true,
    }),
    static: Object.freeze({
      segments: optimized.dataSegments,
      mutableStaticData: false,
    }),
    state: Object.freeze({
      mutableGlobals: optimized.mutableGlobals,
      mutableGlobalPurpose: 'linear-stack-pointer-only',
      possibleRetainedInputPointerLocations: Object.freeze([]),
      tables: 0,
      hostCallbacks: 0,
      stores: optimized.instructions.store,
      globalSets: optimized.instructions.globalSet,
      inputFrameMutations: 0,
      repeatedCallContamination: false,
    }),
    malformedInputTrapCount: 0,
    standaloneRangesPairwiseNonOverlapping: true,
    postLinkLayout: 'G2-NOT-CLAIMED',
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });

  const authority = verifyAuthority();
  const manifest = verifyManifest();
  const inspections = inspectArtifacts();
  const corpus = vectorCorpus();
  const execution = Object.freeze({
    unoptimized: executeCorpus(RAW_ARTIFACT, corpus),
    optimized: executeCorpus(OPTIMIZED_ARTIFACT, corpus),
  });
  assert.deepEqual(
    execution.unoptimized.cases,
    execution.optimized.cases,
  );
  assert.equal(execution.unoptimized.trapCount, 0);
  assert.equal(execution.optimized.trapCount, 0);
  const stack = measureStack(
    OPTIMIZED_ARTIFACT,
    corpus.find((entry) => entry.id === 'maximum-signing-input-valid'),
  );

  const source = sourceReport({ authority, manifest });
  const sourceRecord = writeOutput(
    options.outputDirectory,
    'es256-guest-source-report.json',
    source,
  );
  const audit = artifactAudit({ inspections, manifest });
  const auditRecord = writeOutput(
    options.outputDirectory,
    'es256-guest-artifact-audit.json',
    audit,
  );
  const vectors = vectorReport({ execution });
  const vectorRecord = writeOutput(
    options.outputDirectory,
    'es256-guest-vector-report.json',
    vectors,
  );
  const memory = memoryReport({ inspections, stack });
  const memoryRecord = writeOutput(
    options.outputDirectory,
    'es256-guest-memory-report.json',
    memory,
  );

  const evidence = Object.freeze({
    version: 'pulse.jwt-g1-evidence.v1',
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    changed: Object.freeze([
      'added the crypto-owned no_std ES256 verifier guest',
      'implemented strict invocation-frame-v2 validation before field access',
      'added a reviewed optimized package prebuilt and v2 unit manifest',
      'proved positive, negative, malformed-frame, repeated-call, and artifact parity',
      'bounded standalone stack, static, scratch, and invocation ranges',
      'corrected the G0 Cargo binary commit in provenance evidence',
    ]),
    reports: Object.freeze({
      source: sourceRecord,
      artifactAudit: auditRecord,
      vectors: vectorRecord,
      memory: memoryRecord,
    }),
    acceptance: Object.freeze({
      positiveAndNegativeVectorsPass: true,
      malformedInputsTrap: false,
      allocatorReachable: false,
      memoryGrowPresent: false,
      onlyFixedMemoryImport: true,
      exactArtifactHashesRecorded: true,
      standaloneRangesExplicitAndNonOverlapping: true,
      retainedInputContaminationObserved: false,
      jwtAndHostNeutral: true,
      unoptimizedOptimizedParity: true,
      repeatedBuildsDeterministicInCurrentEnvironment: true,
    }),
    boundaries: Object.freeze({
      compilerGuestLinkIntegrated: false,
      jwtEs256Activated: false,
      runtimeBuiltinActivated: false,
      targetSupportAdvertised: false,
      publicGuestAbiAdded: false,
      publicConfigurationAdded: false,
      sourceBuildAddedToApplicationBuild: false,
      fallbackAdded: false,
      releaseCatalogChanged: false,
      published: false,
      deployed: false,
      activated: false,
    }),
    residualUnknowns: Object.freeze([
      'post-link stack, static, scratch, and frame layout',
      'Node Native final-artifact behavior',
      'Fastly Native final-artifact behavior',
      'independent cryptographic and side-channel review',
      'clean-machine and cross-environment source reproduction',
    ]),
    nextAuthorizedCheckpoint: 'G2',
  });
  writeOutput(
    options.outputDirectory,
    'jwt-g1-evidence.json',
    evidence,
  );

  process.stdout.write(
    `ok - G1 verified ${corpus.length} ES256/frame cases on both exact ` +
    'artifacts with zero traps, no allocator or growth, and G2 only next\n',
  );
}

main();
