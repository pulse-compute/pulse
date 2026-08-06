'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  versions,
  diagnosticCodes,
  memoryAbi,
  memoryAbiV2
} = require('./constants.js');
const { fail, wrap } = require('./errors.js');
const { normalizeGuestUnitPlan, optimizationArguments } = require('./contracts.js');
const { materializePackagePrebuilt } = require('./materialize.js');
const { inspectWasmFile, reportInspection, surfaceImport, surfaceExport } = require('./inspect.js');
const { runTool, binaryenIdentity } = require('./toolchain.js');
const { fileRecord, stableJson, writeAtomic } = require('./files.js');

function sortedSurface(values) {
  return values.slice().sort((first, second) => (
    compareText(String(first.module || ''), String(second.module || ''))
    || compareText(first.name, second.name)
    || compareText(first.kind, second.kind)
  ));
}

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function targetImport(entry) {
  return Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind });
}

function equal(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function segmentFacts(values) {
  return values
    .map((entry) => ({
      memoryIndex: entry.memoryIndex,
      offset: entry.offset,
      endExclusive: entry.endExclusive,
      bytes: entry.bytes,
      sha256: entry.sha256
    }))
    .sort((first, second) => (
      first.memoryIndex - second.memoryIndex
      || first.offset - second.offset
      || compareText(first.sha256, second.sha256)
    ));
}

function rangeContains(range, segment) {
  return segment.offset >= range.start && segment.endExclusive <= range.endExclusive;
}

function memoryContractForPlan(plan) {
  return plan.version === versions.guestUnitPlanV2 ? memoryAbiV2 : memoryAbi;
}

function memoryContractForManifest(manifest) {
  return manifest.version === versions.guestUnitV2 ? memoryAbiV2 : memoryAbi;
}

function pairwiseDisjoint(ranges) {
  const sorted = ranges.slice().sort((left, right) => left.start - right.start);
  return sorted.every((range, index) => (
    range.start >= 0
    && range.endExclusive > range.start
    && (index === 0 || sorted[index - 1].endExclusive <= range.start)
  ));
}

function memoryLayoutProof(plan, before, inspection, stage) {
  const contract = memoryContractForPlan(plan);
  const expectedSegments = segmentFacts([
    ...before.owner.dataSegments,
    ...before.primary.dataSegments,
    ...before.guest.dataSegments
  ]);
  const observedSegments = segmentFacts(inspection.dataSegments);
  const ranges = [
    Object.freeze({
      id: 'rust-stack',
      ...contract.layout.rustStack,
      disposition: plan.version === versions.guestUnitPlanV2
        ? 'stack-and-transient-fixed-scratch'
        : 'reserved-stack'
    }),
    Object.freeze({
      id: 'rust-static-data',
      ...contract.layout.rustStatic,
      disposition: 'reserved-static-region'
    }),
    Object.freeze({
      id: 'primary-static-data',
      ...contract.layout.primaryStatic,
      disposition: 'reserved-static-region'
    })
  ];
  if (plan.version === versions.guestUnitPlanV2) {
    ranges.push(Object.freeze({
      id: 'private-invocation-frame-v2',
      ...contract.layout.invocationFrame,
      disposition: 'caller-owned-cleared-after-scalar-capture'
    }));
  } else {
    ranges.push(Object.freeze({
      id: 'borrowed-input',
      ...contract.layout.borrowedInput,
      disposition: 'synchronous-read-only'
    }));
  }
  if (!pairwiseDisjoint(ranges)) {
    fail(diagnosticCodes.finalAuditFailed, `${stage} memory reservations overlap.`);
  }
  for (const segment of observedSegments) {
    if (
      !rangeContains(contract.layout.rustStatic, segment)
      && !rangeContains(contract.layout.primaryStatic, segment)
    ) {
      fail(diagnosticCodes.finalAuditFailed, `${stage} contains static data outside its reserved regions.`);
    }
  }
  return Object.freeze({
    stage,
    memoryIdentity: contract.identity,
    fixedMemory: Object.freeze({
      pages: contract.minimumPages,
      bytes: contract.bytes,
      growable: false
    }),
    ranges: Object.freeze(ranges.map((range) => Object.freeze({
      ...range,
      bytes: range.endExclusive - range.start,
      observedDataSegments: Object.freeze(observedSegments.filter((segment) => rangeContains(range, segment)))
    }))),
    fixedScratch: Object.freeze({
      separateRange: false,
      location: plan.version === versions.guestUnitPlanV2
        ? 'rust-stack'
        : 'none-observed'
    }),
    outputStatus: Object.freeze({
      representation: 'scalar-i32-function-result',
      linearMemoryRange: null
    }),
    expectedStaticSegments: Object.freeze(expectedSegments),
    observedStaticSegments: Object.freeze(observedSegments),
    staticSegmentsMatchValidatedInputs: equal(expectedSegments, observedSegments),
    occupiedAndReservedRangesPairwiseDisjoint: true
  });
}

function assertMemoryType(inspection, ownership, label, contract) {
  const expectedType = [{
    minimumPages: contract.minimumPages,
    maximumPages: contract.maximumPages,
    shared: false
  }];
  if (
    inspection.memories !== 1
    || inspection.importedMemories !== ownership.imported
    || inspection.definedMemories !== ownership.defined
    || !equal(inspection.memoryTypes, expectedType)
  ) {
    fail(diagnosticCodes.memoryMismatch, `${label} does not use the accepted fixed 32-page memory.`);
  }
  if (inspection.hasStart) fail(diagnosticCodes.startMismatch, `${label} has a forbidden start section.`);
  if (inspection.features.length) fail(diagnosticCodes.featureMismatch, `${label} uses a feature outside the MVP baseline.`);
  if (
    inspection.instructions.memoryGrow
    || inspection.instructions.memoryCopy
    || inspection.instructions.memoryFill
    || inspection.instructions.memoryInit
    || inspection.instructions.callIndirect
  ) {
    fail(diagnosticCodes.memoryMismatch, `${label} violates the accepted fixed-memory instruction policy.`);
  }
}

function assertPrimaryAndOwner(plan, manifest, primary, owner) {
  const contract = memoryContractForManifest(manifest);
  assertMemoryType(primary, { imported: 1, defined: 0 }, 'Primary module', contract);
  assertMemoryType(owner, { imported: 0, defined: 1 }, 'Memory-owner module', contract);
  if (owner.imports.length !== 0 || owner.exports.length !== 1) {
    fail(diagnosticCodes.memoryMismatch, 'Memory-owner module must contain only one exported memory.');
  }
  const ownerExport = owner.exports[0];
  if (ownerExport.name !== contract.importName || ownerExport.kind !== 'memory') {
    fail(diagnosticCodes.memoryMismatch, 'Memory-owner export must be env.memory.');
  }
  if (
    owner.dataSegments.length
    || owner.mutableGlobals.length
    || Object.values(owner.instructions).some((count) => count !== 0)
    || owner.tables !== 0
  ) {
    fail(diagnosticCodes.memoryMismatch, 'Memory-owner module must be inert.');
  }

  const abiExports = manifest.exports.filter((entry) => entry.role === 'abi');
  const guestImports = primary.imports.filter((entry) => entry.module === manifest.module);
  const expectedGuestImports = abiExports.map((entry) => ({
    module: manifest.module,
    name: entry.name,
    kind: entry.kind,
    type: { parameters: entry.parameters, results: entry.results }
  }));
  if (!equal(guestImports.map(surfaceImport), expectedGuestImports)) {
    fail(diagnosticCodes.abiMismatch, 'Primary guest imports do not exactly match the selected guest ABI.');
  }
  const memoryImports = primary.imports.filter((entry) => entry.kind === 'memory');
  if (
    memoryImports.length !== 1
    || memoryImports[0].module !== plan.composition.memoryOwnerModule
    || memoryImports[0].name !== contract.importName
  ) {
    fail(diagnosticCodes.memoryMismatch, 'Primary memory import does not bind to the accepted memory owner.');
  }
  const unresolved = primary.imports.filter((entry) => (
    entry.module !== manifest.module
    && !(entry.kind === 'memory' && entry.module === plan.composition.memoryOwnerModule && entry.name === contract.importName)
  )).map(targetImport);
  if (!equal(sortedSurface(unresolved), sortedSurface(plan.targetPolicy.allowedImports))) {
    fail(diagnosticCodes.importMismatch, 'Primary host imports do not match the selected target policy.');
  }
  for (const segment of primary.dataSegments) {
    if (!rangeContains(contract.layout.primaryStatic, segment)) {
      fail(diagnosticCodes.memoryMismatch, 'Primary static data escapes its reserved region.');
    }
  }
}

function expectedFinalExports(primary, guest, owner) {
  const values = [
    ...owner.exports.map(surfaceExport),
    ...primary.exports.map(surfaceExport),
    ...guest.exports.map(surfaceExport)
  ];
  const names = values.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    fail(diagnosticCodes.exportMismatch, 'Guest composition inputs contain conflicting export names.');
  }
  return sortedSurface(values);
}

function assertFinal(plan, before, final) {
  const contract = memoryContractForPlan(plan);
  const allowedImports = sortedSurface(plan.targetPolicy.allowedImports);
  const actualImports = sortedSurface(final.imports.map(targetImport));
  if (!equal(actualImports, allowedImports)) {
    fail(diagnosticCodes.finalAuditFailed, 'Final Wasm imports do not match the target policy.', {
      expected: allowedImports,
      actual: actualImports
    });
  }
  const expectedExports = expectedFinalExports(before.primary, before.guest, before.owner);
  const actualExports = sortedSurface(final.exports.map(surfaceExport));
  if (!equal(actualExports, expectedExports)) {
    fail(diagnosticCodes.finalAuditFailed, 'Final Wasm exports do not exactly preserve the validated input surface.');
  }
  for (const required of plan.targetPolicy.requiredExports) {
    if (!actualExports.some((entry) => entry.name === required.name && entry.kind === required.kind)) {
      fail(diagnosticCodes.finalAuditFailed, `Final Wasm is missing target-required export ${required.name}.`);
    }
  }
  assertMemoryType(final, { imported: 0, defined: 1 }, 'Final Wasm', contract);
  const inputMutableGlobals = before.primary.mutableGlobals.length
    + before.guest.mutableGlobals.length
    + before.owner.mutableGlobals.length;
  const inputTables = before.primary.tables + before.guest.tables + before.owner.tables;
  const inputGlobalSets = before.primary.instructions.globalSet
    + before.guest.instructions.globalSet
    + before.owner.instructions.globalSet;
  const inputStores = before.primary.instructions.store
    + before.guest.instructions.store
    + before.owner.instructions.store;
  if (
    final.mutableGlobals.length > inputMutableGlobals
    || final.tables > inputTables
    || final.instructions.globalSet > inputGlobalSets
    || (
      plan.version === versions.guestUnitPlanV2
      && final.instructions.store > inputStores
    )
  ) {
    fail(
      diagnosticCodes.finalAuditFailed,
      plan.version === versions.guestUnitPlanV2
        ? 'Final Wasm introduces mutable state or writes absent from the validated inputs.'
        : 'Final Wasm introduces mutable global or indirect state absent from the validated inputs.'
    );
  }
  const expectedSegments = segmentFacts([
    ...before.owner.dataSegments,
    ...before.primary.dataSegments,
    ...before.guest.dataSegments
  ]);
  const actualSegments = segmentFacts(final.dataSegments);
  if (!equal(actualSegments, expectedSegments)) {
    fail(diagnosticCodes.finalAuditFailed, 'Final Wasm did not preserve validated static data segments exactly.');
  }
  for (const segment of final.dataSegments) {
    if (
      !rangeContains(contract.layout.rustStatic, segment)
      && !rangeContains(contract.layout.primaryStatic, segment)
    ) {
      fail(diagnosticCodes.finalAuditFailed, 'Final Wasm static data escapes accepted reserved regions.');
    }
  }
}

function redactionRecord() {
  return Object.freeze({
    environmentSecrets: 'omitted',
    credentials: 'omitted',
    privateMaterial: 'omitted',
    rawBuffers: 'omitted',
    diagnosticStrategy: 'key-classification-pattern-and-environment-value-redaction'
  });
}

function evidenceClassification() {
  return Object.freeze({
    observedFacts: Object.freeze([
      'packaged-hashes-verified',
      'input-bytes-independently-inspected',
      'validated-inputs-composed',
      'post-link-bytes-optimized',
      'final-bytes-independently-audited'
    ]),
    toolDocumentedBehavior: Object.freeze([]),
    inferences: Object.freeze([]),
    unresolvedAssumptions: Object.freeze([])
  });
}

function finalAudit(plan, before, afterLink, final, artifactRecord) {
  const contract = memoryContractForPlan(plan);
  const beforeOptimization = memoryLayoutProof(plan, before, afterLink, 'before-optimization');
  const afterOptimization = memoryLayoutProof(plan, before, final, 'after-optimization');
  if (
    !beforeOptimization.staticSegmentsMatchValidatedInputs
    || !afterOptimization.staticSegmentsMatchValidatedInputs
  ) {
    fail(diagnosticCodes.finalAuditFailed, 'Static layout changed across guest composition or optimization.');
  }
  const validatedInputWrites = Object.freeze({
    globalSet: before.primary.instructions.globalSet
      + before.guest.instructions.globalSet
      + before.owner.instructions.globalSet,
    store: before.primary.instructions.store
      + before.guest.instructions.store
      + before.owner.instructions.store
  });
  return Object.freeze({
    version: plan.version === versions.guestUnitPlanV2
      ? versions.finalWasmAuditV2
      : versions.finalWasmAudit,
    status: 'passed',
    artifact: Object.freeze({
      file: 'canonical-native.wasm',
      bytes: artifactRecord.bytes,
      sha256: artifactRecord.sha256,
      valid: final.valid
    }),
    targetPolicy: Object.freeze({
      descriptorIdentity: plan.targetPolicy.descriptorIdentity,
      descriptorSha256: plan.targetPolicy.descriptorSha256
    }),
    structure: Object.freeze({
      imports: Object.freeze(final.imports.map(surfaceImport)),
      exports: Object.freeze(final.exports.map(surfaceExport)),
      definedMemories: final.definedMemories,
      importedMemories: final.importedMemories,
      memoryTypes: final.memoryTypes,
      hasStart: final.hasStart,
      features: final.features,
      dataSegments: Object.freeze(segmentFacts(final.dataSegments)),
      mutableGlobals: final.mutableGlobals,
      tables: final.tables
    }),
    instructions: Object.freeze({
      memoryGrow: final.instructions.memoryGrow,
      memoryCopy: final.instructions.memoryCopy,
      memoryFill: final.instructions.memoryFill,
      memoryInit: final.instructions.memoryInit,
      callIndirect: final.instructions.callIndirect,
      ...(plan.version === versions.guestUnitPlanV2 ? {
        globalSet: final.instructions.globalSet,
        store: final.instructions.store
      } : {})
    }),
    ...(plan.version === versions.guestUnitPlanV2 ? {
      mutableState: Object.freeze({
        globals: final.mutableGlobals,
        authorization: 'reviewed-es256-stack-pointer-and-stack-transient-writes',
        validatedInputWrites,
        finalWrites: Object.freeze({
          globalSet: final.instructions.globalSet,
          store: final.instructions.store
        }),
        noAdditionalWritesIntroduced: true
      })
    } : {}),
    layout: Object.freeze({
      memoryContract: contract.identity,
      occupiedAndReservedRangesPairwiseDisjoint: true,
      staticSegmentsPreserved: true,
      ...(plan.version === versions.guestUnitPlanV2 ? {
        beforeOptimization,
        afterOptimization
      } : {})
    }),
    checks: Object.freeze([
      Object.freeze({ id: 'artifact-hash', status: 'passed' }),
      Object.freeze({ id: 'target-policy', status: 'passed' }),
      Object.freeze({ id: 'guest-contract', status: 'passed' }),
      Object.freeze({ id: 'fixed-memory', status: 'passed' }),
      Object.freeze({ id: 'static-layout', status: 'passed' }),
      Object.freeze({ id: 'forbidden-instructions', status: 'passed' })
    ]),
    providerPackaging: Object.freeze({
      authorized: true,
      auditArtifactSha256MatchesInput: true
    }),
    evidenceClassification: evidenceClassification(),
    redaction: redactionRecord()
  });
}

function guestLinkReport(plan, materialized, before, afterLink, final, records, toolchain, posture) {
  const linker = toolchain.tools.find((entry) => entry.name === 'wasm-merge');
  const optimizer = toolchain.tools.find((entry) => entry.name === 'wasm-opt');
  return Object.freeze({
    version: plan.version === versions.guestUnitPlanV2
      ? versions.guestLinkReportV2
      : versions.guestLinkReport,
    status: 'passed',
    profile: plan.profile,
    target: plan.target,
    units: Object.freeze([
      Object.freeze({
        id: materialized.manifest.id,
        module: materialized.manifest.module,
        owner: materialized.manifest.owner,
        packageVersion: materialized.manifest.packageVersion,
        origin: materialized.manifest.origin,
        abi: materialized.manifest.abi,
        artifactSha256: materialized.artifactRecord.sha256,
        sourceIncluded: materialized.sourceRecord.included,
        sourceSha256: materialized.sourceRecord.treeSha256,
        ...(materialized.manifest.version === versions.guestUnitV2 ? {
          manifestVersion: materialized.manifest.version,
          memoryIdentity: materialized.manifest.memory.identity,
          frame: plan.unit.frame,
          toolchain: plan.unit.toolchain
        } : {}),
        provenance: Object.freeze({
          packageManifest: materialized.provenance.packageManifest,
          lockfile: materialized.provenance.lockfile,
          ...(materialized.manifest.version === versions.guestUnitV2
            ? { buildScript: materialized.provenance.buildScript }
            : {}),
          source: materialized.provenance.source
        })
      })
    ]),
    inputs: Object.freeze({
      primary: records.primary,
      memoryOwner: records.owner,
      guest: records.guest
    }),
    materialization: Object.freeze({
      directory: materialized.relativeDirectory,
      cache: 'content-addressed',
      hashVerifiedBeforeUse: true
    }),
    inspection: Object.freeze({
      before: Object.freeze({
        primary: reportInspection(before.primary),
        memoryOwner: reportInspection(before.owner),
        guest: reportInspection(before.guest)
      }),
      composed: reportInspection(afterLink),
      after: reportInspection(final)
    }),
    composition: Object.freeze({
      kind: plan.composition.kind,
      implementation: Object.freeze({
        name: toolchain.name,
        version: toolchain.version,
        tool: linker.name,
        sha256: linker.sha256
      }),
      deterministic: true,
      outputSha256: records.composed.sha256
    }),
    optimization: Object.freeze({
      postLink: true,
      implementation: Object.freeze({
        name: toolchain.name,
        version: toolchain.version,
        tool: optimizer.name,
        sha256: optimizer.sha256
      }),
      posture,
      deterministic: true,
      inputSha256: records.composed.sha256,
      outputSha256: records.final.sha256
    }),
    ...(plan.version === versions.guestUnitPlanV2 ? {
      memoryLayout: Object.freeze({
        beforeOptimization: memoryLayoutProof(plan, before, afterLink, 'before-optimization'),
        afterOptimization: memoryLayoutProof(plan, before, final, 'after-optimization')
      })
    } : {}),
    finalArtifact: Object.freeze({
      file: 'canonical-native.wasm',
      bytes: records.final.bytes,
      sha256: records.final.sha256
    }),
    fallback: Object.freeze({ enabled: false, used: false }),
    evidenceClassification: evidenceClassification(),
    redaction: redactionRecord()
  });
}

function ensureOutputDirectory(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    return fs.realpathSync(directory);
  } catch {
    fail(diagnosticCodes.invalid, 'Guest-link output directory could not be created.');
  }
}

function assertFinalArtifactIdentity(file, audit) {
  if (
    !audit
    || (audit.version !== versions.finalWasmAudit && audit.version !== versions.finalWasmAuditV2)
    || audit.status !== 'passed'
    || !audit.artifact
  ) {
    fail(diagnosticCodes.finalAuditFailed, 'Final Wasm audit identity is missing or unsupported.');
  }
  let observed;
  try {
    observed = fileRecord(fs.realpathSync(file));
  } catch (error) {
    wrap(error, diagnosticCodes.finalAuditFailed, 'Final Wasm artifact could not be read for identity verification.');
  }
  if (
    observed.bytes !== audit.artifact.bytes
    || observed.sha256 !== audit.artifact.sha256
  ) {
    fail(diagnosticCodes.finalAuditFailed, 'Final Wasm bytes do not match their completed audit.', {
      expected: {
        bytes: audit.artifact.bytes,
        sha256: audit.artifact.sha256
      },
      observed
    });
  }
  return Object.freeze(observed);
}

function assertSelectedToolchain(plan, manifest, toolchain) {
  if (plan.version !== versions.guestUnitPlanV2) return;
  const optimizer = toolchain.tools.find((entry) => entry.name === 'wasm-opt');
  if (
    !optimizer
    || toolchain.version !== manifest.toolchain.versions.binaryen
    || toolchain.version !== plan.unit.toolchain.binaryenVersion
    || optimizer.sha256 !== manifest.provenance.binaryenWasmOptSha256
    || optimizer.sha256 !== plan.unit.toolchain.wasmOptSha256
  ) {
    fail(
      diagnosticCodes.optimizationFailed,
      'Pinned Binaryen identity does not match the selected ES256 guest plan.'
    );
  }
}

function realizeGuestLinkPlan(options) {
  const plan = normalizeGuestUnitPlan(options.plan);
  const outputDirectory = ensureOutputDirectory(options.outputDirectory);
  const workDirectory = ensureOutputDirectory(path.join(outputDirectory, '.guest-link-work'));
  const posture = plan.version === versions.guestUnitPlanV2
    ? plan.optimization.posture
    : options.optimizationPosture || 'native-size';
  if (
    plan.version === versions.guestUnitPlanV2
    && options.optimizationPosture !== undefined
    && options.optimizationPosture !== posture
  ) {
    fail(
      diagnosticCodes.optimizationFailed,
      'Guest-link optimization option does not match the exact v2 realization plan.'
    );
  }
  const optimizationArgs = optimizationArguments(posture);
  const toolchain = binaryenIdentity();

  const materialized = materializePackagePrebuilt({
    plan,
    packageRoot: options.packageRoot,
    manifestFile: options.manifestFile,
    projectRoot: options.projectRoot,
    synchronizedPackages: options.synchronizedPackages,
    workDirectory
  });
  assertSelectedToolchain(plan, materialized.manifest, toolchain);

  let primaryFile;
  let ownerFile;
  try {
    primaryFile = fs.realpathSync(options.primaryFile);
    ownerFile = fs.realpathSync(options.memoryOwnerFile);
    if (!fs.statSync(primaryFile).isFile() || !fs.statSync(ownerFile).isFile()) throw new Error('not files');
  } catch {
    fail(diagnosticCodes.invalid, 'Guest-link primary and memory-owner inputs must be existing files.');
  }
  const before = Object.freeze({
    primary: inspectWasmFile(primaryFile, { label: 'primary-input', workDirectory }),
    owner: inspectWasmFile(ownerFile, { label: 'memory-owner-input', workDirectory }),
    guest: materialized.inspection
  });
  assertPrimaryAndOwner(plan, materialized.manifest, before.primary, before.owner);

  const composedFile = path.join(outputDirectory, 'guest-link-composed.wasm');
  try {
    runTool('wasm-merge', [
      ownerFile,
      plan.composition.memoryOwnerModule,
      primaryFile,
      plan.composition.primaryModule,
      materialized.artifactFile,
      materialized.manifest.module,
      '--mvp-features',
      '-o',
      composedFile
    ], {
      cwd: workDirectory,
      failureCode: diagnosticCodes.linkFailed,
      failureMessage: `Guest unit ${materialized.manifest.id} could not be composed.`
    });
  } catch (error) {
    wrap(error, diagnosticCodes.linkFailed, `Guest unit ${materialized.manifest.id} could not be composed.`);
  }
  const afterLink = inspectWasmFile(composedFile, {
    label: 'composed-input',
    workDirectory,
    failureCode: diagnosticCodes.linkFailed
  });
  try {
    assertFinal(plan, before, afterLink);
  } catch (error) {
    if (error && error.code === diagnosticCodes.finalAuditFailed) {
      fail(diagnosticCodes.linkFailed, 'Composed Wasm violates the validated input contract.', { cause: error.message });
    }
    throw error;
  }

  const finalFile = path.join(outputDirectory, 'canonical-native.wasm');
  runTool('wasm-opt', [
    composedFile,
    ...optimizationArgs,
    '-o',
    finalFile
  ], {
    cwd: workDirectory,
    failureCode: diagnosticCodes.optimizationFailed,
    failureMessage: 'Post-link whole-module optimization failed.'
  });
  const final = inspectWasmFile(finalFile, {
    label: 'optimized-final',
    workDirectory,
    failureCode: diagnosticCodes.finalAuditFailed,
    featureFailureCode: diagnosticCodes.finalAuditFailed
  });
  assertFinal(plan, before, final);
  const finalWatFile = path.join(workDirectory, 'optimized-final.wat');

  const records = Object.freeze({
    primary: fileRecord(primaryFile),
    owner: fileRecord(ownerFile),
    guest: fileRecord(materialized.artifactFile),
    composed: fileRecord(composedFile),
    final: fileRecord(finalFile)
  });
  const audit = finalAudit(plan, before, afterLink, final, records.final);
  const report = guestLinkReport(plan, materialized, before, afterLink, final, records, toolchain, posture);
  const reportFile = path.join(outputDirectory, 'guest-link-report.json');
  const auditFile = path.join(outputDirectory, 'final-wasm-audit.json');
  writeAtomic(reportFile, stableJson(report));
  writeAtomic(auditFile, stableJson(audit));

  return Object.freeze({
    plan,
    materialization: Object.freeze({
      directory: materialized.relativeDirectory,
      reused: materialized.reused,
      artifactFile: materialized.artifactFile,
      manifestFile: materialized.manifestFile
    }),
    files: Object.freeze({
      composed: composedFile,
      final: finalFile,
      finalWat: finalWatFile,
      guestLinkReport: reportFile,
      finalWasmAudit: auditFile
    }),
    report,
    audit,
    toolchain
  });
}

module.exports = Object.freeze({
  realizeGuestLinkPlan,
  assertPrimaryAndOwner,
  assertFinal,
  assertFinalArtifactIdentity,
  memoryLayoutProof,
  segmentFacts
});
