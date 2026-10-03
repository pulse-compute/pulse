'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');

const root = path.resolve(__dirname, '../../..');
const tc = acceptanceToolchain();
const find = (value, predicate) => {
  if (!value || typeof value !== 'object') return;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = find(child, predicate);
    if (found) return found;
  }
};
const rehash = plan => {
  delete plan.planHash;
  plan.planHash = createHash('sha256').update(stableStringify(plan)).digest('hex');
  return plan;
};

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-s03-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'),
      "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},native:{host:'node',target:'native'},javascript:{host:'node',target:'javascript'}}));");
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'),
      "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';type Input={label?:string;id:string};export default defineSchemaRegistry({schemas:{'app.Input':schema<Input>()}});");
    fs.writeFileSync(path.join(cwd, 'src/helper.ts'), "export function check(value:string):boolean{return value==='ready';}");
    const prefix = "const input=await ctx.req.json('app.Input');const label=input.label;";
    const call = "return ctx.text(''+check(label));";
    const write = body => fs.writeFileSync(path.join(cwd, 'src/index.ts'),
      "import {Pulse} from '@pulse-compute/pulse';import {check} from './helper';const app=new Pulse({auto:true});app.post('/',async(ctx)=>{" + body + "});export default app;");
    const project = profile => tc.resolveProject({ cwd, profile });
    const compile = body => { write(body); return tc.compileNativeProjectInMemory(project('native')); };
    const positives = [
      `${prefix}if(label===undefined)return ctx.text('missing');${call}`,
      `${prefix}if(label!==undefined){${call}}return ctx.text('missing');`,
      `${prefix}if(label===undefined){return ctx.text('missing');}else{${call}}`,
      `${prefix}if(ctx.req.method==='POST'){if(label===undefined)return ctx.text('missing');}else{if(label===undefined)return ctx.text('missing');}${call}`,
    ];
    let executions = 0, first;
    for (const body of positives) {
      const compiled = compile(body); first ||= compiled.plan;
      validateCanonicalNativePlan(structuredClone(compiled.plan));
      const fastly = compileFastlyNativePlatformCapabilitiesPlan(compiled.plan,
        { cwd: root, canonicalBuild: true, emitWat: false, requirePlatformCapability: false });
      const javascript = tc.prepareJavascriptApplication(project('javascript'));
      const schemaCodecs = require('../../packages/schema-json/src/compiler/canonical-schema-codecs')
        .createCanonicalSchemaCodecs(compiled.plan.schemas.registry);
      for (const [payload, expected] of [[{ id: '1', label: 'ready' }, 'true'], [{ id: '1' }, 'missing']]) {
        const request = { method: 'POST', path: '/', url: 'https://s03.test/', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
        const native = await tc.executeCanonicalNativeModule(compiled.native, { request, strict: false });
        const platform = tc.executeFastlyNativePlatformCapabilities(fastly, { request });
        const js = await tc.executeNodeJavascriptApplication(javascript.loaded.application,
          new Request(request.url, { method: 'POST', body: request.body, headers: request.headers }), { strict: false, schemaCodecs });
        assert.equal(native.response.body, expected);
        assert.equal(platform.response.body, expected);
        assert.equal(await js.text(), expected);
        executions += 3;
      }
    }
    // A bounded application placement obtains an optional scalar from request
    // state, guards it, then passes the definite value to scalar validation.
    const stateVariants = [
      ["ctx.state.set('label','ready');", 'true'],
      ['', 'missing']
    ];
    let statePlan;
    for (const [setup, expected] of stateVariants) {
      const state = compile(setup + "const label=ctx.state.get('label');if(label===undefined)return ctx.text('missing');" + call);
      statePlan ||= state.plan;
      validateCanonicalNativePlan(structuredClone(state.plan));
      const stateFastly = compileFastlyNativePlatformCapabilitiesPlan(state.plan,
        { cwd: root, canonicalBuild: true, emitWat: false, requirePlatformCapability: false });
      const stateJs = tc.prepareJavascriptApplication(project('javascript'));
      const stateRequest = { method: 'POST', path: '/', url: 'https://s03.test/', headers: [], body: '' };
      assert.equal((await tc.executeCanonicalNativeModule(state.native, { request: stateRequest, strict: false })).response.body, expected);
      assert.equal(tc.executeFastlyNativePlatformCapabilities(stateFastly, { request: stateRequest }).response.body, expected);
      assert.equal(await (await tc.executeNodeJavascriptApplication(stateJs.loaded.application,
        new Request(stateRequest.url, { method: 'POST' }), { strict: false })).text(), expected);
      executions += 3;
    }
    const negatives = [
      `${prefix}${call}`,
      `${prefix}if(label!==undefined)return ctx.text('missing');${call}`,
      `${prefix}if(ctx.req.method==='POST'){if(label===undefined)return ctx.text('missing');}${call}`,
      `const input=await ctx.req.json('app.Input');let label=input.label;if(label===undefined)return ctx.text('missing');${call}`,
      `${prefix}if(label===undefined){}${call}`,
      `${prefix}if(label===null)return ctx.text('missing');${call}`,
      "const label=ctx.state.get('label');if(label===null)return ctx.text('missing');" + call,
    ];
    for (const [i, body] of negatives.entries()) assert.throws(() => compile(body), e =>
      e.diagnostics?.some(d => d.code === 'PULSE_NATIVE_PURE_HELPER_ARGUMENT_UNSUPPORTED'), `source ${i}`);
    const forged = structuredClone(first);
    const guard = find(forged.handlers, e => e.kind === 'binary' && e.right?.kind === 'undefined');
    assert.ok(guard);
    guard.operator = '!==';
    assert.throws(() => validateCanonicalNativePlan(rehash(forged)), e => e.name === 'CanonicalNativePlanError'
      && e.diagnostics?.some(d => d.message === 'pure argument kind mismatch')
      && !e.diagnostics?.some(d => d.message === 'plan hash mismatch'));
    const nullGuard = structuredClone(first);
    find(nullGuard.handlers, e => e.kind === 'binary' && e.right?.kind === 'undefined').right =
      { kind: 'literal', value: null, valueKind: 'null' };
    assert.throws(() => validateCanonicalNativePlan(rehash(nullGuard)), e => e.name === 'CanonicalNativePlanError'
      && e.diagnostics?.some(d => d.message === 'pure argument kind mismatch')
      && !e.diagnostics?.some(d => d.message === 'plan hash mismatch'));
    const forgedState = structuredClone(statePlan);
    find(forgedState.handlers, e => e.kind === 'intrinsic' && e.name === 'state.get').arguments = [];
    assert.throws(() => validateCanonicalNativePlan(rehash(forgedState)), e => e.name === 'CanonicalNativePlanError'
      && e.diagnostics?.some(d => d.message === 'pure argument kind mismatch')
      && !e.diagnostics?.some(d => d.message === 'plan hash mismatch'));
    console.log(JSON.stringify({ status: 'passed', positiveVariants: positives.length + stateVariants.length, executions,
      sourceRejections: negatives.length, forgedPlans: 3 }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
const keep = setInterval(() => {}, 1000);
main().catch(error => { console.error(error, error.diagnostics); process.exitCode = 1; }).finally(() => clearInterval(keep));
