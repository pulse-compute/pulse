#!/usr/bin/env node
'use strict';
// Bound the V8 nursery in both variants to test the measured heap-capacity gap.
// Diagnostic only: this is not a recommended Node flag or a production change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { dependencies } = require('./baseline.cjs');
const { validate } = require('./gc-baseline.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(file));
const hash = value => createHash('sha256').update(value).digest('hex');
const [baselineFile, output] = process.argv.slice(2);
assert(baselineFile && output && process.argv.length === 4 && !fs.existsSync(output));
assert(!process.env.NODE_OPTIONS && !process.env.JSON_CACHE && process.execArgv.length === 0);
const baseline = validate(read(baselineFile)), source = candidateIdentity(root), deps = dependencies();
assert.equal(source.workingTree, ''); assert.deepEqual(deps, baseline.dependencies);
// Compare on the same experiment, host and production source. Only this new
// counterfactual driver/internal documentation may differ from the measured base.
const changed = execFileSync('git', ['diff', '--name-only', baseline.source.sourceRevision, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert(changed.every(file => file === 'wasm/test/performance/gc-host-counterfactual.cjs' || file.startsWith('docs/internal/perf8-06/')));
const report = { schemaVersion: 'pulse.host-nursery-counterfactual.v1', status: 'running', source, baselineSource: baseline.source,
  baselineReportSha256: hash(fs.readFileSync(baselineFile)), node: process.version, dependencies: deps,
  policy: '--max-semi-space-size=4 on both variants', rows: [] };
fs.mkdirSync(output, { recursive: true });
const persist = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
try {
  persist();
  for (const gcMode of ['natural', 'forced']) for (let repetition = 0; repetition < 3; repetition++) {
    for (const variant of (repetition % 2 ? ['patched', 'unpatched'] : ['unpatched', 'patched'])) {
      const directory = read(path.join(path.dirname(baselineFile), 'host-' + variant + '.json')).outDir;
      const manifest = read(path.join(directory, 'pulse-build.json'));
      const artifactSha256 = hash(fs.readFileSync(path.join(directory, manifest.portable.wasm.file)));
      assert.equal(artifactSha256, baseline.artifacts.find(a => a.variant === variant).sha256);
      const label = `${gcMode}-${repetition}-${variant}`, receipt = path.join(output, label + '.json');
      const args = ['--max-semi-space-size=4', ...(gcMode === 'forced' ? ['--expose-gc'] : []), path.join(__dirname, 'gc-host-worker.cjs'), directory, 'full-small-unobserved', gcMode, receipt];
      const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000 });
      fs.writeFileSync(path.join(output, label + '.log'), (result.stdout || '') + (result.stderr || ''));
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      const row = read(receipt); assert.equal(row.status, 'passed'); assert.equal(row.disposalCount, 256);
      assert(row.execArgv.includes('--max-semi-space-size=4')); assert(row.gcEvents.length);
      assert.deepEqual(row.checkpoints.map(c => c.requests), [1, 11, 41, 128, 256]);
      for (const c of row.checkpoints) {
        assert.equal(c.afterGc !== null, gcMode === 'forced');
        for (const point of [c.beforeGc, c.afterGc].filter(Boolean)) {
          assert(point.memory.spaces.find(s => s.space_name === 'new_space').space_size <= 8 * 1024 * 1024);
        }
      }
      report.rows.push({ variant, repetition, artifactSha256, ...row }); persist();
    }
  }
  assert.equal(report.rows.length, 12); assert.deepEqual(candidateIdentity(root), source); assert.deepEqual(dependencies(), deps);
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally { persist(); }
console.log('ok - 12 fixed-nursery counterfactual workers');
