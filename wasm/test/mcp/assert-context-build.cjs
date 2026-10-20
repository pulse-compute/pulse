#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const B = require('../../../scripts/pulse-context-build.cjs');
const F = require('../../../scripts/pulse-context-format.cjs');
const { canonical } = require('../../../scripts/pulse-context-corpus.cjs');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-build-test-'));
const receipt = { schemaVersion: 'pulse.context-build-test.v1', node: process.versions.node, cases: [] };
function test(name, fn) { fn(); receipt.cases.push(name); }
function put(dir, file, bytes) { const p = path.join(dir, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); }
function snapshot(dir) {
  const files = [];
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
      const file = path.join(relative, name), p = path.join(dir, file), stat = fs.lstatSync(p);
      if (stat.isSymbolicLink()) files.push([file, 'link:' + fs.readlinkSync(p)]);
      else if (stat.isDirectory()) walk(file);
      else files.push([file, F.hash(fs.readFileSync(p))]);
    }
  }
  walk(''); return files;
}
function cli(dir, args, env = {}) {
  return spawnSync(process.execPath, ['scripts/pulse-context-build.cjs', ...args], { cwd: dir, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, HOME: path.join(dir, 'no-home-cache'), NODE_OPTIONS: '', NODE_COMPILE_CACHE: '', ...env } });
}
function pass(result) { assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout); }
function failCheck(dir) {
  const before = snapshot(dir), result = cli(dir, ['--check']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(snapshot(dir), before, 'failure must leave every candidate byte untouched');
}
function main() {
  const built = B.construct(root), { corpus, config } = built, limits = config.limits;
  const data = F.encode(corpus, limits);
  test('current output closure', () => assert.equal(B.run().comparedFiles, 22));
  test('independent 02 fixture encoder agrees', () => {
    const old = require('../runtime/context-native-fixture.cjs').fixture(corpus);
    old.files.forEach(file => assert.deepEqual(file.bytes, data.files[file.path.slice(1)]));
  });
  test('manifest identities and scalar-only tables', () => {
    const m = built.outputs.get(B.MANIFEST);
    assert.equal(m.toString(), F.json(built.manifest) + '\n');
    assert(!built.manifest.outputs.some(o => o.path.endsWith('context-manifest.json')));
    const source = built.outputs.get(`${B.DIRECTORY}/context-metadata.ts`).toString();
    for (const c of F.CATEGORIES) assert(source.includes(JSON.stringify(corpus.records.map(r => r.category === c ? '1' : '0').join(''))));
    for (const r of corpus.records) if (r.content.length > 200) assert(!source.includes(JSON.stringify(r.content)));
    assert.equal(data.admission.serializedBytes, built.manifest.dimensions.serializedBytes);
  });
  const inputs = [...new Set([B.CONFIG, 'scripts/pulse-context-inputs.json', 'pnpm-lock.yaml', ...B.PRODUCER_SOURCES,
    ...B.COMPATIBILITY_SOURCES, ...corpus.sources.map(s => s.path)])].sort();
  const a = path.join(temp, 'first'), b = path.join(temp, 'unrelated', 'second');
  for (const [dir, files] of [[a, inputs], [b, [...inputs].reverse()]]) for (const file of files) put(dir, file, fs.readFileSync(path.join(root, file)));
  const preload = path.join(temp, 'reverse-enumeration.cjs');
  fs.writeFileSync(preload, "const fs=require('node:fs'),read=fs.readdirSync;fs.readdirSync=function(...a){return read.apply(this,a).reverse()};Math.random=()=>{throw Error('random used')};Date.now=()=>{throw Error('clock used')};\n");
  const environments = [{ LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, { LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Honolulu', NODE_OPTIONS: `--require=${preload}` }];
  test('two fresh independent roots, reverse creation/enumeration, locale/timezone/cache variation', () => {
    [a, b].forEach((dir, i) => {
      if (process.versions.node === config.producerNode) pass(cli(dir, ['--write'], environments[i]));
      else {
        assert.equal(cli(dir, ['--write'], environments[i]).status, 1, 'unqualified producer must not write');
        // A verifier may reconstruct expected bytes on its own Node; its receipt
        // names that execution version and never claims to be the pinned author.
        const script = "const fs=require('node:fs'),path=require('node:path'),b=require('./scripts/pulse-context-build.cjs').construct();for(const [p,v] of b.outputs){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v)}";
        const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...environments[i] } });
        assert.equal(result.status, 0, result.stderr);
      }
      const before = snapshot(dir), checked = pass(cli(dir, ['--check'], environments[i]));
      assert.deepEqual(snapshot(dir), before); assert.equal(checked.changedFiles, 0);
      assert.equal(checked.manifestSha256, F.hash(built.outputs.get(B.MANIFEST)));
    });
    for (const [file, expected] of built.outputs) {
      assert.deepEqual(fs.readFileSync(path.join(a, file)), expected);
      assert.deepEqual(fs.readFileSync(path.join(b, file)), expected);
    }
  });
  function changed(file, mutate, label = file) {
    test(`read-only stale rejection: ${label}`, () => {
      const p = path.join(a, file), original = fs.readFileSync(p);
      try { fs.writeFileSync(p, mutate(original)); failCheck(a); } finally { fs.writeFileSync(p, original); }
    });
  }
  for (const file of ['docs/getting-started.md', 'scripts/pulse-context-inputs.json', 'pnpm-lock.yaml', ...B.PRODUCER_SOURCES, ...B.COMPATIBILITY_SOURCES]) {
    changed(file, bytes => Buffer.concat([bytes, Buffer.from(file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.ts') ? '\n// source changed\n' : '\n')]));
  }
  function configChange(label, change) { changed(B.CONFIG, bytes => { const c = JSON.parse(bytes); change(c); return JSON.stringify(c); }, label); }
  configChange('weighting', c => c.encoder.fieldPresenceWeights.title++);
  configChange('normalization', c => c.encoder.caseFold = 'Unicode');
  configChange('producer', c => c.producerNode = '0.0.0');
  configChange('resource budget', c => c.limits.resourceTotalBytes--);
  changed('scripts/pulse-context-inputs.json', bytes => { const c = JSON.parse(bytes); c.snapshotStatus = 'released'; return JSON.stringify(c); }, 'status');
  changed('release/pulse-release-manifest.json', bytes => { const c = JSON.parse(bytes); c.releaseVersion = '0.0.0'; return JSON.stringify(c); }, 'version');
  for (const file of built.outputs.keys()) changed(file, bytes => { const c = Buffer.from(bytes); c[c.length - 1] ^= 1; return c; });
  test('missing and unexpected outputs, symlink destinations', () => {
    const file = path.join(a, B.DIRECTORY, 'text.bin'), bytes = fs.readFileSync(file);
    fs.unlinkSync(file); failCheck(a);
    fs.symlinkSync(path.join(b, B.DIRECTORY, 'text.bin'), file); failCheck(a); fs.unlinkSync(file); fs.writeFileSync(file, bytes);
    const extra = path.join(a, B.DIRECTORY, 'unexpected.bin'); fs.writeFileSync(extra, 'extra'); failCheck(a);
    const before = snapshot(a); assert.equal(cli(a, ['--write']).status, 1); assert.deepEqual(snapshot(a), before); fs.unlinkSync(extra);
  });
  test('missing/malformed source, source symlink', () => {
    const p = path.join(a, 'docs/getting-started.md'), bytes = fs.readFileSync(p);
    fs.unlinkSync(p); failCheck(a);
    fs.symlinkSync(path.join(b, 'docs/getting-started.md'), p); failCheck(a); fs.unlinkSync(p);
    fs.writeFileSync(p, Buffer.from([0xc0, 0xaf])); failCheck(a); fs.writeFileSync(p, bytes);
  });

  test('mixed generation and forged self-consistent manifest cannot pass', () => {
    const changed = structuredClone(corpus); changed.records[0].title += ' changed';
    const { corpusHash, ...snapshot } = changed;
    changed.corpusHash = F.hash(JSON.stringify(canonical(snapshot), null, 2));
    const other = F.encode(changed, limits).files;
    for (const name of F.FILES) {
      const original = fs.readFileSync(path.join(a, B.DIRECTORY, name));
      put(a, `${B.DIRECTORY}/${name}`, other[name]); failCheck(a);
      put(a, `${B.DIRECTORY}/${name}`, original);
    }
    const file = `${B.DIRECTORY}/vector.bin`, original = fs.readFileSync(path.join(a, file));
    const bytes = Buffer.from(original); bytes[bytes.length - 1] ^= 1;
    const m = structuredClone(built.manifest); m.outputs.find(o => o.path === 'context-data/vector.bin').sha256 = F.hash(bytes);
    for (const prefix of ['', B.MIRROR]) { put(a, prefix + file, bytes); put(a, prefix + B.MANIFEST, F.json(m) + '\n'); }
    failCheck(a);
    for (const [p, bytes] of built.outputs) put(a, p, bytes);
  });
  function corrupt(label, file, change) {
    test(`format rejection: ${label}`, () => {
      const files = Object.fromEntries(Object.entries(data.files).map(([k, v]) => [k, Buffer.from(v)]));
      files[file] = change(files[file]) || files[file];
      assert.throws(() => F.validateFiles(files, corpus, limits));
    });
  }
  const word = (offset, value) => bytes => { bytes.writeUInt32LE(value, offset); };
  for (const file of F.FILES) {
    corrupt(`${file} short header`, file, b => b.subarray(0, 40));
    corrupt(`${file} truncated section`, file, b => { const v = Buffer.from(b.subarray(0, b.length - 1)); v.writeUInt32LE(v.length, 16); return v; });
    corrupt(`${file} trailing bytes`, file, b => { const v = Buffer.concat([b, Buffer.from('x')]); v.writeUInt32LE(v.length, 16); return v; });
    corrupt(`${file} version`, file, word(8, 2));
    corrupt(`${file} magic`, file, b => { b[0] = 0; });
    corrupt(`${file} mixed hash`, file, b => { b[32] ^= 1; });
    corrupt(`${file} row count`, file, word(20, 1));
    corrupt(`${file} range overflow`, file, word(64, 0xffffffff));
  }
  const v = data.files['vector.bin'], dim = v.readUInt32LE(24), rowStart = 64 + dim * 8, entryStart = rowStart + corpus.records.length * 8;
  corrupt('nonfinite float bit pattern coordinate', 'vector.bin', word(entryStart + 4, 0x7f800000));
  for (const weight of [0, 20, 0xffffffff, 0x80000000]) corrupt(`weight ${weight}`, 'vector.bin', word(entryStart + 4, weight));
  corrupt('valid but wrong coordinate', 'vector.bin', word(entryStart + 4, v.readUInt32LE(entryStart + 4) === 1 ? 2 : 1));
  corrupt('unsorted entries', 'vector.bin', word(entryStart + 8, v.readUInt32LE(entryStart)));
  corrupt('term outside dimension', 'vector.bin', word(entryStart, dim));
  corrupt('row gap', 'vector.bin', word(rowStart, 1));
  corrupt('empty token', 'vector.bin', word(68, 0));
  corrupt('invalid token UTF-8', 'vector.bin', b => { b[b.readUInt32LE(64)] = 0xff; });
  corrupt('unsorted dictionary', 'vector.bin', b => { b[b.readUInt32LE(64)] = 0x7a; });
  corrupt('text invalid UTF-8', 'text.bin', b => { b[b.readUInt32LE(64)] = 0xff; });
  corrupt('wrong UTF16 count', 'text.bin', word(72, 0xffffffff));
  corrupt('reserved word', 'metadata.bin', word(24, 1));
  corrupt('metadata JSON', 'metadata.bin', b => { b[b.readUInt32LE(64)] = 0x78; });
  function recorpus(records) {
    const { corpusHash, ...snapshot } = structuredClone(corpus); snapshot.records = records;
    return { ...snapshot, corpusHash: F.hash(JSON.stringify(canonical(snapshot), null, 2)) };
  }
  function rejectedRecords(label, change) {
    test(`input rejection: ${label}`, () => { const records = structuredClone(corpus.records); change(records); assert.throws(() => F.encode(recorpus(records), limits)); });
  }
  rejectedRecords('duplicate IDs', r => r[1].id = r[0].id);
  rejectedRecords('mixed record version', r => r[0].pulseVersion = '0.0.0');
  rejectedRecords('unknown metadata field', r => r[0].surprise = true);
  rejectedRecords('malformed surrogate', r => r[0].title = '\ud800');
  rejectedRecords('unmapped source', r => r[0].source.sha256 = '0'.repeat(64));
  rejectedRecords('content hash', r => r[0].content += 'x');
  rejectedRecords('oversize token', r => r[0].title = 'x'.repeat(65));
  rejectedRecords('nonfinite numeric', r => r[0].source.startLine = Infinity);
  rejectedRecords('metadata budget', r => r[0].title = 'x '.repeat(4096));
  rejectedRecords('record count', r => { while (r.length <= limits.records) r.push(structuredClone(r[0])); });
  rejectedRecords('row term count', r => r[0].title = Array.from({ length: 1025 }, (_, i) => 't' + i).join(' '));
  test('all byte/count budgets apply jointly', () => {
    for (const field of ['records', 'vocabulary', 'termsPerRecord', 'tokenBytes', 'contentBytesPerRecord', 'metadataBytesPerRecord', 'canonicalCorpusBytes', 'resourceFileBytes', 'resourceTotalBytes', 'resourceSerializedBytes', 'resourceFiles', 'resourceBindings']) {
      assert.throws(() => F.encode(corpus, { ...limits, [field]: 1 }), field);
    }
  });
  test('exact Unicode, BOM, controls, empty text and maximum text', () => {
    const records = structuredClone(corpus.records.slice(0, 3));
    const content = '\ufeff\0"\\é😀\r\n';
    records[0].content = content; records[1].content = ''; records[2].content = '😀'.repeat(6144);
    records.forEach(r => r.contentSha256 = F.hash(r.content));
    const c = recorpus(records), files = F.encode(c, limits).files;
    assert.equal(F.validateFiles(files, c, limits).rows, 3);
    assert.deepEqual(require('../runtime/context-native-fixture.cjs').fixture(c).files.find(f => f.id === 'context.text').bytes, files['text.bin']);
  });

  test('512 rows, 4096 terms, 1024 entries per row; overflow rejects', () => {
    const terms = Array.from({ length: 4096 }, (_, i) => 't' + String(i).padStart(4, '0'));
    const records = Array.from({ length: 512 }, (_, i) => {
      const group = i % 4, id = terms[group * 1024 + Math.floor(i / 4)];
      const r = { ...structuredClone(corpus.records[0]), id, title: id, tags: [], content: terms.slice(group * 1024, (group + 1) * 1024).join(' ') };
      r.contentSha256 = F.hash(r.content); return r;
    }).sort((a, b) => F.compare(a.id, b.id));
    // All maximum rows together exceed the canonical-corpus budget: preserve
    // the independent byte cap rather than claiming this as an admitted input.
    assert.throws(() => F.encode(recorpus(records), limits), /corpus byte budget/);
    records.forEach((r, i) => { if (i >= 160) r.content = r.id; r.contentSha256 = F.hash(r.content); });
    // Cover all four dictionary partitions with complete rows.
    for (const i of [256, 384]) { records[i].content = terms.slice(i / 128 * 1024, (i / 128 + 1) * 1024).join(' '); records[i].contentSha256 = F.hash(records[i].content); }
    const c = recorpus(records), encoded = F.encode(c, limits);
    assert.equal(F.validateFiles(encoded.files, c, limits).dimension, 4096);
    const tooMany = structuredClone(records); tooMany[0].title += ' extravocabulary';
    assert.throws(() => F.encode(recorpus(tooMany), limits));
  });
  test('CLI invalid options never write', () => { const before = snapshot(a); assert.equal(cli(a, ['--repair']).status, 1); assert.deepEqual(snapshot(a), before); });
  receipt.manifestSha256 = F.hash(built.outputs.get(B.MANIFEST)); receipt.corpusHash = corpus.corpusHash;
  receipt.dimensions = built.manifest.dimensions; receipt.status = 'passed';
  console.log(JSON.stringify(receipt));
  console.log(`ok - ${receipt.cases.length} deterministic context build and strict admission cases`);
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
finally { fs.rmSync(temp, { recursive: true, force: true }); }
