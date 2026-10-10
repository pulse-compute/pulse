#!/usr/bin/env node
'use strict';
// Run the existing allocation bound unchanged. A candidate failure is evidence
// against adoption, never permission to increase the production memory limit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [mode, value, receipt] = process.argv.slice(2);
if (mode === '--worker') {
  const invocations = require('./arena-transform-control.cjs').install(value);
  let outcome = { variant: value, status: 'passed' };
  try { require('../provider/assert-fastly-schema-allocation.cjs').main(); }
  catch (error) { outcome = { variant: value, status: 'failed', code: error.code, message: error.message }; }
  fs.writeFileSync(receipt, JSON.stringify({ ...outcome, invocations }) + '\n');
} else {
  assert.equal(mode, '--out'); assert(value && !receipt && !fs.existsSync(value));
  const root = path.resolve(__dirname, '../../..'), source = require('../../../scripts/release-feature-acceptance.cjs').candidateIdentity(root);
  assert.equal(source.workingTree, '', 'Commit source before recording stress evidence');
  assert(!process.env.JSON_CACHE && !process.env.NODE_OPTIONS);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-arena-stress-')), rows = [];
  try {
    for (const variant of ['unpatched', 'patched']) {
      const file = path.join(directory, variant + '.json');
      const result = spawnSync(process.execPath, [__filename, '--worker', variant, file], { cwd: root, encoding: 'utf8', timeout: 180000 });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const row = JSON.parse(fs.readFileSync(file));
      row.stdout = result.stdout; row.stderr = result.stderr;
      const match = (row.message || row.stdout).match(/(?:schema allocation used|memory) (\d+)/); assert(match);
      row.guestCapacityBytes = Number(match[1]);
      assert.equal(row.invocations.length, 1); assert.equal(row.invocations[0].transformsAdded, variant === 'patched' ? 1 : 0);
      assert.match(row.invocations[0].artifactSha256, /^[a-f0-9]{64}$/); rows.push(row);
    }
    assert.equal(rows[0].status, 'passed'); assert(rows[0].guestCapacityBytes <= 128 * 1024 * 1024);
    assert.equal(rows[1].status, 'failed'); assert.equal(rows[1].code, 'ERR_ASSERTION');
    assert.match(rows[1].message, /^schema allocation used \d+ bytes$/); assert(rows[1].guestCapacityBytes > 128 * 1024 * 1024);
    assert.deepEqual(require('../../../scripts/release-feature-acceptance.cjs').candidateIdentity(root), source);
    const report = { status: 'completed', adoption: 'blocked-by-existing-memory-limit', source, node: process.version,
      limitBytes: 128 * 1024 * 1024, fixture: 'assert-fastly-schema-allocation.cjs (unchanged)',
      meaning: 'Both payloads passed response, escaping and digest assertions before the candidate failed final guest capacity; no production limits or GC settings changed', rows };
    fs.writeFileSync(value, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
