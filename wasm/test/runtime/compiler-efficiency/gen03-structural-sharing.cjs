#!/usr/bin/env node
'use strict';
// Opt-in paired evidence. Existing GEN01 workers keep attribution outside the
// measured compile path; runtime/ownership controls run in separate processes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const { fixture } = require('./gen01-census.cjs');
const proof = require('../../provider/assert-fastly-structural-sharing.cjs');
const owner = 'packages/provider-fastly/src/build/native-platform-capabilities.js';
const worker = 'wasm/test/runtime/compiler-efficiency/gen01-census.cjs';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function semantic(job) {
  const provider = require(path.join(job.root, owner));
  const host = require(path.join(job.root, 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js'));
  const { plan } = proof.fixture();
  const artifact = provider.compileFastlyNativePlatformCapabilitiesPlan(plan, proof.options);
  const controls = proof.controls(artifact, job.output);
  const request = { request: { method: 'POST', path: '/', body: '{"name":"雪😀","count":-7,"active":true,"tag":"b"}' } };
  const repeatedRequestMs = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = host.executeFastlyNativePlatformCapabilities(artifact, request);
    repeatedRequestMs.push(performance.now() - start);
    assert.deepEqual(result.response, controls.response);
  }
  const module = new WebAssembly.Module(artifact.wasm);
  return { sourceBytes: Buffer.byteLength(artifact.source), sourceSha256: hash(artifact.source),
    wasmBytes: artifact.wasm.length, wasmSha256: hash(artifact.wasm), repeatedRequestMs,
    imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module),
    cases: controls.cases, records: controls.records, response: controls.response, trace: controls.trace,
    freshContainers: controls.freshContainers, aliasedInputsDetached: controls.aliasedInputsDetached,
    decodedResultsFrozen: controls.decodedResultsFrozen, controlByteIdentical: controls.controlByteIdentical };
}

function child(cwd, script, args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 180000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function main() {
  if (process.argv[2] === '--semantic') return console.log(JSON.stringify(semantic(JSON.parse(process.argv[3]))));
  assert.ok(process.argv[2], 'usage: node gen03-structural-sharing.cjs /path/to/merged-gen02-worktree');
  const roots = { baseline: path.resolve(process.argv[2]), candidate: root };
  const output = path.join(root, 'wasm/.test-results/compiler-efficiency/gen03', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const identityFiles = ['pnpm-lock.yaml', worker, 'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
    'packages/provider-fastly/src/testing/native-platform-capabilities-host.js'];
  const identities = Object.fromEntries(Object.entries(roots).map(([variant, cwd]) => [variant, {
    revision: git(cwd, ['rev-parse', 'HEAD']), tree: git(cwd, ['rev-parse', 'HEAD^{tree}']),
    workingTree: git(cwd, ['status', '--porcelain']),
    files: Object.fromEntries([...identityFiles, owner].map(file => [file, hash(fs.readFileSync(path.join(cwd, file)))]))
  }]));
  for (const file of identityFiles) assert.equal(identities.baseline.files[file], identities.candidate.files[file]);
  const report = { version: 'pulse.gen03.structural-sharing.v1', status: 'running', node: process.version,
    identities, harnessSha256: hash(fs.readFileSync(__filename)),
    controlsSha256: hash(fs.readFileSync(require.resolve('../../provider/assert-fastly-structural-sharing.cjs'))),
    samples: 3, cells: [], semantic: {}, limitations: [
      'Synthetic Fastly Native fixtures; injected ABI execution is not deployed acceptance.',
      'Source bytes, final Wasm bytes, compiler RSS, and runtime duration are separate metrics; no live-memory claim.',
      'Three paired compiler samples are an initial screen; overlapping ranges are inconclusive.',
      'Runtime samples include module creation and request execution on the semantic fixture, not the scaling cells.',
      'The runtime process has already executed the module; engine compilation may be cached. These are not cold-start samples.'
    ] };
  const reportFile = path.join(output, 'measurements.json'), save = () => write(reportFile, report);
  try {
    for (const cell of [
      { id: 'schema-1', schemas: 1, diverse: false, routes: 1, effects: 1 },
      { id: 'schema-32-repeat', schemas: 32, diverse: false, routes: 1, effects: 1 },
      { id: 'schema-16-diverse', schemas: 16, diverse: true, routes: 1, effects: 1 }
    ]) {
      const project = path.join(output, cell.id), schemaFile = path.join(project, 'schemas.ts'), routerFile = path.join(project, 'src/index.ts');
      fs.mkdirSync(path.dirname(routerFile), { recursive: true });
      const input = fixture(cell); fs.writeFileSync(schemaFile, input.schema); fs.writeFileSync(routerFile, input.router);
      const job = { cell, project, schemaFile, routerFile };
      const entry = { cell, fixtureHashes: { schema: hash(input.schema), router: hash(input.router) }, analysis: {}, samples: [] };
      report.cells.push(entry);
      for (const [variant, cwd] of Object.entries(roots)) entry.analysis[variant] = child(cwd, path.join(cwd, worker), ['--analyze', JSON.stringify(job)]);
      for (let sample = 0; sample < 3; sample++) for (const variant of sample % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const cwd = roots[variant], usage = path.join(project, `${variant}-${sample}`); fs.mkdirSync(usage);
        const hook = path.join(usage, 'usage.cjs');
        fs.writeFileSync(hook, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(${JSON.stringify(usage)} + '/' + process.pid + '.json', JSON.stringify(process.resourceUsage().maxRSS * 1024)));`);
        const result = child(cwd, path.join(cwd, worker), ['--compile', JSON.stringify(job)], {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}`
        });
        const rss = fs.readdirSync(usage).filter(name => name.endsWith('.json')).map(name => read(path.join(usage, name)));
        assert.ok(rss.length); result.assemblyScriptPeakRssBytes = Math.max(...rss);
        assert.equal(result.sourceSha256, entry.analysis[variant].sourceSha256);
        assert.equal(result.sourceBytes, entry.analysis[variant].partition.bytes);
        const prior = entry.samples.find(row => row.variant === variant);
        if (prior) assert.equal(result.wasmSha256, prior.wasmSha256);
        entry.samples.push({ variant, sample, ...result }); save();
        console.log(JSON.stringify({ cell: cell.id, variant, sample, sourceBytes: result.sourceBytes, wasmBytes: result.wasmBytes }));
      }
    }
    for (const [variant, cwd] of Object.entries(roots)) {
      report.semantic[variant] = child(cwd, __filename, ['--semantic', JSON.stringify({ root: cwd, output: path.join(output, variant) })]);
      save();
    }
    for (const key of ['records', 'response', 'trace', 'imports', 'exports']) assert.deepEqual(report.semantic.baseline[key], report.semantic.candidate[key], `paired ${key}`);
    for (const value of Object.values(report.semantic)) {
      value.outcomeSha256 = hash(JSON.stringify(value.records)); delete value.records;
    }
    report.status = 'passed'; save(); console.log(JSON.stringify({ status: report.status, report: reportFile }));
  } catch (error) { report.status = 'failed'; report.error = error.stack; save(); throw error; }
}
if (require.main === module) main();
