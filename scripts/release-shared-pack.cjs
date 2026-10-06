'use strict';

// Seal-local reuse only. The parent pins the receipt bytes; each consumer gets
// ordinary copies, never hard links or a writable view of the shared candidate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { candidateIdentity } = require('./release-feature-acceptance.cjs');
const { sha256 } = require('./pack-release.cjs');

const RECEIPT = 'pulse-shared-pack.json';
const SCHEMA = 'pulse.release-shared-pack.v1';

function fileDigest(file) {
  assert(fs.lstatSync(file).isFile(), `Shared pack entry must be a regular file: ${file}`);
  return sha256(fs.readFileSync(file));
}

function recordPack(packed, identity) {
  assert.deepEqual(candidateIdentity(packed.repoRoot), identity, 'Source changed while packing');
  const files = fs.readdirSync(packed.outDir).sort().map(name => ({ name, sha256: fileDigest(path.join(packed.outDir, name)) }));
  const receipt = { schemaVersion: SCHEMA, repoRoot: fs.realpathSync(packed.repoRoot), ...identity, files };
  fs.writeFileSync(path.join(packed.outDir, RECEIPT), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

function sharedPackEnv(directory) {
  return { PULSE_RELEASE_SHARED_PACK: path.resolve(directory),
    PULSE_RELEASE_SHARED_PACK_SHA256: fileDigest(path.join(directory, RECEIPT)) };
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function copySharedPack({ repoRoot, outDir }, env = process.env) {
  const directory = fs.realpathSync(env.PULSE_RELEASE_SHARED_PACK);
  const receiptBytes = fs.readFileSync(path.join(directory, RECEIPT));
  assert.match(env.PULSE_RELEASE_SHARED_PACK_SHA256 || '', /^[a-f0-9]{64}$/, 'Missing shared pack receipt identity');
  assert.equal(sha256(receiptBytes), env.PULSE_RELEASE_SHARED_PACK_SHA256, 'Shared pack receipt changed');
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.schemaVersion, SCHEMA, 'Unknown shared pack receipt');
  if (fs.realpathSync(repoRoot) !== receipt.repoRoot) {
    require('./release-parallel.cjs').assertManagedWorker(repoRoot, receipt.repoRoot,
      { sourceRevision: receipt.sourceRevision, sourceTree: receipt.sourceTree, workingTree: receipt.workingTree },
      env.PULSEWASM_SEAL_WORKER_LAYOUT);
  }
  const { sourceRevision, sourceTree, workingTree } = receipt;
  assert.deepEqual(candidateIdentity(repoRoot), { sourceRevision, sourceTree, workingTree }, 'Shared pack source changed');
  const names = receipt.files.map(file => file.name);
  assert(names.length > 0 && new Set(names).size === names.length, 'Invalid shared pack file set');
  for (const file of receipt.files) {
    assert(file.name !== '.' && file.name !== '..' && !/[\\/]/.test(file.name), 'Invalid shared pack filename');
    assert.equal(fileDigest(path.join(directory, file.name)), file.sha256, `Shared pack bytes changed: ${file.name}`);
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), [...names, RECEIPT].sort(), 'Shared pack file set changed');

  // Resolve existing ancestor symlinks before any removal, including absent
  // destinations below a symlink. The shared directory must never be a target.
  let ancestor = path.resolve(outDir);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const destination = path.join(fs.realpathSync(ancestor), ...suffix);
  assert(!contains(destination, directory) && !contains(directory, destination), 'Shared pack and destination must not overlap');
  assert(!contains(destination, fs.realpathSync(repoRoot)), 'Shared pack destination must not contain the checkout');
  assert(!contains(destination, receipt.repoRoot), 'Shared pack destination must not contain its owning checkout');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of receipt.files) {
    const target = path.join(outDir, file.name);
    fs.copyFileSync(path.join(directory, file.name), target);
    assert.equal(fileDigest(target), file.sha256, `Copied pack bytes changed: ${file.name}`);
  }
  assert.deepEqual(candidateIdentity(repoRoot), { sourceRevision, sourceTree, workingTree }, 'Source changed while copying packages');
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'pulse-release-manifest.json'), 'utf8'));
  process.stderr.write(`[pulse:pack] Reused ${manifest.packageCount} verified packages from this seal\n`);
  return Object.freeze({ repoRoot, outDir, manifest });
}

function main(argv = process.argv.slice(2)) {
  assert(argv.length === 2 && argv[0] === '--out', 'Usage: node scripts/release-shared-pack.cjs --out <directory>');
  const repoRoot = path.resolve(__dirname, '..');
  const identity = candidateIdentity(repoRoot);
  const packed = require('./pack-release.cjs').packRelease({ repoRoot, outDir: argv[1], build: false, fresh: true });
  recordPack(packed, identity);
}

module.exports = { recordPack, sharedPackEnv, copySharedPack };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
