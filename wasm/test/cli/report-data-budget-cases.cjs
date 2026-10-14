'use strict';
const assert = require('node:assert/strict');
const data = require('../../packages/cli/src/internal/report/data');
const limit = fn => assert.throws(fn, error => error.code === 'REPORT_LIMIT');

module.exports = function reportDataBudgetCases() {
  const mib = 1024 * 1024;
  assert.equal(data.LIMITS.bytes, 40 * mib);
  assert.equal(data.LIMITS.nodes, 2000000);

  // Large inventories must survive both the producer and the offline reader.
  // Use separate bounded strings so the per-string limit remains exercised.
  const chunk = 'x'.repeat(mib);
  const wire = data.canonicalJson(Array(39).fill(chunk));
  assert.ok(Buffer.byteLength(wire) > 16 * mib);
  const restored = data.parseJson(Buffer.from(wire));
  assert.equal(restored.length, 39);
  assert.ok(restored.every(value => value === chunk));
  limit(() => data.canonicalJson(Array(40).fill(chunk)));
  limit(() => data.parseJson(' '.repeat(40 * mib + 1)));
  limit(() => data.copyData(chunk + 'x'));

  // A dense graph can exceed the old node budget well before the byte budget.
  const row = Array(100000).fill(0), graph = Array(12).fill(row);
  const graphWire = data.canonicalJson(graph);
  assert.equal(data.parseJson(graphWire)[11].length, row.length);
  limit(() => data.copyData(Array(20).fill(row)));
  limit(() => data.parseJson(JSON.stringify(Array(20).fill(row))));

  // The parser also bounds quoted keys/values before materializing objects.
  const keyed = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(i), 'x']));
  const tokenWire = JSON.stringify(Array(1001).fill(keyed));
  assert.ok(Buffer.byteLength(tokenWire) < data.LIMITS.bytes);
  limit(() => data.parseJson(tokenWire));
};
