#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { packRelease } = require('../../../scripts/pack-release.cjs');
const { PUBLICATION } = require('../../../scripts/package-support.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const run = promisify(execFile);

async function main() {
  // K4 is a required external lane, not an optional release availability probe.
  fastly.inspectFastlyComputeLauncher({ env: process.env, timeoutMs: 5000 });
  const repoRoot = path.resolve(__dirname, '../../..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-k4-acceptance-'));
  let registry;
  try {
    console.log('K4 - replay portable contract, adversarial scheduling and injected Fastly ABI gates');
    for (const script of ['kv/assert-kv-conditional-runtime.cjs', 'kv/assert-kv-conditional-conformance.cjs', 'provider/assert-fastly-conditional-kv.cjs']) {
      const result = await run(process.execPath, [path.join(__dirname, '..', script)], {
        cwd: repoRoot, env: process.env, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
      });
      process.stdout.write(result.stdout);
    }
    console.log('K4 - pack the current candidate and install its exact package closure');
    const releaseDir = path.join(root, 'release');
    const { manifest } = packRelease({ repoRoot, outDir: releaseDir, build: true });
    const tarballs = manifest.packages.map((p) => path.join(releaseDir, p.tarball));
    registry = createReadOnlyRegistry(catalogFromTarballs(tarballs));
    await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
    const packedRoot = path.join(root, 'consumer'); fs.mkdirSync(packedRoot);
    fs.writeFileSync(path.join(packedRoot, 'package.json'), JSON.stringify({ name: 'pulse-k4-packed', private: true, version: '0.0.0' }));
    const npmrc = path.join(root, 'npmrc');
    fs.writeFileSync(npmrc, `registry=${PUBLICATION.registry}/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, npm_config_cache: path.join(root, 'npm-cache'), npm_config_fetch_retries: '0' };
    delete env.NODE_PATH; delete env.npm_config_registry; delete env.NPM_CONFIG_REGISTRY;
    delete env.npm_config_userconfig;
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', ...tarballs], {
      cwd: packedRoot, env, timeout: 360000, maxBuffer: 8 * 1024 * 1024,
    });
    console.log('K4 - run installed Node Native/JavaScript and actual Fastly Compute consumers');
    const child = await run(process.execPath, [path.join(__dirname, 'assert-packed-consumer.cjs'), packedRoot, releaseDir, '--compute'], {
      cwd: packedRoot, env, timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    }).catch((error) => {
      if (error.code === 1 && error.stdout.trim().startsWith('{')) return error;
      throw error;
    });
    const evidence = JSON.parse(child.stdout);
    assert.equal(evidence.providerReality, true);
    assert.equal(evidence.installedBytesUnchanged, true); assert.equal(evidence.workspaceProductModules, 0);
    assert.equal(registry.requests.rejected, 0); assert.equal(registry.requests.missing, 0);
    const output = { ...evidence, registry: registry.requests, deployed: 'pending-T2' };
    if (process.env.PULSEWASM_TEST_TMP_ROOT) fs.writeFileSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT, 'kv-k4-acceptance.json'), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output));
    assert.equal(evidence.status, 'passed', 'K4 real Compute contract gate failed; see recorded scenario failures');
    console.log('ok - K4 exact packed consumers and required real Compute acceptance; deployed evidence remains pending T2');
  } finally {
    if (registry) await new Promise((resolve) => registry.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); console.error(error.stderr || ''); process.exitCode = 1; });
