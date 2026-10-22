'use strict';

// Offline, general byte admission for the selected sparse lexical format.
const { createHash } = require('node:crypto');
const { canonical } = require('./pulse-context-corpus.cjs');
const { createResourceManifest, admitResourceCatalogue } = require('../wasm/packages/contracts/src/resources/embedded.js');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(canonical(value));
const fail = message => { throw new Error(`Context format: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const tokens = text => text.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)).match(/[a-z0-9_]+/g) || [];
const CATEGORIES = ['command', 'contract', 'diagnostic', 'example', 'guide', 'package', 'target'];
const PAIRS = ['fastly/javascript', 'fastly/native', 'node/javascript', 'node/native', 'none/native'];
const FILES = ['vector.bin', 'text.bin', 'metadata.bin'];
const KEYS = ['applicability', 'category', 'contentSha256', 'id', 'pulseVersion', 'source', 'status', 'tags', 'title'];
function wellFormed(value) {
  if (typeof value === 'string') need(value.isWellFormed(), 'malformed Unicode');
  else if (Array.isArray(value)) value.forEach(wellFormed);
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { wellFormed(k); wellFormed(v); });
  else if (typeof value === 'number') need(Number.isFinite(value) && !Object.is(value, -0), 'invalid numeric value');
}
function metadataRecord(record, version, status) {
  need(record && typeof record === 'object' && json(Object.keys(record).sort()) === json(KEYS), 'metadata schema');
  wellFormed(record);
  need(typeof record.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(record.id), 'record ID');
  need(typeof record.title === 'string' && record.title.length > 0 && CATEGORIES.includes(record.category), 'record title/category');
  need(record.pulseVersion === version && record.status === status, 'mixed version/status');
  need(Array.isArray(record.tags) && record.tags.every(t => typeof t === 'string') && json(record.tags) === json([...new Set(record.tags)].sort(compare)), 'tags');
  need(Array.isArray(record.applicability) && record.applicability.length > 0, 'applicability');
  const pairs = record.applicability.map(p => {
    need(p && json(Object.keys(p).sort()) === '["provider","target"]', 'applicability schema');
    return `${p.provider}/${p.target}`;
  });
  need(pairs.every(p => PAIRS.includes(p)) && json(pairs) === json([...new Set(pairs)].sort(compare)), 'applicability order/pair');
  const s = record.source;
  need(s && ['path', 'selection', 'sha256', 'url'].every(k => typeof s[k] === 'string')
    && Object.keys(s).every(k => ['path', 'selection', 'sha256', 'url', 'startLine', 'endLine'].includes(k)), 'source schema');
  need(/^[a-zA-Z0-9._/-]+$/.test(s.path) && !s.path.startsWith('/') && !s.path.split('/').some(p => !p || p === '.' || p === '..')
    && s.selection.length > 0 && /^[a-f0-9]{64}$/.test(s.sha256)
    && /^https:\/\/api.github.com\/repos\/pulse-compute\/pulse\/git\/blobs\/[a-f0-9]{40}$/.test(s.url), 'source identity');
  if (s.startLine !== undefined || s.endLine !== undefined) need(Number.isSafeInteger(s.startLine) && s.startLine > 0 && Number.isSafeInteger(s.endLine) && s.endLine >= s.startLine, 'source range');
  need(/^[a-f0-9]{64}$/.test(record.contentSha256), 'content hash');
}
function validateCorpus(corpus, limits) {
  need(corpus?.schemaVersion === 'pulse.context-corpus.v1' && typeof corpus.pulseVersion === 'string' && corpus.pulseVersion.length > 0 && ['candidate', 'released'].includes(corpus.status), 'corpus schema/version/status');
  const { corpusHash, ...snapshot } = corpus;
  need(/^[a-f0-9]{64}$/.test(corpusHash) && hash(JSON.stringify(canonical(snapshot), null, 2)) === corpusHash, 'corpus identity');
  wellFormed(corpus);
  need(Buffer.byteLength(JSON.stringify(canonical(corpus), null, 2)) <= limits.canonicalCorpusBytes, 'corpus byte budget');
  need(Array.isArray(corpus.records) && corpus.records.length > 0 && corpus.records.length <= limits.records, 'record budget');
  let previous = '';
  for (const { content, ...record } of corpus.records) {
    metadataRecord(record, corpus.pulseVersion, corpus.status);
    need(record.id > previous, 'duplicate/unsorted IDs'); previous = record.id;
    need(typeof content === 'string' && content.isWellFormed() && Buffer.byteLength(content) <= limits.contentBytesPerRecord, 'content Unicode/byte budget');
    need(hash(content) === record.contentSha256, 'content hash mismatch');
    need(Buffer.byteLength(json(record)) <= limits.metadataBytesPerRecord, 'metadata byte budget');
    need(corpus.sources.some(s => s.path === record.source.path && s.sha256 === record.source.sha256 && s.url === record.source.url), 'source mapping mismatch');
  }
}
function encode(corpus, limits) {
  validateCorpus(corpus, limits);
  const rows = corpus.records.map(r => {
    const row = new Map();
    [r.id, r.title, r.tags.join(' '), r.content].forEach((field, i) => {
      for (const term of new Set(tokens(field))) {
        need(term.length <= limits.tokenBytes, 'token byte budget');
        row.set(term, (row.get(term) || 0) + [8, 6, 4, 1][i]);
      }
    });
    need(row.size > 0 && row.size <= limits.termsPerRecord, 'row nonzero budget');
    return row;
  });
  const terms = [...new Set(rows.flatMap(r => [...r.keys()]))].sort(compare);
  need(terms.length > 0 && terms.length <= limits.vocabulary, 'vocabulary budget');
  const ids = new Map(terms.map((t, i) => [t, i]));
  const entries = rows.map(r => [...r].map(([t, w]) => [ids.get(t), w]).sort((a, b) => a[0] - b[0]));
  const nonzeros = entries.reduce((sum, row) => sum + row.length, 0), count = rows.length;
  function header(size, magic) {
    need(Number.isSafeInteger(size) && size <= limits.resourceFileBytes && size <= 0xffffffff, 'resource byte budget');
    const b = Buffer.alloc(size); b.write(magic);
    [1, 64, size, count].forEach((v, i) => b.writeUInt32LE(v, 8 + 4 * i));
    Buffer.from(corpus.corpusHash, 'hex').copy(b, 32); return b;
  }
  const entryStart = 64 + terms.length * 8 + count * 8;
  let at = entryStart + nonzeros * 8;
  const vector = header(at + terms.reduce((sum, t) => sum + t.length, 0), 'PCTXV001');
  vector.writeUInt32LE(terms.length, 24); vector.writeUInt32LE(nonzeros, 28);
  terms.forEach((t, i) => { vector.writeUInt32LE(at, 64 + i * 8); vector.writeUInt32LE(t.length, 68 + i * 8); at += vector.write(t, at, 'ascii'); });
  let cursor = 0;
  entries.forEach((row, i) => {
    const dir = 64 + terms.length * 8 + i * 8;
    vector.writeUInt32LE(cursor, dir); vector.writeUInt32LE(row.length, dir + 4);
    for (const [term, weight] of row) { vector.writeUInt32LE(term, entryStart + cursor * 8); vector.writeUInt32LE(weight, entryStart + cursor++ * 8 + 4); }
  });
  function pack(values, width, magic) {
    const bytes = values.map(s => Buffer.from(s));
    let offset = 64 + count * width;
    const result = header(offset + bytes.reduce((sum, b) => sum + b.length, 0), magic);
    bytes.forEach((b, i) => {
      result.writeUInt32LE(offset, 64 + i * width); result.writeUInt32LE(b.length, 68 + i * width);
      if (width === 12) result.writeUInt32LE(values[i].length, 72 + i * width);
      b.copy(result, offset); offset += b.length;
    }); return result;
  }
  const files = { 'vector.bin': vector, 'text.bin': pack(corpus.records.map(r => r.content), 12, 'PCTXT001'),
    'metadata.bin': pack(corpus.records.map(({ content, ...r }) => json(r)), 8, 'PCTXM001') };
  return { files, terms, nonzeros, admission: admit(files, limits) };
}
function admit(files, limits) {
  need(json(Object.keys(files).sort()) === json([...FILES].sort()), 'unexpected/missing resource');
  const budgets = { files: limits.resourceFiles, fileBytes: limits.resourceFileBytes, totalBytes: limits.resourceTotalBytes, serializedBytes: limits.resourceSerializedBytes, bindings: limits.resourceBindings };
  const manifest = createResourceManifest(FILES.map(name => ({ path: '/' + name, bytes: files[name] })), budgets);
  const catalogue = admitResourceCatalogue(JSON.stringify(manifest), FILES.map(name => ({ id: 'context.' + name.split('.')[0], path: '/' + name })), budgets);
  return { manifestId: manifest.id, catalogueIdentity: catalogue.identity, rawBytes: catalogue.source.decodedBytes, serializedBytes: catalogue.source.serializedBytes, budgets };
}
// Separate parser checks every directory/section before reading it. Re-encoding
// authoritative records additionally rejects a self-consistent but wrong index.
function validateFiles(files, corpus, limits) {
  validateCorpus(corpus, limits);
  const admission = admit(files, limits);
  const n = corpus.records.length;
  function open(name, magic) {
    const b = files[name]; need(Buffer.isBuffer(b) && b.length >= 64, 'short header');
    need(b.subarray(0, 8).equals(Buffer.from(magic)), 'magic');
    need(b.readUInt32LE(8) === 1 && b.readUInt32LE(12) === 64 && b.readUInt32LE(16) === b.length && b.readUInt32LE(20) === n, 'header version/length/count');
    need(b.subarray(32, 64).toString('hex') === corpus.corpusHash, 'mixed corpus hash'); return b;
  }
  function range(b, offset, length) { need(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 64 && length >= 0 && offset <= b.length && length <= b.length - offset, 'section range/truncation'); }
  function utf8(b, offset, length) {
    range(b, offset, length);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b.subarray(offset, offset + length)); }
    catch { fail('invalid UTF-8'); }
  }
  const v = open('vector.bin', 'PCTXV001'), dimension = v.readUInt32LE(24), e = v.readUInt32LE(28);
  need(dimension > 0 && dimension <= limits.vocabulary && e <= n * limits.termsPerRecord, 'dimension/nonzero budget');
  const rowStart = 64 + dimension * 8, entryStart = rowStart + n * 8, tokenStart = entryStart + e * 8;
  range(v, 64, tokenStart - 64);
  let offset = tokenStart, prior = '';
  const terms = [];
  for (let i = 0; i < dimension; i++) {
    const start = v.readUInt32LE(64 + i * 8), size = v.readUInt32LE(68 + i * 8);
    need(start === offset && size > 0 && size <= limits.tokenBytes, 'token directory');
    const term = utf8(v, start, size);
    need(/^[a-z0-9_]+$/.test(term) && term > prior, 'duplicate/unsorted/invalid term');
    terms.push(term); prior = term; offset += size;
  }
  need(offset === v.length, 'vector trailing bytes');
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const first = v.readUInt32LE(rowStart + i * 8), count = v.readUInt32LE(rowStart + i * 8 + 4);
    need(first === cursor && count > 0 && count <= limits.termsPerRecord && count <= e - cursor, 'row directory');
    let last = -1;
    for (let k = 0; k < count; k++) {
      const term = v.readUInt32LE(entryStart + cursor * 8), weight = v.readUInt32LE(entryStart + cursor++ * 8 + 4);
      need(term > last && term < dimension && weight >= 1 && weight <= 19, 'coordinate'); last = term;
    }
  }
  need(cursor === e, 'unused entries');
  for (const [name, magic, width] of [['text.bin', 'PCTXT001', 12], ['metadata.bin', 'PCTXM001', 8]]) {
    const b = open(name, magic); need(b.readUInt32LE(24) === 0 && b.readUInt32LE(28) === 0, 'reserved header');
    range(b, 64, n * width); let end = 64 + n * width;
    for (let i = 0; i < n; i++) {
      const start = b.readUInt32LE(64 + i * width), size = b.readUInt32LE(68 + i * width);
      need(start === end && size <= (width === 12 ? limits.contentBytesPerRecord : limits.metadataBytesPerRecord), 'row offset/byte budget');
      const value = utf8(b, start, size); end += size;
      if (width === 12) {
        need(value.length === b.readUInt32LE(72 + i * width), 'UTF-16 length');
        need(hash(value) === corpus.records[i].contentSha256 && value === corpus.records[i].content, 'content mapping');
      } else {
        let record; try { record = JSON.parse(value); } catch { fail('metadata JSON'); }
        metadataRecord(record, corpus.pulseVersion, corpus.status);
        const { content, ...expected } = corpus.records[i];
        need(value === json(record) && value === json(expected), 'canonical metadata mapping');
      }
    }
    need(end === b.length, 'trailing bytes');
  }
  const expected = encode(corpus, limits);
  for (const name of FILES) need(files[name].equals(expected.files[name]), 'authoritative encoding mismatch');
  return { rows: n, dimension, nonzeros: e, dictionarySha256: hash(json(terms)), ...admission };
}
module.exports = { encode, validateFiles, validateCorpus, tokens, json, hash, compare, FILES, CATEGORIES, PAIRS };
