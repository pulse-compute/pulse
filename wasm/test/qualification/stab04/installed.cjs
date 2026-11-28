'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const harness = ['installed.cjs', 'worker.cjs', 'server.cjs', 'metrics.cjs', '../stab03/fixture.cjs', '../stab03/worker.cjs'];
const { validate } = require('./metrics.cjs');
const root = path.resolve(__dirname, '../../../..');
const { packRelease } = require('../../../../scripts/pack-release.cjs');
const { candidateIdentity } = require('../../../../scripts/release-feature-acceptance.cjs');
const { verifyClosure } = require('../../release/assert-request-deadline-packages.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../../release/read-only-npm-registry.cjs');
const { installedAcceptanceReport } = require('../../support/installed-acceptance-report.cjs');

async function prepare(directory) {
  const output = path.resolve(directory);
  assert(output !== root && !output.startsWith(root + path.sep), 'Evidence must be outside the checkout');
  fs.mkdirSync(output, { recursive: true });
  assert.equal(fs.readdirSync(output).length, 0, 'Use a fresh evidence directory');
  const candidate = candidateIdentity(root), pack = path.join(output, 'packages');
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-stab04-consumer-'));
  const env = { ...process.env, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: path.join(consumer, '.npm-cache') };
  for (const name of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY', 'FASTLY_API_TOKEN', 'FASTLY_API_KEY', 'MAC03_PROOF_KEY_BASE64']) delete env[name];
  let registry;
  try {
    const { manifest } = packRelease({ repoRoot: root, outDir: pack });
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'stab04-consumer', private: true, type: 'module', dependencies: Object.fromEntries(manifest.packages.map(p => [p.name, p.version])) }));
    registry = createReadOnlyRegistry(catalogFromTarballs(manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    const run = (command, args) => promisify(execFile)(command, args, { cwd: consumer, env, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(registry.requests.missing, 0);
    assert.equal(registry.requests.rejected, 0);
    verifyClosure(consumer, pack, manifest);
    for (const file of ['worker.cjs', 'server.cjs', 'metrics.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(consumer, file));
    fs.copyFileSync(path.join(__dirname, '../stab03/fixture.cjs'), path.join(consumer, 'fixture.cjs'));
    fs.copyFileSync(path.join(__dirname, '../stab03/worker.cjs'), path.join(consumer, 'proof.cjs'));
    const proofDir = path.join(output, 'proof'); fs.mkdirSync(proofDir);
    const proofRun = await run(process.execPath, ['proof.cjs', proofDir, root]);
    fs.writeFileSync(path.join(output, 'composition.log'), proofRun.stdout + proofRun.stderr);
    verifyClosure(consumer, pack, manifest);
    const proof = JSON.parse(fs.readFileSync(path.join(proofDir, 'worker.json')));
    assert.equal(proof.status, 'passed');
    const resultDir = path.join(output, 'result');
    fs.mkdirSync(resultDir);
    const result = await run(process.execPath, ['worker.cjs', resultDir, root]);
    fs.writeFileSync(path.join(output, 'installed.log'), result.stdout + result.stderr);
    verifyClosure(consumer, pack, manifest);
    assert.deepEqual(candidateIdentity(root), candidate);
    const worker = JSON.parse(fs.readFileSync(path.join(resultDir, 'worker.json')));
    assert.equal(worker.status, 'passed');
    const receipt = { ...worker, compositionProof: { builds: proof.builds, controls: proof.controls, compositionStatus: proof.compositionStatus, sha256: hash(fs.readFileSync(path.join(proofDir, 'worker.json'))) }, version: 'pulse.stab04-installed.v1', candidate, packageClosureVerified: true, outsideCheckout: true,
      harness: Object.fromEntries(harness.map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
      packages: manifest.packages.map(p => ({ name: p.name, version: p.version, file: 'packages/' + p.tarball, sha256: p.sha256 })) };
    fs.writeFileSync(path.join(output, 'installed.json'), JSON.stringify(receipt, null, 2) + '\n');
    validate(receipt);
    assert.equal(receipt.hostedQualified, false);
    for (const artifact of receipt.artifacts) assert.equal(hash(fs.readFileSync(path.join(resultDir, artifact.file))), artifact.sha256);
    fs.writeFileSync(installedAcceptanceReport(path.join(output, 'acceptance.json')), JSON.stringify({ status: 'passed', source: candidate.sourceRevision, sourceTree: candidate.sourceTree, workingTree: '', workingDiffSha256: hash(''), acceptanceScriptSha256: hash(fs.readFileSync(__filename)), packages: receipt.packages, compositionProof: receipt.compositionProof, nativeQualified: false, bundle: output, installedReceiptSha256: hash(fs.readFileSync(path.join(output, 'installed.json'))), hostedQualified: false }, null, 2) + '\n');
    return { status: 'passed', bundle: output, jobs: receipt.jobs.projected, nativeQualified: false, hostedQualified: false };
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failed-attempt.json'), JSON.stringify({ status: 'failed', candidate, error: error.message, stdout: error.stdout, stderr: error.stderr }, null, 2) + '\n');
    throw error;
  } finally {
    if (registry) await new Promise(resolve => registry.server.close(resolve));
    fs.rmSync(consumer, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const output = process.argv[2] || fs.mkdtempSync(path.join(path.dirname(root), 'pulse-stab04-evidence-'));
  prepare(output).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { prepare };
