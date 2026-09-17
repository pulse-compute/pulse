'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { runInNewContext } = require('node:vm');
const { loadReleaseManifest, RELEASE_MANIFEST } = require('../../../scripts/package-support.cjs');
const { pnpmInvocation, exactVersion, binaryPath } = require('../../../scripts/pnpm-toolchain.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pnpm-policy-'));
try {
  const file = path.join(root, 'release.json');
  const manifest = structuredClone(RELEASE_MANIFEST);
  // A future reviewed toolchain must not require rewriting policy validators.
  manifest.publication.pnpmDevelopmentRange = '^99.2.0';
  manifest.publication.pnpmVersion = '99.3.1';
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(loadReleaseManifest(file).publication.pnpmVersion, '99.3.1');
  for (const invalid of ['99.1.9', '100.0.0', 'latest', '99.3.1-beta.1']) {
    manifest.publication.pnpmVersion = invalid;
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => loadReleaseManifest(file), /pnpmVersion/);
  }
  assert.throws(() => exactVersion('12.4.2; echo injected'), /Invalid exact/);

  // Execute the restore script's actual manifest gate. Its trusted-lockfile
  // mode is permitted only for the bundle's exact verified source/toolchain.
  const repo = path.resolve(__dirname, '../../..');
  const restore = fs.readFileSync(path.join(repo, 'scripts/restore_deps.sh'), 'utf8');
  const gate = restore.match(/node - "\$STAGE\/\.pulse-dependency-bundle\.json"[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const publication = RELEASE_MANIFEST.publication;
  const bundleFile = path.join(root, 'bundle.json');
  const bundle = {
    version: 'pulse.dependency-bundle.v5', builder: 'docker-build-export',
    targetDistribution: 'debian-trixie', platform: process.platform, arch: process.arch,
    node: publication.nodeVersion, nodeMajor: Number(publication.nodeVersion.split('.')[0]),
    nodeEngines: publication.nodeEngines, nodeMinimumVersion: publication.nodeMinimumVersion,
    pnpm: publication.pnpmVersion, assemblyscript: '0.28.18', jsonAs: '1.5.0', xjbAs: '0.1.0',
    lockfileVerification: 'verified-during-fetch-and-bound-by-sha256',
    lockfileSha256: createHash('sha256').update(fs.readFileSync(path.join(repo, 'pnpm-lock.yaml'))).digest('hex'),
    nodeModulesIncluded: false, offlineInstallRequired: true, storePreparation: 'fetched-in-target-container',
    contents: ['.pnpm-store', '.validation-tools/pnpm'],
    restore: { command: './restore_pulsewasm_dependencies_portable.sh <bundle.tar.zst>', validationCommand: 'npm run release:seal -- --skip-install' }
  };
  const verify = (candidate) => {
    fs.writeFileSync(bundleFile, JSON.stringify(candidate));
    runInNewContext(gate, { require, process: {
      platform: process.platform, arch: process.arch, versions: { node: publication.nodeVersion },
      argv: ['node', '-', bundleFile, publication.pnpmVersion, '0.28.18', '1.5.0', '0.1.0',
        'debian-trixie', publication.nodeEngines, publication.nodeMinimumVersion, publication.nodeVersion]
    } });
  };
  // The shell gate reads relative to the repository root, as real restore does.
  const cwd = process.cwd();
  try {
    process.chdir(repo);
    verify(bundle);
    assert.throws(() => verify({ ...bundle, lockfileSha256: '0'.repeat(64) }), /lockfileSha256 mismatch/);
    assert.throws(() => verify({ ...bundle, lockfileVerification: undefined }), /lockfileVerification mismatch/);
    assert.throws(() => verify({ ...bundle, pnpm: '10.0.0' }), /pnpm mismatch/);
  } finally { process.chdir(cwd); }

  assert.deepEqual(pnpmInvocation(root, '10.0.0'), { command: 'corepack', prefix: ['pnpm@10.0.0'] });
  const invocation = pnpmInvocation(root, '12.4.2');
  assert.equal(invocation.command, process.execPath);
  const run = (args) => spawnSync(invocation.command, [...invocation.prefix, ...args], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, COREPACK_ENABLE_NETWORK: '0', npm_config_offline: 'true' }
  });
  const absent = run(['--version']);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /offline execution cannot bootstrap/);
  if (process.platform !== 'win32') {
    const binary = binaryPath(root);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, `#!${process.execPath}\nconsole.log('12.4.1');\n`, { mode: 0o755 });
    const stale = run(['--version']);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Bundled pnpm version mismatch/);
    // Model a native runner to prove cwd, arguments, stdout and exit propagation.
    fs.writeFileSync(binary, `#!${process.execPath}
if (process.argv[2] === '--version') console.log('12.4.2');
else { console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) })); process.exit(7); }
`, { mode: 0o755 });
    const executed = run(['pack', '--json']);
    assert.equal(executed.status, 7);
    assert.deepEqual(JSON.parse(executed.stdout), { cwd: process.cwd(), args: ['pack', '--json'] });
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }

console.log('ok - pnpm policy follows its manifest range; native execution preserves cwd/exit/JSON and rejects missing offline or stale runners');
