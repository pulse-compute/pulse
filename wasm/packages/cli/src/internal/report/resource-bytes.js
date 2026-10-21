'use strict';
const { inspectWasm } = require('@pulse-compute/wasm-build-support/files');
const { sha256, fail } = require('./data');

// Build-only, content-addressed proof of disjoint raw payload ranges. Tiny,
// missing, repeated, overlapping or transformed patterns remain unknown. This
// does not instantiate a module or measure runtime backing/heap copies.
function observeResourceBytes(capsule, prepared) {
  const summary = capsule.binaryResources;
  if (!summary) return;
  const bytes = prepared.native.wasm;
  if (!bytes) return;
  const artifact = capsule.artifacts.find(row => row.sha256 === sha256(bytes) && row.bytes === bytes.length);
  if (!artifact) return;
  const ranges = inspectWasm(bytes, { dataRanges: true }).dataRanges;
  if (!ranges) return;
  const catalogue = prepared.compiled.binaryResources;
  const selected = summary.backings.filter(row => row.selected), observed = [];
  let work = 0;
  for (const backing of selected) {
    if (backing.byteLength === 0) continue;
    if (backing.byteLength < 32) return;
    const blob = catalogue?.blobs.find(row => row.id === backing.id);
    if (!blob) return;
    const payload = Buffer.from(blob.data, 'base64');
    const matches = [];
    for (const range of ranges) {
      work += range.bytes;
      if (work > 256 * 1024 * 1024) return;
      const data = bytes.subarray(range.offset, range.offset + range.bytes);
      const first = data.indexOf(payload);
      if (first >= 0) {
        if (data.indexOf(payload, first + 1) >= 0) return;
        matches.push({ backingId: backing.id, offset: range.offset + first, bytes: payload.length });
      }
    }
    if (matches.length !== 1) return;
    observed.push(matches[0]);
  }
  observed.sort((a, b) => a.offset - b.offset);
  if (observed.some((row, i) => i && observed[i - 1].offset + observed[i - 1].bytes > row.offset)) return;
  const { stableReportId: id } = require('./capsule');
  const evidenceId = id('evidence', 'binary-payload:' + artifact.id);
  capsule.evidence.push({ id: evidenceId, kind: 'measurement', producer: { name: 'pulse-report-binary-payload', version: '1' },
    method: 'disjoint-raw-data-ranges-v1', artifactIds: [artifact.id], source: null, subjectIds: [], result: 'observed',
    scope: { corpus: null, cases: [], targets: ['native'] }, recordedAt: null });
  summary.observedArtifactId = artifact.id; summary.observedRanges = observed;
  summary.observedBackingBytes = { state: 'available', basis: 'measured', coverage: 'exact',
    value: observed.reduce((n, row) => n + row.bytes, 0), reason: null, evidenceIds: [evidenceId] };
}
function verifyResourceBytes(summary, artifact, bytes, physical) {
  if (summary?.observedArtifactId !== artifact.id) return 0;
  const ranges = physical.dataRanges;
  if (!ranges) fail('REPORT_RESOURCE_METRICS');
  let work = 0;
  for (const row of summary.observedRanges) {
    if (!ranges.some(range => row.offset >= range.offset && row.offset + row.bytes <= range.offset + range.bytes)) fail('REPORT_RESOURCE_METRICS');
    const payload = bytes.subarray(row.offset, row.offset + row.bytes);
    const backing = summary.backings.find(b => b.id === row.backingId);
    if (sha256(payload) !== backing.sha256) fail('REPORT_RESOURCE_METRICS');
    let count = 0;
    for (const range of ranges) {
      work += range.bytes;
      if (work > 256 * 1024 * 1024) fail('REPORT_RESOURCE_METRICS');
      const data = bytes.subarray(range.offset, range.offset + range.bytes), first = data.indexOf(payload);
      if (first >= 0) { count++; if (data.indexOf(payload, first + 1) >= 0) count++; }
    }
    if (count !== 1) fail('REPORT_RESOURCE_METRICS');
  }
  return summary.observedBackingBytes.value;
}
module.exports = { observeResourceBytes, verifyResourceBytes };
