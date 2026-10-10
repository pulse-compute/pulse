'use strict';
const assert = require('node:assert/strict');
const { parseGraph, captureGraph } = require('../../packages/build-support/src/report-direct-graph');
const limitBytes = 160 * 1024 * 1024;
const functions = [{ index: 0, bytes: 2, name: 'entry' }];
const prefix = '(module (func $entry ', suffix = '))';
const started = performance.now();
// Exactly at the byte ceiling is accepted, with a complete empty direct graph.
const atLimit = prefix + ' '.repeat(limitBytes - prefix.length - suffix.length) + suffix;
assert.equal(Buffer.byteLength(atLimit), limitBytes);
assert.deepEqual(parseGraph(atLimit, functions, 0).edges, []);
const capture = text => captureGraph({ readBinary: () => ({ emitText: () => text, dispose() {} }) }, Buffer.alloc(0), functions, 0);
const over = capture(atLimit + ' ');
assert.equal(over.status, 'unavailable');
assert.deepEqual(over.diagnostic, { reason: 'graph-budget-exhausted', code: 'text-byte-limit',
  functionIndex: null, observed: limitBytes + 1, expected: limitBytes });
// Measure bytes, not JS character count; rejection still happens before parsing.
const unicode = capture('é'.repeat(limitBytes / 2 + 1));
assert.equal(unicode.diagnostic.observed, limitBytes + 2);
assert.equal(unicode.diagnostic.expected, limitBytes);
// Passing the former ceiling must reveal unsupported control, never a partial
// graph. This case also proves opaque comments cannot supply fake instructions.
const next = capture('(module (; ' + ' '.repeat(32 * 1024 * 1024) + 'call PRIVATE_CANARY ;) (func $entry (call_indirect)))');
assert.equal(next.diagnostic.code, 'indirect-call');
assert.equal(next.reason, 'unsupported-indirect-control');
assert.equal(Object.hasOwn(next, 'edges'), false);
assert.ok(!JSON.stringify(next).includes('PRIVATE_CANARY'));
console.log(JSON.stringify({ limitBytes, status: 'passed', elapsedMs: performance.now() - started, maxRssKiB: process.resourceUsage().maxRSS }));
