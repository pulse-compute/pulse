'use strict';

// Source inventory only: never compiles, downloads, generates vectors or changes gates.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const revision = '3ce6a740226434e013f2ba517129679de0f1fd08';
const tree = '0e69bac826907cd7d4b7d2bef65c4f7475c1c0f2';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const exact = new Set([
  'pnpm-lock.yaml', 'package.json', 'scripts/pulse-context-corpus.cjs', 'scripts/pulse-context-inputs.json',
  'scripts/release-source-checks.cjs', 'scripts/validate-release.cjs', 'scripts/release-feature-acceptance.cjs',
  'scripts/release-evidence-bundle.cjs', 'scripts/release-recovery.cjs', 'scripts/release-checkpoints.cjs',
  'scripts/pack-release.cjs', 'scripts/maintainer-fast-validation.cjs', 'scripts/documentation-release.cjs',
  'wasm/scripts/sync-doc-snippets.cjs', 'wasm/test/suite/registry.cjs',
  'release/pulse-release-manifest.json', 'release/maintenance-policy.json',
  'wasm/packages/contracts/src/handler/canonical-native-plan.js',
  'wasm/test/contracts/assert-binary-resource-admission.cjs', 'wasm/test/runtime/assert-binary-resource-execution.cjs',
  '.github/workflows/release-qualification.yml',
]);
const prefixes = [
  'examples/12-pulse-context-mcp/', 'wasm/packages/cli/examples/12-pulse-context-mcp/',
  'packages/mcp/', 'wasm/test/mcp/', 'wasm/packages/contracts/src/resources/',
  'docs/internal/b10-07/', 'docs/internal/b10-08/',
];
function inventory() {
  assert.equal(git('rev-parse', `${revision}^{tree}`), tree);
  const paths = git('ls-tree', '-r', '--name-only', revision).split('\n');
  const { buildCorpus, render, LIMITS, canonical } = require('../../../scripts/pulse-context-corpus.cjs');
  const corpus = buildCorpus(root);
  for (const source of corpus.sources) exact.add(source.path);
  const selected = paths.filter(file => exact.has(file) || prefixes.some(prefix => file.startsWith(prefix))).sort(compare);
  const files = selected.map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, git('rev-parse', `${revision}:${file}`), `Inventory input differs from pinned base: ${file}`);
    return { path: file, bytes: bytes.length, sha256: sha(bytes), gitBlob: blob };
  });
  const module = render(corpus);
  const output = 'examples/12-pulse-context-mcp/context-corpus.ts';
  assert.equal(fs.readFileSync(path.join(root, output), 'utf8'), module);
  for (const file of paths.filter(file => file.startsWith('examples/12-pulse-context-mcp/'))) {
    assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'wasm/packages/cli', file)), `Installed mirror drift: ${file}`);
  }
  const registry = require('../../../wasm/test/suite/registry.cjs');
  const tasks = Object.entries(registry.tasks).filter(([id]) => /mcp|pulse-context|binary-resource/.test(id))
    .sort(([a], [b]) => compare(a, b)).map(([id, task]) => ({
      id, args: task.args.map(arg => arg.startsWith(root + path.sep) ? path.relative(root, arg) : arg),
      evidence: task.evidence, timeoutMs: task.timeoutMs,
      profiles: Object.keys(registry.profiles).filter(profile => registry.expandProfile(profile).includes(id)),
      description: task.description,
    }));
  const scope = paths.filter(file => file.startsWith('examples/12-pulse-context-mcp/')
    || file.startsWith('packages/mcp/') || file.startsWith('scripts/')
    || file.startsWith('docs/internal/b10-07/') || file.startsWith('docs/internal/b10-08/'));
  const mentions = scope.flatMap(file => fs.readFileSync(path.join(root, file), 'utf8').split('\n')
    .flatMap((line, index) => /vector\.bin|vectors\.bin|\bembeddings?\b/i.test(line) ? [{ path: file, line: index + 1, text: line.trim() }] : []));
  const snapshotBytes = Buffer.byteLength(JSON.stringify(canonical(corpus), null, 2));
  return {
    schemaVersion: 'pulse.b10-mcp-baseline.v1', source: { revision, tree },
    classification: 'source-inspection-not-runtime-qualification',
    corpus: { schemaVersion: corpus.schemaVersion, pulseVersion: corpus.pulseVersion, status: corpus.status,
      corpusHash: corpus.corpusHash, records: corpus.records.length, sources: corpus.sources.length,
      snapshotBytes, moduleBytes: Buffer.byteLength(module), limits: LIMITS,
      remainingRecords: LIMITS.maxRecords - corpus.records.length,
      remainingSnapshotBytes: LIMITS.maxSnapshotBytes - snapshotBytes, installedMirror: 'byte-identical' },
    vectorSearch: { scope: 'Pinned tracked filenames; content in context example, MCP package, scripts and B10-07/08 evidence',
      matchingBinaryPaths: paths.filter(file => /(?:^|\/)(?:vectors?|embeddings?)\.bin$/i.test(file)),
      mentions, conclusion: 'No original MCP vector or encoder recovered in this scope; B10-07 generates synthetic proof data.' },
    tasks, files,
  };
}
const result = JSON.stringify(inventory(), null, 2) + '\n';
const output = path.join(__dirname, 'baseline.json');
if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) throw new Error('Usage: node docs/internal/b10-mcp-00/inventory.cjs --write|--check');
if (process.argv[2] === '--write') fs.writeFileSync(output, result);
else assert.equal(fs.readFileSync(output, 'utf8'), result, 'Baseline inventory differs');
console.log('ok - pinned source inventory, corpus identity, installed mirrors and task ownership');
