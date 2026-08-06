'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeGuestUnitManifest,
  normalizeGuestUnitPlan,
  assertPlanMatchesManifest
} = require('./contracts.js');
const {
  versions,
  diagnosticCodes,
  memoryAbi,
  memoryAbiV2
} = require('./constants.js');
const { fail, wrap } = require('./errors.js');
const {
  fileRecord,
  sourceTreeRecord,
  resolveExistingContained,
  ensureContainedDirectory,
  inside
} = require('./files.js');
const { inspectWasmFile, surfaceImport, surfaceExport } = require('./inspect.js');

function compare(value, expected, code, message, details) {
  if (Buffer.isBuffer(value) && Buffer.isBuffer(expected)) {
    if (!value.equals(expected)) fail(code, message, details);
    return;
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail(code, message, details);
}

function normalizedManifestExports(manifest) {
  return manifest.exports.map((entry) => Object.freeze({
    name: entry.name,
    kind: entry.kind,
    parameters: entry.parameters,
    results: entry.results
  }));
}

function memoryContract(manifest) {
  return manifest.memory.identity === versions.memoryAbiV2 ? memoryAbiV2 : memoryAbi;
}

function planArtifactSha256(plan) {
  return plan.version === versions.guestUnitPlanV2
    ? plan.unit.artifact.sha256
    : plan.unit.artifactSha256;
}

function resolveManifestContained(packageRoot, manifestSourceFile, relative, field, expectedKind = 'file') {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)) {
    fail(diagnosticCodes.invalid, `${field} must be a normalized manifest-relative path.`);
  }
  const candidate = path.resolve(path.dirname(manifestSourceFile), relative);
  if (!inside(packageRoot, candidate) || !fs.existsSync(candidate)) {
    fail(diagnosticCodes.invalid, `${field} does not resolve to an existing contained ${expectedKind}.`);
  }
  const real = fs.realpathSync(candidate);
  if (!inside(packageRoot, real)) fail(diagnosticCodes.invalid, `${field} escapes its package root.`);
  const stat = fs.statSync(real);
  if ((expectedKind === 'file' && !stat.isFile()) || (expectedKind === 'directory' && !stat.isDirectory())) {
    fail(diagnosticCodes.invalid, `${field} must resolve to a ${expectedKind}.`);
  }
  return real;
}

function resolveManifestAsset(packageRoot, manifestSourceFile, manifest, relative, field, expectedKind = 'file') {
  if (manifest.version === versions.guestUnitV2) {
    return resolveManifestContained(packageRoot, manifestSourceFile, relative, field, expectedKind);
  }
  return resolveExistingContained(packageRoot, relative, field, expectedKind);
}

function assertGuestBinary(manifest, inspection) {
  const contract = memoryContract(manifest);
  compare(
    inspection.imports.map(surfaceImport),
    manifest.imports,
    diagnosticCodes.importMismatch,
    `Guest unit ${manifest.id} binary imports do not match its manifest.`
  );
  compare(
    inspection.exports.map(surfaceExport),
    normalizedManifestExports(manifest),
    diagnosticCodes.exportMismatch,
    `Guest unit ${manifest.id} binary exports do not match its manifest.`
  );
  if (
    inspection.memories !== 1
    || inspection.importedMemories !== 1
    || inspection.definedMemories !== 0
    || JSON.stringify(inspection.memoryTypes) !== JSON.stringify([{
      minimumPages: contract.minimumPages,
      maximumPages: contract.maximumPages,
      shared: false
    }])
  ) {
    fail(diagnosticCodes.memoryMismatch, `Guest unit ${manifest.id} binary violates its memory contract.`);
  }
  if (inspection.hasStart) fail(diagnosticCodes.startMismatch, `Guest unit ${manifest.id} binary has a forbidden start section.`);
  if (inspection.features.length !== 0) fail(diagnosticCodes.featureMismatch, `Guest unit ${manifest.id} binary uses unexpected features.`);
  if (
    inspection.tables !== 0
    || inspection.instructions.memoryGrow !== 0
    || inspection.instructions.memoryCopy !== 0
    || inspection.instructions.memoryFill !== 0
    || inspection.instructions.memoryInit !== 0
    || inspection.instructions.callIndirect !== 0
  ) {
    fail(diagnosticCodes.memoryMismatch, `Guest unit ${manifest.id} binary can mutate, grow, retain, or indirectly dispatch borrowed memory.`);
  }
  if (
    manifest.version === versions.guestUnit
    && (inspection.instructions.globalSet !== 0 || inspection.instructions.store !== 0)
  ) {
    fail(diagnosticCodes.memoryMismatch, `Guest unit ${manifest.id} binary can mutate borrowed-span memory.`);
  }
  if (manifest.version === versions.guestUnitV2) {
    if (
      inspection.globals !== 1
      || inspection.mutableGlobals.length !== 1
      || JSON.stringify(inspection.mutableGlobals[0]) !== JSON.stringify({
        name: 'global$0',
        type: 'i32',
        initializer: { instruction: 'i32.const', value: contract.layout.rustStack.endExclusive }
      })
      || inspection.instructions.globalSet !== 64
      || inspection.instructions.store !== 500
    ) {
      fail(
        diagnosticCodes.memoryMismatch,
        `Guest unit ${manifest.id} binary does not match the reviewed stack-only mutable-state posture.`
      );
    }
  }
  for (const segment of inspection.dataSegments) {
    if (
      segment.memoryIndex !== 0
      || segment.offset < contract.layout.rustStatic.start
      || segment.endExclusive > contract.layout.rustStatic.endExclusive
    ) {
      fail(diagnosticCodes.memoryMismatch, `Guest unit ${manifest.id} static data escapes its reserved region.`);
    }
  }
  if (
    manifest.version === versions.guestUnitV2
    && JSON.stringify(inspection.dataSegments.map((entry) => ({
      memoryIndex: entry.memoryIndex,
      offset: entry.offset,
      endExclusive: entry.endExclusive,
      bytes: entry.bytes,
      sha256: entry.sha256
    }))) !== JSON.stringify([{
      memoryIndex: 0,
      offset: 131072,
      endExclusive: 131656,
      bytes: 584,
      sha256: '231fcd9a2fc4e8190c8b96c9f89708b8039ea1b801cc564e32fbc14ff44e53ee'
    }])
  ) {
    fail(diagnosticCodes.memoryMismatch, `Guest unit ${manifest.id} static data does not match the reviewed layout.`);
  }
}

function synchronizedVersion(packages, name) {
  if (!Array.isArray(packages)) fail(diagnosticCodes.ownerMismatch, 'Guest trust requires the synchronized package catalog.');
  const matches = packages.filter((entry) => entry && entry.name === name);
  if (matches.length !== 1) fail(diagnosticCodes.ownerMismatch, `Guest owner ${name} is not uniquely synchronized.`);
  return matches[0].version;
}

function verifyPackageOwner(packageRoot, manifestSourceFile, manifest, synchronizedPackages) {
  const packageManifestFile = resolveManifestAsset(
    packageRoot,
    manifestSourceFile,
    manifest,
    manifest.provenance.packageManifest,
    'guest provenance package manifest'
  );
  const lockfileFile = resolveManifestAsset(
    packageRoot,
    manifestSourceFile,
    manifest,
    manifest.provenance.lockfile,
    'guest provenance lockfile'
  );
  let packageManifest;
  try {
    packageManifest = JSON.parse(fs.readFileSync(packageManifestFile, 'utf8'));
  } catch (error) {
    wrap(error, diagnosticCodes.ownerMismatch, 'Guest owner package manifest is invalid.');
  }
  const synchronized = synchronizedVersion(synchronizedPackages, manifest.owner);
  if (
    packageManifest.name !== manifest.owner
    || packageManifest.version !== manifest.packageVersion
    || synchronized !== manifest.packageVersion
  ) {
    fail(diagnosticCodes.ownerMismatch, `Guest unit ${manifest.id} owner or version does not match synchronized package identity.`, {
      owner: manifest.owner,
      packageVersion: manifest.packageVersion,
      observedOwner: packageManifest.name,
      observedVersion: packageManifest.version,
      synchronizedVersion: synchronized
    });
  }
  const lockfileRecord = fileRecord(lockfileFile);
  if (
    manifest.version === versions.guestUnitV2
    && lockfileRecord.sha256 !== manifest.provenance.cargoLockSha256
  ) {
    fail(diagnosticCodes.hashMismatch, `Guest unit ${manifest.id} lockfile does not match its declared identity.`);
  }
  let buildScriptFile;
  let buildScriptRecord;
  if (manifest.version === versions.guestUnitV2) {
    buildScriptFile = resolveManifestAsset(
      packageRoot,
      manifestSourceFile,
      manifest,
      manifest.provenance.buildScript,
      'guest provenance maintainer build script'
    );
    buildScriptRecord = fileRecord(buildScriptFile);
    if (buildScriptRecord.sha256 !== manifest.provenance.buildScriptSha256) {
      fail(
        diagnosticCodes.hashMismatch,
        `Guest unit ${manifest.id} maintainer build script does not match its declared identity.`
      );
    }
  }
  return Object.freeze({
    packageManifestFile,
    lockfileFile,
    buildScriptFile,
    packageManifestRecord: fileRecord(packageManifestFile),
    lockfileRecord,
    buildScriptRecord
  });
}

function verifyExistingMaterialization(directory, artifactBytes, manifestBytes, artifactName, manifestName) {
  const entries = fs.readdirSync(directory).sort();
  compare(entries, [manifestName, artifactName].sort(), diagnosticCodes.materializationFailed, 'Existing guest materialization contains unexpected files.');
  const artifactFile = path.join(directory, artifactName);
  const manifestFile = path.join(directory, manifestName);
  for (const file of [artifactFile, manifestFile]) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail(diagnosticCodes.materializationFailed, 'Existing guest materialization must contain regular files.');
    }
  }
  compare(fs.readFileSync(artifactFile), artifactBytes, diagnosticCodes.materializationFailed, 'Existing guest artifact bytes differ from the content address.');
  compare(fs.readFileSync(manifestFile), manifestBytes, diagnosticCodes.materializationFailed, 'Existing guest manifest bytes differ from the content address.');
}

function materializePackagePrebuilt(options) {
  const plan = normalizeGuestUnitPlan(options.plan);
  let packageRoot;
  try {
    packageRoot = fs.realpathSync(options.packageRoot);
    if (!fs.statSync(packageRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    fail(diagnosticCodes.invalid, 'Guest package root must be an existing directory.');
  }
  const manifestSourceFile = resolveExistingContained(packageRoot, options.manifestFile, 'guest unit manifest');
  const manifestBytes = fs.readFileSync(manifestSourceFile);
  const manifestRecord = fileRecord(manifestSourceFile);
  if (manifestRecord.sha256 !== plan.unit.manifestSha256) {
    fail(diagnosticCodes.hashMismatch, `Guest unit ${plan.unit.id} manifest hash does not match its plan.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    wrap(error, diagnosticCodes.invalid, `Guest unit ${plan.unit.id} manifest is not valid JSON.`);
  }
  const manifest = normalizeGuestUnitManifest(parsed);
  assertPlanMatchesManifest(plan, manifest);
  const owner = verifyPackageOwner(
    packageRoot,
    manifestSourceFile,
    manifest,
    options.synchronizedPackages
  );

  const artifactSourceFile = resolveManifestAsset(
    packageRoot,
    manifestSourceFile,
    manifest,
    manifest.artifact.file,
    'guest unit artifact'
  );
  const artifactRecord = fileRecord(artifactSourceFile);
  if (
    artifactRecord.bytes !== manifest.artifact.bytes
    || artifactRecord.sha256 !== manifest.artifact.sha256
    || artifactRecord.sha256 !== planArtifactSha256(plan)
  ) {
    fail(diagnosticCodes.hashMismatch, `Guest unit ${manifest.id} artifact bytes do not match their declared identity.`, {
      expectedBytes: manifest.artifact.bytes,
      expectedSha256: manifest.artifact.sha256,
      observedBytes: artifactRecord.bytes,
      observedSha256: artifactRecord.sha256
    });
  }

  let sourceRecord = Object.freeze({ included: false, treeSha256: null, files: 0, bytes: 0 });
  if (manifest.source) {
    const sourceDirectory = resolveManifestAsset(
      packageRoot,
      manifestSourceFile,
      manifest,
      manifest.source.directory,
      'guest unit source',
      'directory'
    );
    if (!inside(sourceDirectory, owner.lockfileFile)) {
      fail(diagnosticCodes.invalid, `Guest unit ${manifest.id} lockfile must be included in its source provenance directory.`);
    }
    const tree = sourceTreeRecord(sourceDirectory);
    if (
      tree.sha256 !== manifest.source.treeSha256
      || tree.sha256 !== plan.unit.source.treeSha256
      || (
        manifest.version === versions.guestUnitV2
        && tree.sha256 !== manifest.provenance.sourceTreeSha256
      )
    ) {
      fail(diagnosticCodes.hashMismatch, `Guest unit ${manifest.id} source tree does not match its declared identity.`);
    }
    sourceRecord = Object.freeze({
      included: true,
      treeSha256: tree.sha256,
      algorithm: tree.algorithm,
      files: tree.files.length,
      bytes: tree.bytes
    });
  }

  const inspection = inspectWasmFile(artifactSourceFile, {
    label: `${manifest.id}-packaged`,
    workDirectory: options.workDirectory
  });
  assertGuestBinary(manifest, inspection);

  let projectRoot;
  try {
    projectRoot = fs.realpathSync(options.projectRoot);
    if (!fs.statSync(projectRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    fail(diagnosticCodes.materializationFailed, 'Guest project root must be an existing directory.');
  }
  const parentRelative = path.posix.dirname(plan.materialization.directory);
  const parent = ensureContainedDirectory(projectRoot, parentRelative);
  const destination = path.join(parent, path.posix.basename(plan.materialization.directory));
  if (!inside(projectRoot, destination)) fail(diagnosticCodes.materializationFailed, 'Guest materialization destination escapes the project root.');
  const artifactBytes = fs.readFileSync(artifactSourceFile);
  let reused = false;
  if (fs.existsSync(destination)) {
    const realDestination = fs.realpathSync(destination);
    if (!inside(projectRoot, realDestination) || !fs.statSync(realDestination).isDirectory()) {
      fail(diagnosticCodes.materializationFailed, 'Existing guest materialization is not a contained directory.');
    }
    verifyExistingMaterialization(
      realDestination,
      artifactBytes,
      manifestBytes,
      plan.materialization.artifact,
      plan.materialization.manifest
    );
    reused = true;
  } else {
    const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(destination)}.staging-`));
    try {
      fs.writeFileSync(path.join(staging, plan.materialization.artifact), artifactBytes);
      fs.writeFileSync(path.join(staging, plan.materialization.manifest), manifestBytes);
      fs.renameSync(staging, destination);
    } catch (error) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      if (error && error.code === 'EEXIST' && fs.existsSync(destination)) {
        verifyExistingMaterialization(
          destination,
          artifactBytes,
          manifestBytes,
          plan.materialization.artifact,
          plan.materialization.manifest
        );
        reused = true;
      } else {
        wrap(error, diagnosticCodes.materializationFailed, `Guest unit ${manifest.id} could not be materialized.`);
      }
    }
  }

  return Object.freeze({
    plan,
    manifest,
    manifestRecord,
    artifactRecord,
    sourceRecord,
    provenance: Object.freeze({
      packageManifest: owner.packageManifestRecord,
      lockfile: owner.lockfileRecord,
      ...(manifest.version === versions.guestUnitV2
        ? { buildScript: owner.buildScriptRecord }
        : {}),
      source: sourceRecord
    }),
    inspection,
    artifactFile: path.join(destination, plan.materialization.artifact),
    manifestFile: path.join(destination, plan.materialization.manifest),
    relativeDirectory: plan.materialization.directory,
    reused
  });
}

module.exports = Object.freeze({
  assertGuestBinary,
  materializePackagePrebuilt
});
