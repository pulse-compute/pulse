'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
function capture(exports) {
  if (!exports?.rd_query) return null;
  const q = (k, i = 0, f = 0) => exports.rd_query(k, i, f);
  const meta = Array.from({length: 14}, (_, i) => q(0, i));
  assert(meta[1] <= 4096 && meta[7] <= 32 && meta[8] <= 512);
  return {meta, transitions: Array.from({length: 64}, (_, i) => q(1, i)),
    samples: Array.from({length: meta[1]}, (_, i) => Array.from({length: 7}, (_, f) => q(2, i, f))),
    records: Array.from({length: meta[8]}, (_, i) => Array.from({length: 7}, (_, f) => q(3, i, f))).filter(row => row[0] !== 0),
    roots: Array.from({length: meta[7]}, (_, i) => Array.from({length: 6}, (_, f) => q(4, i, f))),
    charged: Array.from({length: 3}, (_, i) => q(5, i, 0)),
    committed: Array.from({length: 3}, (_, i) => q(5, i, 1)),
    admission: Array.from({length: 4}, (_, i) => [q(6, i, 0), q(6, i, 1)])};
}
// Reuse the independent RA-07 host unchanged except for a post-run read-only snapshot.
const original = fs.readFileSync(path.join(__dirname, '../ra07/host.cjs'), 'utf8');
const anchor = 'return {trace, body, json, status, thrown, committed, accounting, post,';
assert.equal(original.split(anchor).length - 1, 1);
const moduleObject = {exports: {}};
new Function('require', 'module', 'capture', original.replace(anchor,
  'return {diagnostics:capture(exports), trace, body, json, status, thrown, committed, accounting, post,'))(require, moduleObject, capture);
module.exports = moduleObject.exports;
