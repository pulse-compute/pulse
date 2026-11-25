'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const T = require('./transport.cjs');
const root = path.resolve(__dirname, '../../../..');
const mode = process.argv[2], output = process.argv[3];
if (!['--local', '--live'].includes(mode) || !output || process.argv.length !== 4) {
  console.error('Usage: node wasm/test/s3/upload-01/run.cjs --local|--live /path/to/report.json'); process.exit(2);
}
const files = ['wasm/test/s3/upload-01/transport.cjs', 'wasm/test/s3/upload-01/local.cjs', 'wasm/test/s3/upload-01/run.cjs', 'wasm/test/s3/o1/vectors.json', 'packages/s3/src/signing.js', 'packages/s3/src/provider.js'];
const report = { schemaVersion: 'pulse.upload-01.v1', status: 'running', mode: mode.slice(2),
  startedAt: new Date().toISOString(), node: process.version,
  executionHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceSha256: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  limits: { maxUploadBytes: T.MAX, producerChunkBytes: T.CHUNK, acknowledgementBytes: 16384, defaultAttemptTimeoutMs: mode === '--live' ? 30000 : 5000 },
  productSupportClaim: false, cases: [] };
function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
function safeError(error) {
  const allowed = ['TARGET_INVALID', 'CREDENTIALS_INVALID', 'UPLOAD_LIMIT', 'RESPONSE_METADATA', 'RESPONSE_LIMIT', 'RESPONSE_INCOMPLETE', 'RESPONSE_LENGTH', 'DEADLINE', 'TRANSPORT', 'WRITE'];
  return allowed.includes(error?.code) ? error.code : 'PROBE_FAILED';
}
async function live() {
  const fields = { endpoint: 'UPLOAD01_ENDPOINT', bucket: 'UPLOAD01_BUCKET', region: 'UPLOAD01_REGION', accessId: 'UPLOAD01_ACCESS_KEY_ID', secret: 'UPLOAD01_SECRET_ACCESS_KEY' };
  const missing = Object.values(fields).filter(name => !process.env[name]);
  if (missing.length) {
    report.status = 'blocked'; report.missingConfiguration = missing; report.externalRequests = 0;
    report.originCompatibility = 'not tested'; process.exitCode = 2; return;
  }
  const target = Object.fromEntries(Object.entries(fields).map(([key, env]) => [key, process.env[env]]));
  if (process.env.UPLOAD01_SESSION_TOKEN) target.token = process.env.UPLOAD01_SESSION_TOKEN;
  T.validateTarget(target);
  const prefix = `pulse-upload-01/${crypto.randomUUID()}/`;
  report.target = { endpoint: target.endpoint, bucket: target.bucket, region: target.region, prefix };
  report.remotePrefixConsumption = 'not observable from this client; loopback probe supplies separate prefix-before-EOF evidence';
  report.integrity = 'UNSIGNED-PAYLOAD authenticates the request, not payload bytes; exact GET readback is test evidence only';
  report.cleanup = []; save();
  const owned = [];
  const plans = [{ name: 'hashed-control', size: 1024, hashed: true },
    ...[0, 1, T.CHUNK + 1, T.MAX].map(size => ({ name: `unsigned-${size}`, size })),
    { name: 'invalid-signature', size: T.MAX, badSignature: true }];
  try {
    for (const plan of plans) {
      const key = prefix + plan.name + '/café %/雪.bin';
      const row = { name: plan.name, key, size: plan.size, status: 'running' }; report.cases.push(row); save();
      const head = await T.request(target, 'HEAD', key, { timeoutMs: 30000 });
      row.initialStatus = head.status;
      if (head.status !== 404) { row.status = 'failed'; row.reason = 'isolated-key-not-confirmed-absent'; report.status = 'failed'; break; }
      // Retain intended cleanup before the first potentially mutating call,
      // including acknowledgement-loss and invalid-signature attempts.
      owned.push(key); row.putAttempted = true; save();
      row.put = await T.request(target, 'PUT', key, { size: plan.size, timeoutMs: 30000,
        ...(plan.hashed ? { payloadHash: T.digest(plan.size) } : {}), badSignature: plan.badSignature,
        expectContinue: Boolean(plan.badSignature),
        afterFirstChunk: () => new Promise(done => setTimeout(done, 40)) });
      if (plan.badSignature) {
        row.status = row.put.status === 403 ? 'passed' : 'failed';
        row.earlyRejectionBeforeProducerEOF = row.put.metrics.generatedBytes < plan.size;
        row.absentAfterRejection = (await T.request(target, 'HEAD', key, { timeoutMs: 30000 })).status === 404;
        if (!row.absentAfterRejection || !row.earlyRejectionBeforeProducerEOF) row.status = 'failed';
      } else if (!T.acceptedPut(row.put, plan.size)) {
        row.status = 'failed'; row.reason = 'incomplete-or-unexpected-put-acknowledgement';
      } else {
        const get = await T.request(target, 'GET', key, { timeoutMs: 30000 });
        row.readback = { status: get.status, ...get.readback };
        row.status = get.status === 200 && get.readback?.bytes === plan.size && get.readback.sha256 === T.digest(plan.size) && get.readback.exact ? 'passed' : 'failed';
      }
      save();
      if (row.status !== 'passed') { report.status = 'failed'; break; }
    }
    if (report.status === 'running') report.status = 'passed';
    report.originCompatibility = report.status === 'passed' ? 'known-length UNSIGNED-PAYLOAD and hashed control accepted for tested cases' : 'not established for the selected matrix';
  } finally {
    for (const key of owned) {
      const cleanup = { key, status: 'running' }; report.cleanup.push(cleanup); save();
      try {
        const removed = await T.request(target, 'DELETE', key, { timeoutMs: 30000 });
        cleanup.deleteStatus = removed.status;
        cleanup.headStatus = (await T.request(target, 'HEAD', key, { timeoutMs: 30000 })).status;
        cleanup.status = removed.status === 204 && cleanup.headStatus === 404 ? 'passed' : 'failed';
      } catch (error) { cleanup.status = 'failed'; cleanup.reason = safeError(error); }
      save();
    }
    if (report.cleanup.some(row => row.status !== 'passed')) { report.status = 'failed'; report.cleanupRequired = true; }
  }
}
(async () => {
  save();
  try {
    if (mode === '--local') { report.local = await require('./local.cjs').run(); report.status = report.local.status; }
    else await live();
  } catch (error) {
    report.status = 'failed'; report.reason = safeError(error);
    for (const row of report.cases) if (row.status === 'running') { row.status = 'failed'; row.reason = report.reason; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, mode: report.mode, report: path.resolve(output) }));
  if (report.status === 'failed') process.exitCode = 1;
})().catch(() => { console.error('Unable to write probe report.'); process.exitCode = 1; });
