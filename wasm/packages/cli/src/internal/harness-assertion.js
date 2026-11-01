'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const owned = new WeakMap();
const sensitive = /authorization|cookie|token|secret|password|api[-_]?key/i;

function check(testCase, expectation, compare, context) {
  try { return compare(); }
  catch (error) {
    if (error instanceof assert.AssertionError) owned.set(error, { testCase, expectation, context });
    throw error;
  }
}
function isAssertion(error) { return owned.has(error); }
function summary(error, secrets, redact) {
  const row = owned.get(error);
  if (!row) return null;
  const clean = value => redact(String(value), secrets).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 256);
  function shape(value) {
    if (value === undefined) return { type: 'undefined' };
    if (value === null) return { type: 'null' };
    if (typeof value === 'string' || Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
      const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      return { type: typeof value === 'string' ? 'string' : 'binary', bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    return { type: Array.isArray(value) ? 'array' : typeof value };
  }
  const header = row.expectation.startsWith('response.headers.') ? row.expectation.slice(17) : null;
  const privateValue = /json|text|result|emitted|message/.test(row.expectation);
  function value(input) {
    if (header && sensitive.test(header)) return '<redacted>';
    if (privateValue) return shape(input);
    if (input === undefined) return { type: 'undefined' };
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return clean(input);
    if (Array.isArray(input)) return input.slice(0, 8).map(v => typeof v === 'string' ? clean(v) : shape(v));
    return shape(input);
  }
  const detail = { version: 1, case: clean(row.testCase.name),
    kind: row.testCase.kind === 'event' ? 'event' : 'http', expectation: clean(row.expectation),
    operator: clean(error.operator || 'assert'), expected: value(error.expected), actual: value(error.actual) };
  if (row.context) {
    detail.response = { status: row.context.status };
    detail.request = { method: clean(row.testCase.request?.method || 'GET') };
    if (header) {
      const headers = row.testCase.request?.headers || [];
      const entries = Array.isArray(headers) ? headers : Object.entries(headers);
      const supplied = entries.filter(([name]) => String(name).toLowerCase() === header.toLowerCase());
      detail.request.header = { name: clean(header), present: supplied.length > 0,
        values: sensitive.test(header) ? '<redacted>' : supplied.slice(0, 8).map(([,v]) => clean(v)) };
    }
  }
  return detail;
}
module.exports = { check, isAssertion, summary };
