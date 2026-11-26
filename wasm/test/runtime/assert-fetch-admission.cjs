'use strict';

const assert = require('node:assert/strict');
const { normalizeFetchInit } = require('../../../packages/runtime/src/internal/fetch.js');
const canonical = require('../../packages/host-runtime/src/runtime/canonical-api-runtime.js');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { executeCanonicalProgram } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');

async function main() {
  const invalid = [
    ...['', null, false, 0, 'TRACE', 'CONNECT'].map(method => [{ method }, 'PULSE_FETCH_METHOD_UNSUPPORTED']),
    ...[null, 'headers', 7, [null], Array(1), [['x']], [['x', 'y', 'z']], [[7, 'value']], [['x', 7]], { x: 7 },
      [['', 'value']], [['bad name', 'value']], [['x', 'a\r\nb']], [['x', 'a\0b']]]
      .map(headers => [{ headers }, 'PULSE_FETCH_HEADERS_INVALID']),
    [new Date(0), 'PULSE_FETCH_INIT_INVALID'],
  ];
  for (const normalize of [normalizeFetchInit, canonical.normalizedInit]) {
    for (const [init, code] of invalid) assert.throws(() => normalize(init), { code });
    assert.equal(normalize().method, 'GET');
    assert.equal(normalize(Object.create(null)).method, 'GET');
    for (const method of ['DELETE', 'OPTIONS']) {
      const headers = [['Content-Type', ''], ['x-repeat', 'first'], ['X-Repeat', 'second']];
      const result = normalize({ method, json: 42, headers });
      assert.deepEqual(result.headers, headers, 'preserve explicit empty content type and repeated header pairs');
      assert.equal(result.body, '42');
    }
  }

  // Exercise the compiled continuation host, not only its normalization helper.
  const program = loadCanonicalModule(compileCanonicalSource(`export default async function handler(ctx) {
    const input = await ctx.req.json();
    const response = await ctx.fetch('https://admission.test/', { method: input.method, headers: input.headers }).text();
    return ctx.text(response);
  }`, { fileName: 'fetch-admission.ts', strict: false }));
  let dispatches = 0;
  const execute = input => executeCanonicalProgram(program, {
    request: { method: 'POST', headers: [['content-type', 'application/json']], body: JSON.stringify(input) },
    fetchImplementation: async () => { dispatches++; return new Response('healthy'); },
  });
  for (const [init, code] of invalid.filter(([value]) => !(value instanceof Date))) {
    await assert.rejects(() => execute(init), { code });
    assert.equal(dispatches, 0, 'invalid input must not reach the provider');
  }
  const recovery = await execute({ method: 'OPTIONS', headers: [['x-valid', 'yes']] });
  assert.equal(recovery.response.body, 'healthy');
  assert.equal(dispatches, 1, 'fresh valid execution remains usable without retries');
  console.log(`ok - fetch admission: ${invalid.length} negative cases per normalizer, no invalid dispatch, explicit header preservation and recovery`);
}
module.exports = main;
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
