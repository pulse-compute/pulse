'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan: compile } = require('../../packages/compiler/src/canonical-native-compiler');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { HOST_POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const { withBoxedHostControl, executionSemantics: comparable } = require('../support/host-numeric-control.cjs');
const { source: fastlySource, schemaBundle } = require('../provider/assert-fastly-numeric-regions.cjs');
const source = fastlySource.replace('body:sent', "body:''+sent");
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const options = { reportCapture: false, emitWat: false };
function pair(plan) { return [compile(plan, options), withBoxedHostControl(c => c.compileCanonicalNativePlan(plan, options))]; }
async function execute(artifact, extra = {}) {
  return host.executeCanonicalNativeModule(artifact, { executionId: 'numeric-proof', strict: false, providerAdapter: createNodeProviderAdapter(), ...extra });
}
function checkPlan(plan, numeric, boxed) {
  assert.equal(numeric.manifest.numericRegions.policy, HOST_POLICY);
  assert(numeric.manifest.numericRegions.regions.length > 0);
  assert.equal(boxed.manifest.numericRegions, undefined);
  const a = generate(plan, { numericRegions: HOST_POLICY }), b = generate(plan);
  const shape = x => x.blocks.map(({ lines, ...block }) => block);
  assert.deepEqual(shape(a), shape(b)); assert.equal(a.manifest.guardStateCount, b.manifest.guardStateCount);
  assert.equal(numeric.source, a.source);
}
async function failureParity(artifacts, request) {
  // Settle the first effect after abort: no later effect or response may run.
  const outcomes = [];
  for (const artifact of artifacts) {
    let release, ready, calls = 0;
    const admitted = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
    const pending = execute(artifact, { request, signal: abort.signal, providerAdapter: { id: 'node', dispatchEffect() {
      calls++; ready(); return new Promise(resolve => { release = resolve; });
    } } });
    const rejected = assert.rejects(pending, { code: 'PULSE_RUNTIME_EFFECT_ABORTED' });
    await admitted; abort.abort(new Error('fixture abort')); await rejected;
    release(new Response('late')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); outcomes.push(calls);
  }
  assert.deepEqual(outcomes, [1, 1]);
}
async function main() {
  const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'node-numeric.ts', schemaBundle, strict: false, target: 'native' }));
  const artifacts = pair(plan); checkPlan(plan, ...artifacts);
  const fetches = { 'https://numeric.test/first': { status: 200, body: 'first' }, 'https://numeric.test/slow': { status: 200, body: 'slow', delayMs: 5 }, 'https://numeric.test/fast': { status: 200, body: 'fast' } };
  const handler = new Function(source.replace('export default', 'return'))();
  for (const n of [0, -3, 0.25, 9007199254740992]) {
    const request = { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: JSON.stringify({ n }) };
    const results = [];
    for (const artifact of artifacts) results.push(await execute(artifact, { request, fetches }));
    assert.deepEqual(comparable(results[0]), comparable(results[1]));
    assert(results[0].valueHandleCount < results[1].valueHandleCount);
    const expected = await handler({ req: { json: async () => ({ n }) }, fetch: url => ({ text: async () => fetches[url].body }), parallel: async items => Object.fromEntries(await Promise.all(Object.entries(items).map(async ([k, v]) => [k, await v]))), json: v => v });
    assert.deepEqual(JSON.parse(results[0].response.body), expected);
  }
  const request = { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: '{"n":1}' };
  await failureParity(artifacts, request);
  // Explicit transport rejection and fresh invocation after cancellation.
  for (const artifact of artifacts) {
    await assert.rejects(execute(artifact, { request, providerAdapter: { id: 'node', dispatchEffect() { throw new Error('numeric transport failure'); } } }), /numeric transport failure/);
    assert.equal((await execute(artifact, { request, fetches })).response.status, 200);
  }
  for (const capability of ['response.output', 'request.body.transform']) {
    const disabled = generate({ ...plan, capabilities: [...plan.capabilities, capability] }, { numericRegions: HOST_POLICY });
    assert.equal(disabled.manifest.numericRegions.enabled, false);
    assert.equal(disabled.source, generate({ ...plan, capabilities: [...plan.capabilities, capability] }).source);
  }
  const readPlan = buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx) {
    let n=70000;for(let i=0;i<1;i++){const row=await ctx.kv('pages').getVersioned('p');for(let j=0;j<64;j++){n+=1;}}return ctx.text(''+n);
  }`, { fileName: 'node-numeric-budget.ts', strict: false, target: 'native' }));
  const budgeted = pair(readPlan);
  assert.equal(budgeted[0].manifest.numericRegions.reason, 'execution-budget');
  assert.equal(budgeted[0].source, budgeted[1].source, 'Budget charges and exhaustion retain exactly the old emission');
  const budgetResults = [];
  for (const artifact of budgeted) budgetResults.push(await execute(artifact, { request, kv: { pages: {} } }));
  assert.deepEqual(comparable(budgetResults[0]), comparable(budgetResults[1]));
  assert(budgetResults[0].memory);
  const largePlan = buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx) {
    let n=70000;for(let i=0;i<512;i++){n+=1;}return ctx.text(''+n);
  }`, { fileName: 'node-numeric-cap.ts', strict: false, target: 'native' }));
  const large = pair(largePlan);
  assert.equal(large[0].manifest.numericRegions.regions.length, 0);
  assert.equal(large[0].source, large[1].source, 'Unqualified loop caps retain the boxed path');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-node-numeric-owners-'));
  try {
    require('../provider/assert-fastly-numeric-owners.cjs').writeOwnerProject(cwd);
    const tc = acceptanceToolchain(), project = tc.resolveProject({ cwd, profile: 'node' });
    const built = tc.compileNativeProjectInMemory(project, options), owners = [built.native, withBoxedHostControl(c => c.compileCanonicalNativePlan(built.plan, options))];
    checkPlan(built.plan, ...owners); assert.equal(built.plan.stages.length, 2);
    const js = tc.prepareJavascriptApplication(tc.resolveProject({ cwd, profile: 'js' }));
    const codecs = require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(built.plan.schemas.registry);
    for (const route of ['/', '/other']) for (const n of [-3, 0.25]) for (const body of ['ok', 'stop']) {
      const req = { ...request, path: route, url: 'https://owners.test' + route, body: JSON.stringify({ n }) };
      const fixtures = { 'https://numeric-owner.test/a': { status: 200, body }, 'https://numeric-owner.test/b': { status: 200, body: 'ok' } };
      const a = await execute(owners[0], { request: req, fetches: fixtures }), b = await execute(owners[1], { request: req, fetches: fixtures });
      assert.deepEqual(comparable(a), comparable(b));
      const jr = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(req.url, { method: req.method, headers: req.headers, body: req.body }), { strict: false, schemaCodecs: codecs, fetchImplementation: async url => new Response(String(url).endsWith('/a') ? body : 'ok') });
      assert.equal(a.response.body, await jr.text()); assert.equal(a.response.status, jr.status);
    }
    await failureParity(owners, request);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-node-numeric-linked-'));
  try {
    require('../provider/assert-fastly-numeric-owners.cjs').writeProject(linkedRoot, {
      '.pulse/config.ts': `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false,crypto:['ES256']},node:{host:'node',target:'native'}}));`,
      'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import {jwt} from '@pulse-compute/jwt';const app=new Pulse({auto:true});app.post('/',async ctx=>{
        const token=await jwt.sign(ctx,{sub:'numeric-proof'},{algorithm:'ES256',key:{type:'secret',binding:'TEST_KEY'},expiresInSeconds:60});
        let n=70000;for(let i=0;i<64;i++){n+=1;}return ctx.text(''+n);
      });export default app;`,
    });
    fs.symlinkSync(path.resolve(__dirname, '../../../packages/jwt'), path.join(linkedRoot, 'node_modules/@pulse-compute/jwt'), 'dir');
    const tc = acceptanceToolchain(), project = tc.resolveProject({ cwd: linkedRoot, profile: 'node' });
    const built = tc.compileNativeProjectInMemory(project, options);
    assert(built.native.guestUnits.length > 0); assert(built.native.guestLink);
    assert.equal(built.native.manifest.numericRegions, undefined, 'Linked guests are not opted into the host policy');
    assert.equal(built.native.source, generate(built.plan).source);
  } finally { fs.rmSync(linkedRoot, { recursive: true, force: true }); }
  console.log('ok - Node numeric regions: entry/helper/stage parity, aliases, collections, IEEE, effects, cancellation, fallbacks and project selection');
}
module.exports = { main, pair, comparable };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
