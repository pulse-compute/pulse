'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createResourceManifest, admitResourceCatalogue, resourceCatalogueSummary } = require('../../packages/contracts/src/resources/embedded.js');
const { selectEmbeddedAsset, EMBEDDED_ASSET_NATIVE_LIMITS } = require('../../packages/contracts/src/assets/embedded.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const budgets = Object.freeze({ files: 8, fileBytes: 2 * 1024 * 1024,
  totalBytes: 4 * 1024 * 1024, serializedBytes: 6 * 1024 * 1024, bindings: 16 });
const declarations = [{ id: 'payload', path: '/payload.bin' }];
const create = (bytes, limits = budgets) => createResourceManifest([{ path: '/payload.bin', bytes }], limits);
const admit = (manifest, bindings = declarations, limits = budgets) => admitResourceCatalogue(JSON.stringify(manifest), bindings, limits);
const reject = (fn, reason) => assert.throws(fn, error => error instanceof TypeError && error.reason === reason);
let cases = 0;
function check(name, run) { run(); cases++; console.log(`ok - ${name}`); }

async function main() {
  const { createEmbeddedManifest } = await import(pathToFileURL(path.resolve(__dirname, '../../../packages/assets/dist/embedded.js')));
  check('resource size budgets are independent; HTTP Assets stays fixed', () => {
    for (const size of [0, 1, 262144, 262145, 786432, 1048576, 1048577, 2097152]) {
      const input = Buffer.alloc(size, 0xa5);
      const manifest = create(input), catalogue = admit(manifest);
      assert.equal(catalogue.backingBytes, size);
      assert.equal(catalogue.records[0].sha256, hash(input));
      assert.deepEqual(Buffer.from(catalogue.blobs[0].data, 'base64'), input);
      if (size > EMBEDDED_ASSET_NATIVE_LIMITS.fileBytes) assert.throws(() => selectEmbeddedAsset(JSON.stringify(manifest), '/payload.bin'), /Invalid or oversized/);
      else assert.equal(selectEmbeddedAsset(JSON.stringify(manifest), '/payload.bin').embeddedLength, size);
    }
    reject(() => create(Buffer.alloc(budgets.fileBytes + 1)), 'file-bytes');
  });
  const bytes = Buffer.from([0, 255, 192, 128, 254, 1, 0, 127]);
  const manifest = create(bytes), serial = JSON.stringify(manifest);
  check('independent construction agrees with existing Assets identity', () => {
    const rebuilt = create(Uint8Array.from(bytes));
    assert.equal(JSON.stringify(rebuilt), serial);
    assert.equal(rebuilt.id, manifest.id);
  });
  const existing = await createEmbeddedManifest([{ path: '/payload.bin', bytes }]);
  assert.equal(existing.id, manifest.id);
  assert.equal(admit(existing).identity, admit(manifest).identity);
  console.log('ok - existing Assets constructor identity cross-check'); cases++;
  check('snapshot and deeply immutable transport', () => {
    const mutable = Uint8Array.from(bytes), snapshot = create(mutable);
    mutable.fill(42);
    assert.equal(snapshot.files[0].sha256, hash(bytes));
    assert.throws(() => snapshot.files[0].data = 'bad', TypeError);
    const catalogue = admit(snapshot);
    assert.throws(() => catalogue.blobs[0].data = 'bad', TypeError);
    assert.throws(() => catalogue.records.push({}), TypeError);
    const copy = Buffer.from(catalogue.blobs[0].data, 'base64'); copy.fill(0);
    assert.equal(catalogue.blobs[0].sha256, hash(bytes));
  });
  check('all budgets are required finite safe integers; no inherited defaults or read quota', () => {
    for (const field of Object.keys(budgets)) {
      for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '8', undefined]) {
        reject(() => create(bytes, { ...budgets, [field]: value }), 'budget');
      }
      const missing = { ...budgets }; delete missing[field]; reject(() => create(bytes, missing), 'shape');
    }
    reject(() => create(bytes, { ...budgets, readBytes: 4194304 }), 'shape');
  });
  check('exact budgets pass; every smaller budget fails before selection', () => {
    const exact = { files: 1, fileBytes: bytes.length, totalBytes: bytes.length, serializedBytes: Buffer.byteLength(serial), bindings: 1 };
    assert.equal(JSON.stringify(create(bytes, exact)), serial);
    assert.equal(admit(manifest, declarations, exact).backingBytes, bytes.length);
    for (const field of Object.keys(exact)) {
      assert.throws(() => admit(manifest, declarations, { ...exact, [field]: exact[field] - 1 }), TypeError);
      if (field !== 'bindings') assert.throws(() => create(bytes, { ...exact, [field]: exact[field] - 1 }), TypeError);
    }
    assert.equal(admitResourceCatalogue(JSON.stringify(createResourceManifest([], budgets)), [], { ...budgets, files: 0, bindings: 0, fileBytes: 0, totalBytes: 0 }).backingBytes, 0);
  });
  check('identity ignores declaration order; alias backing is not counted twice', () => {
    const input = [{ path: '/b', bytes }, { path: '/a', bytes }];
    const built = createResourceManifest(input, budgets);
    assert.equal(JSON.stringify(built), JSON.stringify(createResourceManifest([...input].reverse(), budgets)));
    const binds = [{ id: 'b', path: '/b' }, { id: 'a', path: '/a' }, { id: 'alias', path: '/a' }];
    const result = admit(built, binds);
    assert.equal(result.identity, admit(built, [...binds].reverse()).identity);
    assert.equal(result.backingBytes, bytes.length);
    assert.equal(result.blobs.length, 1);
    assert.equal(result.source.decodedBytes, bytes.length * 2);
    assert.notEqual(result.identity, admit(built, binds.slice(0, 2)).identity);
    assert.notEqual(result.identity, admit(built, [{ id: 'renamed', path: '/a' }]).identity);
    assert.notEqual(admit(built, [{ id: 'same', path: '/a' }]).identity, admit(built, [{ id: 'same', path: '/b' }]).identity);
    reject(() => createResourceManifest(input, { ...budgets, totalBytes: bytes.length }), 'total-bytes');
  });
  check('selected and unselected corruption, length, identity and base64 are rejected', () => {
    for (const mutate of [m => m.id = '0'.repeat(64), m => m.byteLength++, m => m.files[0].sha256 = '0'.repeat(64),
      m => m.files[0].byteLength++, m => m.files[0].data = m.files[0].data.slice(0, -4),
      m => m.files[0].data += '\n', m => m.files[0].extra = true,
      m => m.files[0].path = '/../escape', m => m.files[0].contentType = 'text/plain\n']) {
      const bad = structuredClone(manifest); mutate(bad);
      reject(() => admit(bad), 'manifest'); reject(() => admit(bad, []), 'manifest');
    }
    reject(() => admitResourceCatalogue(serial + '\n', declarations, budgets), 'manifest');
    reject(() => admitResourceCatalogue(serial.replace('"version":', '"extra":0,"extra":1,"version":'), declarations, budgets), 'manifest');
  });
  check('binding identity and path grammar are explicit', () => {
    reject(() => admit(manifest, [...declarations, ...declarations]), 'duplicate-id');
    reject(() => admit(manifest, [{ id: 'missing', path: '/absent' }]), 'missing');
    for (const id of ['', 'Upper', '../path', 'a'.repeat(65), '__proto__', 1]) reject(() => admit(manifest, [{ id, path: '/payload.bin' }]), 'logical-id');
    reject(() => admit(manifest, [{ id: 'x', path: '/a%2fb' }]), 'path');
    reject(() => admit(manifest, [{ id: 'x', path: '/payload.bin', extra: true }]), 'shape');
    reject(() => admit(manifest, new Array(1)), 'shape');
  });
  check('constructor rejects ambiguous inputs and accounts escaped UTF-8 metadata exactly', () => {
    reject(() => createResourceManifest(new Array(1), budgets), 'shape');
    const getter = { path: '/p', get bytes() { throw new Error('must not run'); } };
    reject(() => createResourceManifest([getter], budgets), 'shape');
    class LyingBytes extends Uint8Array { get byteLength() { return 0; } get length() { return 0; } }
    const lying = new LyingBytes(9);
    reject(() => create(lying, { ...budgets, fileBytes: 8 }), 'file-bytes');
    assert.equal(create(lying).byteLength, 9);
    const escaped = [{ path: '/é"data', bytes, contentType: 'application/"binary' }];
    const built = createResourceManifest(escaped, budgets), length = Buffer.byteLength(JSON.stringify(built));
    assert.equal(JSON.stringify(createResourceManifest(escaped, { ...budgets, serializedBytes: length })), JSON.stringify(built));
    reject(() => createResourceManifest(escaped, { ...budgets, serializedBytes: length - 1 }), 'serialized-bytes');
  });
  check('report projection omits payload and manifest paths; errors omit supplied content', () => {
    reject(() => resourceCatalogueSummary(JSON.parse(JSON.stringify(admit(manifest)))), 'catalogue');
    const summary = resourceCatalogueSummary(admit(manifest));
    assert.equal(summary.backingBytes, bytes.length);
    const output = JSON.stringify(summary);
    assert(!output.includes(manifest.files[0].data)); assert(!output.includes('/payload.bin'));
    assert(!output.includes('"data"'));
    try { admitResourceCatalogue('secret-payload-content', declarations, budgets); assert.fail('expected rejection'); }
    catch (error) { assert.equal(error.reason, 'manifest'); assert(!JSON.stringify(error).includes('secret-payload-content')); }
  });
  console.log(JSON.stringify({ status: 'passed', cases, generatedInputMaximumBytes: budgets.fileBytes, actualMcpFixture: 'not-qualified' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
