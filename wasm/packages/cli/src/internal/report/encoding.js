/* Shared storage codec. Local table indexes never replace semantic identities. */
const reportEncoding = (() => {
  'use strict';
  const KIND = 'pulse.report-data';
  const LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, depth: 64, nodes: 2000000, stringBytes: 1024 * 1024, records: 100000 });
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  function fail(code = 'REPORT_DATA') { const e = new TypeError(`Report input rejected (${code}).`); e.code = code; e.field = '$'; throw e; }
  function utf8(text) {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 128) size++; else if (c < 2048) size += 2;
      else if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  function stringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stringify).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stringify(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function bounded(meta) {
    if (meta.bytes > LIMITS.bytes || meta.nodes > LIMITS.nodes || meta.depth > LIMITS.depth) fail('REPORT_LIMIT');
    return meta;
  }
  function scalar(value) {
    if (value === null || typeof value === 'boolean') return { bytes: 5, nodes: 1, depth: 0 };
    if (typeof value === 'number' && Number.isFinite(value)) return { bytes: String(value).length, nodes: 1, depth: 0 };
    if (typeof value === 'string') {
      if (utf8(value) > LIMITS.stringBytes) fail('REPORT_LIMIT');
      return { bytes: utf8(JSON.stringify(value)), nodes: 1, depth: 0 };
    }
    fail();
  }
  // Validate the wire itself before following references, including unused data.
  function inspect(value, depth = 0, active = new Set()) {
    if (depth > LIMITS.depth) fail('REPORT_LIMIT');
    if (!value || typeof value !== 'object') return scalar(value);
    if (active.has(value)) fail();
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail();
    const props = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(props);
    if (array && (value.length > LIMITS.records || keys.length !== value.length + 1)) fail('REPORT_LIMIT');
    const meta = { bytes: 2, nodes: 1, depth: 0 }; active.add(value);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const prop = props[key];
      if (typeof key !== 'string' || forbidden.has(key) || !Object.hasOwn(prop, 'value') || !prop.enumerable) fail();
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail();
      const child = inspect(prop.value, depth + 1, active);
      meta.bytes += (array ? 1 : utf8(JSON.stringify(key)) + 2) + child.bytes;
      meta.nodes += child.nodes; meta.depth = Math.max(meta.depth, child.depth + 1); bounded(meta);
    }
    active.delete(value); return meta;
  }
  // Input is the already validated canonical semantic model. Encoding does not
  // drop records, reorder arrays, shorten hashes, or intern by semantic ID.
  function encode(value) {
    const nodes = [], shapes = [], nodeIds = new Map(), shapeIds = new Map();
    function visit(v) {
      let node = v;
      if (Array.isArray(v)) node = [0, ...v.map(visit)];
      else if (v && typeof v === 'object') {
        const keys = Object.keys(v).sort(), key = JSON.stringify(keys);
        let shape = shapeIds.get(key);
        if (shape === undefined) { shape = shapes.length; shapes.push(keys); shapeIds.set(key, shape); }
        node = [1, shape, ...keys.map(k => visit(v[k]))];
      }
      const key = JSON.stringify(node);
      let id = nodeIds.get(key);
      if (id === undefined) { id = nodes.length; nodes.push(node); nodeIds.set(key, id); }
      return id;
    }
    const root = visit(value);
    return { kind: KIND, encodingVersion: 1, shapes, nodes, root };
  }
  function decode(wire) {
    inspect(wire);
    if (wire?.kind !== KIND) return wire; // Original v1 semantic formats.
    if (wire.encodingVersion !== 1) fail('REPORT_INPUT_VERSION');
    if (Object.keys(wire).sort().join(',') !== 'encodingVersion,kind,nodes,root,shapes'
      || !Array.isArray(wire.shapes) || !Array.isArray(wire.nodes) || !wire.nodes.length
      || wire.root !== wire.nodes.length - 1) fail();
    const shapeKeys = new Set();
    for (const keys of wire.shapes) {
      if (!Array.isArray(keys) || keys.some((k, i) => typeof k !== 'string' || forbidden.has(k) || (i > 0 && keys[i - 1] >= k))) fail();
      const identity = JSON.stringify(keys);
      if (shapeKeys.has(identity)) fail();
      shapeKeys.add(identity);
    }
    const metas = [], values = [], shapeUsed = new Set(), referenced = new Set();
    // Postorder references rule out cycles. Charge expanded work before building
    // any expanded tree. Shared immutable objects keep browser memory bounded.
    for (const [i, node] of wire.nodes.entries()) {
      if (!Array.isArray(node)) { metas.push(scalar(node)); values.push(node); continue; }
      const array = node[0] === 0, shape = node[1];
      if (!array && (node[0] !== 1 || !Number.isSafeInteger(shape) || shape < 0 || shape >= wire.shapes.length)) fail();
      const keys = array ? null : wire.shapes[shape], refs = node.slice(array ? 1 : 2);
      if ((!array && refs.length !== keys.length) || refs.length > LIMITS.records) fail();
      const meta = { bytes: 2, nodes: 1, depth: 0 };
      for (const [j, ref] of refs.entries()) {
        if (!Number.isSafeInteger(ref) || ref < 0 || ref >= i) fail();
        referenced.add(ref);
        const child = metas[ref];
        meta.bytes += (array ? 1 : utf8(JSON.stringify(keys[j])) + 2) + child.bytes;
        meta.nodes += child.nodes; meta.depth = Math.max(meta.depth, child.depth + 1); bounded(meta);
      }
      if (!array) shapeUsed.add(shape);
      metas.push(meta);
      values.push(Object.freeze(array ? refs.map(ref => values[ref]) : Object.fromEntries(keys.map((key, j) => [key, values[refs[j]]]))));
    }
    if (referenced.size !== wire.nodes.length - 1 || shapeUsed.size !== wire.shapes.length) fail();
    return values[wire.root];
  }
  function store(value) {
    const raw = stringify(value), encoded = encode(value), normalized = stringify(encoded);
    // Table overhead is not worthwhile for every small input. Only emit a
    // normalized envelope that fits the same bounded wire reader.
    if (utf8(normalized) < utf8(raw)) {
      try { inspect(encoded); return normalized + '\n'; }
      catch (error) { if (error.code !== 'REPORT_LIMIT') throw error; }
    }
    return raw + '\n';
  }
  return Object.freeze({ KIND, LIMITS, encode, decode, store, stringify });
})();
if (typeof module === 'object' && module.exports) module.exports = reportEncoding;
