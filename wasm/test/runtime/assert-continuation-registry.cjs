#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createContinuationRegistry } = require('../../packages/host-runtime/src/runtime/continuation-registry.js');

let now = 1000;
const registry = createContinuationRegistry({ clock: () => now, ttlMs: 50 });
registry.create({ id: 'normal', branchPoint: 'fetch-user', effectIds: ['fetch-1'] });
registry.wait('normal');
registry.resume('normal');
registry.complete('normal');
assert.deepEqual(registry.get('normal').states, ['created', 'waiting', 'resumed', 'completed']);
assert.throws(() => registry.resume('normal'), { name: 'ContinuationDoubleResumeError', code: 'PULSE_CONTINUATION_DOUBLE_RESUME' });

registry.create({ id: 'double', branchPoint: 'fetch-stats' });
registry.wait('double');
registry.resume('double');
assert.throws(() => registry.resume('double'), { name: 'ContinuationDoubleResumeError' });
registry.fail('double', new Error('after-resume failure'));
assert.equal(registry.get('double').state, 'failed');
assert.throws(() => registry.resume('double'), { name: 'ContinuationDoubleResumeError', code: 'PULSE_CONTINUATION_DOUBLE_RESUME' });

registry.create({ id: 'expired', ttlMs: 10 });
registry.wait('expired');
now += 11;
assert.throws(() => registry.resume('expired'), { name: 'ContinuationExpiredError', code: 'PULSE_CONTINUATION_EXPIRED' });
assert.equal(registry.get('expired').state, 'expired');

registry.create({ id: 'swept', ttlMs: 5 });
registry.wait('swept');
now += 6;
assert.deepEqual(registry.sweepExpired(), ['swept']);
assert.equal(registry.get('swept').state, 'expired');

registry.create({ id: 'cancelled' });
registry.wait('cancelled');
registry.cancel('cancelled');
assert.throws(() => registry.resume('cancelled'), { name: 'ContinuationStateError' });
assert.ok(registry.trace().every((event, index) => event.sequence === index + 1));

console.log('ok - continuation registry enforces waiting/resume/complete, double-resume, expiry, failure, cancellation, and ordered trace transitions');
