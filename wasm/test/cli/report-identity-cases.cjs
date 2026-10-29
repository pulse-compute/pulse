'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = path.resolve(__dirname, '../../packages/cli/src');
const files = require(path.join(cli, 'internal/report/files'));
const snapshots = require(path.join(cli, 'internal/report/snapshot'));
const retained = require(path.join(cli, 'internal/report/retained'));
const sources = require(path.join(cli, 'internal/report/source-inputs'));
const identity = require(path.join(cli, 'internal/report/identity-diagnostic'));
const { sha256 } = require(path.join(cli, 'internal/report/data'));

module.exports = function identityCases() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-identity-'));
  const file = path.join(root, 'input.ts'), content = 'SECRET_SOURCE_CANARY_A';
  function rejected(fn, code, stage) {
    let caught;
    assert.throws(fn, error => {
      caught = error;
      assert.equal(error.code, code);
      assert.equal(error.detail.stage, stage);
      const text = JSON.stringify(error.detail);
      assert(text.length < 2048);
      assert(!text.includes(root) && !text.includes('SECRET_SOURCE_CANARY'));
      return true;
    });
    return caught;
  }
  try {
    fs.writeFileSync(file, content);
    const before = snapshots.scan(root);
    fs.writeFileSync(file, 'SECRET_SOURCE_CANARY_B');
    const changed = rejected(() => snapshots.sameSnapshot(before, snapshots.scan(root)), 'REPORT_STALE_INPUTS', 'snapshot-content');
    assert.equal(changed.detail.expected.bytes, changed.detail.actual.bytes);
    assert.equal(changed.detail.expected.sha256, sha256(content));
    assert.equal(changed.detail.actual.sha256, sha256('SECRET_SOURCE_CANARY_B'));
    fs.writeFileSync(file, content);
    const restored = snapshots.scan(root);
    fs.utimesSync(file, new Date(1000), new Date(1000));
    const stamped = rejected(() => snapshots.sameSnapshot(restored, snapshots.scan(root)), 'REPORT_CONCURRENT_CHANGE', 'snapshot-stamp');
    assert.notEqual(stamped.detail.expected.stampSha256, stamped.detail.actual.stampSha256);

    const row = { kind: 'source', identity: 'npm/@fixture/input/input.ts',
      location: { up: 0, file: 'input.ts' }, real: { up: 0, file: 'input.ts' }, bytes: content.length, sha256: sha256(content) };
    const workspace = { root, depth: 0 };
    fs.writeFileSync(file, 'SECRET_SOURCE_CANARY_B');
    rejected(() => sources.readSources(root, [row], workspace), 'REPORT_STALE_INPUTS', 'import-content');
    fs.writeFileSync(file, content);
    rejected(() => sources.captureSources(root, { rows: [{ ...row, file, real: file, token: 'prior-stamp' }] }, workspace),
      'REPORT_CONCURRENT_CHANGE', 'import-stamp');

    // Inject a short read and a changed descriptor stamp at the existing I/O
    // boundary. These must diagnose the rejected read without a repair reread.
    const read = fs.readSync;
    try {
      fs.readSync = () => 0;
      const error = rejected(() => files.readFile(root, 'input.ts'), 'REPORT_CONCURRENT_CHANGE', 'read-short');
      assert.deepEqual(error.detail.actual, { bytes: 0 });
    } finally { fs.readSync = read; }
    const stat = fs.fstatSync;
    let calls = 0;
    try {
      fs.fstatSync = (...args) => { const value = stat(...args); return ++calls === 2 ? { ...value, mtimeNs: value.mtimeNs + 1n } : value; };
      rejected(() => files.readFile(root, 'input.ts'), 'REPORT_CONCURRENT_CHANGE', 'read-finish');
      assert.equal(calls, 2);
    } finally { fs.fstatSync = stat; }
    assert.equal(files.readFile(root, 'input.ts').sha256, sha256(content));

    const out = path.join(root, 'dist'); fs.mkdirSync(out);
    const lease = retained.acquireBuildLock({ root }, out);
    const lockDir = path.join(root, '.pulse-report-locks');
    const lock = path.join(lockDir, fs.readdirSync(lockDir)[0]);
    const originalToken = JSON.parse(fs.readFileSync(lock)).token;
    const replacement = retained.acquireBuildLock({ root }, out);
    try {
      const error = rejected(lease.verify, 'REPORT_CONCURRENT_BUILD', 'lease');
      assert.equal(error.detail.expected.tokenSha256, sha256(originalToken));
      assert(!JSON.stringify(error.detail).includes(originalToken));
      lease(); replacement.verify();
    } finally { lease(); replacement(); }
    assert.deepEqual(fs.readdirSync(lockDir), []);

    const manifest = path.join(out, 'pulse-compile.json');
    const result = retained.publishBuild({}, null, {}, manifest, out, { error: changed.code, ...identity.retainedDetail(changed) });
    assert.deepEqual(result.reportEvidence.detail, changed.detail);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest)).reportEvidence.detail, changed.detail);
    assert(!fs.existsSync(path.join(out, retained.COMPLETION_FILE)));
    // Foreign exceptions cannot smuggle arbitrary payload into a manifest.
    assert.deepEqual(identity.retainedDetail({ detail: { secret: content } }), {});

    const output = [], emit = require('../support/report-identity-failure.cjs')(__filename, cli, line => output.push(JSON.parse(line)));
    emit.phase('negative-capture'); emit(changed); emit(changed);
    assert.equal(output.length, 2);
    assert.equal(output[0].status, 'started');
    assert.equal(output[1].phase, 'negative-capture');
    assert(output[0].files.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
    assert(output[0].files.some(row => row.file === 'wasm/scripts/run-wasm-tests.cjs'));
    assert(output[0].files.some(row => row.file === 'wasm/test/suite/registry.cjs'));
    assert(!JSON.stringify(output).includes(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
