#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DECISION_VERSION = 'pulse.guest-link-poc.phase-a-decision.v1';
const MEMORY_PAGES = 32;
const MEMORY_BYTES = MEMORY_PAGES * 65536;
const MAX_GUEST_LENGTH = 4096;
const INVALID_RANGE = 0x8000_0000;

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const a1Harness = path.join(__dirname, 'assert-scalar-link-control.cjs');
const a2Harness = path.join(__dirname, 'assert-memory-matrix.cjs');
const a3Harness = path.join(__dirname, 'assert-final-artifact-reality.cjs');

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-a4');
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      outputDirectory = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown Phase A decision option: ${token}`);
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function sourceRecord(file) {
  return Object.freeze({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    ...fileRecord(file)
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: options.env || process.env,
    timeout: options.timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${options.label} failed with status ${result.status}${detail ? `\n${detail}` : ''}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertFileRecord(file, expected, label) {
  assert.deepEqual(fileRecord(file), {
    bytes: expected.bytes,
    sha256: expected.sha256
  }, `${label} bytes and hash`);
}

function assertSourceRecords(report, label) {
  assert.ok(Array.isArray(report.sources) && report.sources.length > 0, `${label} must bind its sources`);
  for (const source of report.sources) {
    assert.doesNotMatch(source.file, /^(?:\/|[A-Za-z]:[\\/])/, `${label} source paths must be portable`);
    const file = path.resolve(repoRoot, source.file);
    assert.equal(
      file === repoRoot || file.startsWith(`${repoRoot}${path.sep}`),
      true,
      `${label} source must remain inside the repository`
    );
    assertFileRecord(file, source, `${label} source ${source.file}`);
  }
}

function assertAll(values, predicate, label) {
  assert.equal(values.every(predicate), true, label);
}

function evidenceCriterion(id, statement, evidence, support) {
  return Object.freeze({
    id,
    statement,
    status: 'satisfied',
    support: Object.freeze(support),
    evidence: Object.freeze(evidence)
  });
}

function evaluateEvidence(a1, a2, a3, files) {
  assert.equal(a1.version, 'pulse.guest-link-poc.scalar-control.v1');
  assert.equal(a1.status, 'passed');
  assert.equal(a1.scope.phaseADecision, 'not-evaluated');
  assert.equal(a1.link.resolvedToInternalCall, true);
  assert.equal(a1.link.unresolvedImports, 0);
  assert.equal(a1.memory.pointerEquivalenceClaim, false);

  assert.equal(a2.version, 'pulse.guest-link-poc.memory.v1');
  assert.equal(a2.status, 'passed');
  assert.equal(a2.gate.status, 'passed');
  assert.equal(a2.gate.allowsNextUnit, 'A3');
  assert.deepEqual(a2.gate.unresolvedWithinA2, []);
  assert.equal(a2.negativeControl.observation.rawPointerEquivalenceRejected, true);
  assert.equal(a2.candidate.status, 'passed');

  assert.equal(a3.version, 'pulse.guest-link-poc.final-audit.v1');
  assert.equal(a3.status, 'passed');
  assert.equal(a3.gate.status, 'passed');
  assert.equal(a3.gate.allowsNextUnit, 'A4');
  assert.deepEqual(a3.gate.unresolvedWithinA3, []);

  assertSourceRecords(a1, 'A1');
  assertSourceRecords(a2, 'A2');
  assertSourceRecords(a3, 'A3');

  assertFileRecord(files.a1Final, a1.modules.final, 'A1 final artifact');
  assertFileRecord(files.a2Final, a2.candidate.modules.final, 'A2 final artifact');
  assertFileRecord(files.a3Final, a3.finalArtifact, 'A3 optimized final artifact');
  assertFileRecord(files.a3Fastly, a3.fastlyFixture, 'A3 Fastly fixture');
  assertFileRecord(files.a2Report, a3.prerequisite.a2Report, 'A3-bound A2 report');
  assert.deepEqual(
    a2.candidate.modules.final.sha256,
    a3.prerequisite.unoptimizedCore.sha256,
    'A3 must optimize the exact accepted A2 candidate'
  );
  assert.deepEqual(
    a3.optimization.input,
    {
      bytes: a3.prerequisite.unoptimizedCore.bytes,
      sha256: a3.prerequisite.unoptimizedCore.sha256
    },
    'A3 optimization input must equal its A2 prerequisite'
  );
  assert.deepEqual(
    a3.optimization.output,
    {
      bytes: a3.finalArtifact.bytes,
      sha256: a3.finalArtifact.sha256
    },
    'A3 optimized output must be the audited final artifact'
  );
  assert.deepEqual(
    a3.fastlyFixture.coreInput,
    a3.optimization.output,
    'Fastly fixture must link the exact optimized core input'
  );

  const finalBytes = fs.readFileSync(files.a3Final);
  assert.equal(WebAssembly.validate(finalBytes), true, 'optimized final artifact must validate in Node');
  const finalModule = new WebAssembly.Module(finalBytes);
  assert.deepEqual(WebAssembly.Module.imports(finalModule), []);
  assert.deepEqual(
    WebAssembly.Module.exports(finalModule),
    a3.finalArtifact.exports
  );

  const a2Candidate = a2.candidate;
  const a2Final = a2Candidate.modules.final;
  const a2Guest = a2Candidate.modules.guest;
  const a2Execution = a2Candidate.execution;
  const a3Final = a3.finalArtifact;
  const fastlyFixture = a3.fastlyFixture;

  assert.equal(a3Final.valid, true);
  assert.equal(a3Final.memories, 1);
  assert.equal(a3Final.definedMemories, 1);
  assert.equal(a3Final.importedMemories, 0);
  assert.deepEqual(a3Final.memoryTypes, [{
    minimumPages: MEMORY_PAGES,
    maximumPages: MEMORY_PAGES
  }]);
  assert.deepEqual(a2Candidate.connection, {
    memoryOwner: 'candidate-memory-owner.wasm',
    ownerModuleName: 'env',
    exportName: 'memory',
    primaryImport: 'env.memory',
    guestImport: 'env.memory',
    finalMemoryImports: 0,
    finalMemories: 1,
    multiMemoryLoweringUsed: false,
    hiddenCopyUsed: false,
    emittedBulkMemoryInstructions: {
      copy: 0,
      fill: 0,
      init: 0
    },
    proofOnlyExports: [
      'pulsePrimaryLayoutMarkerPointer',
      'pulse_guest_layout_marker_pointer'
    ]
  });
  assert.deepEqual(a2Candidate.layout.memory, {
    owner: 'candidate-memory-owner.wasm',
    minimumPages: MEMORY_PAGES,
    maximumPages: MEMORY_PAGES,
    bytes: MEMORY_BYTES,
    growable: false
  });

  assert.equal(a2Execution.cases.length, 5);
  assertAll(
    a2Execution.cases,
    (entry) => (
      entry.inputUnchanged === true
      && entry.sentinelsUnchanged === true
      && entry.outOfRangeSentinelsDoNotInfluenceResult === true
    ),
    'all byte-span cases must preserve their exact input and sentinels'
  );
  assert.equal(a2Execution.everyByteProbe.alteredPositionsChecked, 64);
  assert.equal(a2Execution.everyByteProbe.everyPositionInfluencedResult, true);
  assert.equal(a2Execution.everyByteProbe.inputRestored, true);
  assert.equal(a2Guest.loadInstructions > 0, true);

  assert.equal(a2Candidate.layout.heap.guestAllocator, false);
  assert.equal(a2Candidate.layout.heap.primaryAllocatorUsed, false);
  assert.equal(a2Candidate.layout.heap.emittedHeapOrAllocatorPath, false);
  assert.equal(a2Final.memoryGrowInstructions, 0);
  assert.equal(a2Final.memoryCopyInstructions, 0);
  assert.equal(a2Final.memoryFillInstructions, 0);
  assert.equal(a2Final.memoryInitInstructions, 0);

  assert.equal(a2Guest.storeInstructions, 0);
  assert.equal(a2Guest.globalSetInstructions, 0);
  assert.equal(a2Guest.callIndirectInstructions, 0);
  assert.deepEqual(a2Final.mutableGlobals, []);
  assert.equal(a2Final.callIndirectInstructions, 0);

  assert.equal(a2Candidate.layout.pairwiseRangeCheckPassed, true);
  assert.equal(a2Execution.layoutEvidence.pairwiseNonOverlapping, true);
  assert.equal(a2Candidate.layout.staticSegmentPreservation.relocated, false);
  assert.equal(
    a2Candidate.layout.staticSegmentPreservation.markersVerifiedInInstantiatedFinalMemoryBeforeCalls,
    true
  );
  assert.equal(fastlyFixture.layout.pairwiseNonOverlapping, true);
  assert.equal(fastlyFixture.layout.optimizedCoreSegmentsPreserved, true);

  assert.equal(a2Execution.invalidRanges.length, 9);
  assertAll(
    a2Execution.invalidRanges,
    (entry) => (
      entry.result === INVALID_RANGE
      && entry.trapped === false
      && entry.memoryUnchanged === true
    ),
    'every invalid range must return the explicit status without trapping or mutation'
  );
  assert.equal(a2Execution.resultEncoding.invalidStatus, INVALID_RANGE);
  assert.equal(a2Execution.resultEncoding.collisionPossible, false);
  assert.equal(a2Execution.validBoundaryRanges.length, 2);
  assert.equal(
    a2Execution.validBoundaryRanges.some((entry) => (
      entry.class === 'maximum-accepted-length'
      && entry.pointer === 526336
      && entry.length === MAX_GUEST_LENGTH
      && entry.trapped === false
    )),
    true
  );

  assert.deepEqual(a3Final.imports, []);
  assert.equal(a3Final.hasStart, false);
  assert.deepEqual(a3Final.featureValidation, {
    baseline: 'mvp',
    explicitlyEnabled: [],
    binaryenReported: []
  });
  assert.equal(fastlyFixture.valid, true);
  assert.equal(fastlyFixture.memories, 1);
  assert.equal(fastlyFixture.importedMemories, 0);
  assert.equal(fastlyFixture.hasStart, false);
  assert.deepEqual(fastlyFixture.featureValidation, {
    baseline: 'mvp',
    explicitlyEnabled: [],
    binaryenReported: []
  });
  assert.equal(
    fastlyFixture.exports.some((entry) => entry.name === '_start' && entry.kind === 'function'),
    true,
    'Fastly fixture must expose its command entry point'
  );
  assert.deepEqual(
    fastlyFixture.imports,
    [
      { module: 'fastly_http_body', name: 'new', kind: 'function' },
      { module: 'fastly_http_body', name: 'write', kind: 'function' },
      { module: 'fastly_http_resp', name: 'new', kind: 'function' },
      { module: 'fastly_http_resp', name: 'status_set', kind: 'function' },
      { module: 'fastly_http_resp', name: 'header_insert', kind: 'function' },
      { module: 'fastly_http_resp', name: 'send_downstream', kind: 'function' }
    ]
  );

  assert.equal(a3.optimization.runCount, 2);
  assert.equal(a3.optimization.deterministicBytes, true);
  assert.equal(a3.optimization.behaviorChanged, false);
  assert.equal(a3.nodeReality.observationsIdentical, true);
  assert.deepEqual(a3.nodeReality.optimized, a3.nodeReality.unoptimized);
  assertAll(
    a3.nodeReality.optimized.cases,
    (entry) => entry.outOfRangeSentinelsDoNotInfluenceResult === true,
    'A3 optimized replay must prove that out-of-range sentinels do not influence the checksum'
  );
  assert.equal(a3.fastlyFixture.reality.first.status, 200);
  assert.deepEqual(
    a3.fastlyFixture.reality.second,
    a3.fastlyFixture.reality.first
  );
  assert.equal(a3.fastlyFixture.reality.repeatedObservationIdentical, true);
  assert.equal(a3.fastlyFixture.reality.invocation.remoteDeployment, false);
  assert.equal(a3.comparison.equal, true);
  assert.deepEqual(a3.comparison.normalizedFastly, a3.comparison.normalizedNode);

  const criteria = Object.freeze([
    evidenceCriterion(
      'one-final-core-module',
      'One final valid core Wasm module is the accepted proof artifact.',
      [
        'A3 finalArtifact.valid=true',
        `A3 finalArtifact=${a3Final.bytes} bytes sha256:${a3Final.sha256}`,
        'Node WebAssembly.validate=true'
      ],
      ['binary-inspection', 'runtime-validation']
    ),
    evidenceCriterion(
      'one-explainably-owned-memory',
      'The final artifact has exactly one fixed, non-growable, deliberately owned memory.',
      [
        'A2 candidate.connection resolves primary and guest env.memory imports to candidate-memory-owner.wasm',
        `A3 finalArtifact memories=1 imported=0 limits=${MEMORY_PAGES}/${MEMORY_PAGES}`
      ],
      ['compiler-configuration', 'binary-inspection']
    ),
    evidenceCriterion(
      'rust-reads-exact-primary-bytes',
      'Rust reads the exact AssemblyScript-produced borrowed bytes.',
      [
        'A2 negative control rejects equal numeric pointers across independent memories',
        'A2 five byte-span cases pass with unchanged input and sentinels',
        'A2 every-byte probe confirms all 64 positions influence the guest result',
        'A2 candidate.connection hiddenCopyUsed=false'
      ],
      ['negative-control', 'runtime-observation', 'binary-inspection']
    ),
    evidenceCriterion(
      'no-allocation',
      'The bounded proof emits no guest or primary allocator path.',
      [
        'A2 layout.heap guestAllocator=false primaryAllocatorUsed=false',
        'A2 final memory.grow/copy/fill/init counts are all zero'
      ],
      ['source-configuration', 'binary-inspection']
    ),
    evidenceCriterion(
      'no-retained-pointer',
      'The guest cannot retain the borrowed input pointer after the synchronous call.',
      [
        'A2 guest storeInstructions=0 globalSetInstructions=0 callIndirectInstructions=0',
        'A2 final mutableGlobals=[] and callIndirectInstructions=0',
        'A2 input and sentinel bytes remain unchanged'
      ],
      ['binary-inspection', 'runtime-observation', 'bounded-inference']
    ),
    evidenceCriterion(
      'no-memory-range-collision',
      'Stack, static data, proof shell data, and fixture input ranges do not collide.',
      [
        'A2 pairwiseRangeCheckPassed=true',
        'A2 static segments are preserved by exact range and hash',
        'A3 Fastly fixture pairwiseNonOverlapping=true and optimizedCoreSegmentsPreserved=true'
      ],
      ['compiler-configuration', 'binary-inspection']
    ),
    evidenceCriterion(
      'invalid-range-contract',
      'Invalid ranges return the explicit status without trapping or mutating memory.',
      [
        `A2 invalidRanges=9 result=${INVALID_RANGE} trapped=false memoryUnchanged=true`,
        `A2 maximum accepted length=${MAX_GUEST_LENGTH}`,
        'A3 replays the same normalized invalid-range observation under Node and Fastly'
      ],
      ['runtime-observation', 'binary-inspection']
    ),
    evidenceCriterion(
      'imports-and-start-behavior',
      'The optimized core has no imports or start section; the Fastly shell has only its declared host imports and command export.',
      [
        'A3 finalArtifact imports=[] hasStart=false',
        'A3 Fastly fixture hasStart=false and exports _start',
        'A3 Fastly fixture imports exactly six fastly_http_body/fastly_http_resp functions'
      ],
      ['binary-inspection']
    ),
    evidenceCriterion(
      'target-compatible-features',
      'The final core and Fastly fixture validate against the MVP feature baseline.',
      [
        'A3 finalArtifact featureValidation baseline=mvp with no explicit/reported additions',
        'A3 Fastly fixture featureValidation baseline=mvp with no explicit/reported additions',
        'Fastly compute serve accepted the fixture'
      ],
      ['binary-inspection', 'target-runtime-observation']
    ),
    evidenceCriterion(
      'optimized-unoptimized-agreement',
      'Optimization does not change the complete observable proof behavior.',
      [
        'A3 optimization.behaviorChanged=false',
        'A3 nodeReality.observationsIdentical=true',
        'A3 optimized and unoptimized detailed observations are deeply equal'
      ],
      ['runtime-observation']
    ),
    evidenceCriterion(
      'node-and-fastly-reality',
      'The exact optimized core passes Node and its corresponding fixture passes fastly compute serve.',
      [
        'A3 nodeReality exactArtifact=guest-link-poc-final.wasm',
        'A3 Fastly first and second responses are identical HTTP 200 observations',
        'A3 normalized Node and Fastly observations are equal'
      ],
      ['runtime-observation', 'target-runtime-observation']
    ),
    evidenceCriterion(
      'deterministic-final-bytes',
      'Identical inputs produce identical optimized final bytes.',
      [
        'A2 candidate inputs and output are byte-identical across two builds',
        'A3 runs the optimization twice and requires byte equality',
        `A3 optimized sha256:${a3Final.sha256}`
      ],
      ['artifact-hash', 'repeated-build']
    ),
    evidenceCriterion(
      'safety-claims-evidence-bound',
      'Every accepted Phase A safety claim is bound to source/configuration, binary inspection, or runtime evidence.',
      [
        'A1, A2, and A3 source records match the current repository bytes',
        'A3 binds the exact A2 report and unoptimized artifact by size and hash',
        'A3 binds the exact optimized core into the Fastly fixture',
        'A2 and A3 report no unresolved unit-local assumptions'
      ],
      ['source-hash', 'compiler-configuration', 'binary-inspection', 'runtime-observation']
    )
  ]);

  const failTriggers = Object.freeze([
    Object.freeze({
      trigger: 'Pointer meaning remains ambiguous.',
      triggered: false,
      reason: 'The negative control demonstrates the ambiguity, while the accepted candidate resolves both imports to one audited memory.'
    }),
    Object.freeze({
      trigger: 'The accepted candidate retains multiple logical memories.',
      triggered: false,
      reason: 'The final core has one defined memory and no imported memory.'
    }),
    Object.freeze({
      trigger: 'The host must provide an undeclared memory.',
      triggered: false,
      reason: 'The final core defines its fixed memory and has no imports.'
    }),
    Object.freeze({
      trigger: 'Static data, stack, or heap ranges cannot be shown non-overlapping.',
      triggered: false,
      reason: 'Configured bases and decoded half-open ranges pass pairwise overlap checks before and after optimization.'
    }),
    Object.freeze({
      trigger: 'The guest requires allocation.',
      triggered: false,
      reason: 'The guest is no_std, emits no allocator path, and the final core contains no memory.grow.'
    }),
    Object.freeze({
      trigger: 'Behavior changes after optimization.',
      triggered: false,
      reason: 'The complete detailed Node observation is identical before and after optimization.'
    }),
    Object.freeze({
      trigger: 'Invalid input traps outside the defined contract.',
      triggered: false,
      reason: 'All nine invalid classes return the explicit status without a trap or memory mutation.'
    }),
    Object.freeze({
      trigger: 'Fastly rejects the artifact.',
      triggered: false,
      reason: 'Two fastly compute serve requests return identical successful normalized evidence.'
    }),
    Object.freeze({
      trigger: 'Linking requires binary patching or silent target-specific behavior.',
      triggered: false,
      reason: 'The proof uses declared compiler/linker inputs, audits their emitted bytes, and performs no binary patching or fallback.'
    })
  ]);
  assertAll(failTriggers, (entry) => entry.triggered === false, 'no Phase A FAIL trigger may be active');
  assert.equal(criteria.length, 13, 'every A4 PASS criterion must be represented');
  assertAll(criteria, (entry) => entry.status === 'satisfied', 'every A4 PASS criterion must be satisfied');

  return Object.freeze({
    criteria,
    failTriggers
  });
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function table(headers, rows) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n');
}

function renderDecision(context) {
  const {
    a1,
    a2,
    a3,
    reports,
    harnesses,
    criteria,
    failTriggers
  } = context;
  const criterionRows = criteria.map((criterion) => [
    criterion.id,
    'SATISFIED',
    criterion.statement,
    criterion.evidence.join('; '),
    criterion.support.join(', ')
  ]);
  const failRows = failTriggers.map((entry) => [
    entry.trigger,
    'No',
    entry.reason
  ]);
  const evidenceRows = [
    [
      'A1 scalar control',
      a1.version,
      reports.a1.bytes,
      reports.a1.sha256,
      a1.modules.final.sha256
    ],
    [
      'A2 memory matrix',
      a2.version,
      reports.a2.bytes,
      reports.a2.sha256,
      a2.candidate.modules.final.sha256
    ],
    [
      'A3 final audit',
      a3.version,
      reports.a3.bytes,
      reports.a3.sha256,
      a3.finalArtifact.sha256
    ]
  ];
  const harnessRows = harnesses.map((entry) => [
    entry.file,
    entry.bytes,
    entry.sha256
  ]);

  return `# Guest-link proof: Phase A decision

**Decision record:** ${DECISION_VERSION}  
**Decision:** **PASS**  
**Next authorized unit:** B0 — contract and pipeline design  
**Authorizes:** Phase B guest-link pipeline work under the exact bounded contract below  
**Does not authorize:** a public guest ABI, third-party guests, guest-linked crypto, provider mutation, deployment, or release

## Decision

Phase A passes. The A1 scalar control, A2 memory experiment matrix, and A3
optimized Node/Fastly reality proof satisfy every A4 PASS criterion. No
CONDITIONAL dependency or FAIL trigger remains inside the bounded proof.

This is an evidence decision, not a product compatibility promise. Phase B
must turn the accepted proof contract into a first-party internal pipeline and
must independently preserve every containment rule.

## Evidence inputs

${table(
    ['Unit', 'Report version', 'Report bytes', 'Report SHA-256', 'Final core SHA-256'],
    evidenceRows
  )}

The A3 report binds the exact A2 report and unoptimized artifact by size and
hash. Its optimization output is the exact core input linked into the
proof-only Fastly command fixture.

### Reproducible harnesses

${table(['File', 'Bytes', 'SHA-256'], harnessRows)}

The A4 task reruns A1, A2, and A3 from these repository sources with frozen,
offline Cargo inputs. A3 performs the local target gate through
\`fastly compute serve\`; no remote deployment occurs.

## A4 PASS criteria

${table(
    ['Criterion', 'Result', 'Decision statement', 'Evidence', 'Support kind'],
    criterionRows
  )}

## CONDITIONAL gate

No safety, layout, feature, determinism, or provider property in the bounded
proof depends on an unresolved undocumented assumption. The proof records
exact tool versions and hashes, but does not accept tool behavior as a safety
substitute: the emitted inputs and final modules are independently inspected
and executed.

The AssemblyScript-transitive Binaryen installation is permitted only for this
spike. Direct pinned Binaryen ownership remains mandatory in Phase B and is
not a condition on the already-audited Phase A bytes.

## FAIL stop checks

${table(['A4 FAIL trigger', 'Triggered', 'Evidence-bound reason'], failRows)}

## Evidence classification

### Observed facts

- A1 resolves an independently compiled Rust scalar function to an internal
  call in one valid artifact and makes no byte-memory claim.
- A2's independent-memory negative control proves that equal numeric pointers
  do not imply equal bytes.
- The A2 candidate resolves both toolchains to one fixed 32-page memory,
  preserves both static segments, and passes the complete byte and invalid
  range matrix.
- The optimized final core is ${a3.finalArtifact.bytes} bytes with SHA-256
  \`${a3.finalArtifact.sha256}\`.
- Node and two local Fastly requests produce the same normalized observation.
- Repeated builds and optimization runs produce byte-identical artifacts.

### Tool-documented behavior

No tool-documented behavior is accepted alone as proof of memory safety.
Binaryen and target-tool versions are recorded for reproducibility; module
structure, ranges, instructions, features, imports, exports, and hashes are
verified from emitted bytes. Runtime behavior is checked independently.

### Inferences

- The borrowed input pointer cannot survive the synchronous guest call because
  the guest has no stores, mutable-global writes, indirect dispatch, callback,
  or host call through which to retain or escape it.
- The proof ranges cannot collide because all occupied and reserved half-open
  ranges are pairwise disjoint, memory is fixed, and no allocator,
  \`memory.grow\`, bulk-memory copy, fill, or runtime initialization path is
  emitted.
- Target compatibility is bounded to the audited MVP artifact and the exact
  local Fastly fixture; it is not generalized to arbitrary guests.

### Unresolved assumptions

None within the Phase A proof boundary.

## Accepted Phase A contract

Phase B may rely only on this bounded result:

1. one first-party, independently compiled, host-neutral core Wasm guest;
2. one deliberately owned, fixed, non-growable 32-bit linear memory;
3. primary and guest memory imports resolved during linking, leaving one
   defined memory and no memory import in the final core;
4. synchronous borrowed \`(pointer: u32, length: u32)\` input with a maximum
   length of ${MAX_GUEST_LENGTH} bytes;
5. explicit invalid-range status \`0x${INVALID_RANGE.toString(16)}\`, with no
   trap for the defined invalid classes;
6. no allocator, heap path, retained pointer, callback, reentrancy, host/WASI
   import, start section, memory growth, or binary patch;
7. configured stack/static bases plus binary-inspected, non-overlapping
   half-open ranges;
8. post-link optimization followed by a complete structural and behavioral
   audit;
9. deterministic final bytes and matching Node/Fastly observable behavior;
10. source, commands, tool versions, input hashes, and output hashes retained
    as evidence.

The proof-only marker exports and Fastly command shell are not part of an
accepted v1 public ABI. This result is not a proof for arbitrary Rust source,
different layouts or toolchains, growable memory, or general unsafe Rust
correctness.

## Deferred to Phase B

- choose and encode the production memory-owner/link-stage structure without
  widening the proof contract;
- establish direct pinned Binaryen ownership rather than relying on the
  AssemblyScript-transitive spike tool;
- define the internal guest-unit manifest, materialization, provenance,
  diagnostics, and final audit contracts;
- reproduce this evidence through the production pipeline;
- keep guest units first-party, prebuilt, sealed, allocator-free, and
  host-neutral.

Crypto and JWT semantics remain outside this decision. Phase C's initial
HS256 realization remains \`guest-source\`, not \`guest-linked\`.
`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-a4-'));
  const a1Output = path.join(workDirectory, 'a1');
  const a2Output = path.join(workDirectory, 'a2');
  const a3Output = path.join(workDirectory, 'a3');
  const cargoEnvironment = {
    ...process.env,
    CARGO_INCREMENTAL: '0',
    CARGO_NET_OFFLINE: 'true'
  };

  try {
    run(process.execPath, [a1Harness, '--out', a1Output], {
      label: 'A1 scalar control prerequisite',
      env: cargoEnvironment,
      timeoutMs: 180000
    });
    run(process.execPath, [a2Harness, '--out', a2Output], {
      label: 'A2 memory matrix prerequisite',
      env: cargoEnvironment,
      timeoutMs: 240000
    });
    run(process.execPath, [a3Harness, '--out', a3Output], {
      label: 'A3 target reality prerequisite',
      env: cargoEnvironment,
      timeoutMs: 360000
    });

    const files = Object.freeze({
      a1Report: path.join(a1Output, 'guest-link-poc-report.json'),
      a1Final: path.join(a1Output, 'guest-link-poc.wasm'),
      a2Report: path.join(a2Output, 'guest-link-poc-memory-report.json'),
      a2Final: path.join(a2Output, 'guest-link-poc-memory.wasm'),
      a3Report: path.join(a3Output, 'guest-link-poc-final-audit.json'),
      a3Final: path.join(a3Output, 'guest-link-poc-final.wasm'),
      a3Fastly: path.join(a3Output, 'guest-link-poc-fastly.wasm')
    });
    const a1 = readJson(files.a1Report);
    const a2 = readJson(files.a2Report);
    const a3 = readJson(files.a3Report);
    const evaluation = evaluateEvidence(a1, a2, a3, files);
    const reports = Object.freeze({
      a1: fileRecord(files.a1Report),
      a2: fileRecord(files.a2Report),
      a3: fileRecord(files.a3Report)
    });
    const harnesses = Object.freeze([
      sourceRecord(a1Harness),
      sourceRecord(a2Harness),
      sourceRecord(a3Harness),
      sourceRecord(__filename)
    ]);
    const decision = renderDecision({
      a1,
      a2,
      a3,
      reports,
      harnesses,
      ...evaluation
    });
    assert.equal(
      decision,
      renderDecision({
        a1,
        a2,
        a3,
        reports,
        harnesses,
        ...evaluation
      }),
      'decision record rendering must be deterministic'
    );
    assert.match(decision, /\*\*Decision:\*\* \*\*PASS\*\*/);
    assert.match(decision, /### Unresolved assumptions\n\nNone within the Phase A proof boundary\./);
    assert.doesNotMatch(decision, /\/(?:workspace|tmp|root)\//);
    assert.doesNotMatch(decision, /\b(?:TODO|TBD)\b/);

    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const output = path.join(options.outputDirectory, 'guest-link-poc-decision.md');
    fs.writeFileSync(output, decision);
    const decisionRecord = fileRecord(output);
    console.log(`ok - Phase A PASS; the evidence-bound guest-link proof authorizes Phase B (${decisionRecord.bytes} bytes, ${decisionRecord.sha256})`);
    console.log(`decision - ${path.relative(repoRoot, output).split(path.sep).join('/')}`);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
