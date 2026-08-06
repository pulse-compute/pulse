'use strict';

const {
  normalizeTargetSupportDeclaration
} = require('@pulse-compute/wasm-contracts/project/target-support-evidence');
const { NODE_JAVASCRIPT_TARGET_DESCRIPTOR } = require('./target.js');

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

const NODE_JAVASCRIPT_PARITY_EVIDENCE = evidence(
  'wasm/test/contracts/assert-node-router-context-parity.cjs',
  'pulse.node-router-context-parity.v1',
  12
);
const NODE_JAVASCRIPT_EFFECT_ADAPTER_EVIDENCE = evidence(
  'wasm/test/contracts/assert-javascript-effect-adapter.cjs',
  'pulse.javascript-effect-adapter.v1',
  13
);
const NODE_JAVASCRIPT_FETCH_BODY_EVIDENCE = evidence(
  'wasm/test/contracts/assert-fetch-projections-request-bodies.cjs',
  'pulse.fetch-projections-request-bodies.v1',
  12
);
const NODE_JAVASCRIPT_BINDINGS_REDACTION_EVIDENCE = evidence(
  'wasm/test/contracts/assert-config-secrets-kv-redaction.cjs',
  'pulse.config-secrets-kv-redaction.v1',
  10
);
const NODE_JAVASCRIPT_ASSETS_EVIDENCE = evidence(
  'packages/assets/test/javascript-runtime.test.ts',
  'pulse.assets-javascript-realization.v1',
  4
);
const NODE_JAVASCRIPT_PACKAGE_PARITY_EVIDENCE = evidence(
  'wasm/test/contracts/assert-package-reachability.cjs',
  'pulse.package-capability-parity.v1',
  1
);
const NODE_JAVASCRIPT_SCHEMA_CODEC_EVIDENCE = evidence(
  'wasm/test/contracts/assert-schema-codecs.cjs',
  'pulse.schema-codecs.v1',
  4
);
const NODE_JAVASCRIPT_CROSS_TARGET_CONFORMANCE_EVIDENCE = evidence(
  'wasm/test/contracts/assert-node-cross-target-conformance.cjs',
  'pulse.node-cross-target-conformance.v1',
  37
);
const NODE_JAVASCRIPT_GRIP_EVIDENCE = evidence(
  'wasm/test/contracts/assert-grip-cross-target-conformance.cjs',
  'pulse.grip-cross-target-conformance.v1',
  35
);

function gate(id, reasonId, owner, summary, evidenceReference) {
  return Object.freeze({
    id,
    status: 'satisfied',
    reasonId,
    owner,
    summary,
    evidence: evidenceReference || null
  });
}

const GATES = Object.freeze([
  gate(
    'core-router-context',
    'node-router-context-parity',
    'provider-node',
    'The graph-backed loader, Node request/response lifecycle, project test/dev lane, and Router/context wire behavior agree across Native and JavaScript.',
    NODE_JAVASCRIPT_PARITY_EVIDENCE
  ),
  gate(
    'shared-effect-adapter',
    'javascript-effect-adapter',
    'runtime',
    'One request-owned JavaScript effect adapter implements explicit keyed parallel execution without changing implicit Native grouping.',
    NODE_JAVASCRIPT_EFFECT_ADAPTER_EVIDENCE
  ),
  gate(
    'fetch-projections-request-bodies',
    'fetch-projections-request-bodies',
    'runtime',
    'Fetch normalization, bounded body projections, timeout propagation, and direct response pass-through are implemented.',
    NODE_JAVASCRIPT_FETCH_BODY_EVIDENCE
  ),
  gate(
    'bindings-redaction',
    'config-secrets-kv-redaction',
    'provider-node',
    'Config, secret, and KV effects share provider-neutral value contracts with request-owned redaction.',
    NODE_JAVASCRIPT_BINDINGS_REDACTION_EVIDENCE
  ),
  gate(
    'assets-package',
    'assets-javascript-realization',
    'assets',
    'Assets has a request-bound JavaScript realization and provider-owned response handling.',
    NODE_JAVASCRIPT_ASSETS_EVIDENCE
  ),
  gate(
    'package-capability-parity',
    'package-capability-parity',
    'compiler',
    'Canonical package roots, package effects, and provider requirements agree across supported targets.',
    NODE_JAVASCRIPT_PACKAGE_PARITY_EVIDENCE
  ),
  gate(
    'build-source-packaging',
    'node-javascript-source-packaging',
    'provider-node',
    'Node JavaScript builds emit deterministic executable source packages with explicit dependencies and no Native fallback.',
    NODE_JAVASCRIPT_PACKAGE_PARITY_EVIDENCE
  ),
  gate(
    'normalized-semantic-trace',
    'normalized-semantic-trace',
    'schema-json',
    'All schema JSON boundaries emit a normalized redaction-safe semantic trace.',
    NODE_JAVASCRIPT_SCHEMA_CODEC_EVIDENCE
  ),
  gate(
    'schema-validation-policy',
    'schema-validation-policy',
    'schema-json',
    'The pulse.schema registry drives strict policy and generated JavaScript and Native codecs.',
    NODE_JAVASCRIPT_SCHEMA_CODEC_EVIDENCE
  ),
  gate(
    'cross-target-conformance',
    'node-cross-target-conformance',
    'provider-node',
    'A shared corpus and drift comparator enforce JavaScript and Native semantic parity.',
    NODE_JAVASCRIPT_CROSS_TARGET_CONFORMANCE_EVIDENCE
  ),
  gate(
    'grip-readiness',
    'grip-cross-target-conformance',
    'grip',
    'Stateless GRIP framing and provider broadcast agree across JavaScript, Native Node, and Fastly.',
    NODE_JAVASCRIPT_GRIP_EVIDENCE
  ),
  gate(
    'target-integrity',
    'javascript-target-integrity',
    'provider-node',
    'JavaScript packaging and conformance preserve explicit target identity without Native artifacts or automatic fallback.',
    NODE_JAVASCRIPT_CROSS_TARGET_CONFORMANCE_EVIDENCE
  )
]);

const COMMANDS = Object.freeze([
  ['build', 'provider-node'],
  ['compile', 'compiler'],
  ['dev', 'provider-node'],
  ['doctor', 'cli'],
  ['inspect', 'cli'],
  ['test', 'provider-node']
].map(([id, owner]) => Object.freeze({
  id,
  implemented: true,
  status: 'eligible',
  reasonId: `${id}-implemented`,
  owner
})));

const NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION = normalizeTargetSupportDeclaration({
  provider: 'node',
  target: 'javascript',
  targetId: NODE_JAVASCRIPT_TARGET_DESCRIPTOR.targetId,
  runtimeClass: NODE_JAVASCRIPT_TARGET_DESCRIPTOR.runtimeClass,
  definition: 'full-target-support',
  coreExecutionReady: true,
  fullTargetSupportReady: true,
  generalAvailable: true,
  automaticFallback: false,
  parity: NODE_JAVASCRIPT_PARITY_EVIDENCE,
  commands: COMMANDS,
  gates: GATES
});

module.exports = Object.freeze({
  NODE_JAVASCRIPT_PARITY_EVIDENCE,
  NODE_JAVASCRIPT_EFFECT_ADAPTER_EVIDENCE,
  NODE_JAVASCRIPT_FETCH_BODY_EVIDENCE,
  NODE_JAVASCRIPT_BINDINGS_REDACTION_EVIDENCE,
  NODE_JAVASCRIPT_ASSETS_EVIDENCE,
  NODE_JAVASCRIPT_PACKAGE_PARITY_EVIDENCE,
  NODE_JAVASCRIPT_SCHEMA_CODEC_EVIDENCE,
  NODE_JAVASCRIPT_CROSS_TARGET_CONFORMANCE_EVIDENCE,
  NODE_JAVASCRIPT_GRIP_EVIDENCE,
  NODE_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
});
