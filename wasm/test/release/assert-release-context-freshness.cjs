'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const owner = require('../../../scripts/release-context-freshness.cjs');
const fixture = require('./context-freshness-fixture.cjs');
const builder = require('../../../scripts/pulse-context-build.cjs');
const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');
const identity = { sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), workingTree: '' };
const checked = fixture.sourceChecks(identity), proof = checked.contextFreshness;
const entries = fixture.entries(proof);
const manifest = { packages: PACKAGE_SET.map(item => ({ name: item.name, version: RELEASE_VERSION, sha256: 'd'.repeat(64) })),
  context: owner.verifyPacked(proof, entries) };
const tasks = proof.selections.features;
const runner = { schemaVersion: 2, sourceRevision: identity.sourceRevision, sourceIdentity: { sourceRevision: identity.sourceRevision },
  status: 'passed', currentTask: null, startedAt: '2026-10-21T00:00:00.000Z', finishedAt: '2026-10-21T00:00:01.000Z', durationMs: 1000,
  requestedTasks: tasks, selectedTasks: tasks, completedTasks: tasks.length,
  results: tasks.map(name => ({ name, status: 'passed', exitCode: 0 })) };
const features = { schemaVersion: 'pulse.release-feature-acceptance.v1', ...identity, status: 'passed',
  gates: tasks.map(task => ({ task, status: 'passed', reportSha256: 'c'.repeat(64), packages: structuredClone(manifest.packages) })) };
const qualified = owner.qualify(checked, manifest, runner, features);
assert.equal(qualified.schemaVersion, owner.QUALIFICATION);
let negatives = 0;
function reject(mutate, pattern) {
  const c = structuredClone({ checked, manifest, runner, features }); mutate(c);
  assert.throws(() => owner.qualify(c.checked, c.manifest, c.runner, c.features), pattern); negatives++;
}
reject(c => delete c.checked.contextFreshness, /freshness receipt/);
reject(c => c.checked.schemaVersion = 'pulse.release-source-checks.v2', /requires v3/);
reject(c => c.checked.contextFreshness.candidate.sourceTree = 'f'.repeat(40), /candidate differs/);
reject(c => c.checked.contextFreshness.reconstruction.mode = 'write', /read-only/);
reject(c => c.checked.contextFreshness.manifestText += ' ', /digest differs/);
reject(c => c.checked.contextFreshness.selections.features.pop(), /selection differs/);
reject(c => delete c.manifest.context, /packed context proof/);
reject(c => c.manifest.context.freshnessSha256 = 'f'.repeat(64), /freshness differs/);
reject(c => c.manifest.packages.pop(), /closure differs/);
reject(c => c.runner.selectedTasks = c.runner.selectedTasks.slice(1), /Selected task set differs/);
reject(c => c.runner.status = 'running', /not passing/);
reject(c => c.features.gates = c.features.gates.filter(g => g.task !== 'mcp-installed'), /Incomplete installed/);
reject(c => c.features.gates[0].packages[0].sha256 = 'e'.repeat(64), /tarball/);
reject(c => c.features.gates.find(g => g.task === 'mcp-installed').packages = [manifest.packages[0]], /Missing MCP installed/);
for (const kind of ['missing', 'extra', 'corrupt']) {
  const copy = new Map(entries), name = [...copy.keys()][0];
  if (kind === 'missing') copy.delete(name);
  else if (kind === 'extra') copy.set('package/examples/12-pulse-context-mcp/context-data/extra.bin', Buffer.from('extra'));
  else copy.set(name, Buffer.from('corrupt'));
  assert.throws(() => owner.verifyPacked(proof, copy), /Packed context/); negatives++;
}
assert.throws(() => owner.verifySeal({}), /Missing context qualification/); negatives++;

// Exercise the actual pre-pack gate against independently copied builder inputs.
// Snapshot the candidate *after* each fault and prove failure does not repair it.
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-context-'));
function put(file, bytes) { const dest = path.join(temporary, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); }
function snapshot() {
  const rows = [];
  function walk(dir) { for (const name of fs.readdirSync(path.join(temporary, dir)).sort()) {
    const relative = path.join(dir, name), file = path.join(temporary, relative);
    if (fs.statSync(file).isDirectory()) walk(relative); else rows.push([relative, owner.hash(fs.readFileSync(file))]);
  } }
  walk(''); return rows;
}
try {
  const built = builder.construct(root);
  const inputs = [...new Set([builder.CONFIG, 'scripts/pulse-context-inputs.json', 'pnpm-lock.yaml',
    ...builder.PRODUCER_SOURCES, ...builder.COMPATIBILITY_SOURCES, ...built.corpus.sources.map(s => s.path)])];
  for (const file of inputs) put(file, fs.readFileSync(path.join(root, file)));
  for (const [file, bytes] of built.outputs) put(file, bytes);
  for (const file of proof.files) put(`wasm/packages/cli/examples/12-pulse-context-mcp/${file.path}`,
    entries.get(`package/examples/12-pulse-context-mcp/${file.path}`));
  assert.deepEqual(owner.check(temporary, identity), proof);
  for (const [file, mode] of [
    ['docs/getting-started.md', 'stale'], [builder.CONFIG, 'missing'], ['pnpm-lock.yaml', 'stale'],
    [builder.PRODUCER_SOURCES[0], 'stale'], [builder.MANIFEST, 'stale'],
    [`${builder.DIRECTORY}/vector.bin`, 'corrupt'], [`${builder.MIRROR}${builder.DIRECTORY}/text.bin`, 'corrupt'],
    [`${builder.DIRECTORY}/extra.bin`, 'extra']
  ]) {
    const target = path.join(temporary, file), previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (mode === 'missing') fs.unlinkSync(target); else put(file, Buffer.concat([previous || Buffer.alloc(0), Buffer.from('bad')]));
    const before = snapshot();
    assert.throws(() => owner.check(temporary, identity));
    assert.deepEqual(snapshot(), before, `Freshness failure changed candidate: ${file}`); negatives++;
    if (previous) put(file, previous); else fs.unlinkSync(target);
  }
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log(`ok - release context freshness: exact package binding and ${negatives} fail-closed cases`);
