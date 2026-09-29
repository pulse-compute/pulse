'use strict';

// Feasibility evidence only: existing storage-read continuations, not an output API.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const root = path.resolve(__dirname, '../../..');
const source = `export default async function handler(ctx) {
  let last = '';
  for (let i = 0; i < 64; i++) {
    const row = await ctx.kv('pages').getVersioned('p');
    if (row.status !== 'found') return ctx.text(last);
    last = row.value;
  }
  return ctx.text(last);
}`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function main() {
  const outputRoot = path.join(root, 'wasm/.test-results');
  fs.mkdirSync(outputRoot, { recursive: true });
  const output = fs.mkdtempSync(path.join(outputRoot, 'str03-'));
  const report = {
    status: 'running', scope: 'injected-host Native retention evidence; no streaming qualification',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    runnerSha256: hash(fs.readFileSync(__filename)), fixtureSha256: hash(source), rows: []
  };
  try {
    const plan = buildCanonicalNativePlan(compileCanonicalSource(source, {
      fileName: 'str03-retention.ts', requireAsync: true, strict: false
    }));
    const native = compileCanonicalNativePlan(plan, { cwd: root });
    fs.writeFileSync(path.join(output, 'probe.wasm'), native.wasm);
    fs.writeFileSync(path.join(output, 'fixture.ts'), source);
    report.wasmSha256 = hash(native.wasm);
    report.wasmBytes = native.wasm.length;
    for (const count of [1, 16, 64]) {
      const controller = host.instantiateCanonicalNativeModule(native, { strict: false });
      let status = controller.start(), supplied = 0, firstTicket, last;
      try {
        while (status === 1) {
          const pending = controller.pendingEffects();
          assert.equal(pending.length, 1);
          const { ticket, effect } = pending[0];
          assert.equal(effect.kind, 'kv.getVersioned');
          firstTicket ||= ticket;
          if (supplied < count) {
            last = String(supplied).padStart(4, '0') + 'x'.repeat(16380);
            controller.setEffectResult(ticket, { status: 'found', value: last, generation: 'g' });
            supplied++;
          } else controller.setEffectResult(ticket, { status: 'not-found' });
          status = controller.resume();
        }
        assert.equal(status, 0);
        assert.equal(controller.response().body, last);
        // Overwriting the only authored local does not release earlier payload handles.
        const retained = [...controller.heap.values.values()].filter(value =>
          typeof value === 'string' && value.length === 16384 && value.endsWith('x'));
        assert.equal(new Set(retained).size, count);
        assert.throws(() => controller.setEffectResult(firstTicket, { status: 'not-found' }),
          { code: 'PULSE_EFFECT_INVOCATION_INVALID' });
        report.rows.push({ count, finalResponseBytes: Buffer.byteLength(last),
          distinctRetainedPayloadBytes: count * 16384,
          valueHandles: controller.heap.size(), accounted: controller.heap.budget.snapshot(),
          guestLinearMemoryBytes: controller.exports.memory.buffer.byteLength });
      } finally { controller.close(); }
    }
    assert.ok(report.rows[2].accounted.bytes > report.rows[1].accounted.bytes);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error); throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: path.join(output, 'report.json'), ...report }));
  }
}
if (require.main === module) main();
module.exports = { main };
