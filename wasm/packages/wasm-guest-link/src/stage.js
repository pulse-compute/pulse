'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFinalWasmPolicy() {
  try {
    return require('@pulse-compute/wasm-contracts/provider/final-wasm-policy');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/provider/final-wasm-policy.js');
    }
    throw error;
  }
}

function loadPackageContract() {
  try {
    return require('@pulse-compute/wasm-contracts/package/package-contract');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/package/package-contract.js');
    }
    throw error;
  }
}

const {
  defineFinalWasmPolicy,
  projectFinalWasmPolicy
} = loadFinalWasmPolicy();
const {
  GUEST_UNIT_CONTRIBUTION_FIELDS,
  normalizeCanonicalGuestUnitContribution
} = loadPackageContract();
const guestLink = require('./index.js');
const { fail, wrap } = require('./errors.js');

const GUEST_LINK_STAGE_INVOCATION_VERSION = 'pulse.guest-link-stage-invocation.v1';
const GUEST_LINK_STAGE_RESULT_VERSION = 'pulse.guest-link-stage-result.v1';
const GUEST_LINK_STAGE_INVOCATION_FIELDS = Object.freeze([
  'version',
  'primaryWasm',
  'guestUnits',
  'projectRoot',
  'profile',
  'finalWasmPolicy',
  'synchronizedPackages',
  'optimizationPosture'
]);
const GUEST_LINK_STAGE_RESULT_FIELDS = Object.freeze([
  'version',
  'wasm',
  'wat',
  'guestUnits',
  'plan',
  'report',
  'audit',
  'materialization',
  'finalArtifact',
  'providerPackaging',
  'fallback'
]);
const FINAL_WASM_POLICY_FIELDS = Object.freeze([
  'version',
  'descriptorOwner',
  'toolchainVersion',
  'descriptorIdentity',
  'permittedImports',
  'requiredExports',
  'featureBaseline',
  'allowedFeatures',
  'memory',
  'start',
  'descriptorSha256'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, fields, label, code = guestLink.diagnosticCodes.invalid) {
  if (!plainObject(value)) fail(code, `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key)).sort();
  const missing = fields.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail(code, `${label} does not match its exact versioned field set.`, { unknown, missing });
  }
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(code, `${label}.${key} must be an enumerable data property.`);
    }
  }
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    fail(guestLink.diagnosticCodes.invalid, `${label} must be a normalized non-empty string.`);
  }
  return value;
}

function exactSemver(value, label) {
  const normalized = string(value, label);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    fail(guestLink.diagnosticCodes.ownerMismatch, `${label} must be an exact semantic version.`);
  }
  return normalized;
}

function normalizeContribution(value) {
  try {
    return normalizeCanonicalGuestUnitContribution(value);
  } catch (error) {
    wrap(error, guestLink.diagnosticCodes.invalid, 'Guest-link requires one exact canonical guest-unit contribution.');
  }
}

function normalizeFinalWasmPolicy(value) {
  exactKeys(value, FINAL_WASM_POLICY_FIELDS, 'Guest-link final-Wasm policy', 'PULSE_GUEST_TARGET_POLICY_REQUIRED');
  let normalized;
  try {
    normalized = defineFinalWasmPolicy({
      version: value.version,
      descriptorOwner: value.descriptorOwner,
      toolchainVersion: value.toolchainVersion,
      descriptorIdentity: value.descriptorIdentity,
      permittedImports: value.permittedImports,
      requiredExports: value.requiredExports
    });
  } catch (error) {
    wrap(error, 'PULSE_GUEST_TARGET_POLICY_REQUIRED', 'Guest-link requires a valid selected-target final-Wasm policy.');
  }
  if (JSON.stringify(stable(value)) !== JSON.stringify(stable(normalized))) {
    fail('PULSE_GUEST_TARGET_POLICY_REQUIRED', 'Guest-link final-Wasm policy does not match its normalized descriptor identity.');
  }
  return normalized;
}

function normalizeSynchronizedPackages(values) {
  if (!Array.isArray(values)) {
    fail(guestLink.diagnosticCodes.ownerMismatch, 'Guest-link requires an exact synchronized package catalog.');
  }
  const names = new Set();
  return Object.freeze(values.map((entry, index) => {
    exactKeys(entry, ['name', 'version'], `Guest-link synchronizedPackages[${index}]`, guestLink.diagnosticCodes.ownerMismatch);
    const name = string(entry.name, `Guest-link synchronizedPackages[${index}].name`);
    if (names.has(name)) {
      fail(guestLink.diagnosticCodes.ownerMismatch, `Guest-link synchronized package ${name} is duplicated.`);
    }
    names.add(name);
    return Object.freeze({
      name,
      version: exactSemver(entry.version, `Guest-link synchronizedPackages[${index}].version`)
    });
  }).sort((left, right) => left.name.localeCompare(right.name)));
}

function normalizeStageSelection(value, index) {
  exactKeys(value, ['contribution', 'packageRoot'], `Guest-link guestUnits[${index}]`);
  return Object.freeze({
    contribution: normalizeContribution(value.contribution),
    packageRoot: string(value.packageRoot, `Guest-link guestUnits[${index}].packageRoot`)
  });
}

function normalizeGuestLinkStageInvocation(input) {
  exactKeys(input, GUEST_LINK_STAGE_INVOCATION_FIELDS, 'Guest-link stage invocation');
  if (input.version !== GUEST_LINK_STAGE_INVOCATION_VERSION) {
    fail(
      guestLink.diagnosticCodes.invalid,
      `Guest-link stage invocation must use ${GUEST_LINK_STAGE_INVOCATION_VERSION}.`
    );
  }
  if (!Array.isArray(input.guestUnits)) {
    fail(guestLink.diagnosticCodes.invalid, 'Guest-link stage invocation.guestUnits must be an array.');
  }
  if (input.guestUnits.length !== 1) {
    fail(
      'PULSE_GUEST_UNIT_CARDINALITY_UNSUPPORTED',
      'The initial guest-unit composition contract accepts exactly one selected unit.',
      {
        selected: input.guestUnits.map((entry) => entry && entry.contribution && entry.contribution.id).filter(Boolean).sort(),
        automaticFallback: false
      }
    );
  }
  if (!Buffer.isBuffer(input.primaryWasm)) {
    fail(guestLink.diagnosticCodes.invalid, 'Guest-link stage invocation.primaryWasm must be exact primary Wasm bytes.');
  }
  const optimizationPosture = string(
    input.optimizationPosture,
    'Guest-link stage invocation.optimizationPosture'
  );
  if (!['native-default', 'native-size'].includes(optimizationPosture)) {
    fail(
      guestLink.diagnosticCodes.optimizationFailed,
      `Unsupported guest-link optimization posture ${optimizationPosture}.`
    );
  }
  return Object.freeze({
    version: GUEST_LINK_STAGE_INVOCATION_VERSION,
    primaryWasm: Buffer.from(input.primaryWasm),
    guestUnits: Object.freeze(input.guestUnits.map(normalizeStageSelection)),
    projectRoot: string(input.projectRoot, 'Guest-link stage invocation.projectRoot'),
    profile: string(input.profile, 'Guest-link stage invocation.profile'),
    finalWasmPolicy: normalizeFinalWasmPolicy(input.finalWasmPolicy),
    synchronizedPackages: normalizeSynchronizedPackages(input.synchronizedPackages),
    optimizationPosture
  });
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function readSelectedManifest(selection) {
  const contribution = selection.contribution;
  let packageRoot;
  try {
    packageRoot = fs.realpathSync(selection.packageRoot);
  } catch (error) {
    wrap(error, guestLink.diagnosticCodes.invalid, 'Guest-unit package root is unavailable.');
  }
  const relativeManifest = contribution.manifest.replace(/^\.\//, '');
  const manifestFile = path.resolve(packageRoot, relativeManifest);
  if (!inside(packageRoot, manifestFile) || !fs.existsSync(manifestFile)) {
    fail(
      guestLink.diagnosticCodes.invalid,
      `Guest-unit manifest ${contribution.manifest} is not contained by ${contribution.owner}.`
    );
  }
  const realManifest = fs.realpathSync(manifestFile);
  if (!inside(packageRoot, realManifest) || !fs.statSync(realManifest).isFile()) {
    fail(
      guestLink.diagnosticCodes.invalid,
      `Guest-unit manifest ${contribution.manifest} is not a contained regular file.`
    );
  }
  const bytes = fs.readFileSync(realManifest);
  let manifest;
  try {
    manifest = guestLink.normalizeGuestUnitManifest(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    wrap(error, guestLink.diagnosticCodes.invalid, `Guest-unit manifest ${contribution.manifest} is invalid.`);
  }
  if (
    manifest.id !== contribution.id
    || manifest.owner !== contribution.owner
    || manifest.packageVersion !== contribution.packageVersion
    || manifest.origin !== contribution.origin
  ) {
    fail(
      guestLink.diagnosticCodes.ownerMismatch,
      `Guest-unit contribution ${contribution.id} does not match its package-owned manifest.`
    );
  }
  return Object.freeze({
    packageRoot,
    manifestFile: relativeManifest,
    manifest,
    manifestSha256: sha256(bytes)
  });
}

function hostImports(primaryBytes, guestModule) {
  let module;
  try {
    module = new WebAssembly.Module(primaryBytes);
  } catch (error) {
    wrap(error, guestLink.diagnosticCodes.invalid, 'Guest-link primary input is not valid core Wasm.');
  }
  return WebAssembly.Module.imports(module)
    .filter((entry) => entry.module !== guestModule)
    .filter((entry) => !(entry.module === 'env' && entry.name === 'memory' && entry.kind === 'memory'))
    .map((entry) => Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind }));
}

function optimizationForPosture(posture) {
  return posture === 'native-size'
    ? Object.freeze({ mode: 'experimental-native-size', posture: 'native-size' })
    : Object.freeze({ mode: 'default', posture: 'native-default' });
}

function makeGuestUnitPlan(selection, resolved, facts, primaryBytes) {
  let targetPolicy;
  try {
    targetPolicy = projectFinalWasmPolicy(
      facts.finalWasmPolicy,
      hostImports(primaryBytes, resolved.manifest.module)
    );
  } catch (error) {
    wrap(
      error,
      'PULSE_GUEST_TARGET_POLICY_REQUIRED',
      'Guest-link primary imports exceed the selected target final-Wasm policy.'
    );
  }
  const manifest = resolved.manifest;
  const isV2 = manifest.version === guestLink.versions.guestUnitV2;
  const optimization = optimizationForPosture(facts.optimizationPosture);
  const input = {
    version: isV2 ? guestLink.versions.guestUnitPlanV2 : guestLink.versions.guestUnitPlan,
    profile: facts.profile,
    target: targetPolicy.descriptorIdentity,
    unit: isV2 ? {
      manifestVersion: manifest.version,
      id: manifest.id,
      module: manifest.module,
      owner: manifest.owner,
      packageVersion: manifest.packageVersion,
      abi: manifest.abi,
      origin: manifest.origin,
      manifestSha256: resolved.manifestSha256,
      artifact: {
        bytes: manifest.artifact.bytes,
        sha256: manifest.artifact.sha256
      },
      source: {
        included: true,
        treeSha256: manifest.source.treeSha256
      },
      memoryIdentity: manifest.memory.identity,
      frame: {
        identity: guestLink.es256FrameV2.identity,
        capacityBytes: guestLink.es256FrameV2.capacityBytes,
        alignmentBytes: guestLink.es256FrameV2.alignmentBytes,
        pointerWidthBits: guestLink.es256FrameV2.pointerWidthBits
      },
      toolchain: {
        binaryenVersion: manifest.toolchain.versions.binaryen,
        wasmOptSha256: manifest.provenance.binaryenWasmOptSha256
      }
    } : {
      id: manifest.id,
      module: manifest.module,
      owner: manifest.owner,
      packageVersion: manifest.packageVersion,
      abi: manifest.abi,
      origin: manifest.origin,
      manifestSha256: resolved.manifestSha256,
      artifactSha256: manifest.artifact.sha256,
      source: {
        included: Boolean(manifest.source),
        treeSha256: manifest.source ? manifest.source.treeSha256 : null
      }
    },
    targetPolicy,
    materialization: {
      workspace: '.pulse/guests',
      directory: `.pulse/guests/${manifest.id}/${manifest.artifact.sha256}`,
      artifact: 'unit.wasm',
      manifest: 'unit.json',
      contentAddress: 'artifact-sha256',
      generated: true,
      authoritative: false
    },
    trust: isV2 ? {
      lowerer: 'trusted-first-party',
      catalog: 'pulse.jwt-crypto-working-candidate.v1',
      catalogStatus: 'unpublished-synchronized',
      ownerMatchesContributionPackage: true,
      installedVersionMatches: true,
      status: 'passed'
    } : {
      lowerer: 'trusted-first-party',
      releaseManifest: 'synchronized',
      ownerMatchesContributionPackage: true,
      installedVersionMatches: true,
      status: 'passed'
    },
    composition: {
      kind: 'core-wasm-static-link',
      semanticContract: 'connect-validated-core-units-into-one-final-audited-native-artifact',
      primaryModule: 'pulse_primary',
      memoryOwnerModule: 'env'
    },
    fallback: { enabled: false, onFailure: 'stop-before-provider-packaging' }
  };
  if (isV2) {
    input.optimization = {
      mode: optimization.mode,
      postLink: true,
      posture: optimization.posture
    };
  }
  return guestLink.normalizeGuestUnitPlan(input);
}

function normalizeGuestLinkStageResult(input) {
  exactKeys(input, GUEST_LINK_STAGE_RESULT_FIELDS, 'Guest-link stage result');
  if (input.version !== GUEST_LINK_STAGE_RESULT_VERSION) {
    fail(
      guestLink.diagnosticCodes.finalAuditFailed,
      `Guest-link stage result must use ${GUEST_LINK_STAGE_RESULT_VERSION}.`
    );
  }
  if (!Buffer.isBuffer(input.wasm) || typeof input.wat !== 'string') {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage result must contain exact final Wasm and text bytes.');
  }
  if (!Array.isArray(input.guestUnits) || input.guestUnits.length !== 1) {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage result must identify exactly one normalized contribution.');
  }
  const guestUnits = Object.freeze(input.guestUnits.map(normalizeContribution));
  const plan = guestLink.normalizeGuestUnitPlan(input.plan);
  const expectedReportVersion = plan.version === guestLink.versions.guestUnitPlanV2
    ? guestLink.versions.guestLinkReportV2
    : guestLink.versions.guestLinkReport;
  const expectedAuditVersion = plan.version === guestLink.versions.guestUnitPlanV2
    ? guestLink.versions.finalWasmAuditV2
    : guestLink.versions.finalWasmAudit;
  if (!plainObject(input.report) || input.report.version !== expectedReportVersion || input.report.status !== 'passed') {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage result report identity is invalid.');
  }
  if (!plainObject(input.audit) || input.audit.version !== expectedAuditVersion || input.audit.status !== 'passed') {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage result audit identity is invalid.');
  }
  exactKeys(input.finalArtifact, ['bytes', 'sha256'], 'Guest-link stage result.finalArtifact', guestLink.diagnosticCodes.finalAuditFailed);
  const observedArtifact = Object.freeze({ bytes: input.wasm.length, sha256: sha256(input.wasm) });
  if (
    input.finalArtifact.bytes !== observedArtifact.bytes
    || input.finalArtifact.sha256 !== observedArtifact.sha256
    || input.report.finalArtifact.bytes !== observedArtifact.bytes
    || input.report.finalArtifact.sha256 !== observedArtifact.sha256
    || input.audit.artifact.bytes !== observedArtifact.bytes
    || input.audit.artifact.sha256 !== observedArtifact.sha256
  ) {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage result bytes do not match their report and audit identity.');
  }
  exactKeys(input.materialization, ['directory', 'reused', 'contentAddressed'], 'Guest-link stage result.materialization', guestLink.diagnosticCodes.finalAuditFailed);
  if (input.materialization.contentAddressed !== true || typeof input.materialization.reused !== 'boolean') {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage materialization disposition is invalid.');
  }
  exactKeys(input.providerPackaging, [
    'authorized',
    'input',
    'artifactSha256',
    'automaticFallback'
  ], 'Guest-link stage result.providerPackaging', guestLink.diagnosticCodes.finalAuditFailed);
  if (
    input.providerPackaging.authorized !== true
    || input.providerPackaging.input !== 'exact-audited-final-bytes'
    || input.providerPackaging.artifactSha256 !== observedArtifact.sha256
    || input.providerPackaging.automaticFallback !== false
    || input.audit.providerPackaging.authorized !== true
  ) {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage did not authorize only exact audited final bytes.');
  }
  exactKeys(input.fallback, [
    'enabled',
    'used',
    'onFailure',
    'alternateOutputAuthorized'
  ], 'Guest-link stage result.fallback', guestLink.diagnosticCodes.finalAuditFailed);
  if (
    input.fallback.enabled !== false
    || input.fallback.used !== false
    || input.fallback.onFailure !== 'stop-before-provider-packaging'
    || input.fallback.alternateOutputAuthorized !== false
    || input.report.fallback.enabled !== false
    || input.report.fallback.used !== false
  ) {
    fail(guestLink.diagnosticCodes.finalAuditFailed, 'Guest-link stage fallback disposition is invalid.');
  }
  return Object.freeze({
    version: GUEST_LINK_STAGE_RESULT_VERSION,
    wasm: Buffer.from(input.wasm),
    wat: input.wat,
    guestUnits,
    plan,
    report: input.report,
    audit: input.audit,
    materialization: Object.freeze({
      directory: input.materialization.directory,
      reused: input.materialization.reused,
      contentAddressed: true
    }),
    finalArtifact: observedArtifact,
    providerPackaging: Object.freeze({
      authorized: true,
      input: 'exact-audited-final-bytes',
      artifactSha256: observedArtifact.sha256,
      automaticFallback: false
    }),
    fallback: Object.freeze({
      enabled: false,
      used: false,
      onFailure: 'stop-before-provider-packaging',
      alternateOutputAuthorized: false
    })
  });
}

function realizeGuestLinkStage(input) {
  const invocation = normalizeGuestLinkStageInvocation(input);
  const selection = invocation.guestUnits[0];
  const resolved = readSelectedManifest(selection);
  const plan = makeGuestUnitPlan(selection, resolved, invocation, invocation.primaryWasm);
  const stageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-stage-'));
  try {
    const primaryFile = path.join(stageDirectory, 'primary.wasm');
    fs.writeFileSync(primaryFile, invocation.primaryWasm);
    const owner = guestLink.writeMemoryOwnerModule(stageDirectory);
    const linked = guestLink.realizeGuestLinkPlan({
      plan,
      packageRoot: resolved.packageRoot,
      manifestFile: resolved.manifestFile,
      projectRoot: invocation.projectRoot,
      synchronizedPackages: invocation.synchronizedPackages,
      primaryFile,
      memoryOwnerFile: owner.file,
      outputDirectory: path.join(stageDirectory, 'output'),
      optimizationPosture: plan.version === guestLink.versions.guestUnitPlanV2
        ? plan.optimization.posture
        : 'native-size'
    });
    const verifiedArtifact = guestLink.assertFinalArtifactIdentity(linked.files.final, linked.audit);
    const finalBytes = fs.readFileSync(linked.files.final);
    const finalWat = fs.readFileSync(linked.files.finalWat, 'utf8');
    return normalizeGuestLinkStageResult({
      version: GUEST_LINK_STAGE_RESULT_VERSION,
      wasm: finalBytes,
      wat: finalWat,
      guestUnits: [selection.contribution],
      plan,
      report: linked.report,
      audit: linked.audit,
      materialization: {
        directory: linked.materialization.directory,
        reused: linked.materialization.reused,
        contentAddressed: true
      },
      finalArtifact: verifiedArtifact,
      providerPackaging: {
        authorized: true,
        input: 'exact-audited-final-bytes',
        artifactSha256: verifiedArtifact.sha256,
        automaticFallback: false
      },
      fallback: {
        enabled: false,
        used: false,
        onFailure: 'stop-before-provider-packaging',
        alternateOutputAuthorized: false
      }
    });
  } finally {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({
  GUEST_LINK_STAGE_INVOCATION_VERSION,
  GUEST_LINK_STAGE_RESULT_VERSION,
  GUEST_LINK_STAGE_INVOCATION_FIELDS,
  GUEST_LINK_STAGE_RESULT_FIELDS,
  normalizeGuestLinkStageInvocation,
  normalizeGuestLinkStageResult,
  makeGuestUnitPlan,
  realizeGuestLinkStage,
  GUEST_UNIT_CONTRIBUTION_FIELDS
});
