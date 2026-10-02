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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-s02-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'),
      "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},native:{host:'node',target:'native'},javascript:{host:'node',target:'javascript'}}));");
    fs.writeFileSync(path.join(cwd, 'src/helper.ts'), "export function check(value:string):boolean{return value==='hello';}export function checkRecord(value:{kind:string;owner:string}):boolean{return value.kind==='hello';}");
    const write = body => fs.writeFileSync(path.join(cwd, 'src/index.ts'),
      "import {Pulse} from '@pulse-compute/pulse';import {" + (body.includes('checkRecord(') ? 'checkRecord' : 'check') + "} from './helper';const app=new Pulse({auto:true});app.post('/',async(ctx)=>{"
      + body + "});export default app;");
    const project = profile => tc.resolveProject({ cwd, profile });
    const compile = body => { write(body); return tc.compileNativeProjectInMemory(project('native')); };
    const wideRecord = Array.from({ length: 24 }, (_, i) => `f${i}:''`).join(',');
    const wideUpdates = Array.from({ length: 7 }, (_, i) => `record={...record,f${i}:'hello'};`).join('');
    const wideChecks = Array.from({ length: 7 }, (_, i) => `check(record.f${i})`).join('&&');
    const positives = [
      "let record={kind:'',owner:'known'};record={...record,kind:'hello'};return ctx.text(''+check(record.kind));",
      "const value=await ctx.req.text();let record={kind:'',owner:'known'};record={...record,kind:value};return ctx.text(''+check(record.kind));",
      "let record={meta:{kind:'hello'},owner:'known'};record={...record,owner:'other'};return ctx.text(''+check(record.meta.kind));",
      `let record={${wideRecord}};${wideUpdates}return ctx.text(''+(${wideChecks}));`
    ];
    let plan, dynamicPlan, executions = 0;
    for (const [index, body] of positives.entries()) {
      const compiled = compile(body);
      plan ||= compiled.plan;
      if (index === 1) dynamicPlan = compiled.plan;
      validateCanonicalNativePlan(structuredClone(compiled.plan));
      const fastly = compileFastlyNativePlatformCapabilitiesPlan(compiled.plan, {
        cwd: root, canonicalBuild: true, emitWat: false, requirePlatformCapability: false
      });
      const javascript = tc.prepareJavascriptApplication(project('javascript'));
      const request = { method: 'POST', path: '/', url: 'https://s02.test/', headers: [], body: 'hello' };
      const native = await tc.executeCanonicalNativeModule(compiled.native, { request, strict: false });
      const platform = tc.executeFastlyNativePlatformCapabilities(fastly, { request });
      const js = await tc.executeNodeJavascriptApplication(javascript.loaded.application, new Request(request.url, { method: 'POST', body: 'hello' }), { strict: false });
      assert.equal(native.response.body, 'true');
      assert.equal(platform.response.body, 'true');
      assert.equal(await js.text(), 'true');
      executions += 3;
    }
    const call = p => find(p.handlers, e => e.kind === 'pure-helper-call');
    const forgedField = structuredClone(plan);
    call(forgedField).arguments[0].property = 'missing';
    const rejectedProjection = error => error.name === 'CanonicalNativePlanError'
      && error.diagnostics?.some(d => d.message === 'pure argument kind mismatch')
      && !error.diagnostics?.some(d => d.message === 'plan hash mismatch');
    assert.throws(() => validateCanonicalNativePlan(rehash(forgedField)), rejectedProjection);
    const forgedSpread = structuredClone(plan);
    const spread = find(forgedSpread.handlers, e => e.kind === 'spread');
    spread.value = { kind: 'literal', value: 1, valueKind: 'number' };
    assert.throws(() => validateCanonicalNativePlan(rehash(forgedSpread)), rejectedProjection);
    const forgedText = structuredClone(dynamicPlan);
    find(forgedText.handlers, e => e.kind === 'intrinsic' && e.name === 'request.text').arguments = [
      { kind: 'literal', value: 'unexpected', valueKind: 'string' }
    ];
    assert.throws(() => validateCanonicalNativePlan(rehash(forgedText)), error => error.name === 'CanonicalNativePlanError'
      && !error.diagnostics?.some(d => d.message === 'plan hash mismatch'));
    const negatives = [
      "let record={kind:'hello',owner:'known'};record={...record,kind:3};return ctx.text(''+check(record.kind));",
      "let record={kind:'hello',owner:'known'};const alias=record;record={...alias,owner:'other'};return ctx.text(''+check(record.kind));",
      "let record={kind:'hello',owner:'known'};record={...record,owner:'other'};return ctx.text(''+checkRecord(record));",
      "let record={kind:'hello',owner:'known'};const alias=record;record={...record,owner:'other'};alias.kind='bad';return ctx.text(''+check(record.kind));",
      "const unknown=await ctx.req.json();const record={...unknown,kind:'hello'};return ctx.text(''+check(record.kind));",
      "let record={kind:'hello',owner:'known'};record={...record,owner:undefined};return ctx.text(''+check(record.kind));"
    ];
    for (const [i, body] of negatives.entries()) {
      assert.throws(() => compile(body), error => Boolean(error.diagnostics?.length), `negative source ${i}`);
    }
    console.log(JSON.stringify({ status: 'passed', positiveVariants: positives.length, executions,
      sourceRejections: negatives.length, forgedPlans: 3, semantics: 'proven bounded record spread preserves required scalar field facts' }));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const keep = setInterval(() => {}, 1000);
main().catch(error => { console.error(error, error.diagnostics); process.exitCode = 1; }).finally(() => clearInterval(keep));
