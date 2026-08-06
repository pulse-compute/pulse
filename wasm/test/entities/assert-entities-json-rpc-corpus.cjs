#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'entities-envelope-corpus.json'), 'utf8'));
const frozen = require('./bounded-envelope-scanner.cjs');
const productionPath = path.join(repoRoot, 'packages/entities/dist/internal/bounded-json-rpc.js');

function captureFailure(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail('expected bounded envelope scan to fail');
}

(async () => {
  assert.equal(fs.existsSync(productionPath), true, 'Entities package build must emit its production scanner');
  const production = await import(pathToFileURL(productionPath).href);
  assert.equal(typeof production.scanJsonRpcEnvelope, 'function');

  for (const fixture of corpus.valid) {
    const expected = frozen.scanJsonRpcEnvelope(fixture.text, fixture.limits);
    const actual = production.scanJsonRpcEnvelope(fixture.text, fixture.limits);
    assert.deepEqual(actual, expected, `${fixture.name} must match the frozen I0 scanner`);
    assert.equal(actual.method, fixture.method, `${fixture.name} method`);
    assert.equal(actual.paramsRaw, fixture.paramsRaw, `${fixture.name} params raw slice`);
    assert.equal(actual.idKind, fixture.idKind, `${fixture.name} ID kind`);
    assert.equal(actual.idRaw, fixture.idRaw, `${fixture.name} raw ID slice`);
    assert.equal(Object.isFrozen(actual), true, `${fixture.name} selection must be immutable`);
  }

  for (const fixture of corpus.invalid) {
    const expected = captureFailure(() => frozen.scanJsonRpcEnvelope(fixture.text, fixture.limits));
    const actual = captureFailure(() => production.scanJsonRpcEnvelope(fixture.text, fixture.limits));
    assert.equal(actual.code, fixture.code, `${fixture.name} production failure code`);
    assert.equal(actual.code, expected.code, `${fixture.name} must match the frozen I0 scanner`);
    assert.equal(Object.isFrozen(actual.detail), true, `${fixture.name} error detail must be immutable`);
  }

  const source = fs.readFileSync(path.join(repoRoot, 'packages/entities/src/internal/bounded-json-rpc.ts'), 'utf8');
  const routerSource = fs.readFileSync(path.join(repoRoot, 'packages/entities/src/entity-router.ts'), 'utf8');
  assert.doesNotMatch(source, /node:|Buffer\./, 'production scanner must remain target-portable');
  assert.doesNotMatch(routerSource, /bounded-envelope-scanner|wasm\/test/, 'runtime must not depend on its test-only feasibility scanner');
  assert.match(routerSource, /scanJsonRpcEnvelope\(envelopeText/);

  console.log(JSON.stringify({
    version: corpus.version,
    valid: corpus.valid.length,
    invalid: corpus.invalid.length,
    productionScanner: 'packages/entities/dist/internal/bounded-json-rpc.js'
  }));
  console.log('ok - Entities I4 production scanner matches the frozen bounded JSON-RPC corpus');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
