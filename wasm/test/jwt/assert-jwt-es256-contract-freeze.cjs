#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const {
  versions: guestVersions,
  memoryAbi,
} = require('../../packages/wasm-guest-link/src/constants.js');
const {
  inspectWasmFile,
  reportInspection,
} = require('../../packages/wasm-guest-link/src/inspect.js');
const {
  sourceTreeRecord,
} = require('../../packages/wasm-guest-link/src/files.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const OBSERVED_AT = '2026-07-30';
const STAGE = 'G0';
const SOURCE_DECISION_VERSION = 'pulse.es256-source-decision.g0.v1';
const DEPENDENCY_INVENTORY_VERSION =
  'pulse.es256-dependency-license-inventory.g0.v1';
const PRIVATE_CONTRACT_VERSION =
  'pulse.es256-private-contract.g0.v1';
const FRAME_CONTRACT_VERSION =
  'pulse.es256-frame-v2-contract.g0.v1';
const EVIDENCE_VERSION = 'pulse.jwt-g0-evidence.v1';
const PROBE_DIRECTORY =
  'packages/crypto/guests/es256-rustcrypto/probe';

const EXPECTED_DEPENDENCIES = Object.freeze([
  Object.freeze({
    name: 'base16ct',
    version: '1.0.0-beta.1',
    checksum:
      '4c7f02d4ea65f2c1853089ffd8d2787bdbc63de2f0d29dedbcf8ccdfa0ccd4cf',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'block-buffer',
    version: '0.10.4',
    checksum:
      '3078c7629b62d3f0439517fa394996acacc5cbc91c5a20d8c658e77abd503a71',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'cfg-if',
    version: '1.0.4',
    checksum:
      '9330f8b2ff13f34540b44e946ef35111825727b38d33286ef986142615121801',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'const-oid',
    version: '0.9.6',
    checksum:
      'c2459377285ad874054d797f3ccebf984978aa39129f6eafde5cdc8315b612f8',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'cpufeatures',
    version: '0.2.17',
    checksum:
      '59ed5838eebb26a2bb2e58f6d5b5316989ae9d08bab10e0e6d103e656d1b0280',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'locked-target-inactive',
  }),
  Object.freeze({
    name: 'crypto-bigint',
    version: '0.5.5',
    checksum:
      '0dc92fb57ca44df6db8059111ab3af99a63d5d0f8375d9972e319a379c6bab76',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'crypto-common',
    version: '0.1.6',
    checksum:
      '1bfb12502f3fc46cca1bb51ac28df9d618d813cdc3d2f25b9fe775a34af26bb3',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'der',
    version: '0.7.10',
    checksum:
      'e7c1832837b905bbfb5101e07cc24c8deddf52f93225eee6ead5f4d63d53ddcb',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked-sec1-transitive',
  }),
  Object.freeze({
    name: 'digest',
    version: '0.10.7',
    checksum:
      '9ed9a281f7bc9b7576e61468ba615a66a5c8cfdff42420a70aa82701a3b1e292',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'ecdsa',
    version: '0.16.9',
    checksum:
      'ee27f32b5c5292967d2d4a9d7f1e0b0aed2c15daded5a60300e4abb9d8020bca',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'elliptic-curve',
    version: '0.13.8',
    checksum:
      'b5e6043086bf7973472e0c7dff2142ea0b680d30e18d9cc40f267efbf222bd47',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'ff',
    version: '0.13.1',
    checksum:
      'c0b50bfb653653f9ca9095b427bed08ab8d75a137839d9ad64eb11810d5b6393',
    license: 'MIT/Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'generic-array',
    version: '0.14.9',
    checksum:
      '4bb6743198531e02858aeaea5398fcc883e71851fcbcb5a2f773e2fb6cb1edf2',
    license: 'MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'group',
    version: '0.13.0',
    checksum:
      'f0f9ef7462f7c099f518d754361858f86d8a07af53ba9af0fe635bbccb151a63',
    license: 'MIT/Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'libc',
    version: '0.2.189',
    checksum:
      '3eaf3ede3fee6db1a4c2ee091bf8a8b4dccdc6d17f656fb07896ee72867612f2',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'locked-target-inactive',
  }),
  Object.freeze({
    name: 'p256',
    version: '0.13.2',
    checksum:
      'c9863ad85fa8f4460f9c48cb909d38a0d689dba1f6f6988a5e3e0d31071bcd4b',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'primeorder',
    version: '0.13.6',
    checksum:
      '353e1ca18966c16d9deb1c69278edbc5f194139612772bd9537af60ac231e1e6',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'rand_core',
    version: '0.6.4',
    checksum:
      'ec0be4795e2f6a28069bec0b5ff3e2ac9bafc99e6a9a7dc3547996c5c816922c',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked-traits-only-no-rng-source',
  }),
  Object.freeze({
    name: 'sec1',
    version: '0.7.3',
    checksum:
      'd3e97a565f76233a6003f9f5c54be1d9c5bdfa3eccfb189469f11ec4901c47dc',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked-point-decoding-only',
  }),
  Object.freeze({
    name: 'sha2',
    version: '0.10.9',
    checksum:
      'a7507d819769d01a365ab707794a4084392c824f54a7a6a7862f8c3d0892b283',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'signature',
    version: '2.2.0',
    checksum:
      '77549399552de45a898a580c1b41d445bf730df867cc44e6c0233bbc4b8329de',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked-traits-only',
  }),
  Object.freeze({
    name: 'subtle',
    version: '2.6.1',
    checksum:
      '13c2bddecc57b384dee18652358fb23172facb8a2c51ccc10d74c157bdea3292',
    license: 'BSD-3-Clause',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'typenum',
    version: '1.20.1',
    checksum:
      'b6f5e870be6c3b371b77fe0ee0bafb859fa4964b4404c27de1d380043c4dda20',
    license: 'MIT OR Apache-2.0',
    targetDisposition: 'linked',
  }),
  Object.freeze({
    name: 'version_check',
    version: '0.9.5',
    checksum:
      '0b928f33d975fc6ad9f86c8f283853ad26bdd5b10b7f1542aa2fa15e2289105a',
    license: 'MIT/Apache-2.0',
    targetDisposition: 'build-only',
  }),
  Object.freeze({
    name: 'zeroize',
    version: '1.9.0',
    checksum:
      'e13c156562582aa81c60cb29407084cdb54c4164760106ab78e6c5b0858cf64e',
    license: 'Apache-2.0 OR MIT',
    targetDisposition: 'linked',
  }),
]);

const PROBE_ARTIFACTS = Object.freeze({
  unoptimized: Object.freeze({
    file:
      'wasm/.test-results/jwt-g0/es256-dependency-probe.unoptimized.wasm',
    bytes: 2_649_696,
    sha256:
      '81253b459387142a81215183d651296952eba30d73a6f524fdc6cb60a2583aad',
  }),
  release: Object.freeze({
    file: 'wasm/.test-results/jwt-g0/es256-dependency-probe.release.wasm',
    bytes: 22_820,
    sha256:
      '9aa2803bc168c1c79c6f59b33b42b42b6083aaffd00e47a6f9021f07a82891b9',
  }),
  optimized: Object.freeze({
    file:
      'wasm/.test-results/jwt-g0/es256-dependency-probe.optimized.wasm',
    bytes: 20_627,
    sha256:
      '58c9ecc403333c80d596ee84ce1966d51d02347ef8f589afe711c7fdad737c37',
  }),
});

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g0');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete JWT G0 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[++index]);
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(relativeFile) {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'),
  );
}

function fileRecord(relativeFile) {
  const normalized = relativeFile.replace(/\\/g, '/');
  const bytes = fs.readFileSync(path.join(repoRoot, normalized));
  return Object.freeze({
    file: normalized,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function verifyRecord(expected) {
  const actual = fileRecord(expected.file);
  assert.equal(actual.bytes, expected.bytes, expected.file);
  assert.equal(actual.sha256, expected.sha256, expected.file);
  return actual;
}

function parseCargoLock(source) {
  const packages = [];
  for (const block of source.split('[[package]]').slice(1)) {
    const field = (name) => {
      const match = block.match(
        new RegExp(`^${name} = "([^"]+)"$`, 'm'),
      );
      return match ? match[1] : null;
    };
    packages.push(Object.freeze({
      name: field('name'),
      version: field('version'),
      checksum: field('checksum'),
      registry: field('source'),
    }));
  }
  return Object.freeze(packages);
}

function verifyCargoClosure() {
  const cargoFile = path.join(repoRoot, PROBE_DIRECTORY, 'Cargo.toml');
  const lockFile = path.join(repoRoot, PROBE_DIRECTORY, 'Cargo.lock');
  const cargo = fs.readFileSync(cargoFile, 'utf8');
  const lock = fs.readFileSync(lockFile, 'utf8');

  assert.match(
    cargo,
    /ecdsa = \{ version = "=0\.16\.9", default-features = false, features = \["arithmetic", "hazmat"\] \}/,
  );
  assert.match(
    cargo,
    /p256 = \{ version = "=0\.13\.2", default-features = false, features = \["arithmetic"\] \}/,
  );
  assert.match(
    cargo,
    /sha2 = \{ version = "=0\.10\.9", default-features = false \}/,
  );
  for (const prohibited of [
    '"std"',
    '"alloc"',
    '"signing"',
    '"verifying"',
    '"rfc6979"',
    '"pem"',
    '"pkcs8"',
    '"serde"',
    '"getrandom"',
  ]) {
    assert.equal(
      cargo.includes(prohibited),
      false,
      `probe enables prohibited feature ${prohibited}`,
    );
  }

  const parsed = parseCargoLock(lock);
  const root = parsed.find(
    (entry) => entry.name === 'pulse-es256-rustcrypto-probe',
  );
  assert.deepEqual(root, {
    name: 'pulse-es256-rustcrypto-probe',
    version: '0.0.0',
    checksum: null,
    registry: null,
  });
  const registry = parsed
    .filter((entry) => entry.registry !== null)
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      checksum: entry.checksum,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expected = EXPECTED_DEPENDENCIES
    .map(({ name, version, checksum }) => ({ name, version, checksum }))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(registry, expected);

  return Object.freeze({
    cargo: fileRecord(`${PROBE_DIRECTORY}/Cargo.toml`),
    lock: fileRecord(`${PROBE_DIRECTORY}/Cargo.lock`),
    toolchain: fileRecord(`${PROBE_DIRECTORY}/rust-toolchain.toml`),
    linker: fileRecord(`${PROBE_DIRECTORY}/.cargo/config.toml`),
    source: fileRecord(`${PROBE_DIRECTORY}/src/lib.rs`),
    readme: fileRecord(`${PROBE_DIRECTORY}/README.md`),
    tree: sourceTreeRecord(path.join(repoRoot, PROBE_DIRECTORY)),
  });
}

function verifyStartingAuthority() {
  const f4 = readJson(
    'wasm/.test-results/jwt-f4/jwt-f4-final-proof-seal.json',
  );
  const f3 = readJson(
    'wasm/.test-results/jwt-f3/jwt-f3-asymmetric-candidate-comparison.json',
  );
  const f2 = readJson(
    'wasm/.test-results/jwt-f2/jwt-f2-memory-assumption-ledger.json',
  );
  assert.equal(f4.status, 'passed');
  assert.equal(f4.classification, 'PASS');
  assert.equal(f4.outcomes.jwtCryptoClosedLoop.decision, 'PASS');
  assert.equal(
    f4.outcomes.guestLinkedAsymmetricDirection.decision,
    'CONDITIONAL',
  );
  assert.equal(
    f4.outcomes.guestLinkedAsymmetricDirection.recommendedFirstAlgorithm,
    'ES256',
  );
  assert.equal(
    f4.outcomes.jwtCryptoClosedLoop.productionReleaseReadiness,
    'NOT_READY',
  );
  assert.equal(f3.recommendation.algorithm, 'ES256');
  assert.equal(f3.privateFrame.selectedCapacityBytes, 16_640);
  assert.equal(f3.privateFrame.selectedRawPayloadBytes, 16_468);
  assert.equal(
    f2.items.find((entry) => entry.id === 'invocation-frame-contract')
      .status,
    'REQUIRED-NOT-IMPLEMENTED',
  );

  return Object.freeze({
    f4: fileRecord(
      'wasm/.test-results/jwt-f4/jwt-f4-final-proof-seal.json',
    ),
    f4Handoff: fileRecord(
      'wasm/.test-results/jwt-f4/jwt-f4-final-handoff.md',
    ),
    f3: fileRecord(
      'wasm/.test-results/jwt-f3/jwt-f3-asymmetric-candidate-comparison.json',
    ),
    f3Targets: fileRecord(
      'wasm/.test-results/jwt-f3/jwt-f3-five-target-matrix.json',
    ),
    f2Memory: fileRecord(
      'wasm/.test-results/jwt-f2/jwt-f2-memory-assumption-ledger.json',
    ),
  });
}

function verifyV1Unchanged() {
  assert.equal(guestVersions.guestUnit, 'pulse.guest-unit.v1');
  assert.equal(guestVersions.guestUnitV2, 'pulse.guest-unit.v2');
  assert.equal(
    guestVersions.memoryAbi,
    'pulse.guest-memory.borrowed-span.v1',
  );
  assert.equal(
    guestVersions.memoryAbiV2,
    'pulse.guest-memory.invocation-frame.v2',
  );
  assert.deepEqual(memoryAbi, {
    identity: 'pulse.guest-memory.borrowed-span.v1',
    pointerWidthBits: 32,
    pageBytes: 65_536,
    minimumPages: 32,
    maximumPages: 32,
    bytes: 2_097_152,
    maximumBorrowedBytes: 4_096,
    invalidRangeStatus: 0x8000_0000,
    importModule: 'env',
    importName: 'memory',
    layout: {
      rustStack: { start: 0, endExclusive: 65_536 },
      rustStatic: { start: 131_072, endExclusive: 262_144 },
      primaryStatic: { start: 262_144, endExclusive: 524_288 },
      borrowedInput: { start: 524_288, endExclusive: 2_097_152 },
    },
  });
}

function verifyFrozenContracts() {
  const es256 = cryptoContracts.CRYPTO_ES256_CONTRACT;
  const jwt = jwtContracts.JWT_ES256_KEY_NORMALIZATION_CONTRACT;
  assert.deepEqual(cryptoContracts.CRYPTO_ALGORITHMS, ['HS256']);
  assert.equal(es256.version, 'pulse.crypto.es256-verification.v1');
  assert.equal(es256.status, 'contract-frozen-not-executable');
  assert.equal(es256.algorithm, 'ES256');
  assert.deepEqual(es256.primitive, {
    kind: 'ecdsa',
    curve: 'P-256',
    hash: 'SHA-256',
  });
  assert.deepEqual(es256.resultStatuses, [
    'valid',
    'invalid-authenticator',
    'invalid-key',
    'invalid-input',
    'realization-failure',
  ]);
  assert.deepEqual(es256.resultCodes, {
    valid: 1,
    invalidAuthenticator: 0,
    invalidKey: -1,
    invalidInput: -2,
    realizationFailure: -3,
  });
  assert.equal(es256.guest.unitVersion, guestVersions.guestUnitV2);
  assert.equal(es256.guest.memory.identity, guestVersions.memoryAbiV2);
  assert.equal(es256.guest.export.name, 'pulse_crypto_es256_verify');
  assert.deepEqual(es256.guest.export.parameters, ['i32', 'i32']);
  assert.deepEqual(es256.guest.export.results, ['i32']);
  assert.equal(es256.guest.allocator, false);
  assert.equal(es256.guest.hostCallbacks, false);
  assert.equal(es256.automaticFallback, false);

  assert.equal(jwt.version, 'pulse.jwt.es256-key-normalization.v1');
  assert.equal(jwt.status, 'contract-frozen-not-executable');
  assert.deepEqual(jwt.inlineJwk.requiredMembers, [
    'kty',
    'crv',
    'x',
    'y',
  ]);
  assert.deepEqual(jwt.inlineJwk.optionalMembers, [
    'alg',
    'use',
    'key_ops',
    'kid',
  ]);
  assert.equal(jwt.inlineJwk.coordinateBytes, 32);
  assert.equal(jwt.jwks.entriesMaximum, 16);
  assert.equal(jwt.jwks.remoteDiscovery, false);
  assert.equal(jwt.jwks.selectedKeyFailure, 'terminal-no-retry');
  assert.equal(jwt.cryptoAdapter.publicKeyBytes, 64);
  assert.equal(jwt.cryptoAdapter.signatureBytes, 64);
  assert.equal(jwt.cryptoAdapter.derAccepted, false);
  assert.equal(jwt.cryptoAdapter.highS, 'accepted-if-otherwise-valid');
  assert.equal(jwt.exactSigningInput, true);
  assert.equal(jwt.claimsBeforeAuthenticity, false);
  assert.equal(jwt.automaticFallback, false);
  assert.equal(Object.isFrozen(es256), true);
  assert.equal(Object.isFrozen(es256.frame.header), true);
  assert.equal(Object.isFrozen(jwt), true);
}

function inspectProbeArtifacts(outputDirectory) {
  const inspectionDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pulse-es256-g0-inspection-'),
  );
  const inspected = {};
  try {
    for (const [name, expected] of Object.entries(PROBE_ARTIFACTS)) {
      verifyRecord(expected);
      inspected[name] = reportInspection(inspectWasmFile(
        path.join(repoRoot, expected.file),
        {
          label: `es256-g0-${name}`,
          workDirectory: inspectionDirectory,
        },
      ));
    }
  } finally {
    fs.rmSync(inspectionDirectory, { recursive: true, force: true });
  }

  for (const name of ['release', 'optimized']) {
    const value = inspected[name];
    assert.deepEqual(value.imports, [{
      module: 'env',
      name: 'memory',
      kind: 'memory',
      type: {
        minimumPages: 32,
        maximumPages: 32,
        shared: false,
      },
    }]);
    assert.deepEqual(value.exports, [{
      name: 'pulse_es256_dependency_probe',
      kind: 'function',
      parameters: ['i32', 'i32', 'i32', 'i32', 'i32', 'i32'],
      results: ['i32'],
    }]);
    assert.equal(value.definedMemories, 0);
    assert.equal(value.importedMemories, 1);
    assert.equal(value.memories, 1);
    assert.equal(value.hasStart, false);
    assert.equal(value.tables, 0);
    assert.deepEqual(value.features, []);
    assert.equal(value.instructions.memoryGrow, 0);
    assert.equal(value.instructions.memoryCopy, 0);
    assert.equal(value.instructions.memoryFill, 0);
    assert.equal(value.instructions.memoryInit, 0);
    assert.equal(value.instructions.callIndirect, 0);
    assert.deepEqual(value.dataSegments, [{
      memoryIndex: 0,
      offset: 131_072,
      endExclusive: 131_656,
      bytes: 584,
      sha256:
        '231fcd9a2fc4e8190c8b96c9f89708b8039ea1b801cc564e32fbc14ff44e53ee',
    }]);
    assert.deepEqual(value.mutableGlobals, [{
      name: 'global$0',
      type: 'i32',
      initializer: {
        instruction: 'i32.const',
        value: 65_536,
      },
    }]);
  }
  assert.equal(inspected.unoptimized.hasStart, false);
  assert.equal(inspected.unoptimized.instructions.memoryGrow, 0);
  assert.deepEqual(inspected.unoptimized.features, ['mutable-globals']);
  assert.equal(inspected.unoptimized.tables, 1);

  return Object.freeze(inspected);
}

function executeProbe(relativeFile) {
  const module = new WebAssembly.Module(
    fs.readFileSync(path.join(repoRoot, relativeFile)),
  );
  const memory = new WebAssembly.Memory({ initial: 32, maximum: 32 });
  const instance = new WebAssembly.Instance(module, { env: { memory } });
  const verify = instance.exports.pulse_es256_dependency_probe;
  assert.equal(typeof verify, 'function');

  const key = Buffer.from(
    '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6' +
      '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299',
    'hex',
  );
  const data = Buffer.from('sample');
  const signature = Buffer.from(
    'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' +
      'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8',
    'hex',
  );
  const order = BigInt(
    '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
  );
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`);
  const highS = Buffer.from(
    (order - s).toString(16).padStart(64, '0'),
    'hex',
  );
  const highSignature = Buffer.concat([
    signature.subarray(0, 32),
    highS,
  ]);

  const view = Buffer.from(memory.buffer);
  const keyPointer = 524_288;
  const dataPointer = keyPointer + 64;
  const signaturePointer = dataPointer + 32;
  const run = (keyBytes, dataBytes, signatureBytes) => {
    view.fill(0, keyPointer, signaturePointer + 64);
    keyBytes.copy(view, keyPointer);
    dataBytes.copy(view, dataPointer);
    signatureBytes.copy(view, signaturePointer);
    return verify(
      keyPointer,
      keyBytes.length,
      dataPointer,
      dataBytes.length,
      signaturePointer,
      signatureBytes.length,
    );
  };

  const results = Object.freeze({
    valid: run(key, data, signature),
    invalidAuthenticator: run(
      key,
      data,
      Buffer.from(signature.map((byte, index) =>
        index === 0 ? byte ^ 1 : byte)),
    ),
    acceptedHighS: run(key, data, highSignature),
    invalidKey: run(Buffer.alloc(64), data, signature),
    invalidInput: run(key, data, Buffer.alloc(64)),
  });
  assert.deepEqual(results, {
    valid: 1,
    invalidAuthenticator: 0,
    acceptedHighS: 1,
    invalidKey: -1,
    invalidInput: -2,
  });
  return results;
}

function frameContract() {
  const frame = cryptoContracts.CRYPTO_ES256_CONTRACT.frame;
  const headerOffsets = Object.values(frame.header);
  assert.equal(new Set(headerOffsets).size, 16);
  assert.deepEqual(headerOffsets, [
    0, 4, 8, 12, 16, 20, 24, 28,
    32, 36, 40, 44, 48, 52, 56, 60,
  ]);
  assert.equal(frame.headerBytes, 64);
  assert.equal(frame.capacityBytes, 16_640);
  assert.equal(frame.signingInputBytesMaximum, 16_340);
  assert.equal(frame.publicKeyBytes, 64);
  assert.equal(frame.signatureBytes, 64);
  assert.equal(
    frame.signingInputBytesMaximum
      + frame.publicKeyBytes
      + frame.signatureBytes,
    16_468,
  );
  assert.equal(frame.rawPayloadBytesMaximum, 16_468);
  assert.equal(frame.capacityBytes - 16_468, 172);
  assert.equal(frame.reservedHeaderAndAlignmentBytes, 172);
  assert.equal(frame.reservedWordCount, 4);
  assert.equal(frame.reservedWordValue, 0);
  assert.deepEqual(frame.canonicalOffsets, {
    publicKey: 64,
    signature: 128,
    signingInput: 192,
  });
  const maximumCanonicalEnd =
    frame.canonicalOffsets.signingInput
    + frame.signingInputBytesMaximum;
  assert.equal(maximumCanonicalEnd, 16_532);
  assert.equal(
    Math.ceil(maximumCanonicalEnd / frame.alignmentBytes)
      * frame.alignmentBytes,
    16_544,
  );

  return Object.freeze({
    version: FRAME_CONTRACT_VERSION,
    stage: STAGE,
    status: 'PASS',
    identity: frame.identity,
    memoryIdentity:
      cryptoContracts.CRYPTO_ES256_CONTRACT.guest.memory.identity,
    outerAbi: Object.freeze({
      export:
        cryptoContracts.CRYPTO_ES256_CONTRACT.guest.export.name,
      parameters: Object.freeze([
        Object.freeze({ name: 'framePointer', type: 'i32' }),
        Object.freeze({ name: 'frameCapacity', type: 'i32' }),
      ]),
      result: Object.freeze({ name: 'status', type: 'i32' }),
      requiredFrameCapacity: frame.capacityBytes,
    }),
    layout: frame,
    totalLength: Object.freeze({
      minimum: 192,
      maximum: frame.capacityBytes,
      multipleOf: frame.alignmentBytes,
      canonicalFormula:
        'align16(192 + signingInputLength)',
      maximumCanonical: 16_544,
    }),
    fieldRules: Object.freeze({
      offsetsAtOrAfterHeader: true,
      offsetsAlignedTo: frame.alignmentBytes,
      keyLengthExact: frame.publicKeyBytes,
      signatureLengthExact: frame.signatureBytes,
      signingInputLengthMaximum:
        frame.signingInputBytesMaximum,
      checkedOffsetPlusLength: true,
      insideDeclaredTotalLength: true,
      pairwiseNonOverlap: true,
      duplicateOffsetsRejected: true,
      reservedHeaderWordsZero: true,
    }),
    validationOrder: Object.freeze([
      'outer-pointer-alignment-capacity-and-fixed-memory-range-without-dereference',
      'magic-version-header-length-and-declared-total-length',
      'fixed-algorithm-flags-and-zero-reserved-words',
      'exact-key-signature-and-bounded-signing-input-lengths',
      'checked-offset-plus-length-and-declared-frame-bounds',
      'field-alignment-pairwise-non-overlap-and-duplicate-offset-rejection',
      'field-dereference-and-cryptographic-decoding',
    ]),
    lifetime: Object.freeze({
      owner: 'compiler-generated-caller',
      use: 'synchronous-borrow',
      retention: 'forbidden',
      producerZeroInitializesCapacity: true,
      callerClearsBytes: frame.capacityBytes,
      clearTiming: 'after-scalar-capture-on-return-or-trap',
      guestScratchClearing: 'g1-must-prove',
    }),
    scalarMapping:
      cryptoContracts.CRYPTO_ES256_CONTRACT.resultCodes,
    malformedMapping: Object.freeze({
      frame: 'invalid-input',
      signatureEncoding: 'invalid-input',
      publicPoint: 'invalid-key',
      wellFormedNonVerifyingSignature: 'invalid-authenticator',
      infrastructure: 'realization-failure',
      rawLibraryCodesEscape: false,
    }),
    v1Preserved: true,
    publicConfiguration: false,
  });
}

function privateContract(frame) {
  return Object.freeze({
    version: PRIVATE_CONTRACT_VERSION,
    stage: STAGE,
    status: 'PASS',
    activation: 'contract-frozen-not-executable',
    ownership: Object.freeze({
      semanticVerification: '@pulse-compute/crypto',
      jwtJwkAndJwksShapeAndSelection: '@pulse-compute/jwt',
      fixedByteNormalization: '@pulse-compute/crypto adapter',
      guestSourcePrebuiltAndProvenance: '@pulse-compute/crypto',
      genericValidationMaterializationLinkAudit:
        '@pulse-compute/wasm-guest-link',
      reachabilityAndRealizationPlanning:
        'crypto contracts and compiler',
      providerEligibilityAndArtifactDelivery:
        'explicit provider toolchain',
      claimsAndPolicy: '@pulse-compute/jwt',
    }),
    crypto: cryptoContracts.CRYPTO_ES256_CONTRACT,
    jwt: jwtContracts.JWT_ES256_KEY_NORMALIZATION_CONTRACT,
    frame,
    packagePrebuiltManifest: Object.freeze({
      version: guestVersions.guestUnitV2,
      requiredFields: Object.freeze([
        'version',
        'id',
        'module',
        'owner',
        'packageVersion',
        'abi',
        'origin',
        'artifact',
        'source',
        'toolchain',
        'imports',
        'exports',
        'memory',
        'start',
        'features',
        'provenance',
      ]),
      fixed: Object.freeze({
        id: 'pulse.crypto.es256.rustcrypto-p256.v1',
        module: 'pulse_crypto_es256',
        owner: '@pulse-compute/crypto',
        packageVersion: '1.0.0-beta.1',
        abi: 'pulse.crypto.es256.verify.v1',
        origin: 'package-prebuilt',
        artifactFile: 'prebuilt/es256-verifier.wasm',
        sourceDirectory: 'source',
        toolchainKind: 'rust-cargo',
        toolchainTarget: 'wasm32v1-none',
        rustc: '1.97.1 (8bab26f4f 2026-07-14)',
        cargo: '1.97.1 (c980f4866 2026-06-30)',
        import: 'env.memory',
        export: 'pulse_crypto_es256_verify',
        memoryIdentity: guestVersions.memoryAbiV2,
        start: 'forbidden',
        featureBaseline: 'mvp',
      }),
      artifactFieldsG1MustFill: Object.freeze([
        'bytes',
        'sha256',
        'sourceTreeSha256',
        'cargoLockSha256',
        'reconstructionCommandIdentity',
      ]),
      executableFieldsForbidden: true,
      applicationSourceBuild: false,
      firstPartyOnly: true,
    }),
    targetEligibility: Object.freeze({
      'node-javascript': 'eligible-runtime-builtin-g3-required',
      'node-native': 'eligible-guest-linked-g2-g4-required',
      'fastly-native': 'eligible-guest-linked-g4-required',
      'fastly-javascript':
        'ineligible-until-ecdsa-verify-execution-evidence',
      browser: 'deferred-no-support-claim',
      esp32: 'deferred-no-support-claim',
    }),
    failClosed: Object.freeze({
      selectedRealizationFailure: 'terminal-realization-failure',
      retryAnotherRealization: false,
      retryJavaScriptAfterNativeFailure: false,
      retryAnotherJwksKeyAfterSelectedFailure: false,
      inferCapabilityFromProtectedAlg: false,
      runtimeDetectionInJwt: false,
    }),
    prohibited: Object.freeze([
      'guest-allocator',
      'memory-grow',
      'second-memory',
      'dynamic-loading',
      'application-supplied-guest',
      'public-third-party-manifest',
      'host-callbacks',
      'source-compilation-during-application-build',
      'realization-fallback',
      'backend-specific-jwt-logic',
      'raw-library-status-or-exception',
      'sensitive-report-content',
    ]),
  });
}

function sourceDecision(inputs) {
  const release = inputs.inspections.release;
  const optimized = inputs.inspections.optimized;
  return Object.freeze({
    version: SOURCE_DECISION_VERSION,
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    decision: 'SELECTED',
    candidate: Object.freeze({
      family: 'RustCrypto p256',
      operation: 'verify-only',
      target: 'wasm32v1-none',
      runtimePosture: 'no_std',
      topLevel: Object.freeze([
        Object.freeze({
          crate: 'p256',
          version: '0.13.2',
          registryChecksum:
            'c9863ad85fa8f4460f9c48cb909d38a0d689dba1f6f6988a5e3e0d31071bcd4b',
          sourceRevision:
            'd21a81b2be325db940502fdc5299094b79b450f0',
          features: Object.freeze(['arithmetic']),
        }),
        Object.freeze({
          crate: 'ecdsa',
          version: '0.16.9',
          registryChecksum:
            'ee27f32b5c5292967d2d4a9d7f1e0b0aed2c15daded5a60300e4abb9d8020bca',
          sourceRevision:
            'abd0175f3ae2dc4b118fa914e94c1fc4b0182ba9',
          features: Object.freeze(['arithmetic', 'hazmat']),
        }),
        Object.freeze({
          crate: 'sha2',
          version: '0.10.9',
          registryChecksum:
            'a7507d819769d01a365ab707794a4084392c824f54a7a6a7862f8c3d0892b283',
          sourceRevision:
            '82c36a428f8d6f05f3bfccdedb243e9d1f85359d',
          features: Object.freeze([]),
        }),
      ]),
      reason:
        'This exact 0.13 closure permits direct fixed-width prehashed verification without enabling the aggregate p256/ecdsa feature, ecdsa signing/verifying modules, rfc6979, alloc, std, or randomness. The newer 0.14 aggregate algorithm feature couples verification to rfc6979 and was not selected.',
    }),
    featureDisposition: Object.freeze({
      enabled: Object.freeze({
        p256: Object.freeze(['arithmetic']),
        ecdsa: Object.freeze(['arithmetic', 'hazmat']),
        sha2: Object.freeze([]),
      }),
      disabled: Object.freeze([
        'std',
        'alloc',
        'p256/ecdsa',
        'ecdsa/signing',
        'ecdsa/verifying',
        'rfc6979',
        'randomness',
        'getrandom',
        'pem',
        'pkcs8',
        'serde',
        'jwk',
        'ecdh',
      ]),
      notes: Object.freeze([
        'rand_core is present as a trait-only transitive dependency; no RNG source or getrandom feature is enabled.',
        'der is present beneath SEC1 point decoding; neither the Pulse request nor guest boundary accepts DER signatures or certificate/key containers.',
        'The generic ecdsa arithmetic module contains signing primitives in source, but no signing key, RFC6979, RNG source, export, or reachable probe call is selected.',
      ]),
    }),
    targetProbe: Object.freeze({
      toolchain: Object.freeze({
        rustc: '1.97.1 (8bab26f4f 2026-07-14)',
        cargo: '1.97.1 (c980f4866 2026-06-30)',
        target: 'wasm32v1-none',
      }),
      binaryen:
        '129.0.0-nightly.20260428 / wasm-opt version 129 (version_129-59-gdf8b79d62)',
      source: inputs.source.tree,
      artifacts: Object.freeze({
        unoptimized: inputs.inspections.unoptimized,
        release,
        optimized,
      }),
      execution: inputs.execution,
      acceptedReleaseSurface: Object.freeze({
        imports: release.imports,
        exports: release.exports,
        features: release.features,
        hasStart: release.hasStart,
        memories: release.memoryTypes,
        tables: release.tables,
        globals: release.mutableGlobals,
        dataSegments: release.dataSegments,
      }),
    }),
    resourceExpectations: Object.freeze({
      unoptimizedBytes:
        inputs.inspections.unoptimized.bytes,
      cargoReleaseBytes: release.bytes,
      postBinaryenBytes: optimized.bytes,
      fixedMemoryBytes: 2_097_152,
      reservedStack: Object.freeze({
        start: 0,
        endExclusive: 65_536,
        basis: 'linker stack-first reservation and stack-pointer initializer',
      }),
      observedStatic: Object.freeze({
        start: 131_072,
        endExclusive: 131_656,
        bytes: 584,
      }),
      stackHighWater: 'UNKNOWN-G1-MUST-MEASURE-OR-BOUND',
      scratchRange: 'UNKNOWN-G1-MUST-MEASURE-OR-BOUND',
      finalGuestBytes: 'UNKNOWN-G1',
      finalLinkedBytes: 'UNKNOWN-G2',
    }),
    implementationDisposition: Object.freeze({
      allocatorFeatureEnabled: false,
      memoryGrowInstructions: optimized.instructions.memoryGrow,
      secondMemory: false,
      hostImportsBeyondFixedMemory: false,
      startFunction: false,
      indirectCalls: optimized.instructions.callIndirect,
      highSVerification: 'accepted',
      unsafe: Object.freeze({
        probeShim:
          'one documented raw-slice adapter; maintainer-controlled probe only',
        selectedP256AndEcdsaCrateRoots: 'forbid-unsafe-code',
        fullTransitiveManualUnsafeReview:
          'NOT-COMPLETE-G5-HARDENING',
      }),
      assembly: Object.freeze({
        handwrittenOrGeneratedAssemblySourceSelected: false,
        targetSpecificNativeBackendSelected: false,
        wasmCompilerCodegenOnly: true,
      }),
    }),
    provenanceAndSecurity: Object.freeze({
      licenses: Object.freeze([
        'Apache-2.0',
        'MIT',
        'BSD-3-Clause',
      ]),
      licenseDisposition: 'compatible-for-bounded-proof',
      rustSecSnapshot: Object.freeze({
        repository: 'https://github.com/RustSec/advisory-db',
        commit: 'bd347a52f842c6c696ffcaed55f7ad3568a58cb5',
        observedAt: OBSERVED_AT,
        matchingPackageAdvisories: Object.freeze([]),
      }),
      notices: Object.freeze([
        'RustCrypto ecdsa states that its generic implementation has not been independently audited.',
        'The selected verification primitive uses variable-time scalar inversion; verification inputs are public, but G0 makes no constant-time or side-channel claim.',
        'No clean source-to-prebuilt byte-reproduction claim is made by this probe.',
      ]),
    }),
    normalApplicationBuild: Object.freeze({
      sourceCompilation: false,
      requiredOrigin: 'package-prebuilt',
      prebuiltArtifact: 'G1-MUST-PRODUCE-AND-REVIEW',
    }),
    unknowns: Object.freeze([
      'production guest stack high-water',
      'production guest scratch range and clearing',
      'production guest final code size',
      'production guest exact static range',
      'source-to-prebuilt reproducibility',
      'post-link layout and optimization behavior',
      'full transitive unsafe-code review',
      'independent cryptographic and side-channel review',
    ]),
    selectedSourceMayChangeWithoutReopeningG0: false,
  });
}

function dependencyInventory(source) {
  return Object.freeze({
    version: DEPENDENCY_INVENTORY_VERSION,
    stage: STAGE,
    status: 'PASS',
    observedAt: OBSERVED_AT,
    registry: 'crates.io',
    lockfile: source.lock,
    packageCount: EXPECTED_DEPENDENCIES.length,
    packages: EXPECTED_DEPENDENCIES,
    allRegistryChecksumsPresent:
      EXPECTED_DEPENDENCIES.every((entry) =>
        /^[a-f0-9]{64}$/.test(entry.checksum)),
    licenseSet: Object.freeze([
      'Apache-2.0',
      'MIT',
      'BSD-3-Clause',
    ]),
    unresolvedLicenses: Object.freeze([]),
    productionReleaseLegalReviewComplete: false,
  });
}

function writeOutput(outputDirectory, name, contents) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, contents);
  return fileRecord(
    path.relative(repoRoot, file).replace(/\\/g, '/'),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.outputDirectory, { recursive: true });

  const authority = verifyStartingAuthority();
  verifyV1Unchanged();
  verifyFrozenContracts();
  const source = verifyCargoClosure();
  const inspections = inspectProbeArtifacts(options.outputDirectory);
  const execution = Object.freeze({
    release: executeProbe(PROBE_ARTIFACTS.release.file),
    optimized: executeProbe(PROBE_ARTIFACTS.optimized.file),
  });
  assert.deepEqual(execution.release, execution.optimized);

  const frame = frameContract();
  const privateShape = privateContract(frame);
  const decision = sourceDecision({
    source,
    inspections,
    execution,
  });
  const inventory = dependencyInventory(source);

  const sourceDecisionRecord = writeOutput(
    options.outputDirectory,
    'es256-source-decision.json',
    stableJson(decision),
  );
  const inventoryRecord = writeOutput(
    options.outputDirectory,
    'es256-dependency-and-license-inventory.json',
    stableJson(inventory),
  );
  const privateContractRecord = writeOutput(
    options.outputDirectory,
    'es256-private-contract.json',
    stableJson(privateShape),
  );
  const frameContractRecord = writeOutput(
    options.outputDirectory,
    'es256-frame-v2-contract.json',
    stableJson(frame),
  );

  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    stage: STAGE,
    status: 'PASS',
    changed: Object.freeze([
      'selected exact RustCrypto p256 verifier dependency closure',
      'added maintainer-only wasm32v1-none dependency probe and lockfile',
      'froze crypto signature request, realization, guest, scalar, and frame identities',
      'froze deterministic JWT JWK/JWKS normalization rules',
      'reserved versioned guest-unit and memory-ABI successor identities',
      'preserved borrowed-span v1 unchanged',
    ]),
    evidence: Object.freeze({
      sourceDecision: sourceDecisionRecord,
      dependencyAndLicenseInventory: inventoryRecord,
      privateContract: privateContractRecord,
      frameContract: frameContractRecord,
      probeArtifacts: Object.freeze({
        unoptimized: fileRecord(PROBE_ARTIFACTS.unoptimized.file),
        release: fileRecord(PROBE_ARTIFACTS.release.file),
        optimized: fileRecord(PROBE_ARTIFACTS.optimized.file),
      }),
      startingAuthority: authority,
      source,
    }),
    validation: Object.freeze({
      focusedCommand:
        'node wasm/scripts/run-wasm-tests.cjs --task jwt-es256-contract-freeze --no-report',
      result: 'PASS',
      probeCompiledForAcceptedTarget: true,
      releaseAndOptimizedProbeExecuted: true,
      v1RegressionPreserved: true,
    }),
    observedFacts: Object.freeze([
      'The exact no_std closure compiles for wasm32v1-none.',
      'Release and post-Binaryen probes import only fixed 32-page env.memory, export one probe function, have no start, table, memory.grow, indirect call, or non-MVP feature.',
      'The probe accepts the RFC 6979 P-256 verification vector and its mathematically equivalent high-S form, and rejects wrong authenticators, invalid points, and invalid scalar encodings with the frozen categories.',
      'Cargo release is 22,820 bytes and the pinned Binaryen posture reduces the initial probe to 20,627 bytes.',
      'The optimized probe has 584 static bytes beginning at 131,072; stack high-water remains unmeasured.',
    ]),
    inferences: Object.freeze([
      'The selected dependency and feature closure is viable for G1 under the fixed-memory and no-allocation constraints.',
      'The initial probe does not reveal a source, license, import, feature, or code-size stop condition.',
    ]),
    assumptions: Object.freeze([
      'G1 can replace the probe shim with complete frame validation without enabling a prohibited dependency feature.',
      'G1 stack and scratch measurements will fit the frozen fixed layout; G0 does not claim that result.',
    ]),
    risksOrBlockers: decision.unknowns,
    boundaries: Object.freeze({
      executableEs256Added: false,
      jwtEs256Activated: false,
      productionGuestImplemented: false,
      privateFrameImplemented: false,
      publicGuestAbiAdded: false,
      sourceBuildAddedToApplicationBuild: false,
      fallbackAdded: false,
      targetSupportAdvertised: false,
      releaseCatalogChanged: false,
      published: false,
      deployed: false,
      activated: false,
    }),
    nextAuthorizedCheckpoint: 'G1',
  });
  writeOutput(
    options.outputDirectory,
    'jwt-g0-evidence.json',
    stableJson(evidence),
  );

  process.stdout.write(
    'ok - G0 selected RustCrypto p256 0.13.2 with the verifier-only ' +
      'feature closure, froze ES256/frame/JWT private contracts, preserved ' +
      'borrowed-span v1, and authorizes G1 only\n',
  );
}

main();
