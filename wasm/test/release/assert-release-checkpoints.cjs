'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCheckpointStore, readCheckpointReceipt, fingerprint, RETENTION_MS } = require('../../../scripts/release-checkpoints.cjs');

const passed = { status: 'passed', exitCode: 0, cleanup: { status: 'passed' }, remainingProcessTree: [], error: null };
let assertions = 0;

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-checkpoints-'));
  try {
    const context = { checkout: root, source: 'source-commit', tree: 'source-tree', lockfile: 'lockfile-hash', toolchain: { node: '24.19.0', pnpm: '12.4.2' }, environment: 'environment-hash', options: { requireFastly: true }, selectedTasks: ['build', 'test', 'late'] };
    const output = path.join(root, 'output');
    fs.mkdirSync(path.join(output, 'empty'), { recursive: true });
    fs.writeFileSync(path.join(output, 'module.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    fs.writeFileSync(path.join(output, 'runner'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(output, 'runner'), 0o755);
    const report = path.join(root, 'report.json');
    fs.writeFileSync(report, '{"status":"passed"}\n');
    const specification = { id: 'task:build', definition: { command: ['node', 'build.cjs'], oracle: 'oracle-hash' }, dependencies: {}, artifacts: { output, report } };
    const attempt = (name, previous, extra = {}) => createCheckpointStore({ directory: path.join(root, name), previousDirectory: previous ? path.join(root, previous) : undefined, context, ...extra });
    run({ root, context, output, report, specification, attempt });
    assertions++;
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
}

function snapshotPath(root, id, artifact, child = '') {
  return path.join(root, 'first', crypto.createHash('sha256').update(id).digest('hex'), artifact, child);
}

function rewriteReceipt(receiptPath, mutate, refreshDigest = false) {
  const envelope = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  mutate(envelope.receipt);
  if (refreshDigest) envelope.sha256 = fingerprint(envelope.receipt);
  fs.writeFileSync(receiptPath, JSON.stringify(envelope));
}

fixture(({ attempt, specification, output, report, context }) => {
  const first = attempt('first').record({ ...specification, result: passed });
  fs.rmSync(output, { recursive: true });
  fs.rmSync(report);
  const resumed = attempt('second', 'first').tryReuse(specification);
  assert.equal(resumed.reused, true, resumed.reason);
  assert.equal(resumed.proofId, first.proofId);
  assert.equal(resumed.receipt.disposition, 'reused');
  assert.equal(resumed.receipt.originDirectory, first.receipt.originDirectory);
  assert.equal(resumed.receipt.expiresAt, first.receipt.expiresAt);
  assert.deepEqual(resumed.result, passed);
  assert.equal(fs.statSync(path.join(output, 'runner')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(output, 'empty')).isDirectory(), true);
  assert.equal(fs.statSync(path.join(output, 'module.wasm')).nlink, 1);
  assert.equal(readCheckpointReceipt({ receiptPath: resumed.receiptPath, context, definition: specification.definition, dependencies: {} }).proofId, first.proofId);
  fs.writeFileSync(path.join(output, 'module.wasm'), 'consumer mutation');
  assert.equal(attempt('third', 'second').tryReuse(specification).reused, true);
  assert.deepEqual(fs.readFileSync(path.join(output, 'module.wasm')), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
});

// Every authority input invalidates; there is no source or toolchain fallback.
for (const field of ['checkout', 'source', 'tree', 'lockfile', 'toolchain', 'environment', 'options', 'selectedTasks']) {
  fixture(({ attempt, specification, context }) => {
    attempt('first').record({ ...specification, result: passed });
    const changed = { ...context, [field]: 'different' };
    const result = attempt('second', 'first', { context: changed }).tryReuse(specification);
    assert.equal(result.reused, false, field);
    assert.match(result.reason, /context changed/);
  });
}

for (const field of ['command', 'oracle']) {
  fixture(({ attempt, specification }) => {
    attempt('first').record({ ...specification, result: passed });
    const result = attempt('second', 'first').tryReuse({ ...specification, definition: { ...specification.definition, [field]: 'changed' } });
    assert.equal(result.reused, false);
    assert.match(result.reason, /definition changed/);
  });
}

fixture(({ attempt, specification }) => {
  const first = attempt('first').record({ ...specification, result: passed });
  const second = attempt('second').record({ ...specification, result: passed });
  assert.notEqual(first.proofId, second.proofId, 'An executed task invalidates dependents even with identical outputs');
  const dependent = { ...specification, id: 'task:test', dependencies: { build: first.proofId } };
  attempt('first').record({ ...dependent, result: passed });
  const miss = attempt('third', 'first').tryReuse({ ...dependent, dependencies: { build: second.proofId } });
  assert.equal(miss.reused, false);
  assert.match(miss.reason, /dependency proof changed/);
});

// A late failure can recover the prefix, but never promote the failed tail.
fixture(({ attempt, specification }) => {
  const initial = attempt('first');
  const build = initial.record({ ...specification, result: passed });
  const test = { ...specification, id: 'task:test', dependencies: { build: build.proofId } };
  const testProof = initial.record({ ...test, result: passed });
  const late = { ...specification, id: 'task:late', dependencies: { test: testProof.proofId } };
  initial.record({ ...late, result: { ...passed, status: 'failed', exitCode: 1, error: 'late failure' } });
  const resume = attempt('second', 'first');
  assert.equal(resume.tryReuse(specification).reused, true);
  assert.equal(resume.tryReuse(test).reused, true);
  assert.equal(resume.tryReuse(late).reused, false);
  assert.equal(resume.record({ ...late, result: passed }).receipt.disposition, 'executed');
});

for (const result of [
  { ...passed, status: 'failed' },
  { ...passed, status: 'running' },
  { ...passed, status: 'not-run' },
  { ...passed, exitCode: 1 },
  { ...passed, cleanup: { status: 'failed' } },
  { ...passed, cleanup: null },
  { ...passed, cleanupFailure: 'cleanup failed' },
  { ...passed, cleanupFailures: ['cleanup failed'] },
  { ...passed, retainedTaskRoot: '/tmp/still-running' },
  { ...passed, remainingProcessTree: [{ pid: 123 }] },
  { ...passed, remainingProcessTree: { pid: 123 } },
  { ...passed, cleanup: { status: 'passed', remainingProcessTree: [123] } },
  { ...passed, cleanup: { status: 'passed', error: 'cleanup failed' } },
  { ...passed, signal: 'SIGTERM' },
  { ...passed, timedOut: true },
  { ...passed, interruptedBy: 'SIGINT' },
  { ...passed, forcedCompletion: true },
  { ...passed, cancelled: true },
  { ...passed, error: 'incomplete task' },
]) {
  fixture(({ attempt, specification, output }) => {
    fs.rmSync(output, { recursive: true });
    const recorded = attempt('first').record({ ...specification, result });
    assert.deepEqual(recorded.receipt.artifacts, [], 'A failed receipt preserves failure without requiring outputs');
    assert.equal(attempt('second', 'first').tryReuse(specification).reused, false);
  });
}

for (const corruption of ['bytes', 'mode', 'missing', 'extra', 'symlink', 'hardlink', 'receipt']) {
  fixture(({ root, attempt, specification, output }) => {
    const first = attempt('first').record({ ...specification, result: passed });
    const saved = snapshotPath(root, specification.id, 'output', 'module.wasm');
    if (corruption === 'bytes') fs.writeFileSync(saved, 'corrupted');
    if (corruption === 'mode') fs.chmodSync(saved, 0o755);
    if (corruption === 'missing') fs.rmSync(saved);
    if (corruption === 'extra') fs.writeFileSync(path.join(path.dirname(saved), 'unrecorded'), 'unexpected');
    if (corruption === 'symlink') { fs.rmSync(saved); fs.symlinkSync(path.join(output, 'module.wasm'), saved); }
    if (corruption === 'hardlink') { fs.rmSync(saved); fs.linkSync(path.join(output, 'module.wasm'), saved); }
    if (corruption === 'receipt') rewriteReceipt(first.receiptPath, (receipt) => { receipt.result.status = 'forged'; });
    fs.writeFileSync(path.join(output, 'sentinel'), 'untouched');
    const miss = attempt('second', 'first').tryReuse(specification);
    assert.equal(miss.reused, false, corruption);
    assert.equal(fs.readFileSync(path.join(output, 'sentinel'), 'utf8'), 'untouched');
  });
}

for (const dates of [
  { createdAt: new Date(Date.now() - RETENTION_MS - 10000).toISOString(), expiresAt: new Date(Date.now() - 10000).toISOString() },
  { expiresAt: new Date(Date.now() + RETENTION_MS * 2).toISOString() },
  { createdAt: 'invalid' },
  { createdAt: new Date(Date.now() + 60000).toISOString() },
]) {
  fixture(({ attempt, specification }) => {
    const first = attempt('first').record({ ...specification, result: passed });
    rewriteReceipt(first.receiptPath, (receipt) => Object.assign(receipt, dates), true);
    const miss = attempt('second', 'first').tryReuse(specification);
    assert.equal(miss.reused, false);
    assert.match(miss.reason, /expired|retention/);
  });
}

fixture(({ attempt, specification }) => {
  const first = attempt('first');
  const proof = first.record({ ...specification, result: passed });
  assert.throws(() => first.record({ ...specification, result: passed }), /already recorded/);
  assert.equal(first.describe(specification.id).proofId, proof.proofId);
  assert.equal(attempt('second').tryReuse(specification).reused, false);
  assert.equal(attempt('third', 'second').tryReuse(specification).reused, false, 'Only immediate previous scope is inspected; do not search first');
  assert.equal(attempt('fourth', 'first').tryReuse({ ...specification, id: 'task:never-finished' }).reused, false);
});

fixture(({ attempt, specification, output }) => {
  const first = attempt('first').record({ ...specification, result: passed });
  const second = attempt('second', 'first');
  assert.equal(second.tryReuse(specification).reused, true);
  fs.writeFileSync(path.join(output, 'sentinel'), 'untouched');
  assert.equal(second.tryReuse(specification).reused, false);
  assert.equal(fs.readFileSync(path.join(output, 'sentinel'), 'utf8'), 'untouched');
  assert.equal(second.describe(specification.id).proofId, first.proofId);
});

fixture(({ root, attempt, specification, output, report }) => {
  attempt('first').record({ ...specification, result: passed });
  fs.writeFileSync(path.join(output, 'sentinel'), 'untouched');
  const second = attempt('second', 'first');
  for (const artifacts of [
    { '../escape': output },
    { output, nested: path.join(output, 'child') },
    { output: root },
    { output: path.join(root, 'first') },
    { output: path.join(root, 'second') },
    { output: '/' },
    { output: 'relative' },
  ]) assert.equal(second.tryReuse({ ...specification, artifacts }).reused, false);
  const target = path.join(root, 'alias');
  fs.symlinkSync(output, target);
  assert.equal(second.tryReuse({ ...specification, artifacts: { output: target, report } }).reused, false);
  assert.equal(fs.readFileSync(path.join(output, 'sentinel'), 'utf8'), 'untouched');
});

fixture(({ attempt, specification, output, report }) => {
  fs.symlinkSync(report, path.join(output, 'forbidden'));
  assert.throws(() => attempt('first').record({ ...specification, result: passed }), /symlink/);
});

fixture(({ attempt, specification, output, report }) => {
  attempt('first').record({ ...specification, result: passed });
  fs.symlinkSync(report, path.join(output, 'forbidden'));
  assert.equal(attempt('second', 'first').tryReuse(specification).reused, false);
  assert.equal(fs.lstatSync(path.join(output, 'forbidden')).isSymbolicLink(), true);
});

fixture(({ attempt, specification, output }) => {
  fs.rmSync(output, { recursive: true });
  assert.throws(() => attempt('first').record({ ...specification, result: passed }), /ENOENT/);
});

fixture(({ attempt, specification, output, report }) => {
  fs.rmSync(output, { recursive: true });
  fs.symlinkSync(report, output);
  const failed = attempt('first').record({ ...specification, result: { ...passed, status: 'failed', error: 'original error' } });
  assert.equal(failed.receipt.result.error, 'original error');
  assert.deepEqual(failed.receipt.artifacts, []);
});

fixture(({ attempt, specification }) => {
  const first = attempt('first').record({ ...specification, result: passed });
  fs.rmSync(first.receiptPath);
  assert.equal(attempt('second', 'first').tryReuse(specification).reused, false, 'An interrupted snapshot without its terminal receipt is not evidence');
});

fixture(({ attempt, specification, context }) => {
  const first = attempt('first').record({ ...specification, result: passed });
  rewriteReceipt(first.receiptPath, (receipt) => { receipt.artifacts[0].key = '../escape'; }, true);
  assert.throws(() => readCheckpointReceipt({ receiptPath: first.receiptPath, context }), /artifact identity/);
});

assert.equal(fingerprint({ z: 1, a: { b: 2, a: 1 } }), fingerprint({ a: { a: 1, b: 2 }, z: 1 }));
assert.throws(() => fingerprint({ invalid: undefined }), /JSON values/);
console.log(`release-checkpoints: ${assertions} recovery/invalidation fixtures passed`);
