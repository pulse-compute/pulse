#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guestLink = require('../../packages/wasm-guest-link/src/index.js');
const { assertGuestBinary } = require('../../packages/wasm-guest-link/src/materialize.js');
const { inspectWasmFile } = require('../../packages/wasm-guest-link/src/inspect.js');
const { fileRecord: bareFileRecord, stableJson } = require('../../packages/wasm-guest-link/src/files.js');
const { runTool } = require('../../packages/wasm-guest-link/src/toolchain.js');
const {
  realizeSelectedGuestUnits
} = require('../../packages/compiler/src/spine/guest-unit-stage.js');
const {
  GUEST_LINK_STAGE_RESULT_VERSION,
  makeGuestUnitPlan
} = require('../../packages/wasm-guest-link/src/stage.js');
const {
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy
} = require('../../packages/contracts/src/provider/final-wasm-policy.js');
const {
  GUEST_UNIT_CONTRIBUTION_VERSION,
  normalizeGuestUnitContribution
} = require('../../packages/contracts/src/package/package-contract.js');
const { CRYPTO_ALGORITHMS } = require('../../packages/contracts/src/crypto/contracts.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
const packageRoot = path.join(repoRoot, 'packages', 'crypto');
const manifestRelative = 'guests/es256-rustcrypto/pulse.guest-unit.json';
const manifestFile = path.join(packageRoot, manifestRelative);
const candidateFile = path.join(
  wasmRoot,
  'test',
  'jwt',
  'contracts',
  'jwt-crypto-working-candidate.json'
);

const STAGE = 'G2';
const OBSERVED_AT = '2026-07-30';
const MEMORY_PAGES = 32;
const MEMORY_BYTES = MEMORY_PAGES * 65_536;
const FRAME_POINTER = 524_288;
const FRAME_CAPACITY = 16_640;
const FRAME_MAGIC = 0x3253_4550;
const HEADER_BYTES = 64;
const RFC_PUBLIC =
  '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6' +
  '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299';
const RFC_SIGNATURE =
  'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716' +
  'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8';
const STATUS = Object.freeze({
  valid: 1,
  invalidAuthenticator: 0,
  invalidKey: -1,
  invalidInput: -2
});
const MODE_OPTIONS = Object.freeze({
  default: undefined,
  experimentalNativeSize: 'experimental-native-size'
});

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-g2');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete ES256 G2 option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[++index]);
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileRecord(file, label = path.relative(repoRoot, file).replace(/\\/g, '/')) {
  const record = bareFileRecord(file);
  return Object.freeze({ file: label, bytes: record.bytes, sha256: record.sha256 });
}

function writeReport(outputDirectory, name, value) {
  const file = path.join(outputDirectory, name);
  fs.writeFileSync(file, stableJson(value));
  return fileRecord(file);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function synchronizedCatalog() {
  const document = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
  assert.equal(document.schemaVersion, 'pulse.jwt-crypto-working-candidate.v1');
  assert.equal(document.status, 'unpublished');
  assert.equal(document.boundaries.candidatePackagesSynchronized, true);
  assert.equal(document.boundaries.releaseCatalogPromoted, false);
  const selected = document.packages.filter((entry) => entry.name === '@pulse-compute/crypto');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].manifestVersion, '1.0.0-beta.1');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).version,
    selected[0].manifestVersion
  );
  return Object.freeze({
    identity: document.schemaVersion,
    status: 'unpublished-synchronized',
    record: fileRecord(candidateFile),
    packages: Object.freeze(selected.map((entry) => Object.freeze({
      name: entry.name,
      version: entry.manifestVersion
    })))
  });
}

function align16(value) {
  return Math.ceil(value / 16) * 16;
}

function makePrimary(directory) {
  const watFile = path.join(directory, 'es256-g2-primary.wat');
  const wasmFile = path.join(directory, 'es256-g2-primary.wasm');
  const wat = `(module
  (import "env" "memory" (memory 32 32))
  (import "pulse_crypto_es256" "pulse_crypto_es256_verify"
    (func $verify (param i32 i32) (result i32)))
  (data (i32.const 262144) "PULSE-G2-PRIMARY")
  (func (export "pulse_g2_es256_verify_frame") (param i32 i32) (result i32)
    local.get 0
    local.get 1
    call $verify)
  (func (export "pulse_g2_primary_marker") (result i32)
    i32.const 262144
    i32.load))
`;
  fs.writeFileSync(watFile, wat);
  runTool('wasm-as', [watFile, '--mvp-features', '-o', wasmFile], {
    cwd: directory,
    failureCode: guestLink.diagnosticCodes.invalid,
    failureMessage: 'G2 primary proof module could not be assembled.'
  });
  return Object.freeze({ watFile, wasmFile, bytes: fs.readFileSync(wasmFile) });
}

function targetDescriptor() {
  return Object.freeze({
    finalWasmPolicy: defineFinalWasmPolicy({
      version: FINAL_WASM_POLICY_VERSION,
      descriptorOwner: '@pulse-compute/provider-node',
      toolchainVersion: 'pulse.provider-toolchain.v1',
      descriptorIdentity: 'node-native-es256-g2-proof',
      permittedImports: [],
      requiredExports: [
        { name: 'memory', kind: 'memory' },
        { name: 'pulse_crypto_es256_verify', kind: 'function' },
        { name: 'pulse_g2_es256_verify_frame', kind: 'function' },
        { name: 'pulse_g2_primary_marker', kind: 'function' }
      ]
    })
  });
}

function manifestContext(primaryBytes, nativeOptimization) {
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifest = guestLink.normalizeGuestUnitManifest(JSON.parse(manifestBytes));
  const contribution = normalizeGuestUnitContribution({
    version: GUEST_UNIT_CONTRIBUTION_VERSION,
    id: manifest.id,
    manifest: `./${manifestRelative}`
  }, {
    owner: manifest.owner,
    packageVersion: manifest.packageVersion
  });
  const selection = Object.freeze({ ...contribution, packageRoot });
  const stageSelection = Object.freeze({ contribution, packageRoot });
  const resolved = Object.freeze({
    packageRoot,
    manifestFile: manifestRelative,
    manifest,
    manifestSha256: sha256(manifestBytes)
  });
  const plan = makeGuestUnitPlan(stageSelection, resolved, {
    finalWasmPolicy: targetDescriptor().finalWasmPolicy,
    profile: 'native',
    optimizationPosture: nativeOptimization ? 'native-size' : 'native-default'
  }, primaryBytes);
  return Object.freeze({ manifestBytes, manifest, selection, resolved, plan });
}

function realize(options) {
  return guestLink.realizeGuestLinkPlan({
    plan: options.plan,
    packageRoot: options.packageRoot || packageRoot,
    manifestFile: manifestRelative,
    projectRoot: options.projectRoot,
    synchronizedPackages: options.synchronizedPackages || synchronizedCatalog().packages,
    primaryFile: options.primaryFile,
    memoryOwnerFile: options.memoryOwnerFile,
    outputDirectory: options.outputDirectory,
    optimizationPosture: options.plan.optimization.posture
  });
}

function headerValues(overrides = {}, dataLength = 6) {
  return {
    magic: FRAME_MAGIC,
    version: 2,
    headerLength: HEADER_BYTES,
    totalLength: align16(192 + dataLength),
    algorithm: 1,
    flags: 0,
    signingInputOffset: 192,
    signingInputLength: dataLength,
    publicKeyOffset: 64,
    publicKeyLength: 64,
    signatureOffset: 128,
    signatureLength: 64,
    reserved0: 0,
    reserved1: 0,
    reserved2: 0,
    reserved3: 0,
    ...overrides
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
  'reserved3'
]);

function writeFrame(memory, vector) {
  const frame = new Uint8Array(memory.buffer, FRAME_POINTER, FRAME_CAPACITY);
  frame.fill(0);
  const values = headerValues(vector.header, vector.data.length);
  const view = new DataView(memory.buffer, FRAME_POINTER, FRAME_CAPACITY);
  HEADER_FIELDS.forEach((name, index) => view.setUint32(index * 4, values[name] >>> 0, true));
  frame.set(vector.key, values.publicKeyOffset);
  frame.set(vector.signature, values.signatureOffset);
  frame.set(vector.data, values.signingInputOffset);
  return Buffer.from(frame);
}

function runtimeCases() {
  const key = Buffer.from(RFC_PUBLIC, 'hex');
  const signature = Buffer.from(RFC_SIGNATURE, 'hex');
  return Object.freeze([
    Object.freeze({
      id: 'valid-rfc6979-sample',
      key,
      signature,
      data: Buffer.from('sample'),
      expected: STATUS.valid
    }),
    Object.freeze({
      id: 'invalid-authenticator',
      key,
      signature,
      data: Buffer.from('samplf'),
      expected: STATUS.invalidAuthenticator
    }),
    Object.freeze({
      id: 'invalid-public-key',
      key: Buffer.alloc(64),
      signature,
      data: Buffer.from('sample'),
      expected: STATUS.invalidKey
    }),
    Object.freeze({
      id: 'malformed-signature-scalar',
      key,
      signature: Buffer.concat([Buffer.alloc(32), signature.subarray(32)]),
      data: Buffer.from('sample'),
      expected: STATUS.invalidInput
    }),
    Object.freeze({
      id: 'malformed-frame-magic',
      key,
      signature,
      data: Buffer.from('sample'),
      header: Object.freeze({ magic: 0 }),
      expected: STATUS.invalidInput
    }),
    Object.freeze({
      id: 'outer-capacity-mismatch',
      key,
      signature,
      data: Buffer.from('sample'),
      capacity: FRAME_CAPACITY - 16,
      expected: STATUS.invalidInput
    }),
    Object.freeze({
      id: 'outer-pointer-misaligned',
      key,
      signature,
      data: Buffer.from('sample'),
      pointer: FRAME_POINTER + 1,
      expected: STATUS.invalidInput
    }),
    Object.freeze({
      id: 'outer-pointer-before-frame-without-dereference',
      key,
      signature,
      data: Buffer.from('sample'),
      pointer: 0,
      expected: STATUS.invalidInput
    })
  ]);
}

function executeArtifact(file, label) {
  const bytes = fs.readFileSync(file);
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {});
  const exports = instance.exports;
  assert.ok(exports.memory instanceof WebAssembly.Memory);
  assert.equal(exports.memory.buffer.byteLength, MEMORY_BYTES);
  assert.equal(typeof exports.pulse_g2_es256_verify_frame, 'function');
  assert.equal(typeof exports.pulse_crypto_es256_verify, 'function');
  assert.equal(typeof exports.pulse_g2_primary_marker, 'function');
  assert.equal(exports.pulse_g2_primary_marker() >>> 0, 0x534c_5550);
  const cases = [];
  for (const vector of runtimeCases()) {
    const before = writeFrame(exports.memory, vector);
    const pointer = vector.pointer === undefined ? FRAME_POINTER : vector.pointer;
    const capacity = vector.capacity === undefined ? FRAME_CAPACITY : vector.capacity;
    let primaryStatus;
    let directStatus;
    let trapped = false;
    try {
      primaryStatus = exports.pulse_g2_es256_verify_frame(pointer, capacity);
      directStatus = exports.pulse_crypto_es256_verify(pointer, capacity);
    } catch {
      trapped = true;
    }
    const after = Buffer.from(new Uint8Array(
      exports.memory.buffer,
      FRAME_POINTER,
      FRAME_CAPACITY
    ));
    assert.equal(trapped, false, `${label}:${vector.id}`);
    assert.equal(primaryStatus, vector.expected, `${label}:${vector.id}:primary`);
    assert.equal(directStatus, vector.expected, `${label}:${vector.id}:direct`);
    assert.deepEqual(after, before, `${label}:${vector.id}:frame-read-only`);
    new Uint8Array(exports.memory.buffer, FRAME_POINTER, FRAME_CAPACITY).fill(0);
    assert.equal(
      new Uint8Array(exports.memory.buffer, FRAME_POINTER, FRAME_CAPACITY)
        .every((value) => value === 0),
      true,
      `${label}:${vector.id}:caller-clear`
    );
    cases.push(Object.freeze({
      id: vector.id,
      expected: vector.expected,
      primaryStatus,
      directStatus,
      trapped,
      frameMutated: false,
      callerClearedCapacityBytes: FRAME_CAPACITY
    }));
  }
  return Object.freeze({
    artifact: fileRecord(file, label),
    validCoreWasm: WebAssembly.validate(bytes),
    imports: Object.freeze(WebAssembly.Module.imports(module)),
    exports: Object.freeze(WebAssembly.Module.exports(module)),
    fixedMemoryBytes: exports.memory.buffer.byteLength,
    cases: Object.freeze(cases),
    trapCount: 0,
    frameMutationCount: 0
  });
}

function semanticResults(runtime) {
  return runtime.cases.map((entry) => Object.freeze({
    id: entry.id,
    primaryStatus: entry.primaryStatus,
    directStatus: entry.directStatus,
    trapped: entry.trapped,
    frameMutated: entry.frameMutated
  }));
}

function compileNegativeWasm(directory, name, wat, features = ['--mvp-features']) {
  const watFile = path.join(directory, `${name}.wat`);
  const wasmFile = path.join(directory, `${name}.wasm`);
  fs.writeFileSync(watFile, wat);
  runTool('wasm-as', [watFile, ...features, '-o', wasmFile], {
    cwd: directory,
    failureCode: guestLink.diagnosticCodes.invalid,
    failureMessage: `${name} negative fixture could not be assembled.`
  });
  return wasmFile;
}

function normalizedFailure(id, expectedCodes, action) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${id} must fail`);
  assert.ok(expectedCodes.includes(error.code), `${id} emitted ${error.code}`);
  return Object.freeze({
    id,
    status: 'rejected',
    diagnostic: error.code,
    message: String(error.message),
    terminal: true,
    automaticFallbackAttempted: false
  });
}

function manifestFailure(results, sourceManifest, id, expectedCodes, mutate) {
  const input = clone(sourceManifest);
  mutate(input);
  results.push(normalizedFailure(id, expectedCodes, () => (
    guestLink.normalizeGuestUnitManifest(input)
  )));
}

function assertLayout(audit) {
  for (const stage of [
    audit.layout.beforeOptimization,
    audit.layout.afterOptimization
  ]) {
    assert.equal(stage.memoryIdentity, guestLink.versions.memoryAbiV2);
    assert.equal(stage.fixedMemory.pages, MEMORY_PAGES);
    assert.equal(stage.fixedMemory.growable, false);
    assert.equal(stage.occupiedAndReservedRangesPairwiseDisjoint, true);
    assert.equal(stage.staticSegmentsMatchValidatedInputs, true);
    assert.deepEqual(stage.ranges.map((entry) => entry.id), [
      'rust-stack',
      'rust-static-data',
      'primary-static-data',
      'private-invocation-frame-v2'
    ]);
    assert.deepEqual(stage.ranges.map(({ start, endExclusive }) => ({
      start,
      endExclusive
    })), [
      { start: 0, endExclusive: 65_536 },
      { start: 131_072, endExclusive: 262_144 },
      { start: 262_144, endExclusive: 524_288 },
      { start: FRAME_POINTER, endExclusive: FRAME_POINTER + FRAME_CAPACITY }
    ]);
    assert.equal(stage.fixedScratch.separateRange, false);
    assert.equal(stage.fixedScratch.location, 'rust-stack');
    assert.equal(stage.outputStatus.linearMemoryRange, null);
  }
}

function makeNegativeMatrix(inputs) {
  const results = [];
  const sourceManifest = JSON.parse(inputs.contexts.default.manifestBytes);
  manifestFailure(results, sourceManifest, 'wrong-owner', [
    guestLink.diagnosticCodes.ownerMismatch
  ], (value) => { value.owner = '@pulse-compute/jwt'; });
  manifestFailure(results, sourceManifest, 'wrong-package-version', [
    guestLink.diagnosticCodes.ownerMismatch
  ], (value) => { value.packageVersion = '0.2.1'; });
  manifestFailure(results, sourceManifest, 'wrong-unit-identity', [
    guestLink.diagnosticCodes.abiMismatch
  ], (value) => { value.id = 'pulse.crypto.es256.other.v1'; });
  manifestFailure(results, sourceManifest, 'wrong-artifact-size', [
    guestLink.diagnosticCodes.hashMismatch
  ], (value) => { value.artifact.bytes += 1; });
  manifestFailure(results, sourceManifest, 'wrong-artifact-hash', [
    guestLink.diagnosticCodes.hashMismatch
  ], (value) => { value.artifact.sha256 = '0'.repeat(64); });
  manifestFailure(results, sourceManifest, 'wrong-source-tree-hash', [
    guestLink.diagnosticCodes.hashMismatch
  ], (value) => {
    value.source.treeSha256 = '0'.repeat(64);
    value.provenance.sourceTreeSha256 = '0'.repeat(64);
  });
  manifestFailure(results, sourceManifest, 'unexpected-import', [
    guestLink.diagnosticCodes.importMismatch
  ], (value) => {
    value.imports.push({
      module: 'env',
      name: 'callback',
      kind: 'function',
      type: { parameters: [], results: [] }
    });
  });
  manifestFailure(results, sourceManifest, 'unexpected-export', [
    guestLink.diagnosticCodes.exportMismatch
  ], (value) => {
    value.exports.push({
      name: 'unexpected',
      kind: 'function',
      parameters: [],
      results: [],
      role: 'evidence-only'
    });
  });
  manifestFailure(results, sourceManifest, 'missing-abi-export', [
    guestLink.diagnosticCodes.exportMismatch
  ], (value) => { value.exports = []; });
  manifestFailure(results, sourceManifest, 'multiple-abi-exports', [
    guestLink.diagnosticCodes.exportMismatch
  ], (value) => { value.exports.push({ ...value.exports[0], name: 'second_abi' }); });
  manifestFailure(results, sourceManifest, 'extra-memory', [
    guestLink.diagnosticCodes.importMismatch
  ], (value) => { value.imports.push({ ...value.imports[0], name: 'memory2' }); });
  manifestFailure(results, sourceManifest, 'wrong-memory-limits', [
    guestLink.diagnosticCodes.importMismatch
  ], (value) => { value.imports[0].type.maximumPages = 33; });
  manifestFailure(results, sourceManifest, 'start-function', [
    guestLink.diagnosticCodes.startMismatch
  ], (value) => { value.start.policy = 'allowed'; });
  manifestFailure(results, sourceManifest, 'forbidden-features', [
    guestLink.diagnosticCodes.featureMismatch
  ], (value) => { value.features.required = ['simd']; });
  manifestFailure(results, sourceManifest, 'v1-v2-abi-mismatch', [
    guestLink.diagnosticCodes.memoryMismatch
  ], (value) => { value.memory.identity = guestLink.versions.memoryAbi; });
  manifestFailure(results, sourceManifest, 'toolchain-mismatch', [
    guestLink.diagnosticCodes.featureMismatch
  ], (value) => { value.toolchain.versions.binaryen = '129.0.0'; });
  manifestFailure(results, sourceManifest, 'manifest-executable-command', [
    guestLink.diagnosticCodes.invalid
  ], (value) => { value.command = 'cargo build'; });

  const framePlan = clone(inputs.contexts.default.plan);
  framePlan.unit.frame.capacityBytes -= 16;
  results.push(normalizedFailure('frame-capacity-mismatch', [
    guestLink.diagnosticCodes.abiMismatch
  ], () => guestLink.normalizeGuestUnitPlan(framePlan)));

  const posturePlan = clone(inputs.contexts.default.plan);
  posturePlan.optimization.posture = 'native-size';
  results.push(normalizedFailure('post-link-posture-mismatch', [
    guestLink.diagnosticCodes.optimizationFailed
  ], () => guestLink.normalizeGuestUnitPlan(posturePlan)));

  const fallbackPlan = clone(inputs.contexts.default.plan);
  fallbackPlan.fallback = {
    enabled: true,
    onFailure: 'try-alternate-realization'
  };
  results.push(normalizedFailure('selected-unit-failure-followed-by-fallback', [
    guestLink.diagnosticCodes.invalid
  ], () => guestLink.normalizeGuestUnitPlan(fallbackPlan)));

  const baseWat = (extra) => `(module
  (import "env" "memory" (memory 32 32))
  (func (export "pulse_crypto_es256_verify") (param i32 i32) (result i32)
    i32.const -2)
  ${extra}
)`;
  const binaryCases = [
    Object.freeze({
      id: 'extra-table-binary',
      wat: baseWat('(table 1 funcref)'),
      expected: guestLink.diagnosticCodes.memoryMismatch
    }),
    Object.freeze({
      id: 'memory-growth-binary',
      wat: baseWat('(func $grow i32.const 1 memory.grow drop)'),
      expected: guestLink.diagnosticCodes.memoryMismatch
    }),
    Object.freeze({
      id: 'start-function-binary',
      wat: baseWat('(func $start) (start $start)'),
      expected: guestLink.diagnosticCodes.startMismatch
    })
  ];
  for (const entry of binaryCases) {
    const file = compileNegativeWasm(inputs.negativeDirectory, entry.id, entry.wat);
    const inspection = inspectWasmFile(file, {
      label: entry.id,
      workDirectory: inputs.negativeDirectory
    });
    results.push(normalizedFailure(entry.id, [entry.expected], () => (
      assertGuestBinary(inputs.contexts.default.manifest, inspection)
    )));
  }

  const simdFile = compileNegativeWasm(
    inputs.negativeDirectory,
    'forbidden-feature-binary',
    baseWat('(func $simd (drop (v128.const i32x4 0 0 0 0)))'),
    ['--enable-simd']
  );
  results.push(normalizedFailure('forbidden-feature-binary', [
    guestLink.diagnosticCodes.featureMismatch
  ], () => inspectWasmFile(simdFile, {
    label: 'forbidden-feature-binary',
    workDirectory: inputs.negativeDirectory
  })));

  const copiedPackage = path.join(inputs.temporaryRoot, 'crypto-source-mismatch');
  fs.mkdirSync(copiedPackage);
  fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(copiedPackage, 'package.json'));
  fs.cpSync(
    path.join(packageRoot, 'guests'),
    path.join(copiedPackage, 'guests'),
    { recursive: true }
  );
  fs.appendFileSync(
    path.join(copiedPackage, 'guests', 'es256-rustcrypto', 'source', 'README.md'),
    '\nG2 negative source mutation.\n'
  );
  results.push(normalizedFailure('real-source-tree-mismatch', [
    guestLink.diagnosticCodes.hashMismatch
  ], () => realize({
    plan: inputs.contexts.default.plan,
    packageRoot: copiedPackage,
    projectRoot: path.join(inputs.temporaryRoot, 'source-mismatch-project'),
    primaryFile: inputs.primary.wasmFile,
    memoryOwnerFile: inputs.memoryOwner.file,
    outputDirectory: path.join(inputs.temporaryRoot, 'source-mismatch-output')
  })));

  results.push(normalizedFailure('synchronized-owner-version-mismatch', [
    guestLink.diagnosticCodes.ownerMismatch
  ], () => realize({
    plan: inputs.contexts.default.plan,
    projectRoot: path.join(inputs.temporaryRoot, 'owner-mismatch-project'),
    synchronizedPackages: [{ name: '@pulse-compute/crypto', version: '0.2.1' }],
    primaryFile: inputs.primary.wasmFile,
    memoryOwnerFile: inputs.memoryOwner.file,
    outputDirectory: path.join(inputs.temporaryRoot, 'owner-mismatch-output')
  })));

  const tamperedFinal = path.join(inputs.negativeDirectory, 'tampered-final.wasm');
  const tamperedBytes = fs.readFileSync(inputs.realizations.default.first.files.final);
  tamperedBytes[tamperedBytes.length - 1] ^= 1;
  fs.writeFileSync(tamperedFinal, tamperedBytes);
  results.push(normalizedFailure('post-link-audit-mismatch', [
    guestLink.diagnosticCodes.finalAuditFailed
  ], () => guestLink.assertFinalArtifactIdentity(
    tamperedFinal,
    inputs.realizations.default.first.audit
  )));

  return results;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  fs.rmSync(options.outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-es256-g2-'));
  try {
    const projectRoot = path.join(temporaryRoot, 'project');
    const negativeDirectory = path.join(temporaryRoot, 'negative');
    fs.mkdirSync(projectRoot);
    fs.mkdirSync(negativeDirectory);
    const primary = makePrimary(temporaryRoot);
    const memoryOwner = guestLink.writeMemoryOwnerModule(temporaryRoot);
    const catalog = synchronizedCatalog();
    const contexts = {};
    const realizations = {};
    const compilerStages = {};

    for (const [mode, nativeOptimization] of Object.entries(MODE_OPTIONS)) {
      const context = manifestContext(primary.bytes, nativeOptimization);
      contexts[mode] = context;
      const first = realize({
        plan: context.plan,
        projectRoot,
        primaryFile: primary.wasmFile,
        memoryOwnerFile: memoryOwner.file,
        outputDirectory: path.join(temporaryRoot, `${mode}-first`)
      });
      const replay = realize({
        plan: context.plan,
        projectRoot,
        primaryFile: primary.wasmFile,
        memoryOwnerFile: memoryOwner.file,
        outputDirectory: path.join(temporaryRoot, `${mode}-replay`)
      });
      assert.deepEqual(fs.readFileSync(first.files.final), fs.readFileSync(replay.files.final));
      assert.deepEqual(first.report, replay.report);
      assert.deepEqual(first.audit, replay.audit);
      assert.equal(first.report.fallback.enabled, false);
      assert.equal(first.report.fallback.used, false);
      assert.equal(first.audit.structure.imports.length, 0);
      assert.equal(first.audit.structure.definedMemories, 1);
      assert.equal(first.audit.structure.importedMemories, 0);
      assert.equal(first.audit.structure.hasStart, false);
      assert.equal(first.audit.structure.tables, 0);
      assert.deepEqual(first.audit.structure.features, []);
      assert.equal(first.audit.instructions.memoryGrow, 0);
      assert.equal(first.audit.instructions.callIndirect, 0);
      assertLayout(first.audit);
      guestLink.assertFinalArtifactIdentity(first.files.final, first.audit);
      realizations[mode] = Object.freeze({ first, replay });
      const compilerStage = realizeSelectedGuestUnits(
        Object.freeze({ wasm: primary.bytes, wat: '' }),
        [context.selection],
        {
          cwd: projectRoot,
          projectRoot,
          profile: 'native',
          nativeOptimization,
          targetDescriptor: targetDescriptor(),
          synchronizedPackages: catalog.packages
        }
      );
      assert.deepEqual(compilerStage.wasm, fs.readFileSync(first.files.final));
      assert.deepEqual(compilerStage.guestLink.plan, context.plan);
      assert.deepEqual(compilerStage.guestLink.report, first.report);
      assert.deepEqual(compilerStage.guestLink.audit, first.audit);
      assert.equal(compilerStage.guestLink.version, GUEST_LINK_STAGE_RESULT_VERSION);
      compilerStages[mode] = Object.freeze({
        version: compilerStage.guestLink.version,
        finalArtifact: compilerStage.guestLink.finalArtifact,
        providerPackaging: compilerStage.guestLink.providerPackaging,
        matchesDirectPrivatePipeline: true
      });
    }

    assert.equal(realizations.default.first.materialization.reused, false);
    assert.equal(realizations.default.replay.materialization.reused, true);
    assert.equal(realizations.experimentalNativeSize.first.materialization.reused, true);
    assert.equal(realizations.experimentalNativeSize.replay.materialization.reused, true);
    assert.deepEqual(
      fs.readFileSync(realizations.default.first.files.composed),
      fs.readFileSync(realizations.experimentalNativeSize.first.files.composed)
    );

    const materializedDirectory = path.join(
      projectRoot,
      contexts.default.plan.materialization.directory
    );
    const materializedArtifact = path.join(materializedDirectory, 'unit.wasm');
    const materializedManifest = path.join(materializedDirectory, 'unit.json');
    assert.deepEqual(fs.readFileSync(materializedArtifact), fs.readFileSync(
      path.join(packageRoot, manifestRelative, '..', contexts.default.manifest.artifact.file)
    ));
    const materializedBytes = Object.freeze({
      artifact: fs.readFileSync(materializedArtifact),
      manifest: fs.readFileSync(materializedManifest)
    });

    const cacheFailures = [];
    const corrupt = fs.readFileSync(materializedArtifact);
    corrupt[corrupt.length - 1] ^= 1;
    fs.writeFileSync(materializedArtifact, corrupt);
    cacheFailures.push(normalizedFailure('corrupted-materialized-artifact', [
      guestLink.diagnosticCodes.materializationFailed
    ], () => realize({
      plan: contexts.default.plan,
      projectRoot,
      primaryFile: primary.wasmFile,
      memoryOwnerFile: memoryOwner.file,
      outputDirectory: path.join(temporaryRoot, 'corrupt-materialization')
    })));

    fs.rmSync(materializedDirectory, { recursive: true, force: true });
    const rematerialized = realize({
      plan: contexts.default.plan,
      projectRoot,
      primaryFile: primary.wasmFile,
      memoryOwnerFile: memoryOwner.file,
      outputDirectory: path.join(temporaryRoot, 'rematerialized')
    });
    assert.equal(rematerialized.materialization.reused, false);
    assert.deepEqual(fs.readFileSync(materializedArtifact), materializedBytes.artifact);
    assert.deepEqual(fs.readFileSync(materializedManifest), materializedBytes.manifest);
    assert.deepEqual(
      fs.readFileSync(rematerialized.files.final),
      fs.readFileSync(realizations.default.first.files.final)
    );

    fs.rmSync(materializedArtifact);
    cacheFailures.push(normalizedFailure('deleted-materialized-artifact', [
      guestLink.diagnosticCodes.materializationFailed
    ], () => realize({
      plan: contexts.default.plan,
      projectRoot,
      primaryFile: primary.wasmFile,
      memoryOwnerFile: memoryOwner.file,
      outputDirectory: path.join(temporaryRoot, 'missing-materialized-artifact')
    })));
    fs.rmSync(materializedDirectory, { recursive: true, force: true });
    const recreatedAfterMissing = realize({
      plan: contexts.default.plan,
      projectRoot,
      primaryFile: primary.wasmFile,
      memoryOwnerFile: memoryOwner.file,
      outputDirectory: path.join(temporaryRoot, 'recreated-after-missing')
    });
    assert.equal(recreatedAfterMissing.materialization.reused, false);
    assert.deepEqual(fs.readFileSync(materializedArtifact), materializedBytes.artifact);

    const runtime = {};
    for (const mode of Object.keys(MODE_OPTIONS)) {
      const result = realizations[mode].first;
      runtime[mode] = Object.freeze({
        beforeOptimization: executeArtifact(
          result.files.composed,
          `${mode}/before-optimization`
        ),
        afterOptimization: executeArtifact(
          result.files.final,
          `${mode}/after-optimization`
        )
      });
      assert.deepEqual(
        semanticResults(runtime[mode].beforeOptimization),
        semanticResults(runtime[mode].afterOptimization)
      );
    }
    assert.deepEqual(
      semanticResults(runtime.default.afterOptimization),
      semanticResults(runtime.experimentalNativeSize.afterOptimization)
    );

    const negativeMatrix = [
      ...makeNegativeMatrix({
        temporaryRoot,
        negativeDirectory,
        projectRoot,
        primary,
        memoryOwner,
        contexts,
        realizations
      }),
      ...cacheFailures
    ];
    assert.equal(new Set(negativeMatrix.map((entry) => entry.id)).size, negativeMatrix.length);
    assert.equal(negativeMatrix.every((entry) => (
      entry.status === 'rejected'
      && entry.terminal
      && !entry.automaticFallbackAttempted
    )), true);

    const finalArtifacts = {};
    const composedArtifacts = {};
    for (const mode of Object.keys(MODE_OPTIONS)) {
      const finalFile = path.join(options.outputDirectory, `es256-node-native.${mode}.wasm`);
      const composedFile = path.join(
        options.outputDirectory,
        `es256-node-native.${mode}.before-optimization.wasm`
      );
      fs.copyFileSync(realizations[mode].first.files.final, finalFile);
      fs.copyFileSync(realizations[mode].first.files.composed, composedFile);
      finalArtifacts[mode] = fileRecord(finalFile);
      composedArtifacts[mode] = fileRecord(composedFile);
    }

    const planReport = Object.freeze({
      version: 'pulse.es256-guest-unit-plan.g2.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      selectedFirstPartyUnit: Object.freeze({
        id: contexts.default.manifest.id,
        owner: contexts.default.manifest.owner,
        packageVersion: contexts.default.manifest.packageVersion,
        origin: contexts.default.manifest.origin,
        reviewedArtifact: contexts.default.manifest.artifact,
        sourceBuildDuringCompilation: false
      }),
      synchronizedCatalog: catalog,
      modes: Object.freeze({
        default: contexts.default.plan,
        experimentalNativeSize: contexts.experimentalNativeSize.plan
      }),
      publicConfiguration: false,
      jwtActivation: false,
      nextAuthorizedStage: 'G3'
    });
    const planRecord = writeReport(
      options.outputDirectory,
      'es256-guest-unit-plan.json',
      planReport
    );

    const materializationReport = Object.freeze({
      version: 'pulse.es256-materialization-report.g2.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      directory: contexts.default.plan.materialization.directory,
      contentAddress: contexts.default.manifest.artifact.sha256,
      files: Object.freeze({
        artifact: {
          bytes: materializedBytes.artifact.length,
          sha256: sha256(materializedBytes.artifact)
        },
        manifest: {
          bytes: materializedBytes.manifest.length,
          sha256: sha256(materializedBytes.manifest)
        }
      }),
      lifecycle: Object.freeze({
        first: 'created',
        replay: 'reused',
        directoryDeletion: 'deterministically-rematerialized',
        corruptArtifact: 'terminal-rejection',
        missingArtifactInsideExistingAddress: 'terminal-rejection',
        deleteWholeAddressThenRecreate: 'passed'
      }),
      trust: contexts.default.plan.trust,
      synchronizedCatalog: catalog,
      sourceBuildInvocations: 0,
      fallback: Object.freeze({ enabled: false, attempted: false }),
      failures: Object.freeze(cacheFailures)
    });
    const materializationRecord = writeReport(
      options.outputDirectory,
      'es256-materialization-report.json',
      materializationReport
    );

    const linkReport = Object.freeze({
      version: 'pulse.es256-link-report.g2.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      modes: Object.freeze({
        default: realizations.default.first.report,
        experimentalNativeSize: realizations.experimentalNativeSize.first.report
      }),
      artifacts: Object.freeze({
        composed: Object.freeze(composedArtifacts),
        final: Object.freeze(finalArtifacts)
      }),
      compilerGuestUnitStage: Object.freeze(compilerStages),
      exactReviewedGuestPresent: true,
      unresolvedImports: 0,
      deterministicReplay: true,
      preOptimizationBytesEqualAcrossModes: true,
      fallback: Object.freeze({ enabled: false, attempted: false })
    });
    const linkRecord = writeReport(
      options.outputDirectory,
      'es256-link-report.json',
      linkReport
    );

    const finalAuditReport = Object.freeze({
      version: 'pulse.es256-final-wasm-audit.g2.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      modes: Object.freeze({
        default: realizations.default.first.audit,
        experimentalNativeSize: realizations.experimentalNativeSize.first.audit
      }),
      semanticParity: true,
      exactArtifactIdentityVerifiedAfterAudit: true,
      memoryProofRepeatedBeforeAndAfterOptimization: true,
      memoryProofRepeatedAcrossModes: true
    });
    const finalAuditRecord = writeReport(
      options.outputDirectory,
      'es256-final-wasm-audit.json',
      finalAuditReport
    );

    const nodeRealityReport = Object.freeze({
      version: 'pulse.es256-node-native-reality.g2.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      modes: Object.freeze(runtime),
      proof: Object.freeze({
        validInvalidAndMalformedFramesExecuted: true,
        frameValidationBeforeDereference: true,
        prePostOptimizationBehaviorEqual: true,
        defaultAndExperimentalNativeSizeBehaviorEqual: true,
        callerClearedCapacityAfterEveryCall: true,
        trapCount: 0,
        frameMutationCount: 0
      })
    });
    const nodeRealityRecord = writeReport(
      options.outputDirectory,
      'es256-node-native-reality.json',
      nodeRealityReport
    );

    assert.deepEqual(CRYPTO_ALGORITHMS, ['HS256', 'ES256']);
    const cryptoPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
    assert.equal(Object.keys(cryptoPackage.exports).some((entry) => (
      /(?:es256|guest|frame)/i.test(entry)
    )), false);
    const evidence = Object.freeze({
      version: 'pulse.jwt-g2-evidence.v1',
      stage: STAGE,
      status: 'PASS',
      observedAt: OBSERVED_AT,
      exactReviewedPrebuilt: contexts.default.manifest.artifact,
      synchronizedCatalog: catalog,
      outputs: Object.freeze({
        plan: planRecord,
        materialization: materializationRecord,
        link: linkRecord,
        finalAudit: finalAuditRecord,
        nodeNativeReality: nodeRealityRecord,
        composedArtifacts: Object.freeze(composedArtifacts),
        finalArtifacts: Object.freeze(finalArtifacts)
      }),
      acceptance: Object.freeze([
        'selected-reviewed-package-prebuilt',
        'synchronized-first-party-trust',
        'content-addressed-materialization',
        'no-source-build-during-compilation',
        'pinned-binaryen-static-link',
        'whole-module-post-link-optimization',
        'exact-final-artifact-audit',
        'one-fixed-memory-no-start-no-unexpected-imports',
        'pairwise-non-overlap-before-and-after-optimization',
        'default-and-experimental-native-size-semantic-parity',
        'node-native-valid-invalid-malformed-reality',
        'deterministic-replay-and-rematerialization',
        'terminal-diagnostics-without-fallback',
        'v1-contract-preserved',
        'no-public-frame-or-link-configuration',
        'g3-activation-not-started'
      ].map((id) => Object.freeze({ id, status: 'passed' }))),
      negativeIntegrationMatrix: Object.freeze(negativeMatrix),
      boundary: Object.freeze({
        cryptoExecutableAlgorithms: CRYPTO_ALGORITHMS,
        es256Executable: false,
        jwtCompositionChanged: false,
        providerPackagingInvoked: false,
        publicGuestApi: false,
        automaticFallback: false,
        nextAuthorizedStage: 'G3'
      })
    });
    const evidenceRecord = writeReport(
      options.outputDirectory,
      'jwt-g2-evidence.json',
      evidence
    );

    console.log(
      `ok - G2 linked exact ES256 guest; default ${finalArtifacts.default.sha256}, ` +
      `size ${finalArtifacts.experimentalNativeSize.sha256}, evidence ${evidenceRecord.sha256}`
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
