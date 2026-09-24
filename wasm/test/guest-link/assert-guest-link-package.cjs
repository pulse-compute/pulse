#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guestLink = require('../../packages/wasm-guest-link/src/index.js');
const { optimizationArguments } = require('../../packages/wasm-guest-link/src/contracts.js');

const evidenceVersion = 'pulse.guest-link-package-evidence.v1';
const expected = Object.freeze({
  guest: Object.freeze({
    bytes: 344,
    sha256: 'd92d3b3496debbfd13ec1657efe9eac62ce44580cb1e4f439fc80232d346da2c'
  }),
  primary: Object.freeze({
    bytes: 1282,
    sha256: '3b3421a32f5877a2026807cdab6964b992eea24601da6a5ae6a23b2a73d20878'
  }),
  memoryOwner: Object.freeze({
    bytes: 26,
    sha256: '26af409614f556104522d4d6859237908703bf044fb3e230dc53426d6736ccc0'
  }),
  final: Object.freeze({
    bytes: 1310,
    sha256: 'c6c7c9107a02a5506c793ac9562cc78cf5dbfd3173533101777a7e699d075879'
  })
});

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures');

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'guest-link-b1');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete guest-link package option: ${argv[index]}`);
    }
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

function decodeFixture(name, destination) {
  const encoded = fs.readFileSync(path.join(fixtureRoot, 'package', `${name}.wasm.base64`), 'utf8').trim();
  fs.writeFileSync(destination, Buffer.from(encoded, 'base64'));
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error && error.name, 'GuestLinkError');
    assert.equal(error && error.code, code);
    return true;
  });
  return code;
}

function createPackage(root) {
  const nativeRoot = path.join(root, 'native', 'proof');
  const sourceRoot = path.join(nativeRoot, 'source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.cpSync(path.join(fixtureRoot, 'memory', 'rust'), sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), stableJson({
    name: '@pulse-compute/wasm-guest-link',
    version: '1.0.0-beta.1'
  }));
  const artifactFile = path.join(nativeRoot, 'unit.wasm');
  decodeFixture('guest', artifactFile);
  assert.deepEqual(fileRecord(artifactFile), expected.guest);

  const source = guestLink.sourceTreeRecord(sourceRoot);
  const manifest = {
    version: guestLink.versions.guestUnit,
    id: 'pulse.guest-link.proof.borrowed-span',
    module: 'pulse_guest_memory',
    owner: '@pulse-compute/wasm-guest-link',
    packageVersion: '1.0.0-beta.1',
    abi: 'pulse.guest-link.proof.borrowed-span.v1',
    origin: 'package-prebuilt',
    artifact: {
      file: 'native/proof/unit.wasm',
      bytes: expected.guest.bytes,
      sha256: expected.guest.sha256
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
      versions: {
        rustc: '1.97.1',
        cargo: '1.97.1'
      }
    },
    imports: [{
      module: 'env',
      name: 'memory',
      kind: 'memory',
      type: {
        minimumPages: 32,
        maximumPages: 32,
        shared: false
      }
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
    memory: {
      identity: guestLink.memoryAbi.identity,
      import: 'env.memory',
      owner: 'link-stage'
    },
    start: { policy: 'forbidden' },
    features: {
      baseline: 'mvp',
      allowed: [],
      required: []
    },
    provenance: {
      packageManifest: 'package.json',
      lockfile: 'native/proof/source/Cargo.lock',
      reproducibleSourceIncluded: true
    }
  };
  const manifestFile = path.join(nativeRoot, 'unit.json');
  fs.writeFileSync(manifestFile, stableJson(manifest));
  return Object.freeze({
    root,
    manifest,
    manifestFile,
    manifestSha256: fileRecord(manifestFile).sha256,
    source
  });
}

function createPlan(packageFixture) {
  const unit = packageFixture.manifest;
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
      manifestSha256: packageFixture.manifestSha256,
      artifactSha256: unit.artifact.sha256,
      source: {
        included: true,
        treeSha256: packageFixture.source.sha256
      }
    },
    targetPolicy: {
      descriptorOwner: '@pulse-compute/provider-fastly',
      toolchainVersion: 'pulse.provider-toolchain.v1',
      descriptorIdentity: 'fastly-compute-native',
      descriptorSha256: '2222222222222222222222222222222222222222222222222222222222222222',
      allowedImports: [],
      requiredExports: [],
      featureBaseline: 'mvp',
      allowedFeatures: [],
      memory: {
        minimum: 1,
        maximum: 1,
        imported: 0,
        growable: false
      },
      start: 'forbidden'
    },
    materialization: {
      workspace: '.pulse/guests',
      directory: `.pulse/guests/${unit.id}/${unit.artifact.sha256}/${packageFixture.manifestSha256}`,
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
    fallback: {
      enabled: false,
      onFailure: 'stop-before-provider-packaging'
    }
  };
}

function realize(options) {
  return guestLink.realizeGuestLinkPlan({
    plan: options.plan,
    packageRoot: options.packageRoot,
    manifestFile: 'native/proof/unit.json',
    projectRoot: options.projectRoot,
    primaryFile: options.primaryFile,
    memoryOwnerFile: options.memoryOwnerFile,
    outputDirectory: options.outputDirectory,
    synchronizedPackages: [{
      name: '@pulse-compute/wasm-guest-link',
      version: '1.0.0-beta.1'
    }]
  });
}

async function assertRuntime(finalFile) {
  const instance = await WebAssembly.instantiate(fs.readFileSync(finalFile), {});
  const exports = instance.instance.exports;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(exports.pulseRunMemoryCase(index) >>> 0, 0, `memory case ${index}`);
  }
  assert.equal(exports.pulseRunEveryByteProbe() >>> 0, 0);
  assert.equal(exports.pulseInvalidRangeStatus() >>> 0, guestLink.memoryAbi.invalidRangeStatus);
  assert.equal(exports.pulseMemoryBytes() >>> 0, guestLink.memoryAbi.bytes);
  assert.equal(exports.pulseMaxGuestLength() >>> 0, guestLink.memoryAbi.maximumBorrowedBytes);
  assert.equal(
    exports.pulseGuestInvalidStatus(guestLink.memoryAbi.layout.borrowedInput.start, guestLink.memoryAbi.maximumBorrowedBytes + 1) >>> 0,
    guestLink.memoryAbi.invalidRangeStatus
  );
  assert.equal(
    exports.pulseGuestInvalidStatus(0xffff_fff0, 64) >>> 0,
    guestLink.memoryAbi.invalidRangeStatus
  );
  assert.equal(
    exports.pulseGuestInvalidStatus(guestLink.memoryAbi.bytes - 2, 4) >>> 0,
    guestLink.memoryAbi.invalidRangeStatus
  );
  assert.throws(() => exports.memory.grow(1), RangeError);
  return Object.freeze({
    memoryCases: 5,
    everyByteProbe: 'passed',
    invalidRangeClasses: 3,
    fixedMemoryGrowRejected: true
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-guest-link-b1-'));
  try {
    const packageRoot = path.join(temporaryRoot, 'package');
    const projectRoot = path.join(temporaryRoot, 'project');
    const inputRoot = path.join(temporaryRoot, 'inputs');
    const firstOutput = path.join(temporaryRoot, 'first');
    const secondOutput = path.join(temporaryRoot, 'second');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(inputRoot, { recursive: true });
    const packageFixture = createPackage(packageRoot);
    const plan = createPlan(packageFixture);
    for (const directory of [
      `.pulse/guests/${plan.unit.id}/${plan.unit.artifactSha256}`,
      `.pulse/guests/${plan.unit.id}/${plan.unit.artifactSha256}/${'0'.repeat(64)}`
    ]) {
      assert.throws(() => guestLink.normalizeGuestUnitPlan({
        ...plan,
        materialization: { ...plan.materialization, directory }
      }), error => error?.code === guestLink.diagnosticCodes.materializationFailed);
    }
    const primaryFile = path.join(inputRoot, 'primary.wasm');
    const memoryOwnerFile = path.join(inputRoot, 'memory-owner.wasm');
    decodeFixture('primary', primaryFile);
    decodeFixture('owner', memoryOwnerFile);
    assert.deepEqual(fileRecord(primaryFile), expected.primary);
    assert.deepEqual(fileRecord(memoryOwnerFile), expected.memoryOwner);

    const first = realize({
      plan,
      packageRoot,
      projectRoot,
      primaryFile,
      memoryOwnerFile,
      outputDirectory: firstOutput
    });
    const second = realize({
      plan,
      packageRoot,
      projectRoot,
      primaryFile,
      memoryOwnerFile,
      outputDirectory: secondOutput
    });
    assert.equal(first.materialization.reused, false);
    assert.equal(second.materialization.reused, true);
    assert.deepEqual(fileRecord(first.files.final), expected.final);
    assert.deepEqual(fs.readFileSync(first.files.final), fs.readFileSync(second.files.final));
    assert.deepEqual(fs.readFileSync(first.files.guestLinkReport), fs.readFileSync(second.files.guestLinkReport));
    assert.deepEqual(fs.readFileSync(first.files.finalWasmAudit), fs.readFileSync(second.files.finalWasmAudit));
    assert.equal(first.report.finalArtifact.sha256, expected.final.sha256);
    assert.equal(first.audit.artifact.sha256, expected.final.sha256);
    assert.equal(first.audit.providerPackaging.auditArtifactSha256MatchesInput, true);
    assert.equal(first.audit.layout.staticSegmentsPreserved, true);
    assert.equal(optimizationArguments('native-default').includes('--skip-pass=memory-packing'), true);
    assert.equal(optimizationArguments('native-default').includes('--merge-similar-functions'), true);
    assert.deepEqual(first.report.evidenceClassification.unresolvedAssumptions, []);
    const runtime = await assertRuntime(first.files.final);

    const reportText = fs.readFileSync(first.files.guestLinkReport, 'utf8');
    const auditText = fs.readFileSync(first.files.finalWasmAudit, 'utf8');
    assert.equal(reportText.includes(temporaryRoot), false);
    assert.equal(auditText.includes(temporaryRoot), false);
    assert.doesNotMatch(reportText, /"(?:command|commands|argv|shell|executable)"\s*:/i);
    assert.doesNotMatch(reportText, /(?:secret|credential|token)\s*=/i);

    const forbiddenManifest = { ...packageFixture.manifest, command: 'cargo build' };
    const negativeCodes = [
      expectCode(guestLink.diagnosticCodes.invalid, () => guestLink.normalizeGuestUnitManifest(forbiddenManifest))
    ];
    const malformedManifest = {
      ...packageFixture.manifest,
      exports: packageFixture.manifest.exports.map((entry, index) => (
        index === 1 ? { ...entry, parameters: null } : entry
      ))
    };
    negativeCodes.push(expectCode(
      guestLink.diagnosticCodes.invalid,
      () => guestLink.normalizeGuestUnitManifest(malformedManifest)
    ));
    const mismatchedPlan = {
      ...plan,
      unit: { ...plan.unit, module: 'different_guest_module' }
    };
    negativeCodes.push(expectCode(guestLink.diagnosticCodes.abiMismatch, () => {
      guestLink.materializePackagePrebuilt({
        plan: mismatchedPlan,
        packageRoot,
        manifestFile: 'native/proof/unit.json',
        projectRoot,
        synchronizedPackages: [{ name: '@pulse-compute/wasm-guest-link', version: '1.0.0-beta.1' }],
        workDirectory: path.join(firstOutput, '.guest-link-work')
      });
    }));
    negativeCodes.push(expectCode(guestLink.diagnosticCodes.ownerMismatch, () => {
      guestLink.materializePackagePrebuilt({
        plan,
        packageRoot,
        manifestFile: 'native/proof/unit.json',
        projectRoot,
        synchronizedPackages: [{ name: '@pulse-compute/wasm-guest-link', version: '0.1.1' }],
        workDirectory: path.join(firstOutput, '.guest-link-work')
      });
    }));

    const tamperedPackage = path.join(temporaryRoot, 'tampered-package');
    const tamperedProject = path.join(temporaryRoot, 'tampered-project');
    fs.cpSync(packageRoot, tamperedPackage, { recursive: true });
    fs.mkdirSync(tamperedProject);
    const tamperedArtifact = path.join(tamperedPackage, 'native', 'proof', 'unit.wasm');
    const tamperedBytes = fs.readFileSync(tamperedArtifact);
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    fs.writeFileSync(tamperedArtifact, tamperedBytes);
    negativeCodes.push(expectCode(guestLink.diagnosticCodes.hashMismatch, () => {
      realize({
        plan,
        packageRoot: tamperedPackage,
        projectRoot: tamperedProject,
        primaryFile,
        memoryOwnerFile,
        outputDirectory: path.join(temporaryRoot, 'tampered-output')
      });
    }));

    fs.rmSync(options.outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const deliverables = {
      final: path.join(options.outputDirectory, 'canonical-native.wasm'),
      report: path.join(options.outputDirectory, 'guest-link-report.json'),
      audit: path.join(options.outputDirectory, 'final-wasm-audit.json')
    };
    fs.copyFileSync(first.files.final, deliverables.final);
    fs.copyFileSync(first.files.guestLinkReport, deliverables.report);
    fs.copyFileSync(first.files.finalWasmAudit, deliverables.audit);

    const evidence = {
      version: evidenceVersion,
      status: 'passed',
      package: {
        name: '@pulse-compute/wasm-guest-link',
        version: '1.0.0-beta.1',
        directBinaryenVersion: guestLink.binaryenVersion
      },
      contractVersions: {
        guestUnit: guestLink.versions.guestUnit,
        guestUnitPlan: guestLink.versions.guestUnitPlan,
        guestLinkReport: guestLink.versions.guestLinkReport,
        finalWasmAudit: guestLink.versions.finalWasmAudit,
        memoryAbi: guestLink.memoryAbi.identity
      },
      toolchain: first.toolchain,
      proof: {
        inputs: {
          primary: expected.primary,
          memoryOwner: expected.memoryOwner,
          guest: expected.guest
        },
        source: {
          algorithm: packageFixture.source.algorithm,
          files: packageFixture.source.files.length,
          bytes: packageFixture.source.bytes,
          sha256: packageFixture.source.sha256
        },
        final: fileRecord(deliverables.final),
        guestLinkReport: fileRecord(deliverables.report),
        finalWasmAudit: fileRecord(deliverables.audit),
        deterministicSecondRealization: true,
        contentAddressedReuse: true,
        runtime
      },
      negativeDiagnostics: [...new Set(negativeCodes)].sort(),
      checks: [
        'strict-versioned-contract-validation',
        'no-package-supplied-execution',
        'closed-synchronized-owner',
        'artifact-and-source-hash-verification',
        'independent-binary-inspection',
        'content-addressed-materialization',
        'static-core-wasm-composition',
        'whole-module-post-link-optimization',
        'complete-final-binary-audit',
        'normalized-redacted-diagnostics',
        'deterministic-provenance-reporting',
        'exact-audited-final-artifact-reproduction'
      ].map((id) => ({ id, status: 'passed' })),
      boundary: {
        compilerIntegration: 'deferred-to-b2',
        providerPackaging: 'not-invoked',
        publicRegistration: false,
        arbitrarySourceBuilds: false,
        fallback: false,
        nextAuthorizedUnit: 'B2'
      }
    };
    const evidenceFile = path.join(options.outputDirectory, 'guest-link-package-report.json');
    fs.writeFileSync(evidenceFile, stableJson(evidence));
    const evidenceRecord = fileRecord(evidenceFile);
    console.log(
      `ok - B1 guest-link package passed; final ${expected.final.sha256}, ` +
      `evidence ${evidenceRecord.sha256}`
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
