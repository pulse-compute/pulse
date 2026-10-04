'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Analyze only after the measured child exits: parsing a snapshot in that child
// would retain its strings and invalidate the next observation.
function analyze(file) {
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { node_fields: nf, edge_fields: ef, node_types: nt, edge_types: et } = snapshot.snapshot.meta;
  const { nodes, edges, strings } = snapshot;
  const n = name => { const i = nf.indexOf(name); assert.ok(i >= 0); return i; };
  const e = name => { const i = ef.indexOf(name); assert.ok(i >= 0); return i; };
  const type = n('type'), name = n('name'), bytes = n('self_size'), count = n('edge_count');
  const edgeType = e('type'), edgeName = e('name_or_index'), to = e('to_node');
  const offsets = new Map(), payloads = [], texts = [];
  let at = 0, totalSelfBytes = 0;
  for (let i = 0; i < nodes.length; i += nf.length) {
    const end = at + nodes[i + count] * ef.length; offsets.set(i, [at, end]);
    totalSelfBytes += nodes[i + bytes];
    // V8 also retains object-literal allocation templates. Their dynamic fields
    // are system/Hole values, not runtime payloads. Require the populated tag.
    if (nt[0][nodes[i + type]] === 'object') {
      let marked = false, tagged = false;
      for (let j = at; j < end; j += ef.length) if (et[0][edges[j + edgeType]] === 'property') {
        const label = strings[edges[j + edgeName]], dest = edges[j + to];
        if (label === '__mem08_payload') marked = true;
        if (label === 'tag' && nt[0][nodes[dest + type]] === 'string' && /^row-\d+$/.test(strings[nodes[dest + name]])) tagged = true;
      }
      if (marked && tagged) payloads.push(i);
    }
    if (nt[0][nodes[i + type]] === 'string' && /^MEM08-DATA-\d{3}-/.test(strings[nodes[i + name]])) texts.push(i);
    at = end;
  }
  assert.equal(at, edges.length);
  const reached = new Set(), pending = [...payloads];
  while (pending.length) {
    const i = pending.pop(); if (reached.has(i)) continue; reached.add(i);
    const [start, end] = offsets.get(i), kind = nt[0][nodes[i + type]];
    for (let j = start; j < end; j += ef.length) {
      const k = et[0][edges[j + edgeType]], label = strings[edges[j + edgeName]], dest = edges[j + to];
      const targetKind = nt[0][nodes[dest + type]];
      const property = k === 'property' && label !== '__proto__';
      const backing = k === 'internal' && ['elements', 'properties'].includes(label);
      const stringBacking = kind.includes('string') && k === 'internal' && ['first', 'second', 'parent'].includes(label);
      const indexed = k === 'element' || kind === 'array' && k === 'internal' && /^\d+$/.test(label);
      if ((property || backing || stringBacking || indexed) && ['object', 'array', 'string', 'concatenated string', 'sliced string', 'number'].includes(targetKind)) pending.push(dest);
    }
  }
  const sum = ids => [...ids].reduce((total, id) => total + nodes[id + bytes], 0);
  const perType = {};
  for (const id of reached) { const kind = nt[0][nodes[id + type]]; perType[kind] = (perType[kind] || 0) + nodes[id + bytes]; }
  return { payloads: payloads.length, payloadClosureNodes: reached.size, payloadClosureSelfBytes: sum(reached), payloadClosureBytesByType: perType,
    payloadStrings: texts.length, payloadStringSelfBytes: sum(texts), totalSnapshotSelfBytes: totalSelfBytes };
}
module.exports = { analyze };
