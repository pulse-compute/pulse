#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h0');

function read(name) {
  return fs.readFileSync(path.join(outputDirectory, name));
}

function parse(name) {
  return JSON.parse(read(name).toString('utf8'));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

for (const name of [
  'boundary-owner-map.json',
  'boundary-bleed-ledger.json',
  'boundary-contract-freeze.md',
  'boundary-h0-handoff.md',
  'boundary-h0-report.json'
]) {
  assert.equal(fs.existsSync(path.join(outputDirectory, name)), true, `H0 evidence is missing ${name}`);
}

const ownerMap = parse('boundary-owner-map.json');
const ledger = parse('boundary-bleed-ledger.json');
const report = parse('boundary-h0-report.json');

assert.equal(ownerMap.version, 'pulse.boundary-owner-map.h0.v1');
assert.equal(ownerMap.stage, 'H0');
assert.equal(ownerMap.referencePaths.length, 5);
assert.equal(new Set(ownerMap.referencePaths.flatMap((entry) => entry.seams)).size, 18);

assert.equal(ledger.version, 'pulse.boundary-bleed-ledger.h0.v1');
assert.equal(ledger.stage, 'H0');
assert.equal(ledger.summary.total, 15);
assert.equal(ledger.summary.mustFixBeforeEntities, 12);
assert.equal(ledger.summary.unresolvedArchitectureDecisions, 0);
assert.deepEqual(
  ledger.items.filter((entry) => entry.pass === 'H1').map((entry) => entry.id),
  ['H0-B001', 'H0-B002', 'H0-B003', 'H0-B004', 'H0-B005']
);

assert.equal(report.version, 'pulse.boundary-h0-report.v1');
assert.equal(report.status, 'PASS');
assert.equal(report.scope, 'evidence-only');
assert.equal(report.nextAuthorizedCheckpoint, 'H1');
assert.deepEqual(report.risksOrBlockers, []);

for (const output of Object.values(report.outputs)) {
  const absolute = path.join(repoRoot, output.file);
  const bytes = fs.readFileSync(absolute);
  assert.equal(bytes.length, output.bytes, `${output.file} byte count changed after H0`);
  assert.equal(sha256(bytes), output.sha256, `${output.file} hash changed after H0`);
}

assert.match(read('boundary-contract-freeze.md').toString('utf8'), /H1 is authorized/);
assert.match(read('boundary-h0-handoff.md').toString('utf8'), /Implement H1 only/);

console.log('ok - frozen H0 evidence remains intact and delegates current boundary enforcement to H1');
