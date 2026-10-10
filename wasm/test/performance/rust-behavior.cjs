'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
function cases(fixture) {
  const rows = fixture.cases.map((c, i) => ({ ...c, name: 'fixture-' + i, effects: fixture.id === 'schema-effect' ? 1 : 0 }));
  if (fixture.id === 'schema-effect') {
    for (const name of ['quote " slash \\ newline\n snow 雪 emoji 😀', 'x'.repeat(4096)]) rows.push({ name: 'string-' + name.length,
      request: { ...fixture.cases[0].request, body: JSON.stringify({ name, ignored: [1, 2] }) }, expected: { status: 200, json: { name, score: 7 } }, effects: 1 });
    for (const body of ['{', '{}', '{"name":null}', '{"name":5}']) rows.push({ name: 'reject-' + body,
      request: { ...fixture.cases[0].request, body }, reject: true, effects: 0 });
    rows.push({ ...fixture.cases[0], name: 'origin-fraction', fetches: { 'https://origin.example.test/value': { value: { score: -2.5 } } }, expected: { status: 200, json: { name: 'Ada', score: -2.5 } }, effects: 1 });
    rows.push({ name: 'invalid-origin', request: fixture.cases[0].request, fetches: { 'https://origin.example.test/value': { value: { score: 'bad' } } }, reject: true, effects: 1 });
  }
  if (fixture.id === 'multi-route') rows.push({ name: 'other-id', request: { method: 'GET', path: '/api/users/alice' }, expected: { status: 200, json: { id: 'alice' } }, effects: 0 });
  if (fixture.id === 'multi-route') for (const method of ['POST', 'DELETE', 'HEAD']) rows.push({ name: 'unmatched-' + method,
    request: { method, path: '/other' }, expected: { status: 404, text: method === 'HEAD' ? '' : 'Not Found' }, effects: 0 });
  if (fixture.id === 'large-router-compile') {
    rows.push({ name: 'unicode-input', request: { method: 'POST', path: '/items/63', body: JSON.stringify({ value: '雪😀\\"' }) }, expected: { status: 200, json: { value: '雪😀\\"', route: 63 } }, effects: 0 });
    rows.push({ name: 'unmatched-route', request: { method: 'GET', path: '/items/0' }, expected: { status: 404, text: 'Not Found' }, effects: 0 });
    rows.push({ name: 'invalid-input', request: { method: 'POST', path: '/items/0', body: '{}' }, reject: true, effects: 0 });
  }
  return rows;
}
function load(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'pulse-build.json')));
  return { wasm: fs.readFileSync(path.join(directory, manifest.portable.wasm.file)), plan: JSON.parse(fs.readFileSync(path.join(directory, manifest.portable.plan))) };
}
function traceShape(trace) {
  return trace.filter(row => row.type?.startsWith('native-')).map(row => Object.fromEntries(
    ['type', 'effectId', 'continuationId', 'status', 'bodyClass'].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
}
async function observe(compiled, fixture, test) {
  try {
    const result = await executeCanonicalNativeModule(compiled, { request: structuredClone(test.request), providerAdapter: createNodeProviderAdapter({ fetches: test.fetches || fixture.fetches || {} }) });
    return { status: 'returned', response: result.response, effects: result.effectCount, trace: traceShape(result.trace) };
  } catch (error) {
    const trace = traceShape(error.execution?.trace || []);
    return { status: 'rejected', code: error.code || error.name, effects: trace.filter(row => row.type === 'native-effect-start').length, trace };
  }
}
function assertParity(left, right, test, fixture) {
    for (const result of [left, right]) {
      assert.equal(result.status, test.reject ? 'rejected' : 'returned', fixture.id + ': ' + test.name);
      assert.equal(result.effects, test.effects, 'Effect outcome differs');
      if (!test.reject) {
        assert.equal(result.response.status, test.expected.status);
        if (test.expected.json) assert.deepEqual(JSON.parse(result.response.body), test.expected.json);
        else assert.equal(result.response.body, test.expected.text);
      }
    }
    assert.deepEqual(left.trace, right.trace, 'Lifecycle/effect trace differs');
    if (test.reject) assert.equal(left.code, right.code, 'Rejection code differs');
    else for (const key of ['status', 'kind', 'bodyClass', 'headers']) assert.deepEqual(left.response[key], right.response[key]);
}
async function verifyBehavior(pulseDirectory, rustDirectory, fixture) {
  const pulse = load(pulseDirectory), rust = load(rustDirectory), results = [];
  assert.deepEqual(pulse.plan, rust.plan, 'Shared host contract must match');
  for (const test of cases(fixture)) {
    const left = await observe(pulse, fixture, test), right = await observe(rust, fixture, test);
    assertParity(left, right, test, fixture);
    results.push({ name: test.name, status: 'passed', pulse: left, rust: right,
      ...(test.reject ? {} : { wireBodyEqual: left.response.body === right.response.body }) });
  }
  return { fixture: fixture.id, status: 'passed', cases: results.length, results };
}
module.exports = { cases, verifyBehavior, assertParity };
