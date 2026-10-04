#!/usr/bin/env node
'use strict';
// Paired isolated production workers; diagnostic profiling runs separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { root, hash } = require('./schema-cost-profile.cjs');
const { fixture } = require('./sc01-schema-cost.cjs');
const baseline = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'usage: node sc02-scalar-sharing.cjs /path/to/merged-sc01-worktree');
const roots = { baseline, candidate: root };
const relativeWorker = 'wasm/test/runtime/compiler-efficiency/sc01-schema-cost.cjs';
const owner = 'packages/provider-fastly/src/build/native-platform-capabilities.js';
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const output = path.join(root, 'wasm/.test-results/compiler-efficiency/sc02', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
function child(cwd, mode, job, env = {}) {
  const result = spawnSync(process.execPath, [path.join(cwd, relativeWorker), mode, JSON.stringify(job)], {
    cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
const identities = Object.fromEntries(Object.entries(roots).map(([name, cwd]) => [name, {
  revision: git(cwd, ['rev-parse', 'HEAD']), tree: git(cwd, ['rev-parse', 'HEAD^{tree}']), workingTree: git(cwd, ['status', '--porcelain']),
  lockfileSha256: hash(fs.readFileSync(path.join(cwd, 'pnpm-lock.yaml'))), ownerSha256: hash(fs.readFileSync(path.join(cwd, owner))),
  workerSha256: hash(fs.readFileSync(path.join(cwd, relativeWorker)))
}]));
assert.equal(identities.baseline.lockfileSha256, identities.candidate.lockfileSha256);
assert.equal(identities.baseline.workerSha256, identities.candidate.workerSha256);
const report = { version: 'pulse.fastly-scalar-sharing.v1', status: 'running', node: process.version, identities,
  harnessSha256: hash(fs.readFileSync(__filename)), binaryen: require('../../../packages/wasm-guest-link/src/toolchain').binaryenIdentity(),
  samples: 3, cells: [], limits: ['Default production optimization; injected Fastly ABI host, not deployed cold-start.',
    'Process peak RSS and post-probe guest memory capacity are not live/request-peak memory.',
    'Repeated-shape scaling; no registry pruning, general object interning or linked-guest claim.'] };
const reportFile = path.join(output, 'measurements.json');
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
try {
  for (const count of [1, 32, 128]) {
    const project = path.join(output, `fixture-${count}`); fs.mkdirSync(project);
    const schemaFile = path.join(project, 'schemas.ts'); fs.writeFileSync(schemaFile, fixture(count));
    const cell = { count, fixtureSha256: hash(fixture(count)), profiles: {}, samples: [] }; report.cells.push(cell);
    for (const [variant, cwd] of Object.entries(roots)) {
      const profile = child(cwd, '--profile', { project, schemaFile });
      cell.profiles[variant] = { registryHash: profile.registryHash, codecTableHash: profile.codecTableHash,
        portableBytes: profile.portable.bytes, portableSha256: profile.portable.sha256,
        fastlyBytes: profile.fastly.bytes, fastlySha256: profile.fastly.sha256,
        fastlyDeclarations: profile.fastly.shared.declarations + profile.fastly.entries.reduce((n, entry) => n + entry.declarations, 0),
        sharedScalarBytes: profile.fastly.shared.families['scalar-projector'] || 0 };
    }
    for (const field of ['registryHash', 'codecTableHash', 'portableSha256']) assert.equal(cell.profiles.baseline[field], cell.profiles.candidate[field]);
    for (let sample = 0; sample < 3; sample++) for (const variant of sample % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const file = path.join(output, `${variant}-${count}-${sample}`), usage = file + '-usage'; fs.mkdirSync(usage);
      const hook = path.join(usage, 'hook.cjs');
      fs.writeFileSync(hook, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(${JSON.stringify(usage)} + '/' + process.pid + '.json', JSON.stringify(process.resourceUsage().maxRSS * 1024)));`);
      const job = { target: 'fastly', count, project, schemaFile, file };
      const compiled = child(roots[variant], '--compile', job, { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(hook)}` });
      const rss = fs.readdirSync(usage).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(usage, name))));
      assert.ok(rss.length); compiled.assemblyScriptPeakRssBytes = Math.max(...rss);
      const runtime = child(roots[variant], '--runtime', job);
      const prior = cell.samples.find(row => row.variant === variant);
      if (prior) assert.equal(compiled.wasmSha256, prior.wasmSha256);
      cell.samples.push({ variant, sample, ...compiled, runtime }); save();
      console.log(JSON.stringify({ count, variant, sample, buildMs: compiled.buildMs, wasmBytes: compiled.wasmBytes }));
    }
    const modules = Object.fromEntries(Object.keys(roots).map(variant => [variant, new WebAssembly.Module(fs.readFileSync(path.join(output, `${variant}-${count}-0.wasm`)))]));
    assert.deepEqual(WebAssembly.Module.imports(modules.baseline), WebAssembly.Module.imports(modules.candidate));
    assert.deepEqual(WebAssembly.Module.exports(modules.baseline), WebAssembly.Module.exports(modules.candidate));
  }
  report.status = 'passed'; save(); console.log(JSON.stringify({ status: report.status, report: reportFile }));
} catch (error) { report.status = 'failed'; report.error = error.stack; save(); throw error; }
