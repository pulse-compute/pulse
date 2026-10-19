#!/usr/bin/env node
'use strict';

// Design calculator only. It does not emit the production resources, implement
// a Native handler, or replace the independent builder/decoder proofs in 02/03/06.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('./contract.json');
const root = path.resolve(__dirname, '../../..');
const sourcePath = 'examples/12-pulse-context-mcp/context-corpus.ts';
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const start = source.indexOf('export const contextCorpus = freeze(');
assert.notEqual(start, -1);
const corpus = JSON.parse(source.slice(start + 'export const contextCorpus = freeze('.length, source.lastIndexOf(' as const);')));
assert.equal(corpus.corpusHash, contract.corpusHash, 'Rebaseline explicitly when the corpus changes');
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const tokens = text => text.replace(/[A-Z]/g, c => c.toLowerCase()).match(/[a-z0-9_]+/g) || [];
function query(text) {
  assert.ok(Buffer.byteLength(text) <= contract.limits.queryBytes, 'query bytes');
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), 'ASCII query required');
  const result = tokens(text);
  assert.ok(result.length > 0 && result.length <= contract.limits.queryTermsBeforeDeduplication, 'query terms');
  assert.ok(result.every(t => t.length <= contract.limits.tokenBytes), 'token bytes');
  return [...new Set(result)].sort(cmp);
}
const fields = r => [r.id, r.title, r.tags.join(' '), r.content];
const weights = ['id', 'title', 'tags', 'content'].map(k => contract.encoder.fieldPresenceWeights[k]);
const rows = [...corpus.records].sort((a, b) => cmp(a.id, b.id)).map(record => {
  const vector = new Map();
  fields(record).forEach((field, i) => {
    for (const token of new Set(tokens(field))) vector.set(token, (vector.get(token) || 0) + weights[i]);
  });
  return { record, vector };
});
const vocabulary = [...new Set(rows.flatMap(r => [...r.vector.keys()]))].sort(cmp);
const termCount = rows.reduce((sum, r) => sum + r.vector.size, 0);
const textBytes = rows.reduce((sum, r) => sum + Buffer.byteLength(r.record.content), 0);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort(cmp).map(k => [k, canonical(value[k])])) : value;
const metadata = rows.map(({ record }) => {
  const { content, ...rest } = record;
  return Buffer.from(JSON.stringify(canonical(rest)), 'utf8');
});
const metadataBytes = metadata.reduce((sum, bytes) => sum + bytes.length, 0);
const dictionaryBytes = vocabulary.reduce((sum, word) => sum + word.length, 0);
const counts = {
  records: rows.length, vocabulary: vocabulary.length, nonzeroEntries: termCount,
  maxTermsPerRecord: Math.max(...rows.map(r => r.vector.size)),
  maxTokenBytes: Math.max(...vocabulary.map(t => t.length)),
  maxContentBytes: Math.max(...rows.map(r => Buffer.byteLength(r.record.content))),
  maxMetadataBytes: Math.max(...metadata.map(b => b.length)),
  dictionaryBytes, textBytes, metadataBytes,
  vectorBytes: 64 + vocabulary.length * 8 + rows.length * 8 + termCount * 8 + dictionaryBytes,
  textResourceBytes: 64 + rows.length * 12 + textBytes,
  metadataResourceBytes: 64 + rows.length * 8 + metadataBytes
};
assert.ok(counts.records <= contract.limits.records);
assert.ok(counts.vocabulary <= contract.limits.vocabulary);
assert.ok(counts.maxTermsPerRecord <= contract.limits.termsPerRecord);
assert.ok(counts.maxTokenBytes <= contract.limits.tokenBytes);
assert.ok(counts.maxContentBytes <= contract.limits.contentBytesPerRecord);
assert.ok(counts.maxMetadataBytes <= contract.limits.metadataBytesPerRecord);
for (const key of ['vectorBytes', 'textResourceBytes', 'metadataResourceBytes']) assert.ok(counts[key] <= contract.limits.resourceFileBytes);
counts.totalResourceBytes = counts.vectorBytes + counts.textResourceBytes + counts.metadataResourceBytes;
assert.ok(counts.totalResourceBytes <= contract.limits.resourceTotalBytes);
const rank = hits => hits.sort((a, b) => b.score - a.score || cmp(a.id, b.id));
function sparseSearch(q, filter = () => true) {
  return rank(rows.filter(r => filter(r.record) && q.every(t => r.vector.has(t)))
    .map(r => ({ id: r.record.id, score: q.reduce((sum, t) => sum + r.vector.get(t), 0) })));
}
function directSearch(q, filter = () => true) {
  // Independent membership calculation; no map, vocabulary IDs or sparse rows.
  const out = [];
  for (const record of corpus.records) {
    if (!filter(record)) continue;
    const lists = fields(record).map(tokens);
    if (!q.every(t => lists.some(list => list.includes(t)))) continue;
    let score = 0;
    for (let i = 0; i < lists.length; i++) for (const t of q) if (lists[i].includes(t)) score += weights[i];
    out.push({ id: record.id, score });
  }
  return rank(out);
}
const fixtures = [
  ['compile', 'command/compile'],
  ['schema declarations', 'contract/schema-declarations'],
  ['parallel', 'contract/parallel'],
  ['PULSE_BINARY_RESOURCE_INVALID', 'diagnostic/PULSE_BINARY_RESOURCE_INVALID'],
  ['PULSE_FETCH_TIMEOUT', 'diagnostic/PULSE_FETCH_TIMEOUT'],
  ['fetch json', 'contract/fetch-json'],
  ['current beta targets', 'contract/targets'],
  ['providers targets eligibility', 'contract/eligibility']
];
const queries = fixtures.map(([text, expected]) => {
  const q = query(text), hits = sparseSearch(q);
  assert.deepEqual(hits, directSearch(q), text);
  assert.ok(hits.slice(0, 5).some(h => h.id === expected), `Expected relevant top-five result: ${text} -> ${expected}`);
  return { query: text, terms: q, expectedRelevantId: expected, totalMatches: hits.length, top5: hits.slice(0, 5) };
});
for (const term of vocabulary) assert.deepEqual(sparseSearch([term]), directSearch([term]), term);
for (const [text] of fixtures) {
  const filter = r => r.category === 'contract' && r.applicability.some(p => p.provider === 'fastly' && p.target === 'native');
  assert.deepEqual(sparseSearch(query(text), filter), directSearch(query(text), filter));
}
assert.deepEqual(query('PARALLEL parallel'), ['parallel']);
assert.deepEqual(query('@pulse-compute/pulse'), ['compute', 'pulse']);
assert.deepEqual(sparseSearch(query('zzzz_missing_term')), []);
for (const invalid of ['', '...', 'é', '\ud800', 'a'.repeat(65), 'a b c d e f g h i', ' '.repeat(257)]) assert.throws(() => query(invalid));
const report = {
  schemaVersion: 'pulse.context-native-design-measurement.v1',
  sourceRevision: contract.sourceRevision, corpusHash: corpus.corpusHash,
  source: { path: sourcePath, sha256: crypto.createHash('sha256').update(source).digest('hex') },
  encoder: contract.encoder.id, counts,
  oracleComparisons: { vocabularySingles: vocabulary.length, multiTerm: fixtures.length, filtered: fixtures.length },
  queries,
  limitations: ['Node design calculator only', 'No serialized-resource parser or corruption proof',
    'No Native compilation, deadline, allocation or Fastly measurement',
    'Eight relevance cases are smoke evidence; the held-out 06 quality gate remains open']
};
const serialized = JSON.stringify(report, null, 2) + '\n';
if (process.argv.length === 3 && process.argv[2] === '--check') {
  assert.equal(fs.readFileSync(path.join(__dirname, 'measurement.json'), 'utf8'), serialized, 'stale design measurement');
  console.log(JSON.stringify({ status: 'passed', counts, oracleComparisons: report.oracleComparisons }));
} else if (process.argv.length === 2) process.stdout.write(serialized);
else throw new Error('Usage: node docs/internal/b10-mcp-01/measure.cjs [--check]');
