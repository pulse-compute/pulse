'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { instrument, canonicalJson, sha256 } = require('./vis06-derivation.cjs');

// Compare every consumer against the unchanged canonical algorithm, retaining
// at most one consumer's oracle/projection at a time. Consumer identity is part
// of association identity, so partitions cannot deduplicate each other's rows.
function qualify(analytics, queries, bindingIds, progress = () => {}) {
  const started = performance.now(), sites = new Map(analytics.useSites.map(s => [s.id, s]));
  const ids = [...new Set([...bindingIds, ...queries.bindingIds])].sort();
  const bindingConsumers = new Map(ids.map(id => [id, new Set()]));
  const usedSites = new Set(), paths = new Set(), digests = [], comparisons = [];
  const totals = { consumersCompared: 0, consumersWithRows: 0, consumersWithBindingRows: 0,
    rows: 0, consumerSitePairs: 0, emissionAttempts: 0, duplicates: 0, maxPathHops: 0,
    rawAssociationArrayBytes: 2 };
  const timings = { oracleMs: 0, projectionMs: 0, equalityMs: 0, digestAndCountsMs: 0 };
  let reason = null, unavailable = false, exhausted = true, heapPeak = 0;
  for (const consumer of analytics.registrations) {
    const probe = instrument({ unrestricted: true, focus: consumer.id });
    const oracleStart = performance.now(), oracle = probe.derive(analytics);
    const oracleMs = performance.now() - oracleStart;
    const projectionStart = performance.now(), rows = queries.route(consumer.id);
    const projectionMs = performance.now() - projectionStart;
    const equalityStart = performance.now();
    assert.deepEqual(rows, oracle.rows, `Whole-row parity failed for ${consumer.id}`);
    const equalityMs = performance.now() - equalityStart;
    const digestStart = performance.now(), hash = createHash('sha256').update('[');
    const consumerSites = new Set(), consumerBindings = new Set();
    let rawBytes = 2;
    for (const [index, row] of oracle.rows.entries()) {
      // Streaming the canonical array avoids making a multi-GB JSON string.
      // Each trusted generated row still uses the canonical bounded serializer.
      const text = canonicalJson(row);
      if (index) hash.update(','); hash.update(text);
      rawBytes += Buffer.byteLength(text) + (index ? 1 : 0);
      consumerSites.add(row.useSiteId); usedSites.add(row.useSiteId);
      paths.add(JSON.stringify(row.via));
      const binding = sites.get(row.useSiteId).binding.bindingId;
      if (binding) {
        assert.ok(bindingConsumers.has(binding), 'Oracle binding absent from inventory/query index');
        bindingConsumers.get(binding).add(consumer.id); consumerBindings.add(binding);
      }
    }
    const digest = hash.update(']').digest('hex'); digests.push([consumer.id, digest]);
    const digestAndCountsMs = performance.now() - digestStart;
    const counters = probe.stats.counters;
    totals.consumersCompared++;
    if (rows.length) {
      totals.rawAssociationArrayBytes += rawBytes - 2 + (totals.rows ? 1 : 0);
      totals.consumersWithRows++;
    }
    if (consumerBindings.size) totals.consumersWithBindingRows++;
    totals.rows += rows.length; totals.consumerSitePairs += consumerSites.size;
    totals.emissionAttempts += counters.emissionAttempts; totals.duplicates += counters.duplicates;
    totals.maxPathHops = Math.max(totals.maxPathHops, counters.maxPathHops);
    for (const [name, value] of Object.entries({ oracleMs, projectionMs, equalityMs, digestAndCountsMs })) timings[name] += value;
    reason ||= oracle.coverage.reason;
    unavailable ||= oracle.coverage.status === 'unavailable';
    exhausted &&= counters.consumersFinished === 1 && oracle.coverage.reason !== 'graph-budget-exhausted';
    heapPeak = Math.max(heapPeak, probe.stats.sampledHeapBytes, process.memoryUsage().heapUsed);
    comparisons.push({ consumer: consumer.id, kind: consumer.kind, rows: rows.length,
      coverage: oracle.coverage, canonicalRowsSha256: digest, rawArrayBytes: rawBytes,
      oracleMs, projectionMs, equalityMs, digestAndCountsMs, semanticParity: true });
    progress({ stage: 'qualify-consumers', counters: { ...totals, sampledHeapBytes: heapPeak } });
  }
  const bindingStart = performance.now(), bindingComparisons = [];
  for (const id of ids) {
    const expected = [...bindingConsumers.get(id)].sort(), actual = queries.binding(id);
    assert.deepEqual(actual, expected, `Binding reverse parity failed for ${id}`);
    bindingComparisons.push({ binding: id, consumers: expected.length,
      consumersSha256: sha256(canonicalJson(expected)), semanticParity: true });
  }
  timings.bindingParityMs = performance.now() - bindingStart;
  totals.representedUseSites = usedSites.size; totals.distinctPaths = paths.size;
  totals.extraPathRows = totals.rows - totals.consumerSitePairs;
  return { comparisonComplete: true, oracleDerivationExhausted: exhausted,
    semanticParity: 'every consumer whole row and every binding consumer set',
    scope: 'factoring equivalence to the existing static algorithm; not independent control-flow proof',
    coverage: unavailable ? { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' }
      : { status: reason ? 'partial' : 'complete', observed: totals.rows,
        expected: reason ? null : totals.rows, reason },
    counts: totals, timings, consumerComparisons: comparisons, bindingComparisons,
    routeSemanticDigest: sha256(canonicalJson(digests)), sampledHeapPeakBytes: heapPeak,
    elapsedMs: performance.now() - started,
    byteScope: 'exact UTF-8 JSON association-array bytes summed across disjoint consumer partitions; no whole-report normalization/encoding performed' };
}
module.exports = { qualify };
