#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, 'shared-router.ts'), 'utf8');
  const { compileCanonicalRouterSource } = require('../../../wasm/packages/compiler/src/canonical-router-compiler');
  const { compileCanonicalSource } = require('../../../wasm/packages/compiler/src/canonical-api-compiler');
  const { buildCanonicalNativePlan } = require('../../../wasm/packages/compiler/src/canonical-native-plan');
  const router = compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: root });
  const compiled = compileCanonicalSource(router.sourceText, {
    fileName: 'src/index.ts', rootDir: root, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata }
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  return { plan: buildCanonicalNativePlan(compiled), metadata: compiled.metadata, sourceSha256: hash(source) };
}

async function compile(job) {
  const prepared = fixture();
  const relativeOwner = job.target === 'portable'
    ? 'wasm/packages/compiler/src/canonical-native-compiler.js'
    : 'packages/provider-fastly/src/build/native-platform-capabilities.js';
  const file = path.join(root, relativeOwner);
  const owner = new Module(file, module); owner.filename = file;
  owner.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = owner.require.bind(owner);
  let ascCalls = 0, generatorCalls = 0, recipe, ownership;
  const capturePath = path.join(job.directory, 'capture.json');
  fs.rmSync(capturePath, { force: true });
  owner.require = id => id === '@pulse-compute/wasm-runtime-core-as/compiler/canonical-native' ? {
    ...originalRequire(id), generateCanonicalNativeAssemblyScript(...args) {
      const generated = originalRequire(id).generateCanonicalNativeAssemblyScript(...args);
      generatorCalls++; ownership = generated.manifest;
      return generated;
    }
  } : id !== 'node:child_process' ? originalRequire(id) : {
    ...originalRequire(id), spawnSync(executable, args, options) {
      assert.match(args[0], /asc\.js$/);
      assert.ok(!args.includes('--debug'));
      ascCalls++;
      recipe = args.slice(1).map(arg => path.isAbsolute(arg)
        ? arg.startsWith(root + path.sep) ? path.relative(root, arg) : '<temporary>/' + path.basename(arg)
        : arg);
      return spawnSync(executable, job.capture
        ? [...args, '--transform', path.join(__dirname, 'capture-transform.cjs')] : args,
      { ...options, env: { ...(options.env || process.env), PRPT00C_CAPTURE_FILE: capturePath } });
    }
  };
  owner._compile(fs.readFileSync(file, 'utf8'), file);
  const options = { cwd: root, emitWat: false, nativeOptimization: job.optimization,
    bindings: {}, canonicalBuild: true, requirePlatformCapability: false };
  const started = Date.now();
  const artifact = job.target === 'portable'
    ? owner.exports.compileCanonicalNativePlan(prepared.plan, options)
    : owner.exports.compileFastlyNativePlatformCapabilitiesPlan(prepared.plan, options);
  assert.equal(ascCalls, 1, 'one native compilation per build');
  assert.equal(generatorCalls, 1, 'ownership comes from the existing generation, without regeneration');
  assert.equal(artifact.guestUnits?.length || 0, 0, 'unlinked fixture');
  fs.writeFileSync(path.join(job.directory, 'artifact.wasm'), artifact.wasm);
  fs.writeFileSync(path.join(job.directory, 'generated.as.ts'), artifact.source);
  write(path.join(job.directory, 'plan.json'), prepared.plan);
  write(path.join(job.directory, 'manifest.json'), artifact.manifest);
  write(path.join(job.directory, 'ownership.json'), ownership);
  let packaged = null;
  if (job.target === 'fastly') {
    const { createFastlyLoweringPlan } = require('../../../packages/provider-fastly/src/provider-contract');
    const { writeFastlyCanonicalTarget } = require('../../../packages/provider-fastly/src/build/canonical-target');
    const outDir = path.join(job.directory, 'package');
    writeFastlyCanonicalTarget({ plan: prepared.plan, native: artifact,
      providerPlan: createFastlyLoweringPlan(prepared.metadata, {}), providerConfig: {}, outDir });
    const bytes = fs.readFileSync(path.join(outDir, 'bin/main.wasm'));
    assert.deepEqual(bytes, artifact.wasm, 'provider packaging preserves captured final bytes');
    packaged = { bytes: bytes.length, sha256: hash(bytes), byteIdentical: true };
  }
  const runtimeChecks = [];
  for (const [route, body, status] of [
    ['/shared-a', 'shared handler', 200], ['/shared-b', 'shared handler', 200],
    ['/duplicate-a', 'identical body', 200], ['/duplicate-b', 'identical body', 200],
    ['/distinct', 'different body', 201]
  ]) {
    const response = job.target === 'fastly'
      ? require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host')
        .executeFastlyNativePlatformCapabilities(artifact, { request: { path: route } }).response
      : (await require('../../../wasm/packages/host-runtime/src/runtime/canonical-native-host')
        .executeCanonicalNativeModule(artifact, {
          providerAdapter: require('../../../packages/provider-node/src/runtime/canonical-api-runtime').createNodeProviderAdapter({}),
          request: { path: route }
        })).response;
    assert.equal(response.body, body); assert.equal(response.status, status);
    runtimeChecks.push({ route, status, passed: true });
  }
  return { fixtureSha256: prepared.sourceSha256, sourceSha256: hash(artifact.source),
    artifactSha256: hash(artifact.wasm), artifactBytes: artifact.wasm.length,
    ascCalls, generatorCalls, recipe, elapsedMs: Date.now() - started, packaged, runtimeChecks,
    assemblyScript: artifact.manifest.assemblyScript };
}

async function main() {
  if (process.argv[2] === '--compile') return console.log(JSON.stringify(await compile(JSON.parse(process.argv[3]))));
  const directory = path.resolve(process.argv[2] || path.join(root, 'wasm/.test-results/prpt00c'));
  fs.mkdirSync(directory, { recursive: true });
  const sourceFiles = ['proof.cjs', 'capture-transform.cjs', 'attribution.cjs', 'direct-graph.cjs', 'shared-router.ts']
    .map(file => path.relative(root, path.join(__dirname, file))).concat([
      'wasm/packages/compiler/src/canonical-native-compiler.js',
      'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
      'wasm/packages/runtime-core-as/src/compiler/canonical-native-control.js',
      'wasm/packages/build-support/src/native-optimization.js',
      'wasm/packages/build-support/src/native-retention-transform.cjs',
      'wasm/test/runtime/compiler-efficiency/o08-wasm-census.cjs',
      'packages/provider-fastly/src/build/native-platform-capabilities.js',
      'packages/provider-fastly/src/build/canonical-target.js'
    ]);
  const { analyze, selfCheck } = require('./attribution.cjs');
  const { directCallClosure, selfCheck: graphSelfCheck } = require('./direct-graph.cjs');
  const report = { version: 'pulse.prpt00c.proof.v1', status: 'running',
    sourceRevision: git(['rev-parse', 'HEAD']), workingTree: git(['status', '--porcelain']),
    sourceFiles: sourceFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    node: process.version, lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    attributionControls: selfCheck(), directGraphControls: graphSelfCheck(), cells: [] };
  for (const { id, target, optimization } of [
    { id: 'portable', target: 'portable' }, { id: 'fastly', target: 'fastly' },
    { id: 'portable-converge', target: 'portable', optimization: 'experimental-native-size' }
  ]) {
    const builds = [false, true].map(capture => {
      const out = path.join(directory, id, capture ? 'capture' : 'control');
      fs.mkdirSync(out, { recursive: true });
      const job = { directory: out, target, capture, optimization };
      const result = spawnSync(process.execPath, [__filename, '--compile', JSON.stringify(job)], {
        cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024
      });
      fs.writeFileSync(path.join(out, 'stderr.log'), result.stderr || '');
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
      const summary = JSON.parse(result.stdout); write(path.join(out, 'build.json'), summary);
      return summary;
    });
    assert.equal(builds[0].sourceSha256, builds[1].sourceSha256);
    assert.deepEqual(builds[0].recipe, builds[1].recipe);
    assert.deepEqual(fs.readFileSync(path.join(directory, id, 'control/artifact.wasm')),
      fs.readFileSync(path.join(directory, id, 'capture/artifact.wasm')), 'whole Wasm bytes unchanged');
    const capture = JSON.parse(fs.readFileSync(path.join(directory, id, 'capture/capture.json')));
    assert.equal(capture.artifactSha256, builds[1].artifactSha256, 'capture describes final bytes');
    if (optimization) assert.ok(capture.convergenceEmissions > 0, 'convergence hook exercised');
    const plan = JSON.parse(fs.readFileSync(path.join(directory, id, 'capture/plan.json')));
    const ownership = JSON.parse(fs.readFileSync(path.join(directory, id, 'capture/ownership.json')));
    const attribution = analyze(plan, ownership, capture, builds[1].artifactSha256);
    assert.equal(attribution.applicationDirectBody.completeRoutes, 5, 'fixture maps every route');
    assert.equal(attribution.authoredHandlerRegistrations.filter(row => row.registrationCount === 2).length, 1);
    for (const route of attribution.routes) {
      route.directCallReachable = route.status === 'complete'
        ? directCallClosure(capture.graph, route.functionIndices)
        : { status: 'unavailable', reason: 'incomplete route-root mapping' };
    }
    const cell = { id, target, optimization: optimization || 'default', builds,
      wholeArtifactIdentical: true, capture, attribution };
    report.cells.push(cell); write(path.join(directory, 'proof.json'), report);
    console.log(JSON.stringify({ id, bytes: capture.artifactBytes, functions: capture.functions.length,
      mappedRoutes: attribution.applicationDirectBody.completeRoutes, graph: capture.graph.status,
      routes: attribution.routes.map(row => ({ path: row.path, direct: row.directBodyBytes,
        reachable: row.directCallReachable.bodyBytes, reason: row.directCallReachable.reason })) }));
  }
  report.status = 'passed'; write(path.join(directory, 'proof.json'), report);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, compile };
