#!/usr/bin/env node
'use strict';
// Run one input per fresh process. This is measurement tooling, not admission.
// Usage: node --expose-gc .../measure-report-normalization.cjs INPUT [--oversize-codec-only]
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const zlib = require('node:zlib'), crypto = require('node:crypto');
const root = '../../packages/cli/src/internal/report/';
const codec = require(root + 'encoding'), capsule = require(root + 'capsule');
const { renderReport } = require(root + 'viewer');
const { createReportViewModel } = require(root + 'viewer/model');
const input = fs.readFileSync(process.argv[2], 'utf8'), oversize = process.argv[3] === '--oversize-codec-only';
if (process.argv[3] === '--model-runtime') {
  const start = performance.now(), wire = JSON.parse(input), normalized = wire.kind === codec.KIND;
  const value = normalized ? codec.decode(wire) : wire;
  const model = createReportViewModel(value);
  // The previous viewer eagerly constructed its canonical export on startup.
  if (!normalized) assert.ok(model.canonicalJson.length);
  const rows = model.filteredRoutes();
  console.log(JSON.stringify({ representation: normalized ? 'normalized' : 'expanded',
    modelStartupMs: +(performance.now() - start).toFixed(2), peakRssKiB: process.resourceUsage().maxRSS,
    routes: rows.length, evidenceHash: value.evidenceHash.value,
    scope: 'fresh Node process: read, JSON parse, decode if normalized, view model and initial route projection; no DOM/layout/paint' }));
  process.exit(0);
}
const value = JSON.parse(input), raw = codec.stringify(value) + '\n';
const timed = fn => { const start = performance.now(), value = fn(); return { value, ms: +(performance.now() - start).toFixed(2) }; };
const size = text => ({ raw: Buffer.byteLength(text), gzip: zlib.gzipSync(text, { level: 9 }).length,
  brotli: zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length });
const encode = timed(() => codec.stringify(codec.encode(value)) + '\n'), normalized = encode.value;
let decoder = codec, wire = JSON.parse(normalized);
if (oversize) {
  assert.throws(() => codec.decode(wire), { code: 'REPORT_LIMIT' });
  // Explicitly isolated experiment: no product API can override its limits.
  // Allows measuring the historical oversized Catalog prototype without
  // claiming that it is admitted by the shipping report reader.
  const context = vm.createContext({});
  const source = fs.readFileSync(require.resolve(root + 'encoding'), 'utf8')
    .replace('bytes: 16 * 1024 * 1024', 'bytes: 64 * 1024 * 1024').replace('nodes: 500000', 'nodes: 2000000');
  decoder = vm.runInContext(source + '\nreportEncoding', context);
  wire = vm.runInContext('(' + normalized + ')', context);
}
const decode = timed(() => decoder.decode(wire));
assert.equal(decoder.stringify(decode.value) + '\n', raw);
const validation = oversize ? null : timed(() => capsule.validateCapsule(decode.value));
const parseRaw = timed(() => JSON.parse(raw));
const parseNormalized = timed(() => JSON.parse(normalized));
const model = oversize ? null : timed(() => createReportViewModel(decode.value));
const html = oversize ? null : timed(() => renderReport(value));
const escaped = text => text.replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
// Same current shell/scripts: isolates storage savings from UI changes. Does
// not claim to be a previous release's total HTML or browser first paint.
const rawHtml = html?.value.replace(/(<script id="pulse-report-data" type="application\/json">)[\s\S]*?(<\/script>)/,
  (_, start, end) => start + escaped(raw) + end);
const strings = new Map(); let stringOccurrences = 0, stringBytes = 0;
function visit(v) {
  if (typeof v === 'string') { const bytes = Buffer.byteLength(JSON.stringify(v)); strings.set(v, bytes); stringOccurrences++; stringBytes += bytes; }
  else if (v && typeof v === 'object') Object.values(v).forEach(visit);
}
visit(value);
const result = {
  sourceSha256: crypto.createHash('sha256').update(input).digest('hex'), node: process.version,
  producer: value.producer, context: value.context, provenance: value.provenance,
  scope: oversize ? 'codec-only, isolated 64 MiB/2M-node experiment; production rejects original and normalized expansion' : 'production-admitted capsule',
  json: { before: size(raw), after: size(normalized), rawSavingsPercent: +(100 * (1 - Buffer.byteLength(normalized) / Buffer.byteLength(raw))).toFixed(2) },
  embeddedData: { before: size(escaped(raw)), after: size(escaped(normalized)) },
  htmlSameShell: html ? { before: size(rawHtml), after: size(html.value) } : null,
  retainedInventory: oversize ? null : { before: Buffer.byteLength(raw), after: Buffer.byteLength(capsule.serializeStoredCapsule(value)), otherSidecars: 'unchanged' },
  counts: { nodes: wire.nodes.length, shapes: wire.shapes.length, stringOccurrences, distinctStrings: strings.size,
    stringBytes, distinctStringBytes: [...strings.values()].reduce((a,b) => a+b, 0) },
  collections: Object.fromEntries(Object.entries(value).filter(([,v]) => v && typeof v === 'object').map(([k,v]) => [k, Buffer.byteLength(JSON.stringify(v))])),
  ms: { encode: encode.ms, parseRaw: parseRaw.ms, parseNormalized: parseNormalized.ms, decode: decode.ms,
    validation: validation?.ms ?? null, initialViewModel: model?.ms ?? null, standaloneHtmlRender: html?.ms ?? null,
    browserFirstPaint: null },
  peakRssKiB: process.resourceUsage().maxRSS,
  memoryScope: 'fresh process high-water RSS for both representations, encoding, exact roundtrip assertion, rendering and compression; not isolated codec allocation',
};
console.log(JSON.stringify(result, null, 2));
