'use strict';
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-ast01-'));
  const consumer = path.join(temporary, 'consumer');
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const reportDir = fs.mkdtempSync(path.join(root, 'wasm/.test-results/ast01-installed-'));
  const reportFile = installedAcceptanceReport(path.join(reportDir, 'acceptance.json'));
  const report = { status: 'running', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    diffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
    acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
    fixtureSha256: hash(fs.readFileSync(path.join(root, 'packages/assets/test/fixtures/sigv4-compatibility.json'))),
    lifecycleScripts: false, installedOutsideCheckout: true };
  try {
    assert.ok(!temporary.startsWith(root + path.sep));
    fs.mkdirSync(consumer);
    const packed = packRelease({ repoRoot: root, outDir: path.join(temporary, 'packages') });
    const names = ['assets', 's3', 'runtime', 'wasm-contracts'].map(name => '@pulse-compute/' + name);
    const packages = packed.manifest.packages.filter(item => names.includes(item.name));
    assert.equal(packages.length, names.length);
    report.packages = packages.map(({ name, version, sha256 }) => ({ name, version, sha256 }));
    const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache'), npm_config_audit: 'false', npm_config_fund: 'false' };
    delete env.NODE_PATH; delete env.NODE_OPTIONS;
    fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packages.map(item => path.join(packed.outDir, item.tarball))], { cwd: consumer, env, timeout: 30000, stdio: 'pipe' });
    const verify = () => {
      let files = 0;
      for (const item of packages) {
        const installed = path.join(consumer, 'node_modules', item.name);
        assert.ok(fs.realpathSync(installed).startsWith(consumer + path.sep));
        const tarball = path.join(packed.outDir, item.tarball);
        assert.equal(hash(fs.readFileSync(tarball)), item.sha256);
        for (const [file, bytes] of readTarEntries(tarball)) if (file.startsWith('package/') && !file.endsWith('/')) {
          assert.deepEqual(fs.readFileSync(path.join(installed, file.slice(8))), bytes, item.name + '/' + file); files++;
        }
      }
      return files;
    };
    report.verifiedFiles = verify();
    const manifest = JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules/@pulse-compute/assets/package.json')));
    assert.equal(manifest.dependencies['@pulse-compute/s3'], packed.manifest.releaseVersion);
    fs.copyFileSync(path.join(root, 'packages/assets/test/fixtures/sigv4-compatibility.json'), path.join(consumer, 'vectors.json'));
    fs.writeFileSync(path.join(consumer, 'check.mjs'), `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { signSigV4, encodeS3Key, AssetBucket, AssetBucketSignError, assets } from '@pulse-compute/assets';
      import { signHttpRequest } from '@pulse-compute/s3/signing';
      import { s3 } from '@pulse-compute/s3';
      assert.equal(typeof signHttpRequest, 'function'); assert.equal(typeof s3.getText, 'function');
      assert.equal(typeof AssetBucket, 'function'); assert.equal(typeof assets.lookup, 'function');
      const vectors = JSON.parse(fs.readFileSync('vectors.json'));
      for (const vector of vectors) {
        const request = await signSigV4({ ...vector, credentials: { key: 'AKIDEXAMPLE', secret: 'fixture-signing-secret', token: vector.token }, now: new Date('2026-09-29T12:34:56.000Z') });
        assert.deepEqual({ url: request.url, method: request.method, headers: [...request.headers] }, vector.expected);
      }
      assert.equal(encodeS3Key('/é//%2F/'), '/%C3%A9//%252F/');
      await assert.rejects(signSigV4({ method: 'GET', url: 'https://example.test', credentials: { key: '', secret: '' } }), AssetBucketSignError);
      console.log(JSON.stringify({ status: 'passed', vectors: vectors.length }));
    `);
    report.runtime = JSON.parse(execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, env, timeout: 10000, encoding: 'utf8' }));
    fs.writeFileSync(path.join(consumer, 'check.ts'), `
      import { signSigV4, encodeS3Key, type SigV4SignOptions, type SigV4Credentials } from '@pulse-compute/assets';
      const credentials: SigV4Credentials = { key: Promise.resolve('fixture'), secret: () => 'fixture', token: async () => 'fixture' };
      const options: SigV4SignOptions = { method: 'HEAD', url: new URL('https://example.test'), credentials };
      const signed: Promise<Request> = signSigV4(options); const key: string = encodeS3Key('/a//b'); void signed; void key;
    `);
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', 'check.ts'], { cwd: consumer, env, timeout: 30000, stdio: 'pipe' });
    assert.equal(verify(), report.verifiedFiles);
    report.status = 'passed'; report.installedTypes = 'passed';
  } catch (error) { report.status = 'failed'; report.error = String(error.stack || error); throw error; }
  finally { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); fs.rmSync(temporary, { recursive: true, force: true }); }
  console.log(JSON.stringify({ ...report, reportFile }));
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack || error); if (error.stdout) console.error(String(error.stdout)); if (error.stderr) console.error(String(error.stderr)); process.exitCode = 1; });
