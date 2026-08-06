#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  run,
  parseJson,
  spawnDev,
  waitForJsonEvent,
  waitForClose
} = require('../cli/helpers.cjs');

const FASTLY_JAVASCRIPT_TOOLING_EVIDENCE_VERSION = 'pulse.fastly-javascript-tooling-evidence.v1';
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const projectsRoot = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects');
const fixtureRoot = path.join(projectsRoot, 'fastly-javascript-source');
const caseNames = Object.freeze(['inspect', 'doctor', 'test', 'dev', 'compile', 'build']);

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

function postJson(baseUrl, pathname, value) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(value);
    const request = http.request(new URL(pathname, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body))
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Object.freeze({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      })));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function removeGeneratedRoots(roots) {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

async function settleGeneratedRootCleanup(roots) {
  for (const delayMs of [0, 100, 250, 500, 1000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    removeGeneratedRoots(roots);
  }
  assert.deepEqual(
    roots.filter((root) => fs.existsSync(root)),
    [],
    'Fastly JavaScript tooling left generated build roots'
  );
}

async function main() {
  const projectRoot = fixtureRoot;
  const generatedRoots = Object.freeze([
    path.join(projectRoot, '.tooling-build-a'),
    path.join(projectRoot, '.tooling-build-b')
  ]);
  const children = new Set();
  try {
    const inspection = parseJson(run(
      ['inspect', '--profile', 'edge', '--json'],
      projectRoot,
      { timeout: 120000 }
    ));
    assert.equal(inspection.status, 'ok');
    assert.equal(inspection.project.provider, 'fastly');
    assert.equal(inspection.project.target, 'javascript');
    assert.equal(inspection.provider.selectedTarget, 'javascript');
    assert.equal(inspection.provider.realization.javascriptRuntime, true);
    assert.equal(inspection.provider.realization.nativeWasm, false);
    assert.deepEqual(inspection.provider.realization.localTooling, {
      test: 'provider-emulation',
      dev: 'provider-emulation',
      loader: 'provider-owned-bundled-closure',
      packageClosure: 'esbuild-bundled',
      providerReality: false,
      realityRunner: 'fastly compute serve',
      automaticFallback: false
    });
    assert.deepEqual(inspection.provider.realization.deploymentCandidate, {
      status: 'structurally-deployable',
      emittedBy: 'pulse build',
      providerRealityValidated: false,
      deployed: false
    });
    assert.equal(inspection.provider.targetSupport.project.status, 'eligible');
    assert.ok(inspection.provider.targetSupport.commands.every((entry) => entry.status === 'eligible'));
    assert.equal(inspection.provider.targetSupport.availability.coreExecutionReady, true);
    assert.equal(inspection.provider.targetSupport.availability.fullTargetSupportReady, true);
    assert.equal(inspection.provider.targetSupport.availability.generalAvailable, true);
    assert.equal(inspection.provider.targetSupport.availability.summary.pending, 0);
    assert.ok(inspection.provider.targetSupport.availability.gates.every((entry) => entry.status === 'satisfied'));
    assert.equal(inspection.provider.realization.automaticFallback, false);
    assert.equal(inspection.provider.realization.loader.skippedReason, 'provider-build-time-bundle-loader');

    const doctor = parseJson(run(
      ['doctor', '--profile', 'edge', '--json'],
      projectRoot,
      { timeout: 180000 }
    ));
    assert.equal(doctor.status, 'passed');
    assert.equal(doctor.summary.failed, 0);
    assert.equal(doctor.project.provider, 'fastly');
    assert.equal(doctor.project.target, 'javascript');
    assert.equal(doctor.checks.some((entry) => entry.status === 'failed'), false);
    const localTooling = doctor.checks.find((entry) => entry.id === 'javascript-local-tooling');
    assert.ok(localTooling);
    assert.equal(localTooling.status, 'passed');
    assert.equal(localTooling.detail.mode, 'provider-emulation');
    assert.equal(localTooling.detail.loader, 'provider-owned-bundled-closure');
    assert.equal(localTooling.detail.packageClosure, 'esbuild-bundled');
    assert.equal(localTooling.detail.providerReality, false);
    assert.equal(localTooling.detail.realityRunner, 'fastly compute serve');
    assert.equal(localTooling.detail.automaticFallback, false);
    assert.equal(doctor.targetSupport.availability.generalAvailable, true);
    assert.equal(doctor.targetSupport.availability.fullTargetSupportReady, true);
    assert.equal(doctor.targetSupport.availability.summary.pending, 0);

    const tested = parseJson(run(
      ['test', '--profile', 'edge', '--json'],
      projectRoot,
      { timeout: 180000 }
    ));
    assert.equal(tested.status, 'passed');
    assert.equal(tested.provider, 'fastly');
    assert.equal(tested.target, 'javascript');
    assert.equal(tested.targetId, 'fastly-javascript');
    assert.equal(tested.automaticFallback, false);
    assert.deepEqual(tested.summary, { total: 6, passed: 6, failed: 0 });
    assert.equal(tested.metadata.localExecution.mode, 'provider-emulation');
    assert.equal(tested.metadata.localExecution.providerReality, false);
    assert.equal(tested.metadata.localExecution.realityRunner, 'fastly compute serve');
    assert.equal(tested.metadata.localExecution.automaticFallback, false);
    assert.equal(tested.metadata.localExecution.loader.kind, 'provider-owned-bundled-closure');
    assert.match(tested.metadata.localExecution.loader.sourceHash, /^[a-f0-9]{64}$/);
    assert.ok(tested.metadata.localExecution.loader.bundledInputs > 0);
    assert.deepEqual(tested.metadata.localExecution.loader.packagesLoaded, [
      '@pulse-compute/assets',
      '@pulse-compute/grip',
      '@pulse-compute/pulse'
    ]);
    const representative = tested.cases.find((entry) => entry.name === 'representative-request');
    assert.ok(representative);
    assert.equal(representative.response.status, 201);
    assert.deepEqual(representative.providerExecution.fetches.map((entry) => ({
      url: entry.url,
      method: entry.method,
      backend: entry.backend,
      authenticated: entry.authenticated,
      contentType: entry.contentType,
      hasBody: entry.hasBody
    })), [
      {
        url: 'https://api.example.test/user',
        method: 'POST',
        backend: 'api_backend',
        authenticated: false,
        contentType: 'application/json; charset=utf-8',
        hasBody: true
      },
      {
        url: 'https://publisher.example.test/publish',
        method: 'POST',
        backend: 'publisher_backend',
        authenticated: true,
        contentType: 'application/json; charset=utf-8',
        hasBody: true
      }
    ]);
    assert.deepEqual(representative.providerExecution.logs.map((entry) => entry.level), ['error', 'warn', 'info', 'debug']);
    assert.ok(representative.providerExecution.logs.every((entry) => entry.message.includes('<redacted>')));
    assert.deepEqual(representative.jsonTrace.map((entry) => entry.kind), [
      'json.decode.request',
      'json.encode.fetch',
      'json.decode.fetch',
      'json.encode.response'
    ]);
    assert.deepEqual(representative.continuations[0].keys, [
      'mode',
      'token',
      'session',
      'stored',
      'user',
      'acknowledgement'
    ]);
    assert.equal(tested.cases.find((entry) => entry.name === 'assets-pass-through').response.status, 200);
    assert.equal(tested.cases.find((entry) => entry.name === 'head-bodyless-ownership').response.status, 200);
    assert.equal(tested.cases.find((entry) => entry.name === 'bodyless-status').response.status, 204);
    assert.equal(tested.cases.find((entry) => entry.name === 'request-contained-redacted-error').response.status, 500);
    assert.doesNotMatch(JSON.stringify(tested), /representative-(?:user|grip)-token/);

    const dev = spawnDev(
      ['dev', '--profile', 'edge', '--port', '0', '--no-watch', '--once', '--json'],
      projectRoot,
      children
    );
    const ready = await waitForJsonEvent(dev.child, 'ready', dev.stderrText);
    assert.equal(ready.provider, 'fastly');
    assert.equal(ready.target, 'javascript');
    assert.equal(ready.targetId, 'fastly-javascript');
    assert.equal(ready.executionMode, 'provider-emulation');
    assert.equal(ready.providerReality, false);
    assert.equal(ready.realityRunner, 'fastly compute serve');
    assert.equal(ready.automaticFallback, false);
    assert.equal(ready.localLoader.kind, 'provider-owned-bundled-closure');
    assert.match(ready.localLoader.sourceHash, /^[a-f0-9]{64}$/);
    assert.ok(ready.localLoader.bundledInputs > 0);
    assert.deepEqual(ready.localLoader.packagesLoaded, [
      '@pulse-compute/assets',
      '@pulse-compute/grip',
      '@pulse-compute/pulse'
    ]);
    assert.equal(ready.once, true);
    assert.equal(ready.watch, false);
    const devResponse = await postJson(ready.url, '/users/42', { name: 'Ada', active: true });
    assert.equal(devResponse.status, 201, dev.stderrText());
    assert.deepEqual(JSON.parse(devResponse.body), {
      id: '42',
      name: 'Ada',
      active: true,
      middleware: 'seen',
      mode: 'edge',
      sessionId: 'session-1',
      stored: true,
      upstreamId: 7,
      score: 98.5,
      acknowledged: true,
      authenticated: true
    });
    await waitForClose(dev.child, dev.stderrText);

    const compiled = parseJson(run(
      ['compile', '--profile', 'edge', '--out', '.tooling-build-a', '--json'],
      projectRoot,
      { timeout: 180000 }
    ));
    assert.equal(compiled.status, 'compiled');
    assert.equal(compiled.target, 'portable-native-wasm');
    assert.equal(compiled.provider, null);
    assert.equal(compiled.providerNeutral, true);
    assert.equal(compiled.configuredProvider, 'fastly');
    assert.equal(compiled.configuredTarget, 'javascript');
    assert.equal(compiled.automaticFallback, false);
    assert.equal(compiled.manifest.provider, null);
    assert.equal(compiled.manifest.providerNeutral, true);
    assert.equal(compiled.manifest.configuredProvider, 'fastly');
    assert.equal(compiled.manifest.configuredTarget, 'javascript');
    assert.equal(compiled.manifest.automaticFallback, false);
    assert.equal(compiled.targetSupport.project.status, 'eligible');
    assert.ok(fs.existsSync(compiled.files.nativeWasm));

    const buildA = path.join(projectRoot, '.tooling-build-a');
    const buildB = path.join(projectRoot, '.tooling-build-b');
    const first = parseJson(run(
      ['build', '--profile', 'edge', '--out', '.tooling-build-a', '--json'],
      projectRoot,
      { timeout: 180000 }
    ));
    const second = parseJson(run(
      ['build', '--profile', 'edge', '--out', '.tooling-build-b', '--json'],
      projectRoot,
      { timeout: 180000 }
    ));
    assert.deepEqual(snapshot(buildA), snapshot(buildB));
    assert.equal(first.status, 'built');
    assert.equal(second.status, 'built');
    assert.equal(first.provider, 'fastly');
    assert.equal(first.configuredTarget, 'javascript');
    assert.equal(first.automaticFallback, false);
    assert.equal(first.manifest.providerTarget.deployable, true);
    assert.equal(first.manifest.providerTarget.deploymentCandidate, true);
    assert.equal(first.manifest.providerTarget.deploymentValidated, false);
    assert.equal(first.manifest.providerTarget.providerRealityValidated, false);
    assert.equal(first.manifest.providerTarget.nativeWasm, false);
    assert.equal(first.manifest.providerTarget.compiledWasmPresent, false);
    assert.equal(first.sourcePackage.summary.wasmFiles, 0);
    assert.equal(first.sourcePackage.summary.nativeFiles, 0);
    assert.ok(first.sourcePackage.closure.inputs.some((entry) => /provider-fastly\/src\/javascript\/runtime-host\.js$/.test(entry.file)));
    assert.ok(first.sourcePackage.closure.inputs.some((entry) => /packages\/assets\/dist\/portable\.js$/.test(entry.file)));
    assert.ok(first.sourcePackage.closure.inputs.some((entry) => /packages\/grip\/dist\/index\.js$/.test(entry.file)));

    const sourceManifest = JSON.parse(fs.readFileSync(first.files.sourcePackage, 'utf8'));
    const deployment = JSON.parse(fs.readFileSync(first.files.deployment, 'utf8'));
    const candidate = JSON.parse(fs.readFileSync(first.files.deploymentCandidate, 'utf8'));
    assert.equal(candidate.status, 'structurally-deployable');
    assert.equal(candidate.providerRealityValidated, false);
    assert.equal(candidate.deployed, false);
    assert.equal(candidate.automaticFallback, false);
    assert.equal(candidate.commands.localReality, 'fastly compute serve');
    assert.deepEqual(candidate.toolchain, {
      '@fastly/js-compute': '3.43.1',
      esbuild: '0.28.1'
    });
    assert.equal(candidate.identity.applicationPlanHash, sourceManifest.plan.planHash);
    assert.equal(candidate.identity.graphHash, sourceManifest.plan.graphHash);
    assert.equal(candidate.identity.bundleSha256, sourceManifest.closure.bundleSha256);
    assert.equal(first.manifest.application.entry, candidate.entrypoints.bootstrap);
    assert.equal(first.manifest.application.bundledApplication, candidate.entrypoints.bundledApplication);
    assert.equal(first.manifest.application.package, candidate.entrypoints.packageManifest);
    assert.equal(first.manifest.application.fastlyToml, candidate.entrypoints.fastlyManifest);
    assert.equal(candidate.deployment.version, deployment.version);
    assert.equal(candidate.deployment.sha256, sha256(first.files.deployment));
    assert.equal(sourceManifest.deploymentCandidate.sha256, sha256(first.files.deploymentCandidate));
    assert.deepEqual(sourceManifest.deploymentCandidate.identity, candidate.identity);
    assert.deepEqual(sourceManifest.deploymentCandidate.commands, candidate.commands);
    assert.equal(deployment.candidate.file, path.basename(first.files.deploymentCandidate));
    assert.equal(deployment.candidate.status, candidate.status);
    assert.ok(candidate.files.every((entry) => sha256(path.join(buildA, entry.file)) === entry.sha256));
    assert.match(fs.readFileSync(first.files.entry, 'utf8'), /addEventListener\('fetch'/);
    assert.equal(snapshot(buildA).some(([file]) => /\.(?:wasm|wat)$/i.test(file)), false);
    assert.doesNotMatch(JSON.stringify(candidate), /representative-(?:user|grip)-token/);

    assert.deepEqual(caseNames, ['inspect', 'doctor', 'test', 'dev', 'compile', 'build']);
    console.log(`ok - ${FASTLY_JAVASCRIPT_TOOLING_EVIDENCE_VERSION} passed ${caseNames.length} truthful Fastly JavaScript CLI cases`);
  } finally {
    for (const child of children) {
      try { child.kill('SIGKILL'); } catch (_) { /* Best-effort descendant cleanup. */ }
    }
    await settleGeneratedRootCleanup(generatedRoots);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
