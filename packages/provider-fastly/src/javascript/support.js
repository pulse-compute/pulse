'use strict';

const {
  normalizeTargetSupportDeclaration
} = require('@pulse-compute/wasm-contracts/project/target-support-evidence');
const { FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR } = require('./target.js');

function evidence(artifact, version, cases) {
  return Object.freeze({
    artifact,
    version,
    sha256: null,
    status: 'passed',
    cases,
    matched: cases,
    mismatches: 0
  });
}

function gate(id, status, reasonId, owner, summary, evidenceReference = null) {
  return Object.freeze({ id, status, reasonId, owner, summary, evidence: evidenceReference });
}

const FASTLY_JAVASCRIPT_SOURCE_PACKAGE_EVIDENCE = evidence(
  'wasm/test/provider/assert-fastly-javascript-packaging.cjs',
  'pulse.fastly-javascript-source-package-evidence.v1',
  14
);

const FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE = evidence(
  'wasm/test/provider/assert-fastly-javascript-runtime.cjs',
  'pulse.fastly-javascript-runtime-evidence.v1',
  27
);

const FASTLY_JAVASCRIPT_TOOLING_EVIDENCE = evidence(
  'wasm/test/provider/assert-fastly-javascript-tooling.cjs',
  'pulse.fastly-javascript-tooling-evidence.v1',
  6
);

const FASTLY_JAVASCRIPT_FOUR_MODE_EVIDENCE = evidence(
  'wasm/test/contracts/assert-four-mode-conformance.cjs',
  'pulse.four-mode-conformance.v1',
  24
);

const FASTLY_JAVASCRIPT_RELEASE_CANDIDATE_EVIDENCE = evidence(
  'scripts/offline-release-candidates.cjs',
  'pulse.offline-deployment-candidates.v1',
  2
);

const GATES = Object.freeze([
  gate(
    'build-source-packaging',
    'satisfied',
    'fastly-javascript-source-packaging',
    'provider-fastly',
    'Fastly JavaScript builds emit deterministic source closures with exact downstream toolchain pins and no Pulse Native artifact.',
    FASTLY_JAVASCRIPT_SOURCE_PACKAGE_EVIDENCE
  ),
  gate(
    'provider-request-runtime',
    'satisfied',
    'fastly-javascript-request-runtime',
    'provider-fastly',
    'Fastly FetchEvent requests execute through the shared Router/context runtime with request-contained provider failures and cleanup.',
    FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE
  ),
  gate(
    'provider-capabilities-packages-redaction',
    'satisfied',
    'fastly-javascript-capabilities',
    'provider-fastly',
    'Fetch, Config Store, Secret Store, KV Store, Assets, GRIP broadcast, logging, and request-owned redaction have provider adapters.',
    FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE
  ),
  gate(
    'representative-local-tooling',
    'satisfied',
    'fastly-javascript-representative-tooling',
    'provider-fastly',
    'Representative pulse test and pulse dev use explicit provider emulation, while deterministic build output forms a structurally deployable Fastly JavaScript candidate.',
    FASTLY_JAVASCRIPT_TOOLING_EVIDENCE
  ),
  gate(
    'four-mode-conformance',
    'satisfied',
    'fastly-javascript-four-mode-conformance',
    'conformance',
    'Node Native, Node JavaScript, Fastly Native, and Fastly JavaScript agree across normalized semantic traces with target-integrity and negative-control evidence.',
    FASTLY_JAVASCRIPT_FOUR_MODE_EVIDENCE
  ),
  gate(
    'offline-deployment-candidates',
    'satisfied',
    'fastly-javascript-offline-deployment-candidate',
    'release',
    'Two clean source-package builds agree byte-for-byte and the pinned downstream Fastly compiler emits a structurally deployable JavaScript runtime candidate without deployment or publication.',
    FASTLY_JAVASCRIPT_RELEASE_CANDIDATE_EVIDENCE
  )
]);

const COMMANDS = Object.freeze([
  ['build', true, 'eligible', 'build-implemented', 'provider-fastly'],
  ['compile', true, 'eligible', 'compile-implemented', 'compiler'],
  ['dev', true, 'eligible', 'fastly-javascript-dev-implemented', 'provider-fastly'],
  ['doctor', true, 'eligible', 'doctor-implemented', 'cli'],
  ['inspect', true, 'eligible', 'inspect-implemented', 'cli'],
  ['test', true, 'eligible', 'fastly-javascript-test-implemented', 'provider-fastly']
].map(([id, implemented, status, reasonId, owner]) => Object.freeze({
  id,
  implemented,
  status,
  reasonId,
  owner
})));

const FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION = normalizeTargetSupportDeclaration({
  provider: 'fastly',
  target: 'javascript',
  targetId: FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.targetId,
  runtimeClass: FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR.runtimeClass,
  definition: 'full-target-support',
  coreExecutionReady: true,
  fullTargetSupportReady: true,
  generalAvailable: true,
  automaticFallback: false,
  parity: FASTLY_JAVASCRIPT_FOUR_MODE_EVIDENCE,
  commands: COMMANDS,
  gates: GATES
});

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_SOURCE_PACKAGE_EVIDENCE,
  FASTLY_JAVASCRIPT_RUNTIME_EVIDENCE,
  FASTLY_JAVASCRIPT_TOOLING_EVIDENCE,
  FASTLY_JAVASCRIPT_FOUR_MODE_EVIDENCE,
  FASTLY_JAVASCRIPT_RELEASE_CANDIDATE_EVIDENCE,
  FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
});
