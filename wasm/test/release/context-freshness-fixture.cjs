'use strict';
const fs = require('node:fs');
const path = require('node:path');
const owner = require('../../../scripts/release-context-freshness.cjs');
const root = path.resolve(__dirname, '../../..');
let checked;
function freshness(candidate) {
  checked ||= owner.check(root, { sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), workingTree: '' });
  return { ...structuredClone(checked), candidate: structuredClone(candidate) };
}
function sourceChecks(candidate) {
  return { schemaVersion: require('../../../scripts/release-source-checks.cjs').SCHEMA, status: 'passed', candidate,
    contextFreshness: freshness(candidate), snippets: { status: 'ok' },
    documentation: { status: 'ok', validationKind: 'package-source', maintenance: { status: 'ok', publication: { status: 'ok' } } } };
}
function entries(receipt) {
  return new Map(receipt.files.map(file => [`package/examples/12-pulse-context-mcp/${file.path}`,
    fs.readFileSync(path.join(root, 'wasm/packages/cli/examples/12-pulse-context-mcp', file.path))]));
}
module.exports = { freshness, sourceChecks, entries };

// Small real archives, with actual shipped context bytes, for controller tests.
function pack(directory, candidate) {
  const checked = sourceChecks(candidate), receipt = checked.contextFreshness;
  const chunks = [];
  for (const [name, bytes] of entries(receipt)) {
    const header = Buffer.alloc(512);
    if (Buffer.byteLength(name) > 100) throw Error('Fixture path exceeds ustar name field');
    header.write(name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257); header.write('00', 263);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  const cli = require('node:zlib').gzipSync(Buffer.concat(chunks));
  const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');
  fs.mkdirSync(directory, { recursive: true });
  const packages = PACKAGE_SET.map((item, i) => {
    const bytes = item.name === '@pulse-compute/cli' ? cli : Buffer.from(`fixture package ${item.name}`);
    const tarball = `${i}.tgz`; fs.writeFileSync(path.join(directory, tarball), bytes);
    return { name: item.name, version: RELEASE_VERSION, sha256: owner.hash(bytes), tarball };
  });
  const manifest = { packages, context: owner.verifyPacked(receipt, entries(receipt)) };
  fs.writeFileSync(path.join(directory, 'pulse-release-manifest.json'), JSON.stringify(manifest));
  return { checked, manifest };
}
function attach(seal, directory) {
  const candidate = { sourceRevision: seal.sourceRevision, sourceTree: seal.featureAcceptance.sourceTree, workingTree: '' };
  const { checked, manifest } = pack(directory, candidate);
  const tasks = checked.contextFreshness.selections.features;
  const runner = { schemaVersion: 2, sourceRevision: candidate.sourceRevision, sourceIdentity: { sourceRevision: candidate.sourceRevision },
    status: 'passed', currentTask: null, startedAt: '2026-10-21T00:00:00.000Z', finishedAt: '2026-10-21T00:00:01.000Z', durationMs: 1000,
    requestedTasks: tasks, selectedTasks: tasks, completedTasks: tasks.length,
    results: tasks.map(name => ({ name, status: 'passed', exitCode: 0 })) };
  for (const gate of seal.featureAcceptance.gates) gate.packages = structuredClone(manifest.packages);
  const sourceFile = path.join(directory, 'source-checks.json'), runnerFile = path.join(directory, 'tasks.json');
  fs.writeFileSync(sourceFile, JSON.stringify(checked)); fs.writeFileSync(runnerFile, JSON.stringify(runner));
  seal.featureAcceptance.runnerReportSha256 = owner.hash(fs.readFileSync(runnerFile));
  seal.sourceChecks = { file: sourceFile, sha256: owner.hash(fs.readFileSync(sourceFile)) };
  seal.contextEvidence = { packManifest: path.join(directory, 'pulse-release-manifest.json'), featureTasks: runnerFile };
  seal.contextQualification = owner.qualify(checked, manifest, runner, seal.featureAcceptance);
  return { checked, manifest, runner };
}
Object.assign(module.exports, { pack, attach });
