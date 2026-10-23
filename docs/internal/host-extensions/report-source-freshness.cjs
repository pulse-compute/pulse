'use strict';

// Manual investigation of the HEX-01 report-test discrepancy. This does not
// replace the topology test's Wasm, execution or retained-publication checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const { setup } = require(path.join(root, 'wasm/test/support/report-analytics-fixture.cjs'));
const { resolveProject } = require(path.join(root, 'wasm/packages/cli/src/project-config'));
const { compileProject } = require(path.join(root, 'wasm/packages/cli/src/project-execution'));
const { buildCanonicalNativePlan } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan'));
const sha = value => createHash('sha256').update(value).digest('hex');
const parent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(parent, { recursive: true });
const directory = fs.mkdtempSync(path.join(parent, 'hex-source-freshness-'));
const source = path.join(directory, 'src/index.ts');
const originalRead = fs.readFileSync;
let expected, previous, previousDigest;
let sourceReads = 0, cases = 0;
fs.readFileSync = function (file, ...args) {
  const result = originalRead.call(this, file, ...args);
  if (file === source && expected) {
    sourceReads++;
    assert.equal(sha(result), expected, 'fixture read returned a previous source generation');
  }
  return result;
};
try {
  const variants = {};
  for (let cycle = 0; cycle < 12; cycle++) {
    for (const variant of ['http', 'event', 'full']) {
      setup(directory, variant);
      const bytes = originalRead(source);
      expected = sha(bytes);
      variants[variant] = { sha256: expected, bytes: bytes.length };
      const project = resolveProject({ cwd: directory, metadataOnly: true });
      const control = buildCanonicalNativePlan(compileProject(project));
      assert.equal(control.source.sourceHash, expected, 'control source identity');
      const observed = buildCanonicalNativePlan(compileProject(project));
      assert.equal(observed.source.sourceHash, expected, 'observed source identity');
      assert.deepEqual(observed, control, 'same-source plan equality');
      if (previous) assert.equal(sha(JSON.stringify(previous)), previousDigest,
        'later compile mutated an earlier plan');
      previous = observed;
      previousDigest = sha(JSON.stringify(previous));
      cases++;
    }
  }
  assert.equal(new Set(Object.values(variants).map(value => value.bytes)).size, 1,
    'fixture variants retain the same length');
  console.log(JSON.stringify({ status: 'passed', cycles: 12, cases,
    compilations: cases * 2, sourceReads, variants,
    scope: 'same-path same-length fixture rewrites; compiler/plan only, no Wasm or retained publication' }));
} finally {
  fs.readFileSync = originalRead;
  fs.rmSync(directory, { recursive: true, force: true });
}
