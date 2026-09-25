'use strict';
const assert = require('node:assert/strict');
const { instrument, replaceExact, observer, planFor, corpus } = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
function main() {
  assert.throws(() => replaceExact('twice twice', 'twice', 'once'), /instrumentation anchor/);
  assert.throws(() => replaceExact('absent', 'missing', 'value'), /instrumentation anchor/);
  for (const family of ['closed-optional', 'bounded-open', 'text-only']) {
    const plan = planFor(family), options = { canonicalBuild: true, requirePlatformCapability: false };
    const source = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options).source;
    const observed = instrument(source);
    assert.equal(instrument(source), observed, 'instrumentation is deterministic');
    assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options).source, source);
    assert.doesNotMatch(source, /mem01_checkpoint/);
    assert.match(observed, /mem01_checkpoint\(3, encode/);
    assert.match(observed, /mem01_checkpoint\(6, true/);
    assert.ok(corpus(family).some(test => test.name === 'over-byte-bound' && test.error));
    assert.equal(plan.schemas.registry.maxBytes, 65536);
  }
  const memory = new WebAssembly.Memory({ initial: 1 }), view = new DataView(memory.buffer);
  const probe = observer(); probe.attach({ exports: { memory } });
  const r = probe.imports.rtrace;
  view.setUint32(64, 28, true); r.onalloc(64);
  view.setUint32(128, 44, true); r.onalloc(128);
  assert.equal(probe.metrics().outstandingBytes, 80);
  view.setUint32(64, 60, true); r.onresize(64, 32);
  assert.equal(probe.metrics().peakOutstandingBytes, 112);
  view.setUint32(64, 28, true); r.onresize(64, 64);
  r.onfree(128); r.onfree(64);
  assert.equal(probe.metrics().outstandingBytes, 0);
  assert.equal(probe.metrics().allocatedBytes, probe.metrics().freedBytes);
  assert.equal(r.onstore(42, 8, 4, 1), 42, 'instrumented stores preserve their base pointer');
  assert.throws(() => r.onfree(64), /unknown free/);
  console.log('ok - MEM01 instrumentation is isolated, anchored and allocator accounting balances');
}
module.exports = { main };
if (require.main === module) main();
