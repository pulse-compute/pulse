'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { hash, verify } = require('./artifacts.cjs');

// Driver code is explicitly selected, trusted operator code. It owns activation,
// active-process/file observation and credentials; this module discovers none.
async function exercise({ baseline, candidate, driver, probe, timeoutMs = 30000, save = () => {} }) {
  assert.ok(['local-rehearsal', 'deployed'].includes(driver.mode));
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 120000);
  for (const method of ['activate', 'inspect', 'readActiveFile', 'connection']) assert.equal(typeof driver[method], 'function');
  assert.equal(typeof probe, 'function');
  assert.notEqual(baseline.manifest.sha256, candidate.manifest.sha256, 'Upgrade requires distinct artifacts');
  for (const revision of [baseline, candidate]) verify(revision.root, revision.manifest);
  const report = { version: 'pulse.ops01-exercise.v1', status: 'running', mode: driver.mode,
    deployed: driver.mode === 'deployed', scope: 'bounded-upgrade-rollback-smoke', ops01Complete: false, baselineSha256: baseline.manifest.sha256, candidateSha256: candidate.manifest.sha256,
    liveGate: 'pending', deployedSmokeStatus: driver.mode === 'deployed' ? 'running' : 'not-run',
    stages: [], findings: [], activationRetries: 0 };
  const persist = () => save(JSON.parse(JSON.stringify(report)));
  async function bounded(work) {
    const controller = new AbortController(); let timer;
    try { return await Promise.race([work(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Operational step deadline')); }, timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async function stage(name, revision) {
    const result = { name, artifactSha256: revision.manifest.sha256, status: 'running', step: 'activation' };
    report.stages.push(result); persist();
    try {
      verify(revision.root, revision.manifest);
      await bounded(signal => driver.activate({ name, revision, signal }));
      await bounded(async signal => {
        result.step = 'artifact-verification';
        const nonce = randomUUID();
        const before = await driver.inspect({ signal, nonce });
        signal.throwIfAborted();
        // Only non-secret, bounded deployment identity enters the report.
        assert.match(before.instanceId, /^[a-zA-Z0-9._:-]{1,128}$/);
        assert.equal(before.nonce, nonce, 'Stale observation receipt');
        assert.equal(before.artifactSha256, revision.manifest.sha256, 'Active artifact differs');
        const names = await driver.readActiveFile(null, { signal });
        signal.throwIfAborted();
        assert.deepEqual(names, revision.manifest.files.map(file => file.path), 'Active closure has missing/extra files');
        for (const file of revision.manifest.files) {
          const bytes = await driver.readActiveFile(file.path, { signal });
          signal.throwIfAborted();
          assert.ok(Buffer.isBuffer(bytes), 'Driver must read actual active artifact bytes');
          assert.equal(bytes.length, file.bytes); assert.equal(hash(bytes), file.sha256, `Active file mismatch: ${file.path}`);
        }
        result.instanceId = before.instanceId;
        result.verifiedFiles = names.length;
        result.step = 'wire-acceptance';
        const connection = await driver.connection({ signal });
        signal.throwIfAborted();
        const checks = await probe(connection, { signal });
        signal.throwIfAborted();
        result.checks = checks;
        result.step = 'post-acceptance-identity';
        const after = await driver.inspect({ signal, nonce });
        signal.throwIfAborted();
        assert.deepEqual(after, before, 'Active deployment changed during acceptance');
      });
      verify(revision.root, revision.manifest);
      result.status = 'passed'; result.step = 'completed';
    } catch {
      // Never persist arbitrary driver/SDK errors: they can include tokens,
      // credential-bearing URLs, response bodies or private host details.
      result.status = 'failed';
      result.activationDisposition = result.step === 'activation' ? 'unknown' : 'settled';
      report.findings.push({ stage: name, owner: 'deployment-operator', disposition: 'investigate',
        code: 'OPS01_STAGE_FAILED', message: 'Activation, artifact verification or wire acceptance failed; inspect protected operator logs. No activation retry was attempted.' });
      throw new Error('OPS01_STAGE_FAILED');
    } finally { persist(); }
  }
  try {
    persist();
    await stage('baseline', baseline);
    try { await stage('candidate', candidate); }
    finally {
      if (report.stages.at(-1).activationDisposition === 'unknown') {
        report.stages.push({ name: 'rollback', status: 'blocked', artifactSha256: baseline.manifest.sha256 });
        report.findings.push({ stage: 'rollback', owner: 'deployment-operator', disposition: 'recover-manually',
          code: 'OPS01_ACTIVATION_UNKNOWN', message: 'Resolve the uncertain candidate activation before rollback; no concurrent activation was started.' });
      } else await stage('rollback', baseline);
    }
    report.status = 'passed';
  } catch { report.status = 'failed'; }
  report.deployedSmokeStatus = driver.mode === 'deployed' ? report.status : 'not-run';
  persist(); return report;
}
module.exports = { exercise };
