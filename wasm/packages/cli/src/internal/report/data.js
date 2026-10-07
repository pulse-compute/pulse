'use strict';

const crypto = require('node:crypto');
const LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, depth: 64, nodes: 500000, stringBytes: 1024 * 1024, records: 100000 });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function fail(code, field = '$') {
  const error = new TypeError(`Report input rejected (${code}).`);
  error.code = code; error.field = field; throw error;
}
function copyData(input) {
  const active = new Set(); let nodes = 0, bytes = 0;
  function charge(count) { bytes += count; if (bytes > LIMITS.bytes) fail('REPORT_LIMIT'); }
  function visit(value, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('REPORT_LIMIT');
    if (value === null || typeof value === 'boolean') { charge(5); return value; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('REPORT_DATA');
      charge(String(value).length); return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > LIMITS.stringBytes) fail('REPORT_LIMIT');
      charge(Buffer.byteLength(JSON.stringify(value))); return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) fail('REPORT_DATA');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('REPORT_DATA');
    const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
    if (keys.some(key => typeof key !== 'string' || forbidden.has(key))) fail('REPORT_DATA');
    if (array && (value.length > LIMITS.records || keys.length !== value.length + 1)) fail('REPORT_LIMIT');
    active.add(value); charge(2);
    const result = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      charge(array ? 1 : Buffer.byteLength(JSON.stringify(key)) + 2);
      const property = properties[key];
      if (!Object.hasOwn(property, 'value') || !property.enumerable) fail('REPORT_DATA');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('REPORT_DATA');
      result[key] = visit(property.value, depth + 1);
    }
    active.delete(value); return result;
  }
  return visit(input, 0);
}
function stringifyData(value) {
  if (Array.isArray(value)) return '[' + value.map(stringifyData).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stringifyData(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function canonicalJson(value) {
  const text = stringifyData(copyData(value));
  if (Buffer.byteLength(text) > LIMITS.bytes) fail('REPORT_LIMIT');
  return text;
}
function parseJson(input) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)) fail('REPORT_DATA');
  if (Buffer.byteLength(input) > LIMITS.bytes) fail('REPORT_LIMIT');
  let text;
  try { text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input); }
  catch { fail('REPORT_JSON'); }
  // Bound nesting before JSON.parse; reject duplicate keys before they disappear.
  const stack = []; let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (++i; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') break; }
      if (i >= text.length) fail('REPORT_JSON');
      let next = i + 1; while (/\s/.test(text[next] || '') && next < text.length) next++;
      if (text[next] === ':' && stack.at(-1)?.keys) {
        let key; try { key = JSON.parse(text.slice(start, i + 1)); } catch { fail('REPORT_JSON'); }
        const keys = stack.at(-1).keys;
        if (keys.has(key) || forbidden.has(key)) fail('REPORT_DUPLICATE_KEY');
        keys.add(key);
      }
      if (++tokens > LIMITS.nodes) fail('REPORT_LIMIT');
    } else if (ch === '{' || ch === '[') {
      stack.push({ keys: ch === '{' ? new Set() : null });
      if (stack.length > LIMITS.depth) fail('REPORT_LIMIT');
    } else if (ch === '}' || ch === ']') stack.pop();
  }
  let value; try { value = JSON.parse(text); } catch { fail('REPORT_JSON'); }
  return copyData(value);
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\:%\x00-\x1f\x7f]/.test(value)
    || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) fail('REPORT_PATH');
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
module.exports = { LIMITS, fail, copyData, canonicalJson, parseJson, sha256, relativePath, freeze };
