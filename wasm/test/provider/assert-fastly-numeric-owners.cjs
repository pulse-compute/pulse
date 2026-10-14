'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const { withBoxedControl } = require('../support/numeric-region-control.cjs');
const root = path.resolve(__dirname, '../../..');

function writeProject(cwd, files) {
  const common = {
    '.pulse/config.ts': `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'},fastly:{host:'fastly',target:'native',fastly:{bindings:{backends:{'https://numeric-owner.test':'numeric'}}}}}));`,
    'src/types.ts': 'export interface Input {n:number}',
    'src/schemas.ts': `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {Input} from './types';export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>()}});`,
  };
  for (const [name, source] of Object.entries({ ...common, ...files })) {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); fs.writeFileSync(path.join(cwd, name), source);
  }
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  fs.symlinkSync(path.join(root, 'packages/pulse'), path.join(cwd, 'node_modules/@pulse-compute/pulse'), 'dir');
}

function writeOwnerProject(cwd) {
    writeProject(cwd, {
      'src/helpers.ts': `
export function choose(mode:number):number {
  if(mode===0)return 7;
  let n=70000;let alias=n;for(let i=0;i<64;i++){n+=0.25;}
  if(mode===2){let z=80000;for(let j=0;j<0;j++){z+=1;}return z;}
  return n+alias;
}
export function unknown(value:number):number {let n=value;for(let i=0;i<4;i++){n+=1;}return n;}
export function early():number {let n=70000;for(let i=0;i<64;i++){n+=1;if(i===3)return n;}return n;}
export function edges():boolean {
  let neg=0;let nan=1;let inf=1;let large=9007199254740992;let fraction=0;
  for(let i=0;i<4;i++){neg=0*-1;nan=0/0;inf=1/0;large+=1;fraction+=0.1;if(i===1)continue;if(i===2)break;}
  return 1/neg<0 && nan!==nan && inf>0 && large===9007199254740992 && fraction===0.1+0.1+0.1;
}`,
      'src/shared.ts': `export default async function shared(ctx,next) {
  let n=70000;let old=n;for(let i=0;i<64;i++){n+=0.25;}
  const saved={n,old};
  const text=await ctx.fetch('https://numeric-owner.test/a',{method:'POST',body:''+n}).text();
  if(text==='stop')return ctx.text('stopped:'+saved.n);
  n=80000;for(let j=0;j<2;j++){n+=1;}
  const trace=ctx.state.get('trace')||'';
  ctx.state.set('trace',trace+saved.n+':'+saved.old+':'+n+';');return next();
}`,
      'src/second.ts': `export default async function second(ctx,next) {
  let n=90000;for(let i=0;i<4;i++){n+=1;}
  const text=await ctx.fetch('https://numeric-owner.test/b',{method:'POST',body:''+n}).text();
  ctx.state.set('second',''+n);return next();
}`,
      'src/terminal.ts': `import {choose,unknown,early,edges} from './helpers';
export default async function terminal(ctx) {
  const input=await ctx.req.json('proof.Input');
  const first=choose(1);const saved={first};const zero=choose(0);const other=choose(2);const again=choose(1);
  let total=0;for(let i=0;i<3;i++){total+=choose(1);}
  const result={saved,zero,other,again,total,unknown:unknown(input.n),early:early(),edges:edges(),trace:ctx.state.get('trace'),second:ctx.state.get('second')};
  return ctx.json(result);
}`,
      'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import shared from './shared';import second from './second';import terminal from './terminal';
const app=new Pulse({auto:true});app.post('/',shared);app.use(shared);app.use(second);app.post('/',terminal);app.post('/other',terminal);export default app;`,
    });
}

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-numeric-owners-'));
  try {
    writeOwnerProject(cwd);
    const tc = acceptanceToolchain(), project = tc.resolveProject({ cwd, profile: 'node' });
    const { plan } = tc.compileNativeProjectInMemory(project, { reportCapture: false, emitWat: false });
    assert.equal(plan.helpers.length, 4); assert.equal(plan.stages.length, 2);
    const before = JSON.stringify(plan), portable = generate(plan), optimized = generate(plan, { numericRegions: POLICY });
    assert.equal(JSON.stringify(plan), before);
    const shape = generated => generated.blocks.map(({ lines, ...block }) => block);
    assert.deepEqual(shape(optimized), shape(portable), 'Control IDs, ownership and continuation blocks are unchanged');
    assert.equal(optimized.manifest.guardStateCount, portable.manifest.guardStateCount);
    assert.equal(generate(plan).source, portable.source, 'Default/Node emission stays deterministic');
    const selectedPaths = optimized.manifest.numericRegions.regions.flatMap(r => r.statementPaths);
    for (const helper of plan.helpers) {
      const paths = selectedPaths.filter(p => p.startsWith(`helpers.${helper.id}.`));
      assert.equal(paths.length > 0, ['choose', 'edges'].includes(helper.source.name), helper.source.name);
    }
    for (const stage of plan.stages) assert(selectedPaths.some(p => stage.body.some(s => s.statementPath === p)), 'Each actual stage selects numeric regions');
    for (const capability of ['response.output', 'request.body.transform']) {
      const disabled = generate({ ...plan, capabilities: [...plan.capabilities, capability] }, { numericRegions: POLICY });
      assert.equal(disabled.manifest.numericRegions.enabled, false); assert.equal(disabled.manifest.numericRegions.regions.length, 0);
    }
    const options = { cwd, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, reportCapture: false, bindings: { backends: { 'https://numeric-owner.test': 'numeric' } } };
    const control = withBoxedControl(p => p.compileFastlyNativePlatformCapabilitiesPlan(plan, options));
    const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
    const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
    const js = tc.prepareJavascriptApplication(tc.resolveProject({ cwd, profile: 'js' }));
    const codecs = require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(plan.schemas.registry);
    const fixtures = { 'https://numeric-owner.test/a': { status: 200, body: 'ok' }, 'https://numeric-owner.test/b': { status: 200, body: 'ok' } };
    for (const route of ['/', '/other']) for (const n of [-3, 0.25]) {
      const request = { method: 'POST', path: route, url: 'https://owners.test' + route, body: JSON.stringify({ n }), headers: [['content-type', 'application/json']] };
      const opts = { request, fixtures };
      const a = tc.executeFastlyNativePlatformCapabilities(artifact, opts), b = tc.executeFastlyNativePlatformCapabilities(control, opts);
      assert.deepEqual(a.response, b.response); assert.deepEqual(a.trace, b.trace); assert.deepEqual(a.outboundRequests, b.outboundRequests);
      const jr = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: request.method, body: request.body, headers: request.headers }), { strict: false, schemaCodecs: codecs, fetchImplementation: async () => new Response('ok') });
      assert.equal(a.response.status, 200); assert.equal(jr.status, 200); assert.deepEqual(JSON.parse(a.response.body), JSON.parse(await jr.text()));
      const value = JSON.parse(a.response.body);
      assert.deepEqual(value.saved, { first: 140016 }); assert.equal(value.zero, 7); assert.equal(value.other, 80000); assert.equal(value.again, 140016); assert.equal(value.total, 420048);
      assert.equal(value.unknown, n + 4); assert.equal(value.early, 70004); assert.equal(value.second, '90004');
      assert.equal(value.edges, true);
      assert.equal(value.trace, '70016:70000:80002;'.repeat(route === '/' ? 2 : 1));
      for (const failure of [{ status: 200, body: 'stop' }, { sendStatus: 1 }, { neverHeaders: true }]) {
        const failed = { ...opts, fixtures: { ...fixtures, 'https://numeric-owner.test/a': failure } };
        const outcome = build => { try { return tc.executeFastlyNativePlatformCapabilities(build, failed).response; } catch (e) { return { code: e.code, detail: e.detail }; } };
        assert.deepEqual(outcome(artifact), outcome(control), 'Stage early transfer/failure/deadline parity');
      }
    }
    console.log('ok - numeric owners: repeated pure calls, snapshots, unknown inputs, early returns, IEEE values, two stage families, effects and failure parity');
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
module.exports = { main, writeProject, writeOwnerProject };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
