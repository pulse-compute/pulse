'use strict';
const assert = require('node:assert/strict');
const f = require('./report-fixtures.cjs');
const { createCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { compareCapsules, parseComparison, serializeComparison } = require('../../packages/cli/src/internal/report/comparison');
module.exports = function () {
  const base = f.fixture(false);
  base.context.host = 'fastly'; base.artifacts[0].host = 'fastly'; base.artifacts[0].target = 'fastly-compute-native';
  const selected = structuredClone(base), declared = { module: 'fastly_http_req', name: 'redirect_to_grip_proxy_v2', parameters: ['i32', 'i32', 'i32'], results: ['i32'] };
  selected.hostExtensions = [{ id: f.id('host-extension', 'outside:transfer'), contributionId: 'outside:transfer', package: 'outside',
    contractId: 'outside.contract', operation: 'transfer', protocol: 'pulse.host-extension.v1', service: 'terminal-request-backend.v1',
    target: { provider: 'fastly', target: 'native', targetId: 'fastly-compute-native' }, source: { file: 'src/index.ts', line: 2, column: 3 },
    sourceSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), artifactId: f.aid,
    declaredImports: [declared], observedImports: [structuredClone(declared)], evidenceIds: [f.buildId] }];
  selected.coverage.hostExtensions = f.coverage(1);
  const compare = (a, b) => compareCapsules(createCapsule(a), createCapsule(b));
  const inventory = result => result.summary.inventories.find(row => row.collection === 'hostExtensions');
  assert.equal(inventory(compare(base, selected)).counts.unresolvedAfter, 1, 'historical absence is unknown, not zero');
  base.hostExtensions = []; base.coverage.hostExtensions = f.coverage(0);
  assert.equal(inventory(compare(base, selected)).counts.added, 1);
  assert.equal(inventory(compare(selected, base)).counts.removed, 1);
  assert.equal(inventory(compare(selected, selected)).counts.unchanged, 1);
  const changed = structuredClone(selected); changed.hostExtensions[0].sourceSha256 = 'c'.repeat(64);
  const comparison = compare(selected, changed);
  assert.equal(inventory(comparison).counts.modified, 1);
  assert.equal(comparison.sections.find(row => row.collection === 'hostExtensions').changes[0].fields[0].path, '/sourceSha256');
  assert.deepEqual(parseComparison(serializeComparison(comparison)), comparison);
  const capsule = createCapsule(selected);
  assert.equal(capsule.provenance.sourceFingerprint, null);
  assert(!capsule.evidence.some(row => row.kind === 'test'));
  for (const mutate of [
    c => { c.hostExtensions[0].artifactId = 'missing'; },
    c => { c.hostExtensions[0].target.provider = 'node'; },
    c => { c.hostExtensions[0].observedImports[0].results = []; },
    c => { c.hostExtensions[0].observedImports = []; },
    c => { c.hostExtensions[0].declaredImports.push(declared); },
    c => { c.hostExtensions[0].evidenceIds = []; },
    c => { delete c.coverage.hostExtensions; }
  ]) { const c = structuredClone(selected); mutate(c); assert.throws(() => createCapsule(c)); }
  // Exercise the collector boundary with real import bytes, independently of a
  // provider compiler. A manifest/audit of other bytes cannot be reused.
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { sha256 } = require('../../packages/cli/src/internal/report/data');
  const contract = require('../../packages/contracts/src/provider/toolchain').hostExtensions;
  const { readHostExtensions } = require('../../packages/cli/src/internal/report/host-extensions');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hex04-report-'));
  try {
    const str = value => [Buffer.byteLength(value), ...Buffer.from(value)];
    const imp = [1, ...str(declared.module), ...str(declared.name), 0, 0];
    const bytes = Buffer.from([0,97,115,109,1,0,0,0, 1,8,1,96,3,127,127,127,1,127, 2,imp.length,...imp]);
    assert(WebAssembly.validate(bytes));
    const source = 'function __outside(a:i32,b:i32,c:i32):i32 { return 0; }';
    const contribution = { version: contract.VERSION, kind: 'host-extension', mediaType: 'text/assemblyscript',
      id: 'outside:transfer', package: 'outside', contractId: 'outside.contract', data: { target: selected.hostExtensions[0].target,
        operation: 'transfer', service: contract.TERMINAL_SERVICE, source, sha256: sha256(source), entry: '__outside', imports: [declared] } };
    const manifest = { hostExtensionPolicy: contract.composeImportPolicy([], [contribution]), hostExtensions: [{ ...contribution,
      operation: 'transfer', target: contribution.data.target, service: contribution.data.service, sha256: sha256(source), imports: [declared] }] };
    const artifact = { file: 'main.wasm', sha256: sha256(bytes), id: 'artifact:' + sha256(bytes) };
    const prepared = { plan: { effects: [{ kind: 'host.extension', package: 'outside', contractId: 'outside.contract', operation: 'transfer' }] }, providerNativeManifest: path.join(directory, 'manifest.json') };
    fs.writeFileSync(path.join(directory, artifact.file), bytes);
    const write = value => fs.writeFileSync(prepared.providerNativeManifest, JSON.stringify(value));
    write(manifest);
    assert.deepEqual(readHostExtensions(prepared, directory, artifact)[0].observedImports, [declared]);
    assert.equal(readHostExtensions({ plan: prepared.plan }, directory, artifact), null);
    assert.deepEqual(readHostExtensions({ plan: { effects: [] } }, directory, artifact), []);
    assert.throws(() => readHostExtensions(prepared, directory, { ...artifact, sha256: '0'.repeat(64) }), error => error.code === 'REPORT_ARTIFACT_HASH');
    const wrong = structuredClone(manifest); wrong.hostExtensions[0].sha256 = '0'.repeat(64); write(wrong);
    assert.throws(() => readHostExtensions(prepared, directory, artifact), error => error.code === 'REPORT_IDENTITY');
    const forged = structuredClone(manifest); forged.hostExtensionPolicy.sha256 = '0'.repeat(64); write(forged);
    assert.throws(() => readHostExtensions(prepared, directory, artifact), error => error.code === 'PULSE_HOST_EXTENSION_IMPORT');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log('ok - HEX-04 host extension attribution, import separation, historical coverage and semantic compare');
};
