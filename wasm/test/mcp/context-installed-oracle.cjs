'use strict';
// Expected values come from the independent host-v1 handlers and direct lexical
// scan, never from the generated Native computations or the running server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { search, wholeBytes } = require('./context-search-oracle.cjs');
function expectations(consumer, output, corpus, manifest, extraCases = []) {
  const local = createRequire(path.join(consumer, 'package.json'));
  const ts = local('typescript');
  const oracle = path.join(output, 'oracle');
  fs.mkdirSync(path.join(oracle, 'src'), { recursive: true });
  fs.writeFileSync(path.join(oracle, 'package.json'), '{"type":"commonjs"}');
  for (const file of ['context-corpus.ts', 'corpus-version.ts', 'src/handlers.ts']) {
    fs.writeFileSync(path.join(oracle, file.replace(/\.ts$/, '.js')), ts.transpileModule(fs.readFileSync(path.join(consumer, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText);
  }
  const legacy = require(path.join(oracle, 'src/handlers.js'));
  const version = corpus.pulseVersion, cases = [];
  function expected(tool, args) {
    const input = { version, ...args };
    if (tool === 'search') return search(corpus, { applicationVersion: manifest.compatibility.applicationVersion, encoder: manifest.algorithm }, input);
    const result = JSON.parse(JSON.stringify(legacy[tool === 'diagnostic' ? 'explainDiagnostic' : tool](null, input)));
    result.meta.applicationVersion = manifest.compatibility.applicationVersion;
    if (result.status !== 'ok') return result;
    if (tool === 'read' && wholeBytes(result, version) > 24576) {
      const ends = [0]; for (const point of result.record.content) ends.push(ends.at(-1) + point.length);
      const candidate = n => ({ ...result, record: { ...result.record, content: result.record.content.slice(0, ends[n]), truncated: true, nextOffset: result.record.offset + ends[n] }, truncated: true, nextOffset: result.record.offset + ends[n] });
      let lo = 0, hi = ends.length - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (wholeBytes(candidate(mid), version) <= 24576) lo = mid; else hi = mid - 1; }
      assert(lo > 0); return candidate(lo);
    }
    if (tool === 'example') {
      const records = [];
      for (const record of result.records) {
        if (wholeBytes({ ...result, records: [...records, record], truncated: true, nextOffset: result.totalRecords }, version) > 24576) break;
        records.push(record);
      }
      if (!records.length && (input.offset ?? 0) < result.totalRecords) return { meta: result.meta, status: 'response-too-large', error: { code: 'record-requires-read', message: 'Retrieve the selected file as bounded pulse.read chunks using its corpus ID.' }, availableIds: result.availableIds, records: [], totalRecords: 0, truncated: false };
      const next = (input.offset ?? 0) + records.length, truncated = next < result.totalRecords;
      const { nextOffset, ...rest } = result;
      return { ...rest, records, truncated, ...(truncated ? { nextOffset: next } : {}) };
    }
    if (tool === 'diagnostic' && wholeBytes(result, version) > 24576) return { meta: result.meta, status: 'response-too-large', error: { code: 'response-too-large', message: 'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.' } };
    return result;
  }
  function add(tool, args) {
    const result = expected(tool, args);
    cases.push({ tool: 'pulse.' + tool, input: { version, ...args }, expected: result }); return result;
  }
  for (const goal of ['json-api', 'schema-api', 'fetch-api', 'router-api']) for (const target of ['native', 'javascript']) add('start', { goal, provider: 'node', target });
  for (const record of corpus.records) {
    let offset = 0, reconstructed = '';
    for (let page = 0; ; page++) {
      assert(page < 20);
      const result = add('read', { id: record.id, offset });
      assert.equal(result.status, 'ok'); reconstructed += result.record.content;
      assert.deepEqual(result.record.source, record.source);
      assert.equal(result.record.contentSha256, record.contentSha256);
      if (!result.truncated) break;
      assert(result.nextOffset > offset); offset = result.nextOffset;
    }
    assert.equal(reconstructed, record.content);
    if (record.category === 'diagnostic') add('diagnostic', { code: record.id.slice('diagnostic/'.length) });
  }
  for (const id of ['01-hello-json', '02-request-schema', '03-fetch-composition', '09-router-lowering']) {
    let offset = 0;
    for (let page = 0; ; page++) {
      assert(page < 20); const result = add('example', { id, offset });
      if (!result.truncated) break;
      assert(result.nextOffset > offset); offset = result.nextOffset;
    }
  }
  const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'context-quality-cases.json')));
  // Include every frozen query and every page, not just a first-page sample.
  for (const item of frozen.cases) {
    let offset = 0;
    for (let page = 0; ; page++) {
      assert(page < 513); const result = add('search', { ...item.input, offset });
      if (!result.truncated) break;
      assert(result.nextOffset > offset); offset = result.nextOffset;
    }
  }
  for (const [tool, args] of [['start', { goal: 'json-api', provider: 'node', target: 'native' }], ['read', { id: 'schema/registry' }], ['search', { query: 'schema' }], ['example', { id: '01-hello-json' }], ['diagnostic', { code: 'PULSE_SCHEMA_COMPILE_FAILED' }]]) add(tool, { ...args, version: 'not-bundled' });
  for (const item of extraCases) add(item.tool, item.input);
  return cases;
}
module.exports = { expectations };
