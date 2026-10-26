'use strict';
const assert = require('node:assert/strict');
const { instantiate } = require('./host.cjs');
const { profile } = require('./build.cjs');
function checkPair(control, observed, width) {
  let cases = 0;
  function check(name, run) { run(); cases++; }
  check('P05 profile matches the fixture allocation/ownership domain', () => {
    const plan = profile(width, 1024); assert.equal(plan.admitted, true);
    assert.deepEqual(plan.required, { handles: width, backingBytes: 1025 * width, records: 2 * width, cleanupSteps: width, effects: width });
  });
  const snapshot = host => { const { notes, ...rest } = host.snapshot(); return rest; };
  for (const payload of [1, 1024, 16384, 65536]) check('paired payload ' + payload, () => {
    const results = [control, observed].map(artifact => {
      const host = instantiate(artifact.module, { width });
      assert.equal(host.x.run(payload), width);
      assert.equal(host.x.checksum(), width * payload * 127);
      const before = host.snapshot();
      assert.equal(before.error, 0); assert.equal(before.disposals, width); assert.deepEqual(before.live, []);
      assert.deepEqual(before.states, Array(width).fill(4)); assert.deepEqual(before.backing, Array(width).fill(payload + 1));
      for (let i = 0; i < width; i++) {
        assert.equal(host.x.byte(i, 0), 127); assert.equal(host.x.byte(i, payload - 1), 127);
        assert.equal(host.x.byte(i, payload), 0); assert.equal(host.x.ticket(i), 0);
        assert.equal(host.x.resolve(i, host.x.generation(i), payload), 0);
        assert.equal(host.x.issue(i), 0);
      }
      host.x.close(); assert.deepEqual(host.snapshot(), before, 'close is idempotent and retains payload roots');
      assert.equal(before.notes, artifact.identity.observed ? width * 3 : 0);
      return { state: snapshot(host), trace: host.trace.filter(e => e[0] !== 'note') };
    });
    assert.deepEqual(results[0], results[1]);
  });
  for (const options of [{ readFailure: true }, { acquireFailure: 0 }, { disposeUnknown: true },
    { readTrap: true }, { disposeTrap: true }, { expire: true }, { reject: true }]) check('paired failure ' + JSON.stringify(options), () => {
    const results = [control, observed].map(artifact => {
      const host = instantiate(artifact.module, { ...options, width });
      if (options.expire) host.expire();
      if (options.reject) host.x.reject(true);
      if (options.readTrap || options.disposeTrap) assert.throws(() => host.x.run(16), WebAssembly.RuntimeError);
      else host.x.run(16);
      const state = host.snapshot();
      if (options.readFailure) { assert.equal(state.error, 11); assert.equal(state.deliveries, 0); assert.equal(state.disposals, width); }
      if (options.acquireFailure === 0) { assert.equal(state.acquisitions, 1); assert.equal(state.reads, 0); assert.equal(state.states[0], 5); assert.equal(state.disposals, 0); }
      if (options.disposeUnknown) { assert.equal(state.error, 12); assert.deepEqual(state.states, Array(width).fill(5)); assert.equal(state.live.length, width); }
      if (options.expire) { assert.equal(state.disposals, 0); assert.deepEqual(state.states, Array(width).fill(2)); }
      if (options.readTrap) { assert.equal(state.disposals, 0); assert.equal(state.reads, 1); assert.ok(state.tickets.every(ticket => ticket > 0)); }
      if (options.disposeTrap) { assert.equal(state.disposals, 1); assert.equal(state.states[0], 3); assert.ok(state.tickets.every(ticket => ticket === 0)); }
      if (options.reject) { assert.equal(state.deliveries, 0); assert.equal(state.checksum, 0); assert.ok(state.tickets.every(ticket => ticket === 0)); }
      if (!options.readTrap) { host.x.close(); assert.deepEqual(host.snapshot(), state, 'no cleanup retry after closed/unknown/fenced'); }
      return { state: snapshot(host), trace: host.trace.filter(e => e[0] !== 'note') };
    });
    assert.deepEqual(results[0], results[1]);
  });
  for (const artifact of [control, observed]) {
    check('stale/foreign tickets denied before reads', () => {
      const host = instantiate(artifact.module, { width }); const ticket = host.x.issue(0);
      for (const bad of [0, -1, ticket + 1]) assert.equal(host.x.resolve(0, bad, 16), 0);
      assert.equal(host.x.resolve(width, ticket, 16), 0); assert.equal(host.snapshot().reads, 0);
      assert.equal(host.x.resolve(0, ticket, 16), 1); assert.equal(host.x.resolve(0, ticket, 16), 0);
      assert.equal(host.snapshot().reads, 1); host.x.close(); assert.equal(host.snapshot().disposals, 1);
    });
    check('payload validation precedes acquisition', () => {
      for (const size of [0, -1, 65537]) { const host = instantiate(artifact.module, { width }); assert.equal(host.x.run(size), 0); assert.equal(host.snapshot().acquisitions, 0); }
    });
    check('cleanup failure preserves prior business error', () => {
      const host = instantiate(artifact.module, { width, readFailure: true, disposeUnknown: true });
      host.x.run(16); assert.equal(host.x.error(), 11); assert.equal(host.snapshot().disposals, width);
    });
  }
  return cases;
}
module.exports = { checkPair };
