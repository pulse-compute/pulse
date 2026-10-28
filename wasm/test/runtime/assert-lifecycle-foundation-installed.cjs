'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-foundation-installed-'));
  const consumer = path.join(temporary, 'consumer'), pack = path.join(temporary, 'packages');
  assert(!temporary.startsWith(root + path.sep));
  const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true' };
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
  const run = (command, args, timeout = 180000) => promisify(execFile)(command, args, { cwd: consumer, env, timeout, maxBuffer: 16 * 1024 * 1024 });
  let registry;
  try {
    const packed = packRelease({ repoRoot: root, outDir: pack });
    const version = packed.manifest.releaseVersion;
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'foundation-consumer', private: true,
      dependencies: Object.fromEntries(['pulse', 'cli', 'provider-node', 'provider-fastly'].map(name => ['@pulse-compute/' + name, version])) }));
    registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(row => path.join(pack, row.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
    const identities = [];
    for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
      const entry = packed.manifest.packages.find(row => row.name === '@pulse-compute/' + name); assert(entry);
      const directory = path.join(consumer, 'node_modules/@pulse-compute', name);
      assert(fs.realpathSync(directory).startsWith(consumer + path.sep), 'no workspace package links');
      const tarball = path.join(pack, entry.tarball); assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
      for (const [file, bytes] of readTarEntries(tarball)) {
        if (!file.startsWith('package/') || file.endsWith('/')) continue;
        let target = path.join(directory, file.slice(8));
        if (!fs.existsSync(target) && path.basename(target) === '.gitignore') target = path.join(path.dirname(target), '.npmignore');
        assert.deepEqual(fs.readFileSync(target), bytes, entry.name + '/' + file);
      }
      identities.push({ name: entry.name, sha256: entry.sha256 });
    }
    fs.copyFileSync(path.join(__dirname, 'assert-lifecycle-foundation.cjs'), path.join(consumer, 'check.cjs'));
    const result = await run(process.execPath, ['check.cjs', '--installed']);
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(report.status, 'passed'); assert.equal(report.mode, 'installed'); assert.equal(report.cells.length, 5);
    for (const file of ['host-extension-fixture.cjs', 'terminal-host.cjs'])
      fs.copyFileSync(path.join(root, 'wasm/test/support', file), path.join(consumer, file));
    fs.copyFileSync(path.join(root, 'packages/grip/pulse.package.json'), path.join(consumer, 'fixture-product.json'));
    fs.copyFileSync(path.join(root, 'wasm/test/provider/assert-fastly-host-extensions-installed.cjs'), path.join(consumer, 'terminal.cjs'));
    const terminal = await run(process.execPath, ['terminal.cjs', '--installed']);
    const terminalReport = JSON.parse(terminal.stdout.trim().split('\n').at(-1));
    assert.equal(terminalReport.status, 'passed'); assert.equal(terminalReport.cells.length, 2);
    process.stdout.write(terminal.stdout);
    console.log(JSON.stringify({ status: 'passed', mode: 'source-free-installed', packages: identities, qualification: report }));
  } finally {
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
