#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./o18-reusable-stage.cjs');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { compileProject } = require('../../../packages/cli/src/project-execution');
const { buildCanonicalNativePlan, validateCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { lowerSharedStages } = require('../../../packages/compiler/src/shared-stage-plan');
const { compileCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-compiler');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { createNodeProviderAdapter } = require('../../../../packages/provider-node/src/runtime/canonical-api-runtime');
const root = path.resolve(__dirname, '../../../..');

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-o19-'));
  try {
    fixture(2, cwd);
    const tc = acceptanceToolchain(), project = tc.resolveProject({ cwd, profile: 'native' });
    const compiled = compileProject(project, { target: 'native' });
    const plan = buildCanonicalNativePlan(compiled);
    const negativeChecks = require('./o19-stage-contract.cjs').check(plan);
    const expanded = buildCanonicalNativePlan(compiled, { sharedStages: false });
    const original = JSON.stringify(expanded);
    const entries = expanded.routing.entries.filter(e => e.handlerId === expanded.routing.entries[0].handlerId);
    const branch = p => p.entry.body.find(s => s.test?.right?.value === entries[1].index).then[0].then;
    for (const mutate of [
      p => { branch(p)[0].value = { kind: 'literal', value: 'different', valueKind: 'string' }; },
      p => { p.effects.find(e => e.routerEntryStableId === entries[1].stableId).inputs[0].value.value = 'different'; },
      p => { branch(p)[0].value = { kind: 'local', id: 'captured', valueKind: 'string' }; },
      p => { branch(p).push({ kind: 'effect-group', effectIds: [] }); },
      p => { branch(p).push({ kind: 'read-loop', body: [] }); },
      p => { p.routing.entries.find(e => e.stableId === entries[1].stableId).kind = 'error'; }
    ]) {
      const changed = JSON.parse(original); mutate(changed);
      assert.equal(lowerSharedStages(changed), changed, 'ineligible family keeps ordinary Native lowering');
    }
    assert.equal(JSON.stringify(expanded), original, 'factoring must not mutate its input');
    assert.equal(buildCanonicalNativePlan(compiled).planHash, plan.planHash);
    assert.notEqual(expanded.planHash, plan.planHash, 'the plan hash identifies actual lowering');

    // Two stage families, one and three effects, >16 registrations, no error
    // handler, and provider analyses whose only request-body/trim use is a stage.
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app=new Pulse({auto:true});
const first=async(ctx,next)=>{
  const text=await ctx.req.text();
  const value=await ctx.fetch('https://proof.test/one').text();
  ctx.state.set('first',text.trim()+':'+value);
  return next();
};
const second=async(ctx,next)=>{
  const a=await ctx.fetch('https://proof.test/two').text();
  const b=await ctx.fetch('https://proof.test/three?previous='+a).text();
  const c=await ctx.fetch('https://proof.test/four?previous='+b).text();
  ctx.state.set('second',a+':'+b+':'+c);
  return next();
};
${Array.from({ length: 17 }, (_, i) => `app.post('/${i}',first); app.post('/${i}',second); app.post('/${i}',async(ctx)=>ctx.text(ctx.state.get('first')+'|'+ctx.state.get('second')));`).join('\n')}
export default app;`);
    const multi = buildCanonicalNativePlan(compileProject(project, { target: 'native' }));
    assert.equal(multi.stages.length, 2);
    assert.deepEqual(multi.stages.map(s => s.effectIds.length), [1, 3]);
    assert.ok(multi.stages.every(s => s.registrations.length === 17));
    assert.equal(multi.effects.length, 68);
    assert.equal(new Set(multi.continuations.map(c => c.id)).size, 68);
    const roundtrip = JSON.parse(JSON.stringify(multi)); validateCanonicalNativePlan(roundtrip);
    const native = compileCanonicalNativePlan(roundtrip, { cwd: root, emitWat: false });
    const fastly = compileFastlyNativePlatformCapabilitiesPlan(roundtrip, { cwd: root, canonicalBuild: true,
      requirePlatformCapability: false, emitWat: false,
      bindings: { effectBackends: Object.fromEntries(multi.effects.map(e => [e.id, 'proof'])) } });
    assert.equal(native.manifest.stages.length, 2);
    assert.ok(native.manifest.guardStateCount > native.manifest.blockCount, 'sharing retains a registration-aware dispatch allowance');
    assert.ok(native.manifest.stages.every(s => s.chunks.length > 0 && s.bodyStates > 0));
    const values = { '/one': '1', '/two': '2', '/three': '3', '/four': '4' };
    let requests = 0;
    for (const index of [0, 1, 16]) {
      const request = { method: 'POST', path: '/' + index, url: 'https://app.test/' + index, body: `  input-${index}  ` };
      const expected = `input-${index}:1|2:3:4`;
      const adapter = createNodeProviderAdapter({ fetches: {
        'https://proof.test/one': { body: '1' }, 'https://proof.test/two': { body: '2' },
        'https://proof.test/three?previous=2': { body: '3' }, 'https://proof.test/four?previous=3': { body: '4' }
      } });
      const seen = [];
      const node = await tc.executeCanonicalNativeModule(native, { request, providerAdapter: { ...adapter,
        async dispatchEffect(effect, context) { seen.push(new URL(effect.parts.url).pathname); return adapter.dispatchEffect(effect, context); } } });
      assert.equal(node.response.body, expected); assert.deepEqual(seen, Object.keys(values));
      const outbound = [];
      const result = tc.executeFastlyNativePlatformCapabilities(fastly, { request,
        fixtures: { proof: Object.fromEntries(Object.entries(values).map(([key, body]) => [key, { status: 200, body }])) },
        onOutboundRequest(item) { outbound.push(new URL(item.url).pathname); } });
      assert.equal(result.response.body, expected); assert.deepEqual(outbound, Object.keys(values));
      requests += 2;
    }
    console.log(JSON.stringify({ status: 'passed', negativeChecks, fallbackChecks: 6, stages: 2, registrations: 34,
      requests, planHash: multi.planHash, nodeWasmBytes: native.wasm.length, fastlyWasmBytes: fastly.wasm.length }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack || error); if (error.detail) console.error(JSON.stringify({ ...error.detail, source: undefined })); if (error.diagnostics) console.error(JSON.stringify(error.diagnostics)); process.exitCode = 1; });
