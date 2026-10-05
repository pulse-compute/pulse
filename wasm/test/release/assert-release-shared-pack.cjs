'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recordPack, sharedPackEnv, copySharedPack } = require('../../../scripts/release-shared-pack.cjs');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { packRelease } = require('../../../scripts/pack-release.cjs');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-shared-pack-test-'));
const root = path.join(temporary, 'repo');
const shared = path.join(temporary, 'shared');
const destination = path.join(temporary, 'consumer');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  fs.mkdirSync(root);
  fs.mkdirSync(shared);
  git(['init']);
  fs.writeFileSync(path.join(root, 'source'), 'candidate');
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'candidate']);
  const manifest = { packageCount: 1, packages: [{ name: 'fixture', tarball: 'fixture.tgz' }] };
  fs.writeFileSync(path.join(shared, 'fixture.tgz'), 'exact fixture bytes');
  fs.writeFileSync(path.join(shared, 'pulse-release-manifest.json'), JSON.stringify(manifest));
  recordPack({ repoRoot: root, outDir: shared }, candidateIdentity(root));
  const env = sharedPackEnv(shared);
  const copy = (outDir = destination, repoRoot = root, environment = env) => copySharedPack({ repoRoot, outDir }, environment);
  assert.deepEqual(copy().manifest, manifest);
  fs.writeFileSync(path.join(destination, 'fixture.tgz'), 'consumer mutation');
  assert.equal(fs.readFileSync(path.join(shared, 'fixture.tgz'), 'utf8'), 'exact fixture bytes', 'Consumers must not share writable inodes');
  fs.rmSync(destination, { recursive: true });
  assert.deepEqual(copy().manifest, manifest, 'Consumer cleanup must not destroy the shared candidate');
  assert(!fs.existsSync(path.join(destination, 'pulse-shared-pack.json')), 'Internal receipt is not part of consumer output');

  const receipt = path.join(shared, 'pulse-shared-pack.json');
  const receiptBytes = fs.readFileSync(receipt);
  fs.appendFileSync(receipt, ' ');
  assert.throws(copy, /receipt changed/);
  fs.writeFileSync(receipt, receiptBytes);
  assert.throws(() => copy(destination, root, { ...env, PULSE_RELEASE_SHARED_PACK_SHA256: '' }), /Missing shared pack/);
  const tarball = path.join(shared, 'fixture.tgz');
  fs.writeFileSync(tarball, 'tampered');
  assert.throws(copy, /bytes changed/);
  fs.rmSync(tarball);
  assert.throws(copy, /ENOENT/);
  fs.writeFileSync(tarball, 'exact fixture bytes');
  fs.writeFileSync(path.join(shared, 'extra.tgz'), 'unexpected');
  assert.throws(copy, /file set changed/);
  fs.rmSync(path.join(shared, 'extra.tgz'));

  fs.writeFileSync(path.join(root, 'source'), 'dirty candidate');
  assert.throws(copy, /clean candidate checkout/);
  git(['checkout', '--', 'source']);
  fs.writeFileSync(path.join(root, 'untracked'), 'dirty candidate');
  assert.throws(copy, /clean candidate checkout/);
  fs.rmSync(path.join(root, 'untracked'));
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'different revision']);
  assert.throws(copy, /source changed/);
  git(['reset', '--hard', 'HEAD~1']);
  assert.throws(() => copy(destination, temporary), /another checkout/);
  for (const out of [shared, temporary, path.join(shared, 'nested')]) assert.throws(() => copy(out), /must not overlap/);
  if (process.platform !== 'win32') {
    const link = path.join(temporary, 'shared-link');
    fs.symlinkSync(shared, link, 'dir');
    assert.throws(() => copy(path.join(link, 'nested')), /must not overlap/);
    fs.rmSync(tarball);
    fs.symlinkSync(path.join(destination, 'fixture.tgz'), tarball);
    assert.throws(copy, /regular file/);
    fs.rmSync(tarball);
    fs.writeFileSync(tarball, 'exact fixture bytes');
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    assert.deepEqual(packRelease({ repoRoot: root, outDir: destination }).manifest, manifest,
      'packRelease must reuse the verified seal pack without invoking a toolchain');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  console.log('ok - shared release packages are source-bound, hash-checked, private copies; tampering, dirty/stale source and overlapping paths fail closed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
