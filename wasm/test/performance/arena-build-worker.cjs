'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [variant, directory, receipt] = process.argv.slice(2);
const invocations = require('./arena-transform-control.cjs').install(variant);
require('./baseline.cjs').buildWorker(directory, 'artifact', receipt, 'beta8');
const result = JSON.parse(fs.readFileSync(receipt));
assert.equal(invocations.length, 1);
const transformsAdded = invocations[0].transformsAdded;
const flags = result.settings.compiler.flags;
const index = flags.findIndex(flag => /\/json-as\/transform\/lib\/index\.js$/.test(flag.replace(/\\/g, '/')));
assert.equal(transformsAdded, variant === 'patched' && index >= 0 ? 1 : 0);
if (transformsAdded) flags.splice(index + 1, 0, '--transform', '<repo>/wasm/test/performance/schema-cache-arena-transform.cjs');
// Production metadata observes intended argv before this test interceptor.
// Retain the actual intercepted recipe instead of that retained capsule.
delete result.buildMetadata;
result.arenaControl = { variant, transformsAdded, cache: process.env.JSON_CACHE ?? null };
fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n');
