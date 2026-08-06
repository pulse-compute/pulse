#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveProject } = require('../../packages/cli/src/project-config.js');
const { buildProject } = require('../../packages/cli/src/project-execution.js');
const { providerTargetAvailability } = require('../../packages/cli/src/provider-drivers.js');
const {
  buildWorkspacePackage,
  cleanupWorkspacePackageBuilds
} = require('../support/workspace-package-build.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const projectRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'fastly-javascript-source');
const outA = path.join(projectRoot, '.package-a');
const outB = path.join(projectRoot, '.package-b');
let eligibilityRoot;

buildWorkspacePackage('packages/assets');
buildWorkspacePackage('packages/grip');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push([path.relative(root, file).replace(/\\/g, '/'), sha256(file)]);
    }
  }
  visit(root);
  return files;
}

try {
  const project = resolveProject({ cwd: projectRoot, profile: 'edge' });
  assert.equal(project.provider, 'fastly');
  assert.equal(project.target, 'javascript');
  assert.equal(project.reporting, 'debug');

  const first = buildProject(project, { outDir: outA });
  const second = buildProject(project, { outDir: outB });
  assert.deepEqual(snapshot(outA), snapshot(outB), 'Fastly JavaScript source packages must be byte-identical');
  assert.equal(first.provider, 'fastly');
  assert.equal(first.configuredTarget, 'javascript');
  assert.equal(first.automaticFallback, false);
  assert.equal(first.manifest.providerTarget.status, 'provider-runtime-ready');
  assert.equal(first.manifest.providerTarget.deployable, true);
  assert.equal(first.manifest.providerTarget.deploymentCandidate, true);
  assert.equal(first.manifest.providerTarget.deploymentValidated, false);
  assert.equal(first.manifest.providerTarget.providerRealityValidated, false);
  assert.equal(first.manifest.providerTarget.nativeWasm, false);
  assert.equal(first.manifest.providerTarget.compiledWasmPresent, false);
  assert.equal(first.manifest.providerTarget.jsComputeRuntime, false);
  assert.equal(first.manifest.providerTarget.downstreamJavascriptRuntimeWasm, true);
  assert.equal(first.manifest.providerTarget.executionReady, true);
  assert.equal(first.manifest.providerTarget.applicationLoader, true);
  assert.equal(first.manifest.providerTarget.requestAdapter, true);
  assert.equal(first.manifest.providerTarget.lifecycle, true);
  assert.equal(first.manifest.reporting.name, 'debug');
  assert.equal(first.sourcePackage.provider, 'fastly');
  assert.equal(first.sourcePackage.target, 'javascript');
  assert.equal(first.sourcePackage.summary.wasmFiles, 0);
  assert.equal(first.sourcePackage.summary.nativeFiles, 0);
  assert.equal(first.sourcePackage.closure.workspaceLinks, false);
  assert.equal(first.sourcePackage.closure.toolchain['@fastly/js-compute'], '3.43.1');
  assert.equal(first.sourcePackage.closure.toolchain.esbuild, '0.28.1');
  assert.ok(first.sourcePackage.closure.inputs.every((entry) => !path.isAbsolute(entry.file)));
  assert.doesNotMatch(JSON.stringify(first.sourcePackage.closure.inputs), new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(first.sourcePackage.downstreamBuild.classification, 'javascript-runtime-deployment');
  assert.equal(first.sourcePackage.downstreamBuild.pulseNativeLowering, false);
  assert.equal(first.sourcePackage.schemas.active, true);
  assert.deepEqual(first.sourcePackage.schemas.ids, [
    'app.CreateUserInput',
    'app.OriginRequest',
    'app.OriginUser',
    'app.Payload',
    'app.UserResponse'
  ]);
  assert.equal(first.sourcePackage.eligibility.providerExecutionReady, true);
  assert.equal(first.sourcePackage.eligibility.projectStatus, 'eligible');
  assert.equal(first.targetSupport.project.status, 'eligible');
  assert.equal(first.targetSupport.loader.skippedReason, 'provider-build-time-bundle-loader');
  assert.equal(
    first.targetSupport.project.packages.some((entry) => entry.required && entry.owner === 'provider-node'),
    false,
    'Fastly package evidence must not attribute runtime ownership to the Node provider'
  );
  assert.equal(
    first.targetSupport.project.packages.some((entry) => entry.required && entry.reasonId === 'node-package-resolution-planned'),
    false,
    'Fastly package evidence must describe esbuild resolution without Node-provider terminology'
  );
  assert.ok(first.targetSupport.project.packages
    .filter((entry) => entry.contractId === 'pulse.assets' || entry.contractId === 'pulse.grip')
    .every((entry) => entry.status === 'eligible'));
  assert.equal(first.targetSupport.project.capabilities.some((entry) => entry.status === 'blocked'), false);
  assert.equal(first.targetSupport.availability.coreExecutionReady, true);
  assert.equal(first.targetSupport.availability.fullTargetSupportReady, true);
  assert.equal(first.targetSupport.availability.generalAvailable, true);
  assert.deepEqual(first.targetSupport.availability.summary, {
    total: 6,
    satisfied: 6,
    pending: 0,
    blocked: 0
  });
  const fourModeGate = first.targetSupport.availability.gates.find((entry) => entry.id === 'four-mode-conformance');
  assert.ok(fourModeGate);
  assert.equal(fourModeGate.evidence.artifact, 'wasm/test/contracts/assert-four-mode-conformance.cjs');
  assert.equal(fourModeGate.evidence.cases, 24);
  const candidateGate = first.targetSupport.availability.gates.find((entry) => entry.id === 'offline-deployment-candidates');
  assert.ok(candidateGate);
  assert.equal(candidateGate.evidence.artifact, 'scripts/offline-release-candidates.cjs');
  assert.equal(candidateGate.evidence.cases, 2);
  assert.equal(providerTargetAvailability('fastly').javascript, true, 'the sealed full-target-support declaration must expose general availability');

  const generatedPackage = JSON.parse(fs.readFileSync(first.files.package, 'utf8'));
  const deployment = JSON.parse(fs.readFileSync(first.files.deployment, 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(first.files.deploymentCandidate, 'utf8'));
  const sourceManifest = JSON.parse(fs.readFileSync(first.files.sourcePackage, 'utf8'));
  assert.deepEqual(generatedPackage.dependencies, { '@fastly/js-compute': '3.43.1' });
  assert.deepEqual(generatedPackage.devDependencies, { esbuild: '0.28.1' });
  assert.doesNotMatch(JSON.stringify(generatedPackage), /workspace:|file:|link:/);
  assert.equal(candidate.status, 'structurally-deployable');
  assert.equal(candidate.provider, 'fastly');
  assert.equal(candidate.target, 'javascript');
  assert.equal(candidate.targetId, 'fastly-javascript');
  assert.equal(candidate.runtimeClass, 'javascript');
  assert.equal(candidate.automaticFallback, false);
  assert.equal(candidate.nativeArtifact, false);
  assert.equal(candidate.providerRealityValidated, false);
  assert.equal(candidate.deployed, false);
  assert.equal(deployment.generalAvailable, true);
  assert.deepEqual(deployment.deferredTo, []);
  assert.deepEqual(candidate.toolchain, {
    '@fastly/js-compute': '3.43.1',
    esbuild: '0.28.1'
  });
  assert.equal(candidate.commands.localReality, 'fastly compute serve');
  assert.equal(candidate.validation.packageClosure, 'bundled');
  assert.equal(candidate.validation.loader, 'generated');
  assert.equal(candidate.validation.manifestAgreement, 'verified-at-package-write');
  assert.equal(candidate.validation.providerReality, 'not-executed');
  assert.equal(candidate.validation.deployment, 'not-executed');
  assert.equal(candidate.identity.applicationPlanHash, sourceManifest.plan.planHash);
  assert.equal(candidate.identity.graphHash, sourceManifest.plan.graphHash);
  assert.equal(candidate.identity.bundleSha256, sourceManifest.closure.bundleSha256);
  assert.equal(candidate.identity.targetSupportEvidenceHash, first.targetSupport.evidenceHash);
  assert.equal(first.manifest.application.entry, candidate.entrypoints.bootstrap);
  assert.equal(first.manifest.application.bundledApplication, candidate.entrypoints.bundledApplication);
  assert.equal(first.manifest.application.package, candidate.entrypoints.packageManifest);
  assert.equal(first.manifest.application.fastlyToml, candidate.entrypoints.fastlyManifest);
  assert.equal(candidate.deployment.version, deployment.version);
  assert.equal(candidate.deployment.manifest, sourceManifest.package.deployment);
  assert.equal(candidate.deployment.sha256, sha256(first.files.deployment));
  assert.equal(sourceManifest.deploymentCandidate.version, candidate.version);
  assert.equal(sourceManifest.deploymentCandidate.status, candidate.status);
  assert.equal(sourceManifest.deploymentCandidate.file, path.basename(first.files.deploymentCandidate));
  assert.equal(sourceManifest.deploymentCandidate.sha256, sha256(first.files.deploymentCandidate));
  assert.deepEqual(sourceManifest.deploymentCandidate.identity, candidate.identity);
  assert.deepEqual(sourceManifest.deploymentCandidate.commands, candidate.commands);
  assert.equal(deployment.candidate.version, candidate.version);
  assert.equal(deployment.candidate.file, path.basename(first.files.deploymentCandidate));
  assert.equal(deployment.candidate.status, candidate.status);
  assert.equal(deployment.candidate.providerRealityValidated, false);
  assert.equal(deployment.candidate.deployed, false);
  assert.ok(candidate.files.every((entry) => sha256(path.join(outA, entry.file)) === entry.sha256));
  assert.doesNotMatch(JSON.stringify(candidate), new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(candidate), /representative-(?:user|grip)-token/);
  assert.match(fs.readFileSync(first.files.fastlyToml, 'utf8'), /language = "javascript"/);
  assert.match(fs.readFileSync(first.files.buildConfig, 'utf8'), /external: \['fastly:\*'\]/);
  const bootstrap = fs.readFileSync(first.files.entry, 'utf8');
  const application = fs.readFileSync(first.files.bundledApplication, 'utf8');
  assert.match(bootstrap, /from 'fastly:config-store'/);
  assert.match(bootstrap, /from 'fastly:secret-store'/);
  assert.match(bootstrap, /from 'fastly:kv-store'/);
  assert.match(bootstrap, /createFastlyJavascriptHandler/);
  assert.match(bootstrap, /addEventListener\('fetch'/);
  assert.match(bootstrap, /enforceExplicitBackends/);
  assert.match(bootstrap, /class PulseFastlyAbortController/);
  const runtimeConfigMatch = bootstrap.match(/export const pulseRuntimeConfig = Object\.freeze\((\{[^\n]+\})\);/);
  assert.ok(runtimeConfigMatch, 'bootstrap must expose one serialized runtime config');
  assert.equal(JSON.parse(runtimeConfigMatch[1]).reporting, 'debug');
  assert.match(application, /pulseFastlyJavascriptHandler|createFastlyJavascriptHandler/);
  assert.match(application, /app\.Payload/);
  assert.match(application, /sha256Bytes/);
  assert.doesNotMatch(application, /node:(?:fs|path|crypto|module)/);
  assert.ok(first.sourcePackage.closure.inputs.some((entry) => /provider-fastly\/src\/javascript\/runtime-host\.js$/.test(entry.file)));
  assert.ok(first.sourcePackage.closure.inputs.some((entry) => /provider-fastly\/src\/javascript\/lifecycle\.js$/.test(entry.file)));
  assert.ok(first.sourcePackage.closure.inputs.some((entry) => /packages\/assets\/dist\/portable\.js$/.test(entry.file)));
  assert.ok(first.sourcePackage.closure.inputs.some((entry) => /packages\/grip\/dist\/index\.js$/.test(entry.file)));

  const emitted = snapshot(outA).map(([file]) => file);
  assert.equal(emitted.some((file) => /\.(?:wasm|wat)$/i.test(file)), false);
  assert.equal(emitted.some((file) => /canonical-native|assemblyscript/i.test(file)), false);
  assert.ok(emitted.includes('pulse-fastly-javascript-deployment.json'));
  assert.ok(emitted.includes('pulse-fastly-javascript-candidate.json'));
  assert.ok(emitted.includes('pulse-fastly-javascript-source-package.json'));
  assert.ok(emitted.includes('pulse-build.json'));
  assert.ok(emitted.includes('schema-json-registry.json'));
  assert.ok(emitted.includes('schema-json-codecs.cjs'));

  eligibilityRoot = fs.mkdtempSync(path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', '.fastly-js-eligibility-'));
  fs.cpSync(projectRoot, eligibilityRoot, { recursive: true });
  const eligibilityConfig = path.join(eligibilityRoot, '.pulse', 'config.ts');
  fs.writeFileSync(eligibilityConfig, fs.readFileSync(eligibilityConfig, 'utf8')
    .replace("sessions: 'session_store',", '')
    .replace("public: 'asset_store',", '')
    .replace("'https://api.example.test': 'api_backend',", '')
    .replace("publishEndpoint: 'https://publisher.example.test/publish',", ''));
  const blockedProject = resolveProject({ cwd: eligibilityRoot, profile: 'edge' });
  assert.throws(
    () => buildProject(blockedProject, { outDir: path.join(eligibilityRoot, 'dist') }),
    (error) => {
      assert.equal(error.code, 'PULSE_PROVIDER_CAPABILITY_UNSUPPORTED');
      assert.ok(error.detail.reasonIds.includes('fastly-fetch-backend-binding-required'));
      assert.ok(error.detail.reasonIds.includes('fastly-kv-binding-required'));
      assert.ok(error.detail.reasonIds.includes('fastly-assets-binding-required'));
      assert.ok(error.detail.reasonIds.includes('fastly-grip-publish-endpoint-required'));
      assert.equal(error.detail.automaticFallback, false);
      return true;
    }
  );
  assert.equal(fs.existsSync(path.join(eligibilityRoot, 'dist')), false, 'eligibility must fail before mutating build output');

  console.log('ok - Fastly JavaScript packaging is deterministic, runtime-ready, target-correct, and generally available');
} finally {
  fs.rmSync(outA, { recursive: true, force: true });
  fs.rmSync(outB, { recursive: true, force: true });
  if (eligibilityRoot) fs.rmSync(eligibilityRoot, { recursive: true, force: true });
  cleanupWorkspacePackageBuilds();
}
