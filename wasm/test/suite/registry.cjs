'use strict';

const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..', '..');
const node = process.execPath;

function nodeTask(file, options = {}) {
  return Object.freeze({
    command: node,
    args: [path.join(wasmRoot, file), ...(options.args || [])],
    timeoutMs: options.timeoutMs || 30000,
    evidence: options.evidence || 'unit',
    description: options.description || file,
    isolatedArtifacts: options.isolatedArtifacts === true
  });
}

function vitestTask(files, options = {}) {
  const vitest = path.join(path.dirname(require.resolve('vitest')), 'vitest.mjs');
  return Object.freeze({
    command: node,
    args: [vitest, 'run', '--root', path.resolve(wasmRoot, '..'), ...files],
    timeoutMs: options.timeoutMs || 120000,
    evidence: options.evidence || 'javascript',
    description: options.description || files.join(', '),
    isolatedArtifacts: false
  });
}

const tasks = Object.freeze({
  'suite-shape': nodeTask('test/suite/assert-suite-shape.cjs', {
    description: 'profile separation, uniqueness, and timeout budgets'
  }),
  'test-orchestration': nodeTask('test/suite/assert-test-orchestration.cjs', {
    description: 'atomic reports, deterministic slicing, timeouts, and descendant cleanup'
  }),
  'package-exports': nodeTask('test/assert-package-exports.cjs', {
    description: 'workspace package export smoke'
  }),
  boundaries: nodeTask('test/assert-boundaries.cjs', {
    description: 'workspace layout and import boundaries'
  }),
  'workspace-hygiene': nodeTask('test/assert-workspace-hygiene.cjs', {
    description: 'package-manager and workspace hygiene'
  }),
  'hidden-contracts': nodeTask('test/assert-hidden-contracts.cjs', {
    description: 'hidden contract literal scanner'
  }),
  'boundary-authority-h0': nodeTask('test/contracts/assert-boundary-authority-h0.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'frozen pre-Entities compiler/package/guest/provider boundary authority inventory'
  }),
  'boundary-authority-h1': nodeTask('test/contracts/assert-boundary-authority-h1.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'exact immutable package contribution and canonical-operation boundary lock'
  }),
  'boundary-authority-h2': nodeTask('test/contracts/assert-boundary-authority-h2.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'guest-link-owned exact invocation, final-artifact authorization, and no-fallback boundary lock'
  }),
  'boundary-authority-h3': nodeTask('test/contracts/assert-boundary-authority-h3.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'exact provider toolchain, target invocation/result, capability truth, and import boundary lock'
  }),
  'boundary-authority-h4': nodeTask('test/contracts/assert-boundary-authority-h4.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'aligned Crypto/JWT/provider/public type boundary and completed pre-Entities boundary lock'
  }),
  'boundary-negative-h5': nodeTask('test/contracts/assert-boundary-negative-h5.cjs', {
    evidence: 'external',
    timeoutMs: 240000,
    isolatedArtifacts: true,
    description: 'mutation-proven negative matrix for exact protected boundaries and Entities schema bridge guardrails'
  }),
  'boundary-authority-h5': nodeTask('test/contracts/assert-boundary-authority-h5.cjs', {
    evidence: 'external',
    timeoutMs: 3600000,
    isolatedArtifacts: true,
    description: 'focused boundary replay, reference-consumer conformance, and final pre-Entities seal'
  }),
  'api-surface': nodeTask('test/api/assert-api-surface.cjs', {
    description: 'provider-neutral TypeScript API and fixture type surface'
  }),
  'logging-contract': nodeTask('test/contracts/assert-logging-contract.cjs', {
    evidence: 'unit',
    description: 'logging levels, ABI, reporting resolution, and public surfaces'
  }),
  's3-design-contract': nodeTask('test/s3/assert-s3-design-contract.cjs', {
    description: 'S3 draft types, canonical input seam, exact key/body/signing vectors and bounded envelopes'
  }),
  'kv-conditional-runtime': nodeTask('test/kv/assert-kv-conditional-runtime.cjs', {
    description: 'K2 production conditional KV types, wire bounds, snapshots and outcome contracts'
  }),
  'kv-conditional-conformance': nodeTask('test/kv/assert-kv-conditional-conformance.cjs', {
    evidence: 'conformance', timeoutMs: 180000,
    description: 'K2 JavaScript, compiled Native and canonical reference races, token transport and dispatch lifecycle'
  }),
  'kv-conditional-adversarial': nodeTask('test/kv/run-k4-consumer.cjs', {
    evidence: 'conformance', timeoutMs: 180000,
    description: 'K4 project consumers: concurrent requests, retained tombstones, ABA and acknowledgement loss'
  }),
  'kv-conditional-gates': nodeTask('test/kv/assert-k4-gates.cjs', {
    description: 'K4 executable requirement and deployed evidence identity, location and uncertainty gates'
  }),
  'kv-conditional-acceptance': nodeTask('test/kv/assert-k4-acceptance.cjs', {
    evidence: 'external', timeoutMs: 1200000,
    description: 'K4 exact packed consumers and mandatory Fastly CLI/Viceroy execution; no availability skip'
  }),
  'kv-design-contract': nodeTask('test/kv/assert-kv-design-contract.cjs', {
    description: 'K1 conditional KV draft types, opaque generations, wire format, races and dispatch uncertainty'
  }),
  'kv-native-abi-feasibility': nodeTask('test/kv/assert-kv-native-abi-feasibility.cjs', {
    evidence: 'native',
    description: 'K1 compiled Wasm ABI probe for exact 64-bit generation and conditional insert options; no provider acceptance'
  }),
  's3-read-contract': nodeTask('test/s3/assert-s3-read-contract.cjs', {
    description: 'S3 read binding authority, lowering negatives and bounded result contract'
  }),
  's3-write-contract': nodeTask('test/s3/assert-s3-write-contract.cjs', {
    description: 'S3 PUT lowering, bounded outcomes, JavaScript Crypto bytes and pre-dispatch lifecycle'
  }),
  's3-write-conformance': nodeTask('test/s3/run-write-acceptance.cjs', {
    timeoutMs: 180000,
    description: 'Canonical PUT/HEAD/GET, ambiguous writes and cancellation on Node Native/JavaScript and Fastly Native'
  }),
  's3-native-read': nodeTask('test/s3/run-native-read-acceptance.cjs', {
    timeoutMs: 180000,
    description: 'Exact HEAD/GET failure parity through Node Native/JavaScript and Fastly Native'
  }),
  's3-node-transport': nodeTask('test/s3/assert-node-transport.cjs', {
    description: 'Node S3 TLS wire byte fidelity, raw header duplicates, redirects and abort'
  }),
  'crypto-config-planning': nodeTask('test/crypto/assert-crypto-config-planning.cjs', {
    evidence: 'unit',
    timeoutMs: 180000,
    description: 'crypto profile replacement, reachable requirements, and deterministic target realization planning'
  }),
  'crypto-digest-text-contract': nodeTask('test/crypto/assert-digest-text-contract.cjs', {
    description: 'Exact-text digest admission, bounded failures, unavailable providers and cancellation'
  }),
  'crypto-digest-text-conformance': nodeTask('test/crypto/assert-digest-text-conformance.cjs', {
    timeoutMs: 180000,
    evidence: 'conformance',
    description: 'Public exact-text SHA-256 vectors and byte bounds on four target/provider combinations'
  }),
  'crypto-digest-storage-conformance': nodeTask('test/crypto/assert-digest-storage-conformance.cjs', {
    timeoutMs: 180000,
    evidence: 'conformance',
    description: 'Pre-upload digest, S3 receipt and exact readback including schema-encoded text'
  }),
  'multifile-source-identity': nodeTask('test/crypto/assert-multifile-source-identity.cjs', {
    timeoutMs: 180000,
    evidence: 'conformance',
    description: 'Source-qualified effect and intrinsic identity, duplicate rejection and three-target multifile routing'
  }),
  'text-capacity-conformance': nodeTask('test/crypto/assert-text-capacity.cjs', {
    timeoutMs: 180000,
    evidence: 'conformance',
    description: '2 MiB schema/storage boundaries, lower bindings, streamed failures and bounded Native memory'
  }),

  'reachable-graph': nodeTask('test/contracts/assert-reachable-graph-contract.cjs', {
    evidence: 'unit',
    timeoutMs: 120000,
    description: 'deterministic path-independent reachable graph'
  }),
  'project-modules': nodeTask('test/contracts/assert-project-modules.cjs', {
    evidence: 'unit',
    timeoutMs: 180000,
    description: 'recursive modules, handlers, Routers, cycles, and diagnostics'
  }),
  'package-reachability': nodeTask('test/contracts/assert-package-reachability.cjs', {
    evidence: 'unit',
    timeoutMs: 240000,
    description: 'graph-selected package operations and native eligibility'
  }),
  'target-support': nodeTask('test/contracts/assert-target-support.cjs', {
    evidence: 'javascript',
    description: 'complete explicit Node JavaScript target support'
  }),
  'jwt-javascript-admission': nodeTask('test/jwt/assert-jwt-javascript-admission.cjs', {
    evidence: 'javascript',
    timeoutMs: 180000,
    description: 'JWT source admission, provider requirements and HS256/ES256 consumer execution'
  }),
  'provider-toolchain': nodeTask('test/contracts/assert-provider-toolchain-boundary.cjs', {
    evidence: 'unit',
    description: 'exact compiler-to-provider toolchain invocation and result boundary'
  }),
  'crypto-runtime-builtin': vitestTask([
    path.join(wasmRoot, '..', 'packages/crypto/test/contract.test.ts'),
    path.join(wasmRoot, '..', 'packages/crypto/test/runtime-builtin.test.ts')
  ], {
    evidence: 'javascript',
    description: 'bounded HS256 verification through the selected Web Crypto runtime builtin'
  }),
  'crypto-native-guest-source': nodeTask('test/crypto/assert-crypto-native-guest-source.cjs', {
    evidence: 'native',
    timeoutMs: 240000,
    description: 'bounded first-party AssemblyScript HS256 in the selected primary Native module'
  }),
  'crypto-cross-target-conformance': nodeTask('test/crypto/assert-crypto-cross-target-conformance.cjs', {
    evidence: 'conformance',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'shared HS256 corpus across Web Crypto and optimized Native guest source'
  }),
  'crypto-verification-seal': nodeTask('test/crypto/assert-crypto-phase-c-seal.cjs', {
    evidence: 'external',
    timeoutMs: 900000,
    isolatedArtifacts: true,
    description: 'Phase C crypto contract, shared conformance, real Fastly execution, redaction, impact, and deferred-work seal'
  }),
  'jwt-realization-integration': nodeTask('test/jwt/assert-jwt-realization-integration.cjs', {
    evidence: 'external',
    timeoutMs: 900000,
    isolatedArtifacts: true,
    description: 'exact JavaScript runtime-builtin and Native guest-source JWT realization integration'
  }),
  'jwt-d-seal': nodeTask('test/jwt/assert-jwt-phase-d-seal.cjs', {
    evidence: 'external',
    timeoutMs: 1200000,
    isolatedArtifacts: true,
    description: 'focused JWT API, semantics, composition, realization, redaction, and no-fallback Phase D seal'
  }),
  'jwt-native-reality': nodeTask('test/jwt/assert-jwt-native-reality.cjs', {
    evidence: 'external',
    timeoutMs: 1200000,
    isolatedArtifacts: true,
    description: 'shared JWT corpus through Local and real Fastly Native guest-source artifacts'
  }),
  'jwt-fail-closed-audit': nodeTask('test/jwt/assert-jwt-fail-closed-audit.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'JWT fail-closed order, redaction, error taxonomy, and exact-realization no-fallback audit'
  }),
  'jwt-e-seal': nodeTask('test/jwt/assert-jwt-phase-e-seal.cjs', {
    evidence: 'external',
    timeoutMs: 2400000,
    isolatedArtifacts: true,
    description: 'four-cell JWT corpus, focused and aggregate suites, artifact impact, report audit, and Phase E seal'
  }),
  'jwt-evidence-consolidation': nodeTask('test/jwt/assert-jwt-evidence-consolidation.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'A-E evidence hashes, current contracts, working-candidate identity, and frozen-release boundary'
  }),
  'jwt-impact-hardening': nodeTask('test/jwt/assert-jwt-impact-hardening.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'measured JavaScript, Native, guest-link, timing, dependency, and owned production-hardening assessment'
  }),
  'jwt-guest-link-suitability': nodeTask('test/jwt/assert-jwt-guest-link-production-suitability.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'A-E guest-link memory, reproducibility, privacy, and production-suitability reassessment'
  }),
  'jwt-asymmetric-recommendation': nodeTask('test/jwt/assert-jwt-asymmetric-algorithm-recommendation.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'equal-criteria ES256, RS256, and Ed25519 recommendation across five targets'
  }),
  'jwt-final-proof-seal': nodeTask('test/jwt/assert-jwt-final-proof-seal.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'A-F artifact, target, realization, memory, impact, version, and handoff seal'
  }),
  'jwt-es256-contract-freeze': nodeTask('test/jwt/assert-jwt-es256-contract-freeze.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'G0 exact ES256 source closure, dependency probe, private frame, guest, crypto, and JWT contract freeze'
  }),
  'crypto-es256-guest': nodeTask('test/crypto/assert-crypto-es256-guest.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'G1 exact standalone ES256 guest, frame validation, vector corpus, memory audit, and package prebuilt'
  }),
  'crypto-es256-guest-link': nodeTask('test/crypto/assert-crypto-es256-guest-link.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'G2 exact ES256 guest planning, materialization, static link, memory audit, Node reality, and fail-closed diagnostics'
  }),
  'jwt-es256-composition': nodeTask('test/jwt/assert-jwt-es256-composition.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'G3 crypto-owned ES256 composition, bounded JWK/JWKS normalization, shared corpus, Native execution, and fail-closed evidence'
  }),
  'jwt-es256-cross-target': nodeTask('test/jwt/assert-jwt-es256-cross-target.cjs', {
    evidence: 'external',
    timeoutMs: 2400000,
    isolatedArtifacts: true,
    description: 'G4 shared ES256 corpus across Node JavaScript and exact default/size Node/Fastly Native artifacts under an inspected Fastly local execution engine'
  }),
  'jwt-es256-six-cell': nodeTask('test/jwt/assert-jwt-es256-six-cell.cjs', {
    evidence: 'external',
    timeoutMs: 3000000,
    isolatedArtifacts: true,
    description: 'H4 frozen ES256 corpus across Node/Fastly JavaScript and exact default/size Node/Fastly Native artifacts'
  }),
  'jwt-es256-final-seal': nodeTask('test/jwt/assert-jwt-es256-final-seal.cjs', {
    evidence: 'external',
    timeoutMs: 7200000,
    isolatedArtifacts: true,
    description: 'G5 ES256 source reproduction, final memory and artifact audit, hardening ledger, aggregate validation, and independent readiness seal'
  }),
  'node-router-context-parity': nodeTask('test/contracts/assert-node-router-context-parity.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'native and JavaScript Node HTTP-boundary parity'
  }),
  'catalog-router-parity': nodeTask('test/contracts/assert-catalog-router-parity.cjs', {
    evidence: 'conformance',
    timeoutMs: 300000,
    description: 'Catalog original verb probe and 14 mutation routes across Node/Fastly Native/JavaScript'
  }),
  'javascript-effect-adapter': nodeTask('test/contracts/assert-javascript-effect-adapter.cjs', {
    evidence: 'javascript',
    timeoutMs: 180000,
    description: 'request-owned JavaScript effects and keyed parallelism'
  }),
  'fetch-projections-request-bodies': nodeTask('test/contracts/assert-fetch-projections-request-bodies.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'bounded fetch projections and request body ownership'
  }),
  'config-secrets-kv-redaction': nodeTask('test/contracts/assert-config-secrets-kv-redaction.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'binding isolation and secret-safe observations'
  }),
  'schema-registry': nodeTask('test/contracts/assert-schema-registry.cjs', {
    evidence: 'unit',
    timeoutMs: 120000,
    description: 'pulse.schema registry and semantic trace contracts'
  }),
  'schema-codecs': nodeTask('test/contracts/assert-schema-codecs.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'cross-target rich schema codecs and four JSON boundaries'
  }),
  'schema-kv-parity': nodeTask('test/contracts/assert-schema-kv-parity.cjs', {
    evidence: 'conformance',
    timeoutMs: 240000,
    description: 'strict schema and conditional KV public consumer parity'
  }),
  'time-consumer': nodeTask('test/contracts/assert-time-consumer.cjs', {
    evidence: 'conformance', timeoutMs: 240000,
    description: 'public time package consumer, target inspection and builds'
  }),
  'time-conformance': nodeTask('test/contracts/assert-time-conformance.cjs', {
    evidence: 'conformance', timeoutMs: 120000,
    description: 'provider-owned wall time, UTC, failures and four-mode parity'
  }),
  'application-errors': nodeTask('test/contracts/assert-application-errors.cjs', {
    evidence: 'conformance', timeoutMs: 240000,
    description: 'public schema and JWT application error recovery across targets'
  }),
  'application-error-boundaries': nodeTask('test/runtime/assert-application-error-boundaries.cjs', {
    evidence: 'conformance', timeoutMs: 120000,
    description: 'Native failed continuation settlement and terminal failure boundaries'
  }),
  'node-cross-target-conformance': nodeTask('test/contracts/assert-node-cross-target-conformance.cjs', {
    evidence: 'conformance',
    timeoutMs: 240000,
    description: 'Node native and JavaScript semantic conformance corpus'
  }),
  'grip-cross-target-conformance': nodeTask('test/contracts/assert-grip-cross-target-conformance.cjs', {
    evidence: 'conformance',
    timeoutMs: 300000,
    description: 'GRIP framing and broadcast conformance corpus'
  }),
  'four-mode-conformance': nodeTask('test/contracts/assert-four-mode-conformance.cjs', {
    evidence: 'conformance',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'Node/Fastly Native/JavaScript semantic parity and target integrity'
  }),
  'assets-javascript-runtime': vitestTask([
    path.join(wasmRoot, '..', 'packages/assets/test/javascript-runtime.test.ts'),
    path.join(wasmRoot, '..', 'packages/jwt/test/provider-runtime.test.ts'),
    path.join(wasmRoot, '..', 'packages/runtime/test/package-runtime.test.ts')
  ], {
    evidence: 'javascript',
    description: 'request-bound package bridges and Assets/JWT JavaScript runtime'
  }),
  'logging-runtime': nodeTask('test/contracts/assert-logging-runtime.cjs', {
    evidence: 'javascript',
    description: 'synchronous JavaScript logging threshold, redaction, and containment'
  }),

  'canonical-api-lowering': nodeTask('test/lowering/assert-canonical-api-lowering.cjs', {
    evidence: 'native',
    description: 'canonical application continuation lowering'
  }),
  'canonical-native-plan': nodeTask('test/lowering/assert-canonical-native-plan.cjs', {
    evidence: 'native',
    timeoutMs: 60000,
    description: 'deterministic provider-neutral native plan'
  }),
  'bounded-app-logic': nodeTask('test/lowering/assert-bounded-app-logic.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'literal-capped pure loops, string trim, target parity and pre-write failure containment'
  }),
  'logging-lowering': nodeTask('test/lowering/assert-logging-lowering.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    description: 'Native logging pruning, hashing, host ABI, and execution'
  }),
  'canonical-router-lowering': nodeTask('test/lowering/assert-canonical-router-lowering.cjs', {
    evidence: 'native',
    timeoutMs: 180000,
    description: 'mounted Router topology and continuation lowering'
  }),
  'canonical-router-terminal-middleware': nodeTask('test/lowering/assert-canonical-router-terminal-middleware.cjs', {
    evidence: 'native',
    timeoutMs: 240000,
    description: 'terminal middleware and error-lane convergence'
  }),
  'json-as-compatibility': nodeTask('test/lowering/assert-json-as-compatibility.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    description: 'pinned json-as transform and Pulse semantic guards'
  }),
  'entities-envelope-feasibility': nodeTask('test/entities/assert-entities-envelope-feasibility.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    description: 'I0 bounded raw-envelope, terminal intrinsic, and first-party embedded schema-codec architecture freeze'
  }),
  'events-contract-feasibility': nodeTask('test/events/assert-events-contract-feasibility.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'repository-only event normalization and conditional Native entry evidence'
  }),
  'events-static-topology': nodeTask('test/events/assert-events-static-topology.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'root-only static Pulse event extraction, canonical handler identity, deterministic catalog, and fail-closed source shapes'
  }),
  'events-javascript-runtime': nodeTask('test/events/assert-events-javascript-runtime.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'transport-free schema-bound JavaScript event execution, exact selection, isolated context, containment, and HTTP non-regression'
  }),
  'events-emit-javascript': nodeTask('test/events/assert-events-emit-javascript.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'schema-bound one-way JavaScript ctx.emit effects, bounded acceptance, parallelism, redaction, cancellation, and no-loopback evidence'
  }),
  'events-native-runtime': nodeTask('test/events/assert-events-native-runtime.cjs', {
    evidence: 'external',
    timeoutMs: 240000,
    isolatedArtifacts: true,
    description: 'provider-neutral Native event dispatcher, schema payload handles, effect resume, conditional ABI, and event-only/mixed artifact evidence'
  }),
  'events-node-reference': nodeTask('test/events/assert-events-node-reference.cjs', {
    evidence: 'external',
    timeoutMs: 240000,
    isolatedArtifacts: true,
    description: 'Node JavaScript/Native event ingress and acceptance parity, FIFO bounds, cancellation, failure categories, isolation, and no-loopback evidence'
  }),
  'events-conformance': nodeTask('test/events/assert-events-conformance.cjs', {
    evidence: 'conformance',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'canonical event corpus across Node JavaScript and Native covering bounded ingress, emit acceptance, containment, isolation, completion, and the absent reflexive call surface'
  }),
  'events-cli-workflow': nodeTask('test/events/assert-events-cli-workflow.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    isolatedArtifacts: true,
    description: 'event-aware project harness, inspection, packaging, Node JavaScript/Native workflow, and exact Fastly fail-closed eligibility'
  }),
  'events-candidate-seal': nodeTask('test/events/assert-events-candidate-seal.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'EV9 event-facing packages, deterministic tarballs, offline clean consumer, documentation, and blocker seal'
  }),
  'entities-contracts': nodeTask('test/entities/assert-entities-contracts.cjs', {
    evidence: 'unit',
    description: 'Entities versions, bounded normalizers, deterministic identities, and trusted compile-time package boundary'
  }),
  'entities-schema-bridge': nodeTask('test/entities/assert-entities-schema-bridge.cjs', {
    evidence: 'unit',
    timeoutMs: 120000,
    description: 'I3 request-bound declared-schema codec bridge, immutable values, semantic traces, and negative authority surface'
  }),
  'entities-javascript-runtime': vitestTask([
    path.join(wasmRoot, '..', 'packages/entities/test/javascript-runtime.test.ts')
  ], {
    evidence: 'javascript',
    description: 'I4 real package dispatch, JSON-RPC framing, redaction, notification acknowledgement, and catalog identity'
  }),
  'entities-json-rpc-corpus': nodeTask('test/entities/assert-entities-json-rpc-corpus.cjs', {
    evidence: 'unit',
    description: 'I4 production scanner parity with the frozen bounded positive and negative envelope corpus'
  }),
  'entities-package-owned-lowering': nodeTask('test/entities/assert-entities-package-owned-lowering.cjs', {
    evidence: 'unit',
    description: 'I2 first-party static extraction, terminal intrinsic, schema linkage, and fail-closed lowerer boundary'
  }),
  'entities-catalog': nodeTask('test/entities/assert-entities-catalog.cjs', {
    evidence: 'unit',
    description: 'deterministic entity catalog, eligible-target truth, and current product status'
  }),
  'entities-inspection': nodeTask('test/entities/assert-entities-inspection.cjs', {
    evidence: 'unit',
    timeoutMs: 120000,
    description: 'canonical project and pulse inspect declarations, redacted handler effects, I9 target evidence, and deterministic build artifacts'
  }),
  'entities-orchestration-demo': nodeTask('test/entities/assert-entities-orchestration-demo.cjs', {
    evidence: 'unit',
    timeoutMs: 180000,
    description: 'I10 external tools facade over static catalog discovery, governed JSON-RPC calls, backend fetch, and Native artifact inspection'
  }),
  'entities-cross-target': nodeTask('test/entities/assert-entities-cross-target.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'I9 shared Entities corpus across Node/Fastly JavaScript/Native under pinned Viceroy'
  }),
  'entities-candidate-seal': nodeTask('test/entities/assert-entities-candidate-seal.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'I11 unassigned candidate package, tarball, clean-consumer, deterministic-catalog, legal/dependency, and blocker seal'
  }),
  'entities-managed-handler': nodeTask('test/entities/assert-entities-managed-handler.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    description: 'I5 reachable pure managed-handler IR, schema-bound input/result adoption, and fail-closed source diagnostics'
  }),
  'entities-managed-handler-effects': vitestTask([
    path.join(wasmRoot, 'test/entities/managed-handler-effects.test.ts')
  ], {
    evidence: 'native',
    description: 'I6 reachable managed-handler effects, package operations, exact provider requirements, and selected Node execution'
  }),
  'entities-native-runtime': nodeTask('test/entities/assert-entities-native-runtime.cjs', {
    evidence: 'native',
    timeoutMs: 180000,
    description: 'I7 package-owned bounded Native scanner, schema codecs, static dispatcher, managed effects, exact framing, and zero JavaScript fallback'
  }),
  'guest-link-package': nodeTask('test/guest-link/assert-guest-link-package.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'production guest-unit validation, materialization, composition, optimization, and audit'
  }),
  'guest-link-materialization-stage': nodeTask('test/guest-link/assert-b2-materialization-stage.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'guest-link-owned synchronized unit planning, lazy materialization, and fail-closed final handoff'
  }),
  'guest-link-audit-diagnostics': nodeTask('test/guest-link/assert-b3-audit-diagnostics.cjs', {
    evidence: 'native',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'secret-safe guest-link provenance plus stable hard-failure diagnostic matrix'
  }),
  'guest-link-b-seal': nodeTask('test/guest-link/assert-phase-b-seal.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'Phase B aggregate replay, exact Node/Fastly reality, release membership, documentation, and impact seal'
  }),
  'assets-lowering-plan': nodeTask('test/assert-assets-lowering-plan.cjs', {
    evidence: 'native',
    description: 'Assets facade lowering plan'
  }),
  'assets-package-owned-lowering': nodeTask('test/assets/assert-assets-package-owned-lowering.cjs', {
    evidence: 'native',
    description: 'Assets package-owned lowerer'
  }),
  'grip-package-owned-lowering': nodeTask('test/library/assert-grip-package-owned-lowering.cjs', {
    evidence: 'native',
    description: 'GRIP package-owned lowerer'
  }),
  'jwt-package-owned-lowering': nodeTask('test/jwt/assert-jwt-package-owned-lowering.cjs', {
    evidence: 'native',
    description: 'JWT package-owned lowerer, provider requirements, and crypto demand'
  }),

  'continuation-registry': nodeTask('test/runtime/assert-continuation-registry.cjs', {
    evidence: 'unit',
    description: 'continuation state, expiry, and resume guards'
  }),
  'canonical-api-runtime': nodeTask('test/runtime/assert-canonical-api-runtime.cjs', {
    evidence: 'native',
    timeoutMs: 60000,
    description: 'canonical application runtime effects and continuations'
  }),
  'request-budget-transport': nodeTask('test/runtime/request-budget-transport.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'shared request deadline across S3 preparation and Node HTTP body admission'
  }),
  'http-input-outcomes': nodeTask('test/runtime/http-input-outcomes.cjs', {
    evidence: 'conformance',
    timeoutMs: 180000,
    description: 'strict bounded UTF-8 and buffered HTTP denial/uncertainty on selected adapters'
  }),
  'canonical-opaque-node-emission': nodeTask('test/runtime/assert-canonical-opaque-passthrough.cjs', {
    evidence: 'native',
    description: 'opaque body ownership and repeated Node headers'
  }),
  'grip-package-runtime': nodeTask('test/package/assert-grip-package-runtime.cjs', {
    evidence: 'native',
    timeoutMs: 240000,
    description: 'GRIP package build and canonical runtime'
  }),

  'cli-command-spec': nodeTask('test/cli/assert-cli-command-spec.cjs', {
    evidence: 'cli',
    description: 'public parser, help, aliases, and positionals'
  }),
  'cli-init-workflow': nodeTask('test/cli/assert-cli-init-workflow.cjs', {
    evidence: 'cli',
    timeoutMs: 300000,
    description: 'deterministic conventional project creation'
  }),
  'cli-project-workflow': nodeTask('test/cli/assert-cli-project-workflow.cjs', {
    evidence: 'cli',
    timeoutMs: 180000,
    description: 'doctor, test, inspect, compile, and build workflow'
  }),
  'cli-project-guards': nodeTask('test/cli/assert-cli-project-guards.cjs', {
    evidence: 'cli',
    timeoutMs: 180000,
    description: 'output containment, redaction, and provider truth guards'
  }),
  'cli-dev-workflow': nodeTask('test/cli/assert-cli-dev-workflow.cjs', {
    evidence: 'cli',
    timeoutMs: 60000,
    description: 'Node and Fastly development lifecycle'
  }),
  'cli-schema-json-workflow': nodeTask('test/cli/assert-cli-schema-json-workflow.cjs', {
    evidence: 'cli',
    timeoutMs: 180000,
    description: 'schema compile, execution, diagnostics, and reload'
  }),
  'cli-diagnostics': nodeTask('test/cli/assert-cli-diagnostics.cjs', {
    evidence: 'cli',
    timeoutMs: 120000,
    description: 'stable diagnostics, remediation, and exit policy'
  }),

  'provider-fastly-package': nodeTask('test/provider/assert-fastly-package.cjs', {
    evidence: 'providers',
    timeoutMs: 180000,
    description: 'Fastly package API and native target'
  }),
  'provider-packages': nodeTask('test/provider/assert-provider-packages.cjs', {
    evidence: 'providers',
    description: 'Node and Fastly driver shape, capability truth, and conformance import ownership'
  }),
  'provider-fastly-apps': nodeTask('test/provider/assert-fastly-apps.cjs', {
    evidence: 'providers',
    description: 'Fastly config, secret, KV, fetch, and redaction'
  }),
  'canonical-grip-fastly': nodeTask('test/provider/assert-fastly-grip-canonical.cjs', {
    evidence: 'providers',
    timeoutMs: 240000,
    description: 'canonical GRIP Fastly realization'
  }),
  'fastly-cli-gate-surface': nodeTask('test/provider/assert-fastly-cli-gate-surface.cjs', {
    evidence: 'providers',
    description: 'Fastly CLI discovery and compute delegation'
  }),
  'fastly-javascript-packaging': nodeTask('test/provider/assert-fastly-javascript-packaging.cjs', {
    evidence: 'providers',
    timeoutMs: 180000,
    description: 'deterministic target-correct Fastly JavaScript source package'
  }),
  'fastly-javascript-runtime': nodeTask('test/provider/assert-fastly-javascript-runtime.cjs', {
    evidence: 'providers',
    timeoutMs: 180000,
    description: 'Fastly JavaScript lifecycle, provider capabilities, package effects, and cleanup'
  }),
  'fastly-javascript-es256': nodeTask('test/provider/assert-fastly-javascript-es256.cjs', {
    evidence: 'external',
    timeoutMs: 600000,
    isolatedArtifacts: true,
    description: 'Fastly JavaScript Web Crypto ES256 corpus in generated runtime Wasm under Viceroy'
  }),
  'fastly-javascript-tooling': nodeTask('test/provider/assert-fastly-javascript-tooling.cjs', {
    evidence: 'providers',
    timeoutMs: 300000,
    description: 'truthful Fastly JavaScript CLI execution and deployment candidate'
  }),

  'package-root-native': nodeTask('test/compiled/assert-package-root-native.cjs', {
    evidence: 'native',
    timeoutMs: 240000,
    description: 'package-root Assets and keyed parallel native output'
  }),
  'canonical-native-wasm': nodeTask('test/compiled/assert-canonical-native-wasm.cjs', {
    evidence: 'native',
    timeoutMs: 180000,
    description: 'provider-neutral native compilation and host execution'
  }),
  'fastly-native-http-shell': nodeTask('test/provider/assert-fastly-native-http-shell.cjs', {
    evidence: 'providers',
    timeoutMs: 180000,
    description: 'direct Fastly HTTP request and response shell'
  }),
  'fastly-native-http-effects': nodeTask('test/provider/assert-fastly-native-http-effects.cjs', {
    evidence: 'providers',
    timeoutMs: 300000,
    description: 'Fastly outbound HTTP effects and continuations'
  }),
  'fastly-conditional-kv': nodeTask('test/provider/assert-fastly-conditional-kv.cjs', {
    evidence: 'conformance', timeoutMs: 180000,
    description: 'K3 actual Fastly Native conditional KV ABI, shared bytes, races, deadlines and uncertainty'
  }),
  'fastly-native-platform-capabilities': nodeTask('test/provider/assert-fastly-native-platform-capabilities.cjs', {
    evidence: 'providers',
    timeoutMs: 300000,
    description: 'Fastly Config, Secret, KV, and GRIP capabilities'
  }),

  'docs-executable-contracts': nodeTask('test/docs/assert-executable-documentation.cjs', {
    evidence: 'cli',
    timeoutMs: 240000,
    args: ['--section', 'contracts'],
    description: 'source-bound documentation contracts'
  }),
  'docs-executable-init-dev': nodeTask('test/docs/assert-executable-documentation.cjs', {
    evidence: 'cli',
    timeoutMs: 180000,
    args: ['--section', 'init-dev'],
    description: 'documented init and development lifecycle'
  }),
  'docs-migration-schema-lowering': nodeTask('test/docs/assert-migration-schema-lowering-docs.cjs', {
    evidence: 'cli',
    description: 'Express migration, schema/body ownership, and package-lowering documentation contracts'
  }),
  ...Object.fromEntries([
    ['01-hello-json', 180000],
    ['02-request-schema', 240000],
    ['03-fetch-composition', 180000],
    ['05-fastly-capabilities', 360000],
    ['07-opaque-proxy', 360000],
    ['09-router-lowering', 240000],
    ['10-entities-tools', 240000],
    ['11-events', 300000],
    ['12-mcp-proxy', 240000],
    ['13-jwt-es256', 300000]
  ].map(([name, timeoutMs]) => [
    `docs-example-${name}`,
    nodeTask('test/docs/assert-executable-documentation.cjs', {
      evidence: 'cli',
      timeoutMs,
      args: ['--example', name],
      description: `documented ${name} workflow`
    })
  ])),

  'release-packages': nodeTask('test/release/assert-release-packages.cjs', {
    evidence: 'release',
    timeoutMs: 240000,
    description: 'publishable package manifests and tarballs'
  }),
  'release-artifact-determinism': nodeTask('test/release/assert-artifact-determinism.cjs', {
    evidence: 'release',
    timeoutMs: 600000,
    description: 'byte-identical package and documentation artifacts'
  }),
  'clean-machine-acceptance': nodeTask('test/release/assert-clean-machine-acceptance.cjs', {
    evidence: 'release',
    timeoutMs: 900000,
    description: 'packed clean-consumer workflows'
  }),
  'release-evidence-authority': nodeTask('test/release/assert-release-evidence-authority.cjs', {
    evidence: 'release',
    timeoutMs: 30000,
    description: 'sixteen-shard aggregation and exact evidence boundary'
  }),
  'deployment-candidates': nodeTask('../scripts/offline-release-candidates.cjs', {
    evidence: 'release',
    timeoutMs: 600000,
    args: ['--replace'],
    description: 'deterministic offline Fastly Native and JavaScript deployment candidates'
  }),
  'guest-link-scalar-control': nodeTask('test/guest-link/assert-scalar-link-control.cjs', {
    evidence: 'external',
    timeoutMs: 120000,
    isolatedArtifacts: true,
    description: 'independently compiled Rust-to-AssemblyScript scalar link control'
  }),
  'guest-link-memory-matrix': nodeTask('test/guest-link/assert-memory-matrix.cjs', {
    evidence: 'external',
    timeoutMs: 180000,
    isolatedArtifacts: true,
    description: 'negative and single-owner Rust-to-AssemblyScript memory matrix'
  }),
  'guest-link-final-reality': nodeTask('test/guest-link/assert-final-artifact-reality.cjs', {
    evidence: 'external',
    timeoutMs: 360000,
    isolatedArtifacts: true,
    description: 'optimized guest-link audit and Node/Fastly target reality'
  }),
  'guest-link-feasibility-decision': nodeTask('test/guest-link/assert-phase-a-decision.cjs', {
    evidence: 'external',
    timeoutMs: 720000,
    isolatedArtifacts: true,
    description: 'evidence-bound guest-link Phase A decision and stop gate'
  }),
  'guest-link-contract-design': nodeTask('test/guest-link/assert-contract-design.cjs', {
    evidence: 'external',
    timeoutMs: 30000,
    isolatedArtifacts: true,
    description: 'repository-bound guest-unit contracts, ownership, and pipeline design'
  }),
  'provider-fastly-compute-reality': nodeTask('test/provider/assert-fastly-compute-reality.cjs', {
    evidence: 'external',
    timeoutMs: 300000,
    description: 'real Fastly Compute local execution'
  }),
  'release-runtime-policy': nodeTask('test/release/assert-release-runtime-policy.cjs', {
    evidence: 'unit',
    description: 'Node release-line acceptance and Fastly CLI lifecycle ownership'
  }),
  'cli-javascript-target-compilation': nodeTask('test/cli/assert-cli-javascript-target-compilation.cjs', {
    evidence: 'javascript',
    timeoutMs: 120000,
    description: 'explicit JavaScript target propagation, ordinary imports, source execution and Native rejection'
  })
});

const profiles = Object.freeze({
  unit: Object.freeze([
    'suite-shape',
    'test-orchestration',
    'package-exports',
    'boundaries',
    'workspace-hygiene',
    'hidden-contracts',
    'release-runtime-policy',
    'api-surface',
    'logging-contract',
    's3-design-contract',
    'kv-design-contract',
    'kv-conditional-runtime',
    'kv-conditional-gates',
    's3-read-contract',
    's3-write-contract',
    'crypto-config-planning',
    'crypto-digest-text-contract',
    'reachable-graph',
    'project-modules',
    'package-reachability',
    'provider-toolchain',
    'schema-registry',
    'continuation-registry',
    'entities-contracts',
    'entities-schema-bridge',
    'entities-javascript-runtime',
    'entities-json-rpc-corpus',
    'entities-package-owned-lowering',
    'entities-catalog',
    'entities-inspection',
    'entities-orchestration-demo'
  ]),
  native: Object.freeze([
    'kv-native-abi-feasibility',
    's3-native-read',
    's3-node-transport',
    'canonical-api-lowering',
    'canonical-native-plan',
    'bounded-app-logic',
    'logging-lowering',
    'canonical-router-lowering',
    'canonical-router-terminal-middleware',
    'json-as-compatibility',
    'entities-envelope-feasibility',
    'entities-managed-handler',
    'entities-managed-handler-effects',
    'entities-native-runtime',
    'crypto-native-guest-source',
    'guest-link-package',
    'guest-link-materialization-stage',
    'guest-link-audit-diagnostics',
    'assets-lowering-plan',
    'assets-package-owned-lowering',
    'grip-package-owned-lowering',
    'jwt-package-owned-lowering',
    'canonical-api-runtime',
    'canonical-opaque-node-emission',
    'grip-package-runtime',
    'package-root-native',
    'canonical-native-wasm'
  ]),
  javascript: Object.freeze([
    'cli-javascript-target-compilation',
    'target-support',
    'jwt-javascript-admission',
    'crypto-runtime-builtin',
    'javascript-effect-adapter',
    'logging-runtime',
    'assets-javascript-runtime'
  ]),
  conformance: Object.freeze([
    's3-write-conformance',
    'crypto-cross-target-conformance',
    'crypto-digest-text-conformance',
    'crypto-digest-storage-conformance',
    'multifile-source-identity',
    'text-capacity-conformance',
    'events-conformance',
    'node-router-context-parity',
    'catalog-router-parity',
    'fetch-projections-request-bodies',
    'config-secrets-kv-redaction',
    'kv-conditional-conformance',
    'kv-conditional-adversarial',
    'fastly-conditional-kv',
    'schema-codecs',
    'schema-kv-parity',
    'time-conformance',
    'time-consumer',
    'request-budget-transport',
    'http-input-outcomes',
    'application-errors',
    'application-error-boundaries',
    'node-cross-target-conformance',
    'grip-cross-target-conformance',
    'four-mode-conformance'
  ]),
  cli: Object.freeze([
    'cli-command-spec',
    'cli-init-workflow',
    'cli-project-workflow',
    'cli-project-guards',
    'cli-dev-workflow',
    'cli-schema-json-workflow',
    'events-cli-workflow',
    'cli-diagnostics',
    'docs-executable-contracts',
    'docs-executable-init-dev',
    'docs-migration-schema-lowering',
    'docs-example-01-hello-json',
    'docs-example-02-request-schema',
    'docs-example-03-fetch-composition',
    'docs-example-05-fastly-capabilities',
    'docs-example-07-opaque-proxy',
    'docs-example-09-router-lowering',
    'docs-example-10-entities-tools',
    'docs-example-11-events',
    'docs-example-12-mcp-proxy',
    'docs-example-13-jwt-es256'
  ]),
  providers: Object.freeze([
    'provider-packages',
    'provider-fastly-package',
    'provider-fastly-apps',
    'canonical-grip-fastly',
    'fastly-cli-gate-surface',
    'fastly-javascript-packaging',
    'fastly-javascript-runtime',
    'fastly-javascript-tooling',
    'fastly-native-http-shell',
    'fastly-native-http-effects',
    'fastly-native-platform-capabilities'
  ]),
  release: Object.freeze([
    '@unit',
    '@native',
    '@javascript',
    '@conformance',
    '@cli',
    '@providers',
    'release-packages',
    'release-artifact-determinism',
    'clean-machine-acceptance',
    'release-evidence-authority',
    'deployment-candidates'
  ])
});

function expandProfile(name, stack = []) {
  const entries = profiles[name];
  if (!entries) throw new Error(`Unknown PulseWasm test profile: ${name}`);
  if (stack.includes(name)) throw new Error(`Circular PulseWasm test profile: ${[...stack, name].join(' -> ')}`);
  const expanded = [];
  for (const entry of entries) {
    if (entry.startsWith('@')) expanded.push(...expandProfile(entry.slice(1), [...stack, name]));
    else expanded.push(entry);
  }
  return [...new Set(expanded)];
}

module.exports = { wasmRoot, tasks, profiles, expandProfile };
