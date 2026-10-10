#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createEffectCollectionWindow, COLLECTION_WINDOW_LIMITS } = require('../../packages/host-runtime/src/runtime/effect-collection-window.js');
const { createEffectInvocations } = require('../../packages/host-runtime/src/runtime/effect-invocations.js');
const invalid = { code: 'PULSEWASM_COLLECTION_WINDOW_INVALID' };
const create = (itemCount = 6, concurrency = 2, check) => createEffectCollectionWindow({ itemCount, maxItems: 64, concurrency, check });

function admission() {
  for (const input of [
    { itemCount: -1 }, { itemCount: 65 }, { itemCount: 1.5 },
    { maxItems: undefined }, { maxItems: Infinity }, { maxItems: -1 },
    { maxItems: COLLECTION_WINDOW_LIMITS.maxItems + 1 },
    { concurrency: 0 }, { concurrency: 1.5 },
    { concurrency: COLLECTION_WINDOW_LIMITS.maxConcurrency + 1 }, { check: null }
  ]) assert.throws(() => createEffectCollectionWindow({ itemCount: 6, maxItems: 64, concurrency: 2, ...input }), TypeError);
  const empty = create(0);
  assert.equal(empty.snapshot().state, 'completed');
  assert.equal(empty.claim(), undefined);
  assert.equal(empty.takeReady(), undefined);
  assert.equal(empty.snapshot().occupied, 0);
}

function completionAndBackpressure() {
  const window = create();
  const slow = window.claim(), fast = window.claim();
  assert.deepEqual([slow.index, fast.index], [0, 1]);
  assert.equal(window.claim(), undefined);
  window.settle(fast);
  assert.equal(window.takeReady(), fast, 'fast completion is handled before slow item settles');
  assert.equal(window.claim(), undefined, 'handling retains its lane until persistence finishes');
  window.settle(slow);
  assert.equal(window.takeReady(), undefined, 'only one result handler owns the guest at once');
  assert.equal(window.snapshot().ready, 1);
  window.finish(fast);
  const next = window.claim();
  assert.equal(next.index, 2);
  assert.equal(next.slot, fast.slot, 'a completed lane can be reused');
  assert.equal(window.takeReady(), slow, 'completion notification order owns handling order');
  assert.throws(() => window.settle(fast), invalid, 'old lease cannot settle a reused lane');
  window.finish(slow);
  window.settle(next);
  assert.equal(window.takeReady(), next);
  window.finish(next);
  for (let index = 3; index < 6; index++) {
    const lease = window.claim();
    assert.equal(lease.index, index);
    window.settle(lease);
    assert.equal(window.takeReady(), lease);
    window.finish(lease);
  }
  assert.deepEqual(window.snapshot(), { state: 'completed', itemCount: 6, started: 6, completed: 6, occupied: 0, running: 0, ready: 0, handling: 0 });
  assert.equal(window.claim(), undefined);
  assert.equal(window.takeReady(), undefined);
  assert.throws(() => window.finish(next), invalid);
}

function identityAndTerminal() {
  const window = create(), other = create();
  const first = window.claim(), foreign = other.claim();
  const original = window.snapshot();
  for (const candidate of [{ ...first }, foreign, first.slot, null]) {
    assert.throws(() => window.settle(candidate), invalid);
    assert.deepEqual(window.snapshot(), original, 'invalid settlement cannot advance or retain state');
  }
  assert.throws(() => window.finish(first), invalid);
  window.settle(first);
  assert.throws(() => window.settle(first), invalid);
  assert.throws(() => window.finish(first), invalid);
  assert.equal(window.takeReady(), first);
  window.close();
  window.close();
  for (const operation of [() => window.claim(), () => window.takeReady(), () => window.settle(first), () => window.finish(first)]) assert.throws(operation, invalid);
  assert.equal(window.snapshot().occupied, 0);
  assert.equal(window.snapshot().ready, 0);
  assert.equal(window.snapshot().handling, 0);
  other.close();
}

function lifecycleGuard() {
  for (const phase of ['claim', 'settle', 'takeReady', 'finish']) {
    let expired = false;
    const error = new Error('owning invocation deadline');
    const window = create(6, 2, () => { if (expired) throw error; });
    const lease = window.claim();
    if (phase === 'takeReady' || phase === 'finish') window.settle(lease);
    if (phase === 'finish') window.takeReady();
    expired = true;
    assert.throws(() => window[phase](lease), candidate => candidate === error);
    assert.equal(window.snapshot().state, 'closed');
    assert.equal(window.snapshot().occupied, 0);
    expired = false;
    assert.throws(() => window.settle(lease), invalid, 'guard failure permanently fences late completion');
  }
}

function boundedSchedules() {
  // Adversarial, reproducible completion schedules. No wall-clock sleeps.
  for (let seed = 1; seed <= 100; seed++) {
    let random = seed;
    const choose = length => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % length; };
    const count = seed % 64, width = seed % 8 + 1;
    const window = create(count, width);
    const running = [], completed = new Set();
    let handler;
    while (window.snapshot().state === 'open') {
      let lease;
      while ((lease = window.claim())) running.push(lease);
      if (running.length) {
        const [settled] = running.splice(choose(running.length), 1);
        window.settle(settled);
      }
      if (!handler) handler = window.takeReady();
      const before = window.snapshot();
      assert.ok(before.occupied <= width && before.ready <= width);
      assert.equal(before.running + before.ready + before.handling, before.occupied);
      assert.ok(before.handling <= 1);
      if (handler) {
        assert.ok(!completed.has(handler.index));
        completed.add(handler.index);
        window.finish(handler);
        handler = undefined;
      }
    }
    assert.equal(completed.size, count);
    assert.equal(window.snapshot().occupied, 0);
  }
}

function invocationComposition() {
  // Item leases span check + result handling. Each actual effect keeps its own
  // existing single-use invocation ticket and cumulative execution accounting.
  const window = create(3, 2), effects = createEffectInvocations();
  let effectCount = 0;
  for (let index = 0; index < 3; index++) {
    const lease = window.claim();
    const check = effects.open(lease.slot * 2, 'monitor.fetch'); effectCount++;
    effects.settle(check, () => window.settle(lease));
    assert.throws(() => effects.settle(check, () => window.settle(lease)), { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
    assert.equal(window.takeReady(), lease);
    const store = effects.open(lease.slot * 2 + 1, 'result.store'); effectCount++;
    effects.settle(store, () => window.finish(lease));
  }
  assert.equal(effectCount, 6, 'collection accounting never discounts result-handler effects');
  assert.equal(window.snapshot().state, 'completed');
  effects.close();
}

async function immediateHandlingProof() {
  // A fixture driver demonstrates the window with controlled provider promises.
  // It is not a public API or a Native integration implementation.
  const window = create(3, 2), replies = new Map(), outcomes = new Map();
  const stored = [], handlers = [], dispatched = [];
  let activeHandlers = 0, drain;
  function fill() {
    let lease;
    while ((lease = window.claim())) {
      const current = lease;
      dispatched.push(current.index);
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      replies.set(current.index, { resolve, reject });
      promise.then(value => ({ status: 'ok', value }), () => ({ status: 'failed', reason: 'timeout' }))
        .then(outcome => {
          outcomes.set(current, outcome);
          window.settle(current);
          drain ||= consume().finally(() => { drain = undefined; });
        });
    }
  }
  async function consume() {
    let lease;
    while ((lease = window.takeReady())) {
      const outcome = outcomes.get(lease);
      outcomes.delete(lease);
      activeHandlers++;
      assert.equal(activeHandlers, 1);
      // Hold persistence so another completion queues without retaining more lanes.
      await new Promise(resolve => handlers.push(resolve));
      stored.push({ index: lease.index, status: outcome.status });
      activeHandlers--;
      window.finish(lease);
      fill();
    }
  }
  const flush = () => new Promise(resolve => setImmediate(resolve));
  fill();
  replies.get(1).resolve('fast'); await flush();
  assert.equal(handlers.length, 1, 'fast item starts its handler while slow item is pending');
  replies.get(0).reject(new Error('fixture timeout')); await flush();
  assert.deepEqual(dispatched, [0, 1], 'slow persistence applies backpressure');
  assert.equal(window.snapshot().ready, 1);
  handlers.shift()(); await flush();
  assert.deepEqual(dispatched, [0, 1, 2]);
  assert.deepEqual(stored, [{ index: 1, status: 'ok' }]);
  replies.get(2).resolve('next'); await flush();
  handlers.shift()(); await flush();
  handlers.shift()(); await drain;
  assert.deepEqual(stored, [{ index: 1, status: 'ok' }, { index: 0, status: 'failed' }, { index: 2, status: 'ok' }]);
  assert.equal(outcomes.size, 0);
  assert.equal(window.snapshot().state, 'completed');
}

async function main() {
  admission(); completionAndBackpressure(); identityAndTerminal(); lifecycleGuard();
  boundedSchedules(); invocationComposition(); await immediateHandlingProof();
  console.log('Effect collection window: bounded scheduling, immediate handling, backpressure, identity and lifecycle guards pass.');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
