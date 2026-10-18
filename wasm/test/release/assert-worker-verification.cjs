'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyWorkerAsync, cleanupWorkerAsync, verifyWorker } = require('../../../scripts/release-parallel.cjs');

async function verifyWorkerVerification({ root, binding }) {
  const moduleFile = require.resolve('../../../scripts/release-parallel.cjs');
  const preload = path.join(root, 'verifier-preload.cjs');
  const dependency = path.join(binding.directory, 'node_modules/external/index.js');
  const build = path.join(binding.directory, 'packages/one/dist/index.js');
  const envFor = source => {
    fs.writeFileSync(preload, `const fs = require('node:fs');\n${source}`);
    return { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${preload}`.trim() };
  };
  const short = { timeoutMs: 500, termGraceMs: 50, killGraceMs: 50 };
  const tracked = [];
  assert.deepEqual(await verifyWorkerAsync(binding, { onChild: child => tracked.push(child?.pid || null) }),
    { status: 'passed', removed: [] });
  assert.equal(tracked.length, 2); assert(tracked[0] > 0); assert.equal(tracked[1], null);

  // The child must finish successfully, with the result of this exact request.
  for (const change of [
    'receipt.request.id = "old-request";',
    'receipt.request.operation = "cleanup";',
    'receipt.request.binding.directory += "-foreign";',
    'receipt.request.binding.candidate.sourceRevision = "0".repeat(40);',
    'receipt.request.binding.layoutFile += "-foreign";',
    'receipt.request.binding.inputs.buildSha256 = "0".repeat(64);',
    'delete receipt.result;'
  ]) {
    const env = envFor(`const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = function(bytes) { const receipt = JSON.parse(bytes); ${change}
        return write(JSON.stringify(receipt)); };`);
    await assert.rejects(verifyWorkerAsync(binding, { env }), /Foreign or stale|Missing worker/);
  }
  await assert.rejects(verifyWorkerAsync(binding, { env: envFor('process.stdout.write = () => true;') }), SyntaxError);
  await assert.rejects(verifyWorkerAsync(binding, { env: envFor(`const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = bytes => { process.exitCode = 9; return write(bytes); };`) }), /did not complete: 9/);
  await assert.rejects(verifyWorkerAsync(binding, { env: envFor(`require(${JSON.stringify(moduleFile)}).verifyWorker = () => {
    throw new Error('verifier crash fixture'); };`) }), /verifier crash fixture/);

  // Mutate actual bytes while a full scan is reading them, and after removal
  // but before cleanup's final full scan. Neither may be admitted as a pass.
  try {
    await assert.rejects(verifyWorkerAsync(binding, { env: envFor(`const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        if (file === ${JSON.stringify(dependency)}) { const stat = fs.statSync(file);
          fs.writeFileSync(file, 'DEPENDENCY'); fs.utimesSync(file, stat.atime, stat.mtime); }
        return read.call(this, file, ...args); };`) }), /dependency\/build inputs changed/);
  } finally { fs.writeFileSync(dependency, 'dependency'); }
  const residue = path.join(binding.directory, 'verification-residue');
  fs.writeFileSync(residue, 'remove me');
  try {
    await assert.rejects(cleanupWorkerAsync(binding, { env: envFor(`const remove = fs.rmSync;
      fs.rmSync = function(file, ...args) { const result = remove.call(this, file, ...args);
        if (file === ${JSON.stringify(residue)}) fs.writeFileSync(${JSON.stringify(build)}, 'changed after removal');
        return result; };`) }), /dependency\/build inputs changed/);
    assert(!fs.existsSync(residue), 'actual removal must precede the second scan');
  } finally { fs.writeFileSync(build, 'build'); }
  verifyWorker(binding);

  // A hung verifier and its ordinary child share the supervised process group.
  const pidFile = path.join(root, 'verifier-descendant');
  const hanging = envFor(`require(${JSON.stringify(moduleFile)}).verifyWorker = () => {
    const child = require('node:child_process').spawn(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
    process.on('SIGTERM',()=>{}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  };`);
  let verifier;
  const started = Date.now();
  await assert.rejects(verifyWorkerAsync(binding, { ...short, env: hanging,
    onChild: child => { if (child) verifier = child; } }), /timeout/);
  assert(Date.now() - started < 3000, 'verifier escalation is bounded');
  assert(verifier.exitCode !== null || verifier.signalCode, 'verifier must be terminal');
  const descendant = Number(fs.readFileSync(pidFile, 'utf8'));
  // A killed descendant may remain a zombie until the container reaps it.
  assert.throws(() => process.kill(-verifier.pid, 0), /ESRCH/, `verifier group (including ${descendant}) must be gone`);

  const controller = new AbortController();
  let timer;
  try {
    await assert.rejects(verifyWorkerAsync(binding, { ...short, timeoutMs: 5000, env: hanging,
      signal: controller.signal, onChild(child) {
        if (child) timer = setTimeout(() => controller.abort('SIGTERM'), 100);
      } }), /SIGTERM/);
  } finally { clearTimeout(timer); }
  let spawned = false;
  await assert.rejects(verifyWorkerAsync(binding, { signal: controller.signal,
    onChild: child => { spawned ||= Boolean(child); } }), /SIGTERM/);
  assert.equal(spawned, false, 'pre-cancelled admission must not launch a verifier');
  await assert.rejects(verifyWorkerAsync(binding, { ...short, onChild(child) {
    if (child) throw new Error('verifier tracking failed');
  } }), /verifier tracking failed/);
  console.log('ok - owned async worker verification: exact requests, terminal results, byte mutations and bounded cancellation');
}
module.exports = { verifyWorkerVerification };
