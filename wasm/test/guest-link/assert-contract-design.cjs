#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_VERSION = 'pulse.guest-link-contract-design-evidence.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const UNIT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MODULE_NAME = /^[a-z][a-z0-9_]*$/;
const PACKAGE_NAME = /^@pulse-compute\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FORBIDDEN_MANIFEST_FIELDS = new Set(['command', 'commands', 'argv', 'shell', 'executable']);

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const designFile = path.join(__dirname, 'fixtures', 'contracts', 'guest-link-contract-design.json');
const harnessFile = __filename;

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-b0');
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a directory');
      outputDirectory = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown contract-design option: ${token}`);
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: path.relative(repoRoot, file).split(path.sep).join('/'),
    bytes: bytes.length,
    sha256: sha256(bytes)
  });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  assert.deepEqual(
    Object.keys(value).sort(),
    [...Object.keys(value)].filter((key) => allowed.has(key)).sort(),
    `${label} must not contain undeclared fields`
  );
  for (const key of required) {
    assert.equal(Object.hasOwn(value, key), true, `${label}.${key} is required`);
  }
}

function assertSha(value, label) {
  assert.match(value, SHA256, `${label} must be a lowercase SHA-256`);
}

function assertRelativePath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.equal(path.posix.isAbsolute(value), false, `${label} must be relative`);
  assert.equal(path.win32.isAbsolute(value), false, `${label} must be portable`);
  assert.equal(value.split('/').includes('..'), false, `${label} must reject traversal`);
  assert.equal(value.includes('\\'), false, `${label} must use portable separators`);
}

function walkKeys(value, visitor, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, visitor, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    visitor(key, entry, [...trail, key]);
    walkKeys(entry, visitor, [...trail, key]);
  }
}

function assertNoExecutionFields(value, label) {
  walkKeys(value, (key, _entry, trail) => {
    assert.equal(
      FORBIDDEN_MANIFEST_FIELDS.has(key.toLowerCase()),
      false,
      `${label} contains forbidden execution field ${trail.join('.')}`
    );
  });
}

function validateGuestUnit(contract, acceptedMemoryAbi) {
  assert.equal(contract.version, 'pulse.guest-unit.v1');
  assert.equal(contract.additionalProperties, false);
  assert.deepEqual(contract.optional, ['source']);
  assert.deepEqual(contract.independentlyVerified, [
    'artifact.sha256',
    'artifact.bytes',
    'imports',
    'exports',
    'memory',
    'start',
    'features'
  ]);

  const unit = contract.example;
  exactKeys(unit, contract.required, contract.optional, 'guest unit');
  assertNoExecutionFields(unit, 'guest unit');
  assert.equal(unit.version, contract.version);
  assert.match(unit.id, UNIT_ID);
  assert.match(unit.module, MODULE_NAME);
  assert.match(unit.owner, PACKAGE_NAME);
  assert.match(unit.packageVersion, VERSION);
  assert.match(unit.abi, UNIT_ID);
  assert.equal(unit.origin, 'package-prebuilt');

  exactKeys(unit.artifact, ['file', 'bytes', 'sha256'], [], 'guest unit artifact');
  assertRelativePath(unit.artifact.file, 'guest unit artifact file');
  assert.ok(Number.isSafeInteger(unit.artifact.bytes) && unit.artifact.bytes > 0);
  assertSha(unit.artifact.sha256, 'guest unit artifact');

  exactKeys(unit.source, ['included', 'directory', 'treeSha256'], [], 'guest unit source');
  assert.equal(unit.source.included, true);
  assertRelativePath(unit.source.directory, 'guest unit source directory');
  assertSha(unit.source.treeSha256, 'guest unit source');

  exactKeys(unit.toolchain, ['kind', 'target', 'locked', 'versions'], [], 'guest unit toolchain');
  assert.equal(unit.toolchain.kind, 'rust-cargo');
  assert.equal(unit.toolchain.target, 'wasm32v1-none');
  assert.equal(unit.toolchain.locked, true);
  assert.deepEqual(Object.keys(unit.toolchain.versions).sort(), ['cargo', 'rustc']);

  assert.deepEqual(unit.imports, [{
    module: 'env',
    name: 'memory',
    kind: 'memory',
    type: {
      minimumPages: 32,
      maximumPages: 32,
      shared: false
    }
  }]);
  assert.deepEqual(unit.exports.map(({ name, kind, role }) => ({ name, kind, role })), [
    {
      name: 'pulse_guest_layout_marker_pointer',
      kind: 'function',
      role: 'evidence-only'
    },
    {
      name: 'pulse_guest_span_checksum',
      kind: 'function',
      role: 'abi'
    }
  ]);
  assert.deepEqual(unit.exports[1].parameters, ['i32', 'i32']);
  assert.deepEqual(unit.exports[1].results, ['i32']);
  assert.deepEqual(unit.memory, {
    identity: acceptedMemoryAbi.identity,
    import: 'env.memory',
    owner: 'link-stage'
  });
  assert.deepEqual(unit.start, { policy: 'forbidden' });
  assert.deepEqual(unit.features, { baseline: 'mvp', allowed: [], required: [] });
  assert.equal(unit.provenance.reproducibleSourceIncluded, true);
  assertRelativePath(unit.provenance.packageManifest, 'guest package manifest');
  assertRelativePath(unit.provenance.lockfile, 'guest lockfile');

  const withoutSource = { ...unit };
  delete withoutSource.source;
  exactKeys(withoutSource, contract.required, contract.optional, 'guest unit without optional source');
}

function validatePlan(contract, unitContract) {
  assert.equal(contract.version, 'pulse.guest-unit-plan.v1');
  assert.equal(contract.additionalProperties, false);
  const plan = contract.example;
  exactKeys(plan, contract.required, [], 'guest unit plan');
  assertNoExecutionFields(plan, 'guest unit plan');
  assert.equal(plan.version, contract.version);
  assert.equal(plan.unit.id, unitContract.example.id);
  assert.equal(plan.unit.module, unitContract.example.module);
  assert.equal(plan.unit.owner, unitContract.example.owner);
  assert.equal(plan.unit.packageVersion, unitContract.example.packageVersion);
  assert.equal(plan.unit.abi, unitContract.example.abi);
  assert.equal(plan.unit.origin, 'package-prebuilt');
  assertSha(plan.unit.manifestSha256, 'guest unit plan manifest');
  assert.equal(plan.unit.artifactSha256, unitContract.example.artifact.sha256);
  assertSha(plan.targetPolicy.descriptorSha256, 'target descriptor');
  assert.equal(plan.targetPolicy.descriptorIdentity, plan.target);
  assert.equal(plan.targetPolicy.featureBaseline, 'mvp');
  assert.deepEqual(plan.targetPolicy.memory, {
    minimum: 1,
    maximum: 1,
    imported: 0,
    growable: false
  });
  assertRelativePath(plan.materialization.workspace, 'guest workspace');
  assertRelativePath(plan.materialization.directory, 'guest materialization directory');
  assert.equal(
    plan.materialization.directory,
    `${plan.materialization.workspace}/${plan.unit.id}/${plan.unit.artifactSha256}`
  );
  assert.equal(plan.materialization.contentAddress, 'artifact-sha256');
  assert.equal(plan.materialization.generated, true);
  assert.equal(plan.materialization.authoritative, false);
  assert.equal(plan.trust.status, 'passed');
  assert.equal(plan.composition.kind, 'core-wasm-static-link');
  assert.equal(plan.composition.primaryModule, 'pulse_primary');
  assert.equal(plan.composition.memoryOwnerModule, 'env');
  assert.notEqual(plan.composition.primaryModule, plan.unit.module);
  assert.deepEqual(plan.fallback, {
    enabled: false,
    onFailure: 'stop-before-provider-packaging'
  });
}

function validateLinkReport(contract, planContract) {
  assert.equal(contract.version, 'pulse.guest-link-report.v1');
  assert.equal(contract.additionalProperties, false);
  const report = contract.example;
  exactKeys(report, contract.required, [], 'guest link report');
  assertNoExecutionFields(report, 'guest link report');
  assert.equal(report.version, contract.version);
  assert.equal(report.status, 'passed');
  assert.equal(report.profile, planContract.example.profile);
  assert.equal(report.target, planContract.example.target);
  assert.equal(report.units.length, 1);
  assert.equal(report.units[0].module, planContract.example.unit.module);
  assert.equal(report.units[0].origin, 'package-prebuilt');
  assertSha(report.units[0].artifactSha256, 'reported guest artifact');
  assertSha(report.units[0].sourceSha256, 'reported guest source');
  assert.equal(report.materialization.hashVerifiedBeforeUse, true);

  for (const module of Object.values(report.inspection.before)) {
    assert.ok(Array.isArray(module.imports), 'each input inspection must report exact imports');
    assert.ok(Array.isArray(module.exports), 'each input inspection must report exact exports');
    assert.ok(Number.isInteger(module.memories), 'each input inspection must report memories');
    assert.ok(Array.isArray(module.features), 'each input inspection must report features');
  }
  for (const key of ['imports', 'exports', 'features']) {
    assert.ok(Array.isArray(report.inspection.after[key]), `final inspection must report ${key}`);
  }
  assert.equal(report.inspection.after.memories, 1);
  assert.equal(report.inspection.after.hasStart, false);
  assert.equal(report.composition.kind, planContract.example.composition.kind);
  assert.equal(report.composition.implementation.name, 'binaryen');
  assert.ok(report.composition.implementation.version.length > 0);
  assert.equal(report.composition.deterministic, true);
  assert.equal(report.optimization.postLink, true);
  assert.equal(report.optimization.deterministic, true);
  assert.equal(report.optimization.inputSha256, report.composition.outputSha256);
  assert.equal(report.optimization.outputSha256, report.finalArtifact.sha256);
  assert.deepEqual(report.fallback, { enabled: false, used: false });
  assert.deepEqual(report.evidenceClassification.unresolvedAssumptions, []);
  assert.deepEqual(Object.values(report.redaction), ['omitted', 'omitted', 'omitted', 'omitted']);
}

function validateFinalAudit(contract, linkReportContract, acceptedMemoryAbi) {
  assert.equal(contract.version, 'pulse.final-wasm-audit.v1');
  assert.equal(contract.additionalProperties, false);
  const audit = contract.example;
  exactKeys(audit, contract.required, [], 'final Wasm audit');
  assertNoExecutionFields(audit, 'final Wasm audit');
  assert.equal(audit.version, contract.version);
  assert.equal(audit.status, 'passed');
  assert.equal(audit.artifact.valid, true);
  assert.equal(audit.artifact.sha256, linkReportContract.example.finalArtifact.sha256);
  assertSha(audit.targetPolicy.descriptorSha256, 'final audit target descriptor');
  assert.deepEqual(audit.structure.imports, []);
  assert.ok(audit.structure.exports.length > 0);
  assert.equal(audit.structure.definedMemories, acceptedMemoryAbi.memory.finalDefinedMemories);
  assert.equal(audit.structure.importedMemories, acceptedMemoryAbi.memory.finalImportedMemories);
  assert.deepEqual(audit.structure.memoryTypes, [{
    minimumPages: acceptedMemoryAbi.memory.minimumPages,
    maximumPages: acceptedMemoryAbi.memory.maximumPages,
    shared: false
  }]);
  assert.equal(audit.structure.hasStart, false);
  assert.deepEqual(audit.structure.features, []);
  assert.equal(audit.structure.mutableGlobals.length, 0);
  assert.equal(audit.structure.tables, 0);
  assert.deepEqual(audit.instructions, {
    memoryGrow: 0,
    memoryCopy: 0,
    memoryFill: 0,
    memoryInit: 0,
    callIndirect: 0
  });
  assert.equal(audit.layout.memoryContract, acceptedMemoryAbi.identity);
  assert.equal(audit.layout.occupiedAndReservedRangesPairwiseDisjoint, true);
  assert.equal(audit.layout.staticSegmentsPreserved, true);
  assert.ok(audit.checks.every((entry) => entry.status === 'passed'));
  assert.deepEqual(audit.providerPackaging, {
    authorized: true,
    auditArtifactSha256MatchesInput: true
  });
  assert.deepEqual(audit.evidenceClassification.unresolvedAssumptions, []);
}

function validateMemoryAbi(memory) {
  assert.equal(memory.identity, 'pulse.guest-memory.borrowed-span.v1');
  assert.deepEqual(memory.memory, {
    owner: 'link-stage',
    minimumPages: 32,
    maximumPages: 32,
    bytes: 2097152,
    growable: false,
    finalDefinedMemories: 1,
    finalImportedMemories: 0
  });
  assert.equal(memory.borrowedInput.maximumBytes, 4096);
  assert.equal(memory.borrowedInput.lifetime, 'synchronous-call');
  assert.equal(memory.borrowedInput.retention, 'forbidden');
  assert.equal(memory.borrowedInput.allocation, 'forbidden');
  assert.deepEqual(memory.invalidRange, {
    statusType: 'u32',
    status: '0x80000000',
    definedInvalidClassesTrap: false
  });
  const ranges = Object.values(memory.layout)
    .filter((entry) => entry && typeof entry === 'object' && Number.isInteger(entry.start));
  for (let left = 0; left < ranges.length; left += 1) {
    assert.ok(ranges[left].start >= 0 && ranges[left].endExclusive > ranges[left].start);
    for (let right = left + 1; right < ranges.length; right += 1) {
      assert.equal(
        ranges[left].start < ranges[right].endExclusive && ranges[right].start < ranges[left].endExclusive,
        false,
        'accepted memory ABI reserved ranges must not overlap'
      );
    }
  }
  assert.deepEqual(memory.requiredPostLinkOrder, [
    'compose',
    'whole-module-optimize',
    'complete-final-audit'
  ]);
}

function validatePipeline(design) {
  const stages = design.pipeline.stages;
  assert.deepEqual(stages.map((entry) => entry.order), [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.deepEqual(stages.map((entry) => entry.id), [
    'package-lowering',
    'guest-unit-planning',
    'package-prebuilt-materialization',
    'primary-assemblyscript-compilation',
    'independent-input-audit',
    'core-wasm-composition',
    'whole-module-optimization',
    'complete-final-audit',
    'provider-packaging'
  ]);
  assert.equal(stages.find((entry) => entry.id === 'core-wasm-composition').owner, 'wasm-guest-link');
  assert.equal(stages.find((entry) => entry.id === 'provider-packaging').input, 'exact-audited-final-bytes');
  assert.match(design.pipeline.insertion, /^after-primary-assemblyscript-compilation-before-/);
}

function validateTrustAndDiagnostics(design) {
  assert.equal(new Set(design.trustChecks.map((entry) => entry.id)).size, design.trustChecks.length);
  assert.ok(design.trustChecks.length >= 10);
  assert.ok(design.trustChecks.every((entry) => entry.failure.startsWith('PULSE_GUEST_')));
  assert.equal(design.diagnostics.canonicalOwner, 'wasm-guest-link');
  for (const required of [
    'PULSE_GUEST_UNIT_INVALID',
    'PULSE_GUEST_UNIT_HASH_MISMATCH',
    'PULSE_GUEST_UNIT_OWNER_MISMATCH',
    'PULSE_GUEST_UNIT_ABI_MISMATCH',
    'PULSE_GUEST_UNIT_IMPORT_MISMATCH',
    'PULSE_GUEST_UNIT_EXPORT_MISMATCH',
    'PULSE_GUEST_UNIT_MEMORY_MISMATCH',
    'PULSE_GUEST_UNIT_START_MISMATCH',
    'PULSE_GUEST_UNIT_FEATURE_MISMATCH',
    'PULSE_GUEST_LINK_FAILED',
    'PULSE_GUEST_OPTIMIZATION_FAILED',
    'PULSE_GUEST_FINAL_AUDIT_FAILED'
  ]) {
    assert.ok(design.diagnostics.codes.includes(required), `diagnostics must include ${required}`);
  }
}

function assertCurrentSeam(touchpoint, source) {
  const checks = {
    'package-metadata': /sidecar/,
    'package-contract': /PACKAGE_NATIVE_LOWERING_TRUST_POLICY/,
    'lowerer-contributions': /realizationArtifacts/,
    'compiler-order': /provider-realization/,
    'native-realization': /realizeCanonicalNativePlan/,
    'build-artifacts': /ARTIFACT_ORDER/,
    'artifact-materialization': /getDefaultArtifactsDir/,
    'fastly-target-descriptor': /fastly-compute-native/,
    'node-target-descriptor': /node-native-host/,
    'diagnostic-catalog': /pulsewasm\.diagnostic-codes\.v1/,
    'release-manifest': /@pulse-compute\/wasm-compiler/,
    'generated-workspace-ignore': /wasm\/\.test-results/
  };
  assert.match(source, checks[touchpoint.seam], `${touchpoint.seam} no longer matches its B0 seam`);
  if (touchpoint.seam === 'generated-workspace-ignore') {
    const matches = source.match(/(?:^|\n)(?:\*\*\/)?\.pulse\/guests\/?(?=\n|$)/g) || [];
    assert.equal(matches.length, 1, 'the completed B2 seam must ignore exactly one generated .pulse/guests workspace pattern');
  }
  if (touchpoint.seam === 'release-manifest') {
    assert.match(source, /@pulse-compute\/wasm-guest-link/, 'the completed B4 seam must synchronize the guest-link package');
  }
}

function touchpointRecords(design) {
  const seams = new Set();
  return design.touchpoints.map((touchpoint) => {
    assert.equal(seams.has(touchpoint.seam), false, `duplicate touchpoint ${touchpoint.seam}`);
    seams.add(touchpoint.seam);
    assertRelativePath(touchpoint.path, `touchpoint ${touchpoint.seam}`);
    const file = path.join(repoRoot, touchpoint.path);
    assert.equal(fs.existsSync(file), true, `${touchpoint.seam} file must exist`);
    const source = fs.readFileSync(file, 'utf8');
    assertCurrentSeam(touchpoint, source);
    return Object.freeze({
      ...touchpoint,
      bytes: Buffer.byteLength(source),
      sha256: sha256(source)
    });
  });
}

function validateReplacementSeam(design) {
  const seam = design.componentModelReplacementSeam;
  assert.equal(seam.currentMechanism, design.contracts.guestUnitPlan.example.composition.kind);
  assert.equal(seam.futureMechanism, 'component-model');
  assert.equal(seam.replacementOwner, 'wasm-guest-link');
  assert.ok(seam.mustPreserve.includes('guest-link-report'));
  assert.ok(seam.mustPreserve.includes('final-wasm-audit'));
  assert.ok(seam.requiresNewContractVersionWhen.includes('semantic-abi-changes'));
  assert.ok(seam.doesNotAuthorize.includes('third-party-components'));
}

function renderMarkdown(evidence) {
  const design = evidence.design;
  const lines = [
    '# Guest-link B0 contract and pipeline design',
    '',
    `**Evidence:** ${evidence.version}  `,
    `**Status:** **${evidence.status.toUpperCase()}**  `,
    '**Next authorized unit:** B1 — internal guest-link package  ',
    `**Phase A decision:** ${design.decisionBinding.version} at \`${design.decisionBinding.sha256}\``,
    '',
    'B0 defines the internal contract and ownership boundary only. It does not',
    'implement linking, materialization, provider packaging, source builds, or a',
    'public guest registration surface.',
    '',
    '## Contract set',
    '',
    '| Artifact | Version | Authority |',
    '| --- | --- | --- |',
    `| Guest-unit manifest | \`${design.contractVersions.guestUnit}\` | Claims independently verified from packaged bytes |`,
    `| Guest-unit plan | \`${design.contractVersions.guestUnitPlan}\` | Compiler-selected, trust-bound plan |`,
    `| Guest-link report | \`${design.contractVersions.guestLinkReport}\` | Link/optimization provenance and before/after facts |`,
    `| Final Wasm audit | \`${design.contractVersions.finalWasmAudit}\` | Packaging gate over exact final bytes |`,
    '',
    'No contract contains an arbitrary executable, shell, argument-vector, or',
    'package-supplied build field. Source-build contracts remain unsealed.',
    '',
    '## Accepted memory ABI',
    '',
    `\`${design.acceptedMemoryAbi.identity}\` is bound to the exact A4 decision.`,
    'It retains one link-stage-owned fixed 32-page memory, synchronous read-only',
    'borrowed `(u32 pointer, u32 length)` input up to 4096 bytes, invalid status',
    '`0x80000000`, pairwise-disjoint configured ranges, no allocation or retention,',
    'and mandatory compose → whole-module optimize → complete final audit order.',
    '',
    '## Pipeline',
    '',
    '| Order | Stage | Owner | Output/input |',
    '| ---: | --- | --- | --- |'
  ];
  for (const stage of design.pipeline.stages) {
    const artifact = stage.output || stage.input;
    lines.push(`| ${stage.order} | ${stage.id} | ${stage.owner} | ${Array.isArray(artifact) ? artifact.join(', ') : artifact} |`);
  }
  lines.push(
    '',
    'Provider packaging is invoked only with the exact bytes bound by a passed',
    'final audit. Any selected-unit failure stops before packaging with fallback',
    'disabled.',
    '',
    '## Repository touchpoint map',
    '',
    '| Seam | Current file | B unit | Required change |',
    '| --- | --- | --- | --- |'
  );
  for (const touchpoint of evidence.touchpoints) {
    lines.push(`| ${touchpoint.seam} | \`${touchpoint.path}\` | ${touchpoint.implementationUnit} | ${touchpoint.change} |`);
  }
  lines.push(
    '',
    'Every mapped file existed and matched its expected current seam when this',
    'record was rendered. Exact byte counts and SHA-256 values are in the JSON',
    'evidence artifact.',
    '',
    '## Ownership',
    '',
    '- Package lowerers own semantic selection and contribute a distinct unit requirement.',
    '- The compiler owns collection, ordering, conflict rejection, and contextual reporting.',
    '- `@pulse-compute/wasm-guest-link` owns validation, materialization, composition, optimization, final audit, and normalized guest failures.',
    '- Provider descriptors contribute final-Wasm constraints; providers do not own generic composition.',
    '- The release manifest is an input to the closed first-party trust decision.',
    '',
    '## Replacement seam',
    '',
    'The stable boundary is validated unit + plan + target policy + primary core',
    'Wasm in, then one audited final artifact plus the same normalized reports out.',
    'Binaryen executable names and arguments are not package contracts. A future',
    'component-model engine may replace static core composition inside the',
    'guest-link owner, but ABI, memory, trust, or report meaning changes require',
    'new contract versions.',
    '',
    '## B0 validation',
    ''
  );
  for (const check of evidence.checks) lines.push(`- ${check}: passed`);
  lines.push('', '## Deferred', '');
  for (const item of design.deferred) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = fs.readFileSync(designFile, 'utf8');
  const design = JSON.parse(source);

  assert.equal(design.version, 'pulse.guest-link-contract-design.v1');
  assert.equal(design.status, 'accepted-for-b1');
  assert.deepEqual(design.contractVersions, {
    guestUnit: 'pulse.guest-unit.v1',
    guestUnitPlan: 'pulse.guest-unit-plan.v1',
    guestLinkReport: 'pulse.guest-link-report.v1',
    finalWasmAudit: 'pulse.final-wasm-audit.v1'
  });
  assert.equal(design.boundaries.visibility, 'internal-synchronized-first-party');
  assert.equal(design.boundaries.origin, 'package-prebuilt');
  assert.equal(design.boundaries.finalArtifactCount, 1);
  assert.equal(design.boundaries.fallback, false);
  assert.equal(design.boundaries.manifestMetadataIsAuthoritative, false);
  assert.equal(design.boundaries.sourceBuildContractSealed, false);
  assert.equal(design.boundaries.thirdPartyRegistration, false);

  const decisionFile = path.join(repoRoot, design.decisionBinding.file);
  assert.equal(fs.existsSync(decisionFile), true, 'B0 requires the accepted A4 decision record');
  const decision = fs.readFileSync(decisionFile);
  assert.equal(sha256(decision), design.decisionBinding.sha256, 'B0 must bind the exact accepted A4 decision');
  const decisionText = decision.toString('utf8');
  assert.match(decisionText, /\*\*Decision:\*\* \*\*PASS\*\*/);
  assert.match(decisionText, /\*\*Next authorized unit:\*\* B0/);
  assert.match(decisionText, /one first-party, independently compiled, host-neutral core Wasm guest/);

  const designText = JSON.stringify(design);
  assert.doesNotMatch(designText, /\b(?:crypto|jwt)\b/i, 'generic B0 design must not contain domain semantics');
  validateMemoryAbi(design.acceptedMemoryAbi);
  validateGuestUnit(design.contracts.guestUnit, design.acceptedMemoryAbi);
  validatePlan(design.contracts.guestUnitPlan, design.contracts.guestUnit);
  validateLinkReport(design.contracts.guestLinkReport, design.contracts.guestUnitPlan);
  validateFinalAudit(
    design.contracts.finalWasmAudit,
    design.contracts.guestLinkReport,
    design.acceptedMemoryAbi
  );
  validatePipeline(design);
  validateTrustAndDiagnostics(design);
  validateReplacementSeam(design);
  const touchpoints = touchpointRecords(design);

  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    status: 'passed',
    nextAuthorizedUnit: 'B1',
    sources: Object.freeze([
      fileRecord(harnessFile),
      fileRecord(designFile),
      fileRecord(decisionFile)
    ]),
    checks: Object.freeze([
      'exact-a4-decision-bound',
      'minimal-versioned-contract-set',
      'manifest-has-no-execution-fields',
      'manifest-claims-independently-verified',
      'accepted-memory-abi-exact',
      'first-party-trust-fail-closed',
      'pipeline-order-and-ownership',
      'reports-complete-and-redacted',
      'provider-receives-audited-final-bytes',
      'component-model-replacement-contained',
      'compiler-core-domain-neutral',
      'repository-touchpoints-current'
    ]),
    touchpoints: Object.freeze(touchpoints),
    design
  });

  const json = stableJson(evidence);
  const markdown = renderMarkdown(evidence);
  assert.equal(json, stableJson(evidence), 'B0 JSON rendering must be deterministic');
  assert.equal(markdown, renderMarkdown(evidence), 'B0 Markdown rendering must be deterministic');
  assert.doesNotMatch(json, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'JSON must not contain absolute repository paths');
  assert.doesNotMatch(markdown, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Markdown must not contain absolute repository paths');

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const jsonFile = path.join(options.outputDirectory, 'guest-link-contract-design.json');
  const markdownFile = path.join(options.outputDirectory, 'guest-link-touchpoint-map.md');
  fs.writeFileSync(jsonFile, json);
  fs.writeFileSync(markdownFile, markdown);

  const jsonRecord = fileRecord(jsonFile);
  const markdownRecord = fileRecord(markdownFile);
  console.log(
    `ok - B0 contract design passed; ${design.touchpoints.length} seams, ` +
    `${design.trustChecks.length} trust checks, JSON ${jsonRecord.sha256}, map ${markdownRecord.sha256}`
  );
}

main();
