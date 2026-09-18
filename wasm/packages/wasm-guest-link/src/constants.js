'use strict';

const versions = Object.freeze({
  guestUnit: 'pulse.guest-unit.v1',
  guestUnitV2: 'pulse.guest-unit.v2',
  guestUnitPlan: 'pulse.guest-unit-plan.v1',
  guestUnitPlanV2: 'pulse.guest-unit-plan.v2',
  guestLinkReport: 'pulse.guest-link-report.v1',
  guestLinkReportV2: 'pulse.guest-link-report.v2',
  finalWasmAudit: 'pulse.final-wasm-audit.v1',
  finalWasmAuditV2: 'pulse.final-wasm-audit.v2',
  memoryAbi: 'pulse.guest-memory.borrowed-span.v1',
  memoryAbiV2: 'pulse.guest-memory.invocation-frame.v2'
});

const binaryenVersion = '129.0.0-nightly.20260428';

const diagnosticCodes = Object.freeze({
  invalid: 'PULSE_GUEST_UNIT_INVALID',
  hashMismatch: 'PULSE_GUEST_UNIT_HASH_MISMATCH',
  ownerMismatch: 'PULSE_GUEST_UNIT_OWNER_MISMATCH',
  abiMismatch: 'PULSE_GUEST_UNIT_ABI_MISMATCH',
  importMismatch: 'PULSE_GUEST_UNIT_IMPORT_MISMATCH',
  exportMismatch: 'PULSE_GUEST_UNIT_EXPORT_MISMATCH',
  memoryMismatch: 'PULSE_GUEST_UNIT_MEMORY_MISMATCH',
  startMismatch: 'PULSE_GUEST_UNIT_START_MISMATCH',
  featureMismatch: 'PULSE_GUEST_UNIT_FEATURE_MISMATCH',
  materializationFailed: 'PULSE_GUEST_UNIT_MATERIALIZATION_FAILED',
  linkFailed: 'PULSE_GUEST_LINK_FAILED',
  optimizationFailed: 'PULSE_GUEST_OPTIMIZATION_FAILED',
  finalAuditFailed: 'PULSE_GUEST_FINAL_AUDIT_FAILED'
});

const memoryAbi = Object.freeze({
  identity: versions.memoryAbi,
  pointerWidthBits: 32,
  pageBytes: 65536,
  minimumPages: 32,
  maximumPages: 32,
  bytes: 32 * 65536,
  maximumBorrowedBytes: 4096,
  invalidRangeStatus: 0x8000_0000,
  importModule: 'env',
  importName: 'memory',
  layout: Object.freeze({
    rustStack: Object.freeze({ start: 0, endExclusive: 65536 }),
    rustStatic: Object.freeze({ start: 131072, endExclusive: 262144 }),
    primaryStatic: Object.freeze({ start: 262144, endExclusive: 524288 }),
    borrowedInput: Object.freeze({ start: 524288, endExclusive: 32 * 65536 })
  })
});

const es256FrameV2 = Object.freeze({
  identity: 'pulse.crypto.es256.invocation-frame.v2',
  memoryIdentity: versions.memoryAbiV2,
  pointerWidthBits: 32,
  byteOrder: 'little-endian',
  magic: 0x3253_4550,
  version: 2,
  headerBytes: 64,
  capacityBytes: 16640,
  alignmentBytes: 16,
  signingInputBytesMaximum: 16340,
  publicKeyBytes: 64,
  signatureBytes: 64,
  export: 'pulse_crypto_es256_verify',
  parameters: Object.freeze(['i32', 'i32']),
  results: Object.freeze(['i32'])
});

const memoryAbiV2 = Object.freeze({
  identity: versions.memoryAbiV2,
  pointerWidthBits: 32,
  pageBytes: 65536,
  minimumPages: 32,
  maximumPages: 32,
  bytes: 32 * 65536,
  importModule: 'env',
  importName: 'memory',
  layout: Object.freeze({
    rustStack: Object.freeze({ start: 0, endExclusive: 65536 }),
    stackStaticGuard: Object.freeze({ start: 65536, endExclusive: 131072 }),
    rustStatic: Object.freeze({ start: 131072, endExclusive: 262144 }),
    primaryStatic: Object.freeze({ start: 262144, endExclusive: 524288 }),
    invocationFrame: Object.freeze({
      start: 524288,
      endExclusive: 524288 + es256FrameV2.capacityBytes
    }),
    unallocated: Object.freeze({
      start: 524288 + es256FrameV2.capacityBytes,
      endExclusive: 32 * 65536
    })
  }),
  frame: es256FrameV2
});

const es256GuestUnit = Object.freeze({
  version: versions.guestUnitV2,
  id: 'pulse.crypto.es256.rustcrypto-p256.v1',
  module: 'pulse_crypto_es256',
  owner: '@pulse-compute/crypto',
  packageVersion: '1.0.0-beta.5',
  abi: 'pulse.crypto.es256-rs256.verify-and-sign.v3',
  artifact: Object.freeze({
    file: 'prebuilt/es256-verifier.wasm',
    bytes: 36378,
    sha256: 'b1d09f10fddf7587cb9e87f959fa908457e076e207db078fc101390c70e4aecf'
  }),
  source: Object.freeze({
    directory: 'source',
    treeSha256: '581fa765f228bd1a3ab6a40ee3cbb35a9d7a101e2839d32e36ececc94b66a741'
  }),
  toolchain: Object.freeze({
    rustc: '1.97.1 (8bab26f4f 2026-07-14)',
    cargo: '1.97.1 (c980f4866 2026-06-30)',
    zig: '0.13.0',
    binaryen: binaryenVersion
  }),
  provenance: Object.freeze({
    cargoLockSha256: 'd5ecc12c9c846468686974aaed841156cc82ab8f876fec4d40b2baa29dff1551',
    reconstructionCommandIdentity: 'pulse.crypto.es256-rs256.build.v3',
    buildScript: 'build.cjs',
    buildScriptSha256: '2de6dddb40ce2a89965e900afc636c6a532639ec6fb7d1b163c2764428f15a55',
    optimizationPosture: 'native-size',
    binaryenWasmOptSha256: '1304eb38ad315a0d70d8427757f641c110d972468c126af645ef800b09c26e56',
    g0SourceDecision: '../../../../wasm/.test-results/jwt-g0/es256-source-decision.json',
    g0SourceDecisionSha256: '58db9e3587ace112a8864c7916f603d8773dce653deafb7d743c0dc1f4d62d63'
  })
});

const optimizationPostures = Object.freeze({
  'native-default': Object.freeze([
    '--mvp-features',
    '--optimize-level',
    '2',
    '--shrink-level',
    '0',
    '--strip-debug'
  ]),
  'native-size': Object.freeze([
    '--mvp-features',
    '--optimize-level',
    '3',
    '--shrink-level',
    '2',
    '--converge',
    '--strip-debug'
  ])
});

module.exports = Object.freeze({
  versions,
  binaryenVersion,
  diagnosticCodes,
  memoryAbi,
  memoryAbiV2,
  es256FrameV2,
  es256GuestUnit,
  optimizationPostures
});
