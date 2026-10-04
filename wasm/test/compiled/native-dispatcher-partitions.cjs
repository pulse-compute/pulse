'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { generateCanonicalNativeAssemblyScript } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime');

function largestFunctionBody(bytes) {
  let offset = 8, largest = 0;
  const leb = () => { let value = 0, shift = 0, byte; do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128); return value; };
  while (offset < bytes.length) {
    const section = bytes[offset++], length = leb(), end = offset + length;
    if (section === 10) {
      const count = leb();
      for (let index = 0; index < count; index++) { const size = leb(); largest = Math.max(largest, size); offset += size; }
    }
    offset = end;
  }
  return largest;
}

async function main() {
  // Thousands of ordinary states must not be recombined by the optimizer.
  const source = `import type { PulseContext } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) {
  let total = 0;
  ${'total += 1;\n'.repeat(2000)}
  for (let i = 0; i < 4; i += 1) {
    if (i === 0) continue;
    if (i === 2) break;
    total += i;
  }
  if (ctx.req.path === '/negative') total = -total;
  const { first, second } = await ctx.parallel({ first: ctx.config.get('A'), second: ctx.config.get('B') });
  return ctx.text('' + total + first + second);
}`;
  const compiled = compileCanonicalSource(source, { fileName: path.join(__dirname, 'dispatcher-consumer.ts'), strict: false });
  const plan = buildCanonicalNativePlan(compiled);
  const native = compileCanonicalNativePlan(plan);
  const repeated = compileCanonicalNativePlan(plan);
  assert.deepEqual(repeated.wasm, native.wasm, 'partitioning remains deterministic');
  assert.equal(native.manifest.dispatcher.strategy, 'bounded-state-chunks');
  assert.ok(native.manifest.dispatcher.chunkCount > 20);
  assert.ok(largestFunctionBody(native.wasm) < 8192, 'optimized artifact must retain bounded functions');
  // An indivisible pure-loop state is retained and explicitly reported.
  const oversized = compileCanonicalSource(`import type { PulseContext } from '@pulse-compute/runtime';
export default function handler(ctx: PulseContext) {
  let value = 0;
  for (let i = 0; i < 2; i += 1) { ${'value += 1;'.repeat(1000)} }
  return ctx.text('' + value);
}`, { fileName: path.join(__dirname, 'oversized-state.ts'), strict: false });
  const oversizedGenerated = generateCanonicalNativeAssemblyScript(buildCanonicalNativePlan(oversized));
  assert.equal(oversizedGenerated.manifest.dispatcher.strategy, 'bounded-state-chunks');
  assert.equal(oversizedGenerated.manifest.dispatcher.oversizedStateCount, 1);
  const program = loadCanonicalModule(compiled);
  const adapter = { id: 'partition-test', dispatchEffect(effect) { return effect.name; } };
  for (const requestPath of ['/', '/negative']) {
    const options = { request: { method: 'GET', path: requestPath }, providerAdapter: adapter };
    const actual = await nativeHost.executeCanonicalNativeModule(native, options);
    const reference = await canonicalHost.createCanonicalHostRuntime(options).execute(program, options);
    assert.equal(actual.response.body, reference.response.body);
    assert.equal(actual.response.body, (requestPath === '/' ? '2001' : '-2001') + 'AB');
    assert.equal(actual.effectCount, 2);
  }
  const controller = nativeHost.instantiateCanonicalNativeModule(native, { request: { method: 'GET', path: '/' }, providerAdapter: adapter });
  assert.equal(controller.start(), 1);
  const pending = controller.pendingEffects();
  const pc = controller.programCounter(), continuation = controller.continuationState();
  assert.equal(controller.resume(), -2);
  assert.equal(controller.programCounter(), pc);
  assert.equal(controller.continuationState(), continuation);
  controller.setEffectResult(pending[0].ticket, controller.prepareEffectResult(0, 'A'));
  assert.equal(controller.exports.pulse_set_effect_result(0, 1), 0, 'duplicate result rejected');
  assert.equal(controller.resume(), -2, 'partial grouped results cannot resume');
  controller.setEffectResult(pending[1].ticket, controller.prepareEffectResult(1, 'B'));
  assert.equal(controller.resume(), 0);
  assert.equal(controller.response().body, '2001AB');
  console.log('ok - bounded Native dispatcher preserves branches, pure-loop control, grouped effects, resume validation and deterministic small functions');
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
