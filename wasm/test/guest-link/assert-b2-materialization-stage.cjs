#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guestLink = require('../../packages/wasm-guest-link/src/index.js');
const {
  GUEST_LINK_STAGE_INVOCATION_VERSION,
  GUEST_LINK_STAGE_RESULT_VERSION,
  realizeGuestLinkStage
} = require('../../packages/wasm-guest-link/src/stage.js');
const {
  GUEST_UNIT_CONTRIBUTION_VERSION,
  normalizeGuestUnitContribution
} = require('../../packages/contracts/src/package/package-contract.js');
const {
  FINAL_WASM_POLICY_VERSION,
  defineFinalWasmPolicy
} = require('../../packages/contracts/src/provider/final-wasm-policy.js');
const { CANONICAL_NATIVE_PLAN_VERSION } = require('../../packages/contracts/src/handler/canonical-native-plan.js');
const { writeFastlyCanonicalTarget } = require('../../../packages/provider-fastly/src/build/canonical-target.js');
const { createFastlyLoweringPlan } = require('../../../packages/provider-fastly/src/provider-contract.js');
const {
  FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION
} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const fixtureRoot = path.join(__dirname, 'fixtures');
const outputDirectory = path.resolve(process.argv[2] || path.join(wasmRoot, '.test-results', 'guest-link-b2'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixtureWasm(name) {
  return Buffer.from(fs.readFileSync(path.join(fixtureRoot, 'package', `${name}.wasm.base64`), 'utf8').trim(), 'base64');
}

function makePackage(root) {
  const native = path.join(root, 'native', 'proof');
  const source = path.join(native, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.cpSync(path.join(fixtureRoot, 'memory', 'rust'), source, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), stableJson({
    name: '@pulse-compute/wasm-guest-link',
    version: '1.0.0-beta.1'
  }));
  const artifact = fixtureWasm('guest');
  fs.writeFileSync(path.join(native, 'unit.wasm'), artifact);
  const sourceRecord = guestLink.sourceTreeRecord(source);
  const manifest = {
    version: guestLink.versions.guestUnit,
    id: 'pulse.guest-link.proof.borrowed-span',
    module: 'pulse_guest_memory',
    owner: '@pulse-compute/wasm-guest-link',
    packageVersion: '1.0.0-beta.1',
    abi: 'pulse.guest-link.proof.borrowed-span.v1',
    origin: 'package-prebuilt',
    artifact: { file: 'native/proof/unit.wasm', bytes: artifact.length, sha256: sha256(artifact) },
    source: { included: true, directory: 'native/proof/source', treeSha256: sourceRecord.sha256 },
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
  fs.writeFileSync(path.join(native, 'unit.json'), stableJson(manifest));
  return manifest;
}

function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-b2-stage-'));
  try {
    const packageRoot = path.join(temporary, 'package');
    const projectRoot = path.join(temporary, 'project');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    const manifest = makePackage(packageRoot);
    const contribution = normalizeGuestUnitContribution({
      version: GUEST_UNIT_CONTRIBUTION_VERSION,
      id: manifest.id,
      manifest: './native/proof/unit.json'
    }, {
      owner: manifest.owner,
      packageVersion: manifest.packageVersion
    });
    const selection = Object.freeze({ contribution, packageRoot });
    const finalWasmPolicy = defineFinalWasmPolicy({
      version: FINAL_WASM_POLICY_VERSION,
      descriptorOwner: '@pulse-compute/provider-fastly',
      toolchainVersion: 'pulse.provider-toolchain.v1',
      descriptorIdentity: 'fastly-compute-native',
      permittedImports: [],
      requiredExports: []
    });
    const invocation = {
      version: GUEST_LINK_STAGE_INVOCATION_VERSION,
      projectRoot,
      profile: 'native',
      finalWasmPolicy,
      synchronizedPackages: [{ name: manifest.owner, version: manifest.packageVersion }],
      optimizationPosture: 'native-default'
    };
    const primary = fixtureWasm('primary');
    const realize = (overrides = {}) => realizeGuestLinkStage({
      ...invocation,
      primaryWasm: primary,
      guestUnits: [selection],
      ...overrides
    });
    const first = realize();
    const second = realize();
    assert.equal(first.version, GUEST_LINK_STAGE_RESULT_VERSION);
    assert.equal(first.materialization.reused, false);
    assert.equal(second.materialization.reused, true);
    assert.equal(first.plan.materialization.directory, `.pulse/guests/${manifest.id}/${manifest.artifact.sha256}`);
    assert.equal(first.report.fallback.enabled, false);
    assert.equal(first.report.fallback.used, false);
    assert.equal(first.audit.providerPackaging.authorized, true);
    assert.equal(first.audit.artifact.sha256, sha256(first.wasm));
    assert.deepEqual(first.wasm, second.wasm);
    assert.equal(sha256(first.wasm), 'c9f3fbcdb0cd2ffe3a6d9cc7446802ab2a99cd3b65120c4fcf8482f15544dc1d');
    const finalModule = new WebAssembly.Module(first.wasm);
    const providerInput = Object.freeze({
      ...first,
      version: FASTLY_NATIVE_PLATFORM_CAPABILITIES_VERSION,
      compilerVersion: 'pulse.canonical-native-wasm-compiler.v3',
      source: '// B2 provider handoff proof\n',
      sourceHash: sha256('// B2 provider handoff proof\n'),
      plan: Object.freeze({
        version: CANONICAL_NATIVE_PLAN_VERSION,
        planHash: 'b2-proof',
        source: Object.freeze({ sourceHash: 'b2-proof', projectSourceHash: 'b2-proof' }),
        capabilities: Object.freeze([]),
        packages: Object.freeze({ effects: Object.freeze([]) }),
        schemas: Object.freeze({ ids: Object.freeze([]), references: Object.freeze([]) })
      }),
      guestLink: Object.freeze({
        version: first.version,
        plan: first.plan,
        report: first.report,
        audit: first.audit,
        materialization: first.materialization,
        finalArtifact: first.finalArtifact,
        providerPackaging: first.providerPackaging,
        fallback: first.fallback
      }),
      manifest: Object.freeze({
        assemblyScript: Object.freeze({ package: 'assemblyscript', version: '0.28.18' }),
        optimization: Object.freeze({ posture: 'native-size' }),
        wasm: first.finalArtifact,
        wat: Object.freeze({ bytes: Buffer.byteLength(first.wat), sha256: sha256(first.wat) }),
        importModules: Object.freeze([]),
        imports: Object.freeze(WebAssembly.Module.imports(finalModule)),
        exports: Object.freeze(WebAssembly.Module.exports(finalModule)),
        finalWasmAudit: first.audit
      })
    });
    const providerOutput = path.join(temporary, 'fastly-package');
    const providerPlan = createFastlyLoweringPlan({}, {});
    const providerBuild = writeFastlyCanonicalTarget({
      outDir: providerOutput,
      projectRoot,
      plan: providerInput.plan,
      providerPlan,
      native: providerInput,
      providerConfig: Object.freeze({ bindings: Object.freeze({}) })
    });
    assert.deepEqual(fs.readFileSync(providerBuild.wasmFile), first.wasm);
    assert.equal(providerBuild.build.guestLink.packagedBytesMatchAudit, true);
    assert.equal(providerBuild.build.compiler.invoked, false);
    const tamperedWasm = Buffer.concat([
      providerInput.wasm,
      Buffer.from([0])
    ]);
    assert.throws(() => writeFastlyCanonicalTarget({
      outDir: path.join(temporary, 'fastly-rejected'),
      projectRoot,
      plan: providerInput.plan,
      providerPlan,
      native: Object.freeze({
        ...providerInput,
        wasm: tamperedWasm,
        manifest: Object.freeze({
          ...providerInput.manifest,
          wasm: Object.freeze({
            bytes: tamperedWasm.length,
            sha256: sha256(tamperedWasm)
          })
        })
      }),
      providerConfig: Object.freeze({ bindings: Object.freeze({}) })
    }), (error) => error && error.code === 'PULSE_GUEST_FINAL_AUDIT_FAILED');
    assert.throws(
      () => realize({
        synchronizedPackages: [{ name: manifest.owner, version: '0.1.1' }]
      }),
      (error) => error && error.code === guestLink.diagnosticCodes.ownerMismatch
    );

    const materializedDirectory = path.join(projectRoot, first.plan.materialization.directory);
    assert.deepEqual(fs.readdirSync(materializedDirectory).sort(), ['unit.json', 'unit.wasm']);
    const firstMaterializedArtifact = fs.readFileSync(path.join(materializedDirectory, 'unit.wasm'));
    const firstMaterializedManifest = fs.readFileSync(path.join(materializedDirectory, 'unit.json'));
    fs.rmSync(path.join(projectRoot, '.pulse', 'guests'), { recursive: true, force: true });
    assert.equal(fs.existsSync(materializedDirectory), false);
    const recreated = realize();
    assert.equal(recreated.materialization.reused, false);
    assert.deepEqual(recreated.wasm, first.wasm);
    assert.deepEqual(fs.readFileSync(path.join(materializedDirectory, 'unit.wasm')), firstMaterializedArtifact);
    assert.deepEqual(fs.readFileSync(path.join(materializedDirectory, 'unit.json')), firstMaterializedManifest);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const report = Object.freeze({
      version: 'pulse.guest-unit-materialization-proof.v1',
      status: 'passed',
      contribution: Object.freeze({
        version: contribution.version,
        distinctFromRealizationArtifacts: true,
        owner: contribution.owner,
        packageVersion: contribution.packageVersion
      }),
      stageOrder: Object.freeze([
        'primary-assemblyscript-compilation',
        'guest-unit-materialization',
        'core-wasm-composition',
        'whole-module-optimization',
        'final-wasm-audit',
        'provider-packaging'
      ]),
      materialization: Object.freeze({
        directory: first.plan.materialization.directory,
        generated: true,
        contentAddressed: true,
        safeToDelete: true,
        first: 'created',
        second: 'reused',
        afterDeletion: 'recreated',
        recreatedMaterializationBytesIdentical: true,
        recreatedFinalArtifactBytesIdentical: true
      }),
      stage: Object.freeze({
        invocationVersion: GUEST_LINK_STAGE_INVOCATION_VERSION,
        resultVersion: GUEST_LINK_STAGE_RESULT_VERSION,
        owner: '@pulse-compute/wasm-guest-link'
      }),
      finalArtifact: first.finalArtifact,
      providerPackaging: first.providerPackaging,
      fastlyPackaging: Object.freeze({
        artifact: 'bin/main.wasm',
        sha256: sha256(fs.readFileSync(providerBuild.wasmFile)),
        matchesFinalAudit: providerBuild.build.guestLink.packagedBytesMatchAudit,
        recompiledAfterAudit: providerBuild.build.compiler.invoked
      }),
      failurePolicy: Object.freeze({
        automaticFallback: false,
        alternateRealizationAttempted: false,
        synchronizedVersionMismatch: 'rejected'
      })
    });
    fs.writeFileSync(path.join(outputDirectory, 'guest-unit-materialization-proof.json'), stableJson(report));
    console.log(`ok - B2 materialized once, reused by content hash, and authorized exact audited ${report.finalArtifact.sha256}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main();
