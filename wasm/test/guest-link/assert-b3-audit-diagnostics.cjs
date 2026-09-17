#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guestLink = require('../../packages/wasm-guest-link/src/index.js');
const { runTool } = require('../../packages/wasm-guest-link/src/toolchain.js');
const { assertFinal } = require('../../packages/wasm-guest-link/src/pipeline.js');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures');

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-b3');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) throw new Error(`Unknown or incomplete B3 option: ${argv[index]}`);
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function fixtureWasm(name) {
  return Buffer.from(fs.readFileSync(path.join(fixtureRoot, 'package', `${name}.wasm.base64`), 'utf8').trim(), 'base64');
}

function baseManifest(artifact, source) {
  return {
    version: guestLink.versions.guestUnit,
    id: 'pulse.guest-link.proof.borrowed-span',
    module: 'pulse_guest_memory',
    owner: '@pulse-compute/wasm-guest-link',
    packageVersion: '1.0.0-beta.1',
    abi: 'pulse.guest-link.proof.borrowed-span.v1',
    origin: 'package-prebuilt',
    artifact: {
      file: 'native/proof/unit.wasm',
      bytes: artifact.length,
      sha256: sha256(artifact)
    },
    source: {
      included: true,
      directory: 'native/proof/source',
      treeSha256: source.sha256
    },
    toolchain: {
      kind: 'rust-cargo',
      target: 'wasm32v1-none',
      locked: true,
      versions: { rustc: '1.97.1', cargo: '1.97.1' }
    },
    imports: [{
      module: 'env',
      name: 'memory',
      kind: 'memory',
      type: { minimumPages: 32, maximumPages: 32, shared: false }
    }],
    exports: [{
      name: 'pulse_guest_layout_marker_pointer',
      kind: 'function',
      parameters: [],
      results: ['i32'],
      role: 'evidence-only'
    }, {
      name: 'pulse_guest_span_checksum',
      kind: 'function',
      parameters: ['i32', 'i32'],
      results: ['i32'],
      role: 'abi'
    }],
    memory: { identity: guestLink.memoryAbi.identity, import: 'env.memory', owner: 'link-stage' },
    start: { policy: 'forbidden' },
    features: { baseline: 'mvp', allowed: [], required: [] },
    provenance: {
      packageManifest: 'package.json',
      lockfile: 'native/proof/source/Cargo.lock',
      reproducibleSourceIncluded: true
    }
  };
}

function createPackage(root, artifact = fixtureWasm('guest')) {
  const nativeRoot = path.join(root, 'native', 'proof');
  const sourceRoot = path.join(nativeRoot, 'source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.cpSync(path.join(fixtureRoot, 'memory', 'rust'), sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), stableJson({
    name: '@pulse-compute/wasm-guest-link',
    version: '1.0.0-beta.1'
  }));
  fs.writeFileSync(path.join(nativeRoot, 'unit.wasm'), artifact);
  const source = guestLink.sourceTreeRecord(sourceRoot);
  const manifest = baseManifest(artifact, source);
  const manifestFile = path.join(nativeRoot, 'unit.json');
  fs.writeFileSync(manifestFile, stableJson(manifest));
  return Object.freeze({ root, source, manifest, manifestFile, manifestSha256: fileRecord(manifestFile).sha256 });
}

function createPlan(fixture) {
  const unit = fixture.manifest;
  return {
    version: guestLink.versions.guestUnitPlan,
    profile: 'native',
    target: 'fastly-compute-native',
    unit: {
      id: unit.id,
      module: unit.module,
      owner: unit.owner,
      packageVersion: unit.packageVersion,
      abi: unit.abi,
      origin: unit.origin,
      manifestSha256: fixture.manifestSha256,
      artifactSha256: unit.artifact.sha256,
      source: { included: true, treeSha256: fixture.source.sha256 }
    },
    targetPolicy: {
      descriptorOwner: '@pulse-compute/provider-fastly',
      toolchainVersion: 'pulse.provider-toolchain.v1',
      descriptorIdentity: 'fastly-compute-native',
      descriptorSha256: '3333333333333333333333333333333333333333333333333333333333333333',
      allowedImports: [],
      requiredExports: [],
      featureBaseline: 'mvp',
      allowedFeatures: [],
      memory: { minimum: 1, maximum: 1, imported: 0, growable: false },
      start: 'forbidden'
    },
    materialization: {
      workspace: '.pulse/guests',
      directory: `.pulse/guests/${unit.id}/${unit.artifact.sha256}/${fixture.manifestSha256}`,
      artifact: 'unit.wasm',
      manifest: 'unit.json',
      contentAddress: 'artifact-and-manifest-sha256',
      generated: true,
      authoritative: false
    },
    trust: {
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
}

function realize(fixture, plan, projectRoot, outputDirectory, inputs = {}) {
  fs.mkdirSync(projectRoot, { recursive: true });
  return guestLink.realizeGuestLinkPlan({
    plan,
    packageRoot: fixture.root,
    manifestFile: 'native/proof/unit.json',
    projectRoot,
    primaryFile: inputs.primaryFile,
    memoryOwnerFile: inputs.memoryOwnerFile,
    outputDirectory,
    synchronizedPackages: inputs.synchronizedPackages || [{
      name: '@pulse-compute/wasm-guest-link',
      version: '1.0.0-beta.1'
    }]
  });
}

function compileWat(directory, name, source, features = ['--mvp-features']) {
  const watFile = path.join(directory, `${name}.wat`);
  const wasmFile = path.join(directory, `${name}.wasm`);
  fs.writeFileSync(watFile, source, 'utf8');
  runTool('wasm-as', [watFile, ...features, '-o', wasmFile], {
    cwd: directory,
    failureCode: guestLink.diagnosticCodes.invalid,
    failureMessage: `B3 fixture ${name} could not be assembled.`
  });
  return wasmFile;
}

function expectFailure(matrix, id, expectedCode, operation) {
  let observed;
  try {
    operation();
    assert.fail(`${id} must fail`);
  } catch (error) {
    if (error && error.code === 'ERR_ASSERTION') throw error;
    assert.equal(error && error.name, 'GuestLinkError', `${id} error owner`);
    assert.equal(error && error.code, expectedCode, `${id} stable code`);
    assert.deepEqual(error.detail, error.details, `${id} canonical and compatibility details`);
    observed = error;
  }
  matrix.push(Object.freeze({
    id,
    expectedCode,
    observedCode: observed.code,
    detailSafe: true,
    automaticFallback: false
  }));
  return observed;
}

function assertReportCoverage(report) {
  assert.equal(report.profile, 'native');
  assert.equal(report.target, 'fastly-compute-native');
  assert.equal(report.units.length, 1);
  const unit = report.units[0];
  for (const field of ['id', 'owner', 'packageVersion', 'origin', 'artifactSha256']) assert.ok(unit[field], `unit ${field}`);
  assert.equal(unit.origin, 'package-prebuilt');
  assert.equal(unit.sourceIncluded, true);
  assert.match(unit.sourceSha256, /^[a-f0-9]{64}$/);
  for (const item of ['packageManifest', 'lockfile']) {
    assert.match(unit.provenance[item].sha256, /^[a-f0-9]{64}$/);
    assert.ok(unit.provenance[item].bytes > 0);
  }
  assert.equal(unit.provenance.source.included, true);
  assert.match(unit.provenance.source.treeSha256, /^[a-f0-9]{64}$/);
  for (const item of ['primary', 'memoryOwner', 'guest']) assert.match(report.inputs[item].sha256, /^[a-f0-9]{64}$/);
  assert.match(report.finalArtifact.sha256, /^[a-f0-9]{64}$/);
  for (const stage of ['composition', 'optimization']) {
    assert.equal(report[stage].implementation.name, 'binaryen');
    assert.match(report[stage].implementation.version, /^\d/);
    assert.match(report[stage].implementation.sha256, /^[a-f0-9]{64}$/);
  }
  for (const stage of ['before', 'after']) {
    const inspection = stage === 'before' ? report.inspection.before.primary : report.inspection.after;
    for (const field of ['imports', 'exports', 'memoryTypes', 'features']) assert.ok(Array.isArray(inspection[field]), `${stage} ${field}`);
  }
  assert.deepEqual(report.fallback, { enabled: false, used: false });
  assert.equal(report.redaction.environmentSecrets, 'omitted');
  assert.equal(report.redaction.privateMaterial, 'omitted');
  assert.equal(report.redaction.rawBuffers, 'omitted');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-b3-'));
  const matrix = [];
  try {
    const inputs = path.join(temporary, 'inputs');
    const packageRoot = path.join(temporary, 'package');
    const projectRoot = path.join(temporary, 'project');
    fs.mkdirSync(inputs, { recursive: true });
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    const primaryFile = path.join(inputs, 'primary.wasm');
    const memoryOwnerFile = path.join(inputs, 'owner.wasm');
    fs.writeFileSync(primaryFile, fixtureWasm('primary'));
    fs.writeFileSync(memoryOwnerFile, fixtureWasm('owner'));
    const fixture = createPackage(packageRoot);
    const plan = createPlan(fixture);
    const first = realize(fixture, plan, projectRoot, path.join(temporary, 'valid-first'), { primaryFile, memoryOwnerFile });
    const second = realize(fixture, plan, projectRoot, path.join(temporary, 'valid-second'), { primaryFile, memoryOwnerFile });
    assert.deepEqual(first.report, second.report);
    assert.deepEqual(first.audit, second.audit);
    assertReportCoverage(first.report);

    expectFailure(matrix, 'missing-unit', guestLink.diagnosticCodes.invalid, () => {
      realize(
        { ...fixture, root: path.join(temporary, 'missing-package') },
        plan,
        projectRoot,
        path.join(temporary, 'missing-output'),
        { primaryFile, memoryOwnerFile }
      );
    });

    expectFailure(matrix, 'invalid-metadata', guestLink.diagnosticCodes.invalid, () => {
      guestLink.normalizeGuestUnitManifest({ ...fixture.manifest, command: 'cargo build' });
    });

    const tamperedRoot = path.join(temporary, 'tampered-package');
    fs.cpSync(packageRoot, tamperedRoot, { recursive: true });
    const tamperedArtifact = path.join(tamperedRoot, 'native', 'proof', 'unit.wasm');
    const tamperedBytes = fs.readFileSync(tamperedArtifact);
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    fs.writeFileSync(tamperedArtifact, tamperedBytes);
    expectFailure(matrix, 'artifact-hash-mismatch', guestLink.diagnosticCodes.hashMismatch, () => {
      realize({ ...fixture, root: tamperedRoot }, plan, path.join(temporary, 'tampered-project'), path.join(temporary, 'tampered-output'), {
        primaryFile,
        memoryOwnerFile
      });
    });

    expectFailure(matrix, 'owner-trust-mismatch', guestLink.diagnosticCodes.ownerMismatch, () => {
      realize(fixture, plan, projectRoot, path.join(temporary, 'owner-output'), {
        primaryFile,
        memoryOwnerFile,
        synchronizedPackages: [{ name: fixture.manifest.owner, version: '0.1.1' }]
      });
    });

    expectFailure(matrix, 'abi-mismatch', guestLink.diagnosticCodes.abiMismatch, () => {
      realize(fixture, {
        ...plan,
        unit: { ...plan.unit, module: 'different_guest_module' }
      }, projectRoot, path.join(temporary, 'abi-output'), { primaryFile, memoryOwnerFile });
    });

    const extraImportFile = compileWat(inputs, 'extra-import-guest', `(module
      (import "env" "memory" (memory 32 32))
      (import "unexpected_host" "read" (func $unexpected (result i32)))
      (func (export "pulse_guest_layout_marker_pointer") (result i32) i32.const 131072)
      (func (export "pulse_guest_span_checksum") (param i32 i32) (result i32) i32.const 0)
    )`);
    const extraImportFixture = createPackage(path.join(temporary, 'extra-import-package'), fs.readFileSync(extraImportFile));
    expectFailure(matrix, 'unexpected-import', guestLink.diagnosticCodes.importMismatch, () => {
      realize(extraImportFixture, createPlan(extraImportFixture), path.join(temporary, 'extra-import-project'), path.join(temporary, 'extra-import-output'), {
        primaryFile,
        memoryOwnerFile
      });
    });

    const extraExportFile = compileWat(inputs, 'extra-export-guest', `(module
      (import "env" "memory" (memory 32 32))
      (func (export "pulse_guest_layout_marker_pointer") (result i32) i32.const 131072)
      (func (export "pulse_guest_span_checksum") (param i32 i32) (result i32) i32.const 0)
      (func (export "unexpected_export"))
    )`);
    const extraExportFixture = createPackage(path.join(temporary, 'extra-export-package'), fs.readFileSync(extraExportFile));
    expectFailure(matrix, 'unexpected-export', guestLink.diagnosticCodes.exportMismatch, () => {
      realize(extraExportFixture, createPlan(extraExportFixture), path.join(temporary, 'extra-export-project'), path.join(temporary, 'extra-export-output'), {
        primaryFile,
        memoryOwnerFile
      });
    });

    expectFailure(matrix, 'memory-policy-mismatch', guestLink.diagnosticCodes.memoryMismatch, () => {
      realize(fixture, plan, projectRoot, path.join(temporary, 'memory-output'), {
        primaryFile: memoryOwnerFile,
        memoryOwnerFile
      });
    });

    const startPrimary = compileWat(inputs, 'start-primary', `(module
      (type $guest (func (param i32 i32) (result i32)))
      (import "pulse_guest_memory" "pulse_guest_span_checksum" (func $guest (type $guest)))
      (import "env" "memory" (memory 32 32))
      (func $start)
      (start $start)
    )`);
    expectFailure(matrix, 'start-policy-mismatch', guestLink.diagnosticCodes.startMismatch, () => {
      realize(fixture, plan, projectRoot, path.join(temporary, 'start-output'), {
        primaryFile: startPrimary,
        memoryOwnerFile
      });
    });

    const simdPrimary = compileWat(inputs, 'simd-primary', `(module
      (type $guest (func (param i32 i32) (result i32)))
      (import "pulse_guest_memory" "pulse_guest_span_checksum" (func $guest (type $guest)))
      (import "env" "memory" (memory 32 32))
      (func $simd (result v128) (v128.const i32x4 0 0 0 0))
    )`, ['--enable-simd']);
    expectFailure(matrix, 'unexpected-feature', guestLink.diagnosticCodes.featureMismatch, () => {
      realize(fixture, plan, projectRoot, path.join(temporary, 'feature-output'), {
        primaryFile: simdPrimary,
        memoryOwnerFile
      });
    });

    expectFailure(matrix, 'link-failure', guestLink.diagnosticCodes.linkFailed, () => {
      runTool('wasm-merge', ['--not-a-valid-wasm-merge-input'], {
        cwd: inputs,
        failureCode: guestLink.diagnosticCodes.linkFailed,
        failureMessage: 'Validated guest inputs could not be linked.'
      });
    });

    expectFailure(matrix, 'optimizer-failure', guestLink.diagnosticCodes.optimizationFailed, () => {
      runTool('wasm-opt', ['--not-a-valid-wasm-opt-input'], {
        cwd: inputs,
        failureCode: guestLink.diagnosticCodes.optimizationFailed,
        failureMessage: 'Post-link whole-module optimization failed.'
      });
    });

    const inspectionWork = path.join(temporary, 'audit-inspection');
    fs.mkdirSync(inspectionWork);
    const before = Object.freeze({
      primary: guestLink.inspectWasmFile(primaryFile, { label: 'b3-primary', workDirectory: inspectionWork }),
      owner: guestLink.inspectWasmFile(memoryOwnerFile, { label: 'b3-owner', workDirectory: inspectionWork }),
      guest: guestLink.inspectWasmFile(first.materialization.artifactFile, { label: 'b3-guest', workDirectory: inspectionWork })
    });
    const finalInspection = guestLink.inspectWasmFile(first.files.final, { label: 'b3-final', workDirectory: inspectionWork });
    expectFailure(matrix, 'post-link-final-audit', guestLink.diagnosticCodes.finalAuditFailed, () => {
      const unexpected = Object.freeze({ module: 'unexpected_host', name: 'read', kind: 'function' });
      assertFinal(plan, before, Object.freeze({
        ...finalInspection,
        imports: Object.freeze([...finalInspection.imports, unexpected])
      }));
    });

    const secret = 'PULSE_B3_SECRET_DO_NOT_LEAK_7f2c';
    process.env.PULSE_B3_SECRET = secret;
    const diagnostic = new guestLink.GuestLinkError(
      guestLink.diagnosticCodes.linkFailed,
      `link failure Bearer ${secret}`,
      {
        cause: `nested failure ${secret}`,
        environmentSecret: secret,
        authorization: `Bearer ${secret}`,
        privateKey: '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
        rawBuffer: Buffer.from(secret)
      }
    );
    const diagnosticText = JSON.stringify({
      name: diagnostic.name,
      code: diagnostic.code,
      message: diagnostic.message,
      detail: diagnostic.detail
    });
    assert.doesNotMatch(diagnosticText, new RegExp(secret));
    assert.doesNotMatch(diagnosticText, /private-material/);
    assert.equal(diagnostic.detail, diagnostic.details);
    delete process.env.PULSE_B3_SECRET;

    const requiredCodes = [
      guestLink.diagnosticCodes.invalid,
      guestLink.diagnosticCodes.hashMismatch,
      guestLink.diagnosticCodes.ownerMismatch,
      guestLink.diagnosticCodes.abiMismatch,
      guestLink.diagnosticCodes.importMismatch,
      guestLink.diagnosticCodes.exportMismatch,
      guestLink.diagnosticCodes.memoryMismatch,
      guestLink.diagnosticCodes.startMismatch,
      guestLink.diagnosticCodes.featureMismatch,
      guestLink.diagnosticCodes.linkFailed,
      guestLink.diagnosticCodes.optimizationFailed,
      guestLink.diagnosticCodes.finalAuditFailed
    ].sort();
    assert.deepEqual([...new Set(matrix.map((entry) => entry.observedCode))].sort(), requiredCodes);
    assert.deepEqual(matrix.map((entry) => entry.id).sort(), [
      'abi-mismatch',
      'artifact-hash-mismatch',
      'invalid-metadata',
      'link-failure',
      'memory-policy-mismatch',
      'missing-unit',
      'optimizer-failure',
      'owner-trust-mismatch',
      'post-link-final-audit',
      'start-policy-mismatch',
      'unexpected-export',
      'unexpected-feature',
      'unexpected-import'
    ]);

    fs.rmSync(options.outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const report = Object.freeze({
      version: 'pulse.guest-link-audit-diagnostics-proof.v1',
      status: 'passed',
      profile: first.report.profile,
      target: first.report.target,
      unit: first.report.units[0],
      inputArtifacts: first.report.inputs,
      finalArtifact: first.report.finalArtifact,
      toolchain: Object.freeze({
        linker: first.report.composition.implementation,
        optimizer: first.report.optimization.implementation
      }),
      reportCoverage: Object.freeze({
        beforeAfterImportsExportsMemoriesFeatures: true,
        packageAndSourceProvenance: true,
        fallbackDisabled: true,
        sensitiveMaterialOmitted: true
      }),
      diagnostics: Object.freeze(matrix),
      determinism: Object.freeze({
        report: 'byte-equivalent-object',
        audit: 'byte-equivalent-object'
      }),
      redaction: first.report.redaction
    });
    const reportFile = path.join(options.outputDirectory, 'guest-link-audit-diagnostics-proof.json');
    fs.writeFileSync(reportFile, stableJson(report));
    console.log(`ok - B3 audit/provenance and ${matrix.length}-case diagnostic matrix passed; evidence ${fileRecord(reportFile).sha256}`);
  } finally {
    delete process.env.PULSE_B3_SECRET;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main();
