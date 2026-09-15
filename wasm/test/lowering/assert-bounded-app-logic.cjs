#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const ts = require('typescript');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { buildCanonicalSchemaBundle, createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const jsHost = require('../../../packages/provider-node/src/javascript/runtime-host.js');
const { Router } = require('../../../packages/runtime/src/index.js');
const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const httpHost = require('../../../packages/provider-fastly/src/testing/native-http-effects-host.js');
const platformHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');

const repoRoot = path.resolve(__dirname, '../../..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/bounded-app-logic');
const source = fs.readFileSync(path.join(fixture, 'src/handler.ts'), 'utf8');
const authorModule = {};
Function('exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(authorModule);
const handler = authorModule.default;
const registry = extractSchemaRegistry(path.join(fixture, 'src/schemas.ts'), { projectRoot: fixture }).registry;
const bundle = buildCanonicalSchemaBundle(registry, { maxBytes: 16384 });
const codecs = createCanonicalSchemaCodecs(bundle.registry);
const compile = (text, target = 'native') => compileCanonicalSource(text, { fileName: 'bounded-app-logic.ts', requireAsync: true, target, schemaBundle: bundle });

function rehash(plan) {
  delete plan.planHash;
  plan.planHash = crypto.createHash('sha256').update(stableStringify(plan)).digest('hex');
  return plan;
}

async function main() {
  const rejected = [
    'for(let i=0;i<items.length;i++){sum+=i}',
    'for(let i=0;items.length>i && i<8;i++){sum+=i}',
    'for(let i=0;i<1025;i++){sum+=i}',
    'for(let i=0;i<1.5;i++){sum+=i}',
    'for(let i=1;i<8;i++){sum+=i}',
    'for(var i=0;i<8;i++){sum+=i}',
    'for(let i=0;i<8;i--){sum+=i}',
    'for(let i=0;i<8;i++){i=0}',
    'for(let i=0;i<8;i++){[i]=[0]}',
    'for(let i=0;i<8;i++){if(sum>0){i--}}',
    'for(let i=0;i<8 && (sum=0);i++){sum+=i}',
    'for(let i=0;i<8;i++){let i=0}',
    'for(let i=0;i<1024;i++){for(let j=0;j<65;j++){sum++}}',
    'for(let i=0;i<8;i++){for(let i=0;i<8;i++){sum++}}',
    'for(let i=0;i<8;i++){for(let j=0;j<8;j++){i=0}}',
    "for(let i=0;i<8;i++){await ctx.fetch('https://objects.invalid/candidate')}",
    "for(let i=0;i<8;i++){ctx.state.set('key','value')}",
    "for(let i=0;i<8;i++){ctx.log.info('message')}",
    'for(let i=0;i<8;i++){const x=ctx.req.path}',
    'for(let i=0;i<8;i++){sum=helper(i)}',
    'for(let i=0;i<8;i++){items.filter(x=>x)}',
    'for(let i=0;i<8;i++){const x=()=>i}',
    "for(let i=0;i<8;i++){return ctx.text('done')}",
    'for(let i=0;i<8;i++){while(true){sum++}}',
    'for(let i=0;i<8;i++){break outer}',
    'for(let i=0;i<8;i++){items[0].trim(1)}',
  ];
  for (const target of ['native', 'javascript']) for (const loop of rejected) {
    assert.throws(() => compile(`export default async function handler(ctx) {const items=[1];let sum=0;${loop};return ctx.json({sum})}`, target),
      error => error.diagnostics?.some(item => item.code === 'PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED' || item.code === 'PULSE_NATIVE_AWAIT_UNSUPPORTED'), `${target}: ${loop}`);
  }
  const compiled = compile(source);
  compile(source, 'javascript');
  const plan = buildCanonicalNativePlan(compiled);
  assert.ok(plan.entry.body.some(statement => statement.kind === 'pure-loop'));
  assert.equal(plan.effects.length, 1, 'collection processing adds no effects or continuations');
  for (const [expected, mutate] of [
    ['pure loop iteration bound', node => { node.maxIterations = 1025; }],
    ['non-value statement', node => { node.body.push({ kind: 'effect', effectId: plan.effects[0].id, continuationId: plan.effects[0].continuationId }); }],
    ['counter mutation', node => { node.body.push({ kind: 'expression', expression: { kind: 'update', target: { kind: 'local', id: node.localId }, operator: '--' } }); }],
    ['non-value call', node => { node.body.push({ kind: 'expression', expression: { kind: 'intrinsic', name: 'state.get', arguments: [] } }); }],
  ]) {
    const changed = JSON.parse(JSON.stringify(plan));
    mutate(changed.entry.body.find(statement => statement.kind === 'pure-loop'));
    assert.throws(() => validateCanonicalNativePlan(rehash(changed)), error => error.diagnostics?.some(item => item.message.includes(expected)), expected);
  }
  const native = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  assert.match(native.source, /for \(let __pulse_iteration_/);
  const providerOptions = { cwd: repoRoot, backends: { 'https://objects.invalid': 'objects' }, requirePlatformCapability: false };
  const fastlyHttp = http.compileFastlyNativeHttpEffectsPlan(plan, providerOptions);
  const fastlyPlatform = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, providerOptions);
  for (const artifact of [fastlyHttp, fastlyPlatform]) assert.ok(!artifact.inspection.imports.some(entry => /env|pulse_host|js[_-]?compute/.test(entry.module)));

  const app = new Router();
  app.post('/', handler);
  app.error(async (error, ctx) => ctx.text(String(error.cause?.message || error.message), { status: 500 }));
  async function execute(lane, text, mode = '') {
    const sent = [];
    const request = { method: 'POST', path: '/', body: text, headers: [['content-type', 'application/json'], ['x-mode', mode]] };
    try {
      if (lane === 'javascript') {
        const response = await jsHost.executeNodeJavascriptApplication(app, new Request('https://app.test/', request), {
          schemaCodecs: codecs, async fetchImplementation(_url, init) { sent.push(init.body); return new Response('stored'); }
        });
        return { status: response.status, body: await response.text(), sent };
      }
      if (lane === 'native') {
        const result = await nativeHost.executeCanonicalNativeModule(native, { request, providerAdapter: { id: 'node', async dispatchEffect(effect) {
          sent.push(effect.init.body); return { status: 200, body: 'stored', headers: [] };
        } } });
        return { ...result.response, sent };
      }
      const options = { request, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } };
      const result = lane === 'fastly-http' ? httpHost.executeFastlyNativeHttpEffects(fastlyHttp, options) : platformHost.executeFastlyNativePlatformCapabilities(fastlyPlatform, options);
      return { ...result.response, sent: result.outboundRequests?.map(entry => entry.body), trace: result.trace };
    } catch (error) { return { error, sent, trace: error.detail?.trace || [] }; }
  }
  const base = { title: ' Catalog 🙂 ', target: 'resource', command: 'original', items: [], grants: [], receipts: [] };
  const emptyResult = { title: 'Catalog 🙂', selected: [], visits: 0, member: false, replay: '' };
  const vectors = [
    [base, emptyResult],
    [{ ...base, items: [{ id: ' first ', version: 3 }, { id: 'skip', version: 1 }, { id: 'stop', version: 1 }, { id: 'unseen', version: 1 }],
      grants: [{ target: 'other', members: ['actor'] }, { target: 'resource', members: ['other', 'actor'] }], receipts: [{ command: 'newer', result: 'current' }, { command: 'original', result: 'retained' }] },
    { title: 'Catalog 🙂', selected: [{ id: 'first', version: 4 }], visits: 3, member: true, replay: 'retained' }],
    [{ ...base, grants: [{ target: 'other', members: ['actor'] }, { target: 'resource', members: ['other'] }] }, emptyResult],
    [{ ...base, items: Array.from({ length: 64 }, (_, i) => ({ id: `item${i}`, version: i })) },
    { ...emptyResult, selected: Array.from({ length: 64 }, (_, i) => ({ id: `item${i}`, version: i + 1 })), visits: 64 }],
  ];
  const whitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  for (const title of [whitespace + 'é e\u0301 東京 🙂' + whitespace, '\u0085x\u0085', '\u180ex\u200b', ' x\ud800 ', ' a\u00a0b ']) vectors.push([{ ...base, title }, { ...emptyResult, title: title.trim() }]);
  const lanes = ['javascript', 'native', 'fastly-http', 'fastly-platform'];
  for (const [input, expected] of vectors) {
    const text = JSON.stringify({ unknown: true, ...input }, null, 2) + '\n';
    for (const lane of lanes) {
      const result = await execute(lane, text);
      assert.equal(result.error, undefined, `${lane}: ${result.error?.stack}`);
      assert.equal(result.status, 200, `${lane}: ${result.body}`);
      assert.deepEqual(JSON.parse(result.body), expected, `${lane}: ${input.title}`);
      if (lane === 'fastly-http') assert.equal(result.trace.filter(entry => entry.name === 'send_async').length, 1);
      else assert.deepEqual(result.sent, [text], `${lane}: preserve original bytes`);
    }
  }
  for (const input of [{ ...base, title: whitespace }, { ...base, items: Array.from({ length: 65 }, () => ({ id: 'x', version: 1 })) }, { ...base, grants: [{ target: 'resource', members: Array(9).fill('actor') }] }]) {
    for (const lane of lanes) {
      const result = await execute(lane, JSON.stringify(input));
      assert.equal(result.status, 400, lane);
      assert.ok(!result.trace?.some(entry => entry.name === 'send_async'), `${lane}: invalid input dispatched a write`);
      if (result.sent) assert.deepEqual(result.sent, []);
    }
  }
  for (const lane of lanes) {
    const result = await execute(lane, JSON.stringify(base), 'wrong-type');
    assert.ok(result.error || result.status === 500, `${lane}: non-string trim must fail`);
    assert.deepEqual(result.sent, []);
    assert.ok(!result.trace?.some(entry => entry.name === 'send_async'), `${lane}: value failure dispatched a write`);
  }
  const router = compileCanonicalRouterSource("import {Router} from '@pulse-compute/runtime';const app=new Router();app.get('/',async(ctx)=>{let sum=0;for(let i=0;i<1024;i++){for(let j=0;j<64;j++){sum+=1}}for(let k=0;k<0;k++){sum=0}const stored=await ctx.fetch('https://objects.invalid/candidate').text();return ctx.json({sum})});export default app", { fileName: 'loop-router.ts', requireAsync: true });
  const routerCompiled = compileCanonicalSource(router.sourceText, { fileName: 'loop-router.ts',
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata } });
  const routerPlan = buildCanonicalNativePlan(routerCompiled);
  const routerNative = compileCanonicalNativePlan(routerPlan, { cwd: repoRoot });
  const result = await nativeHost.executeCanonicalNativeModule(routerNative, { request: { method: 'GET', path: '/' }, providerAdapter: { id: 'node', async dispatchEffect() { return { status: 200, body: 'stored', headers: [] }; } } });
  assert.deepEqual(JSON.parse(result.response.body), { sum: 65536 });
  // A value error must suppress effects even with no schema reference in the plan.
  const invalid = buildCanonicalNativePlan(compileCanonicalSource("export default async function handler(ctx) { const value=await ctx.req.json(); const title=value.title.trim(); const stored=await ctx.fetch('https://objects.invalid/candidate',{method:'POST',body:title}).text(); return ctx.text(stored) }", { fileName: 'raw-trim.ts', requireAsync: true, strict: false }));
  assert.equal(invalid.schemas.references.length, 0);
  const invalidRequest = { method: 'POST', path: '/', body: '{"title":7}', headers: [['content-type', 'application/json']] };
  for (const [compiler, host] of [[http.compileFastlyNativeHttpEffectsPlan, httpHost.executeFastlyNativeHttpEffects], [platform.compileFastlyNativePlatformCapabilitiesPlan, platformHost.executeFastlyNativePlatformCapabilities]]) {
    const artifact = compiler(invalid, providerOptions);
    assert.throws(() => host(artifact, { request: invalidRequest, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } }), error => {
      assert.equal(error.detail.errorStage, 56);
      assert.ok(!error.detail.trace.some(entry => entry.name === 'send_async'));
      return true;
    });
    const maximum = compiler(routerPlan, providerOptions);
    assert.deepEqual(JSON.parse(host(maximum, { request: { method: 'GET', path: '/' }, fixtures: { 'https://objects.invalid/candidate': { status: 200, body: 'stored' } } }).response.body), { sum: 65536 });
  }
  const event = compileCanonicalProject(path.join(fixture, 'src/event.ts'), {
    rootDir: fixture, workspaceRoot: repoRoot, requireAsync: true, requireEffectAwait: true,
    applicationProjectMetadata: {
      selectedProfile: { name: 'test', source: 'bounded-app-logic' }, strict: true, target: 'native', host: 'node',
      projectHash: '3'.repeat(64), configPlanHash: '4'.repeat(64), bindings: { config: [], secret: [] }, fragments: {}
    }
  });
  const eventNative = compileCanonicalNativePlan(buildCanonicalNativePlan(event), { cwd: repoRoot });
  const logs = [];
  const eventResult = await nativeHost.executeCanonicalNativeEvent(eventNative, { version: 'pulse.event-frame.v1', type: 'values.inspect', schemaId: null }, { log: (_level, _message, entry) => logs.push(entry) });
  assert.equal(eventResult.status, 'completed');
  assert.ok(logs.some(entry => entry.message === 'total:28'));
  // Reuse the CLI suite's isolated workspace-package fixture pattern. This is
  // development evidence, not the combined exact-tarball release gate.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-bounded-app-logic-'));
  try {
    fs.cpSync(fixture, projectRoot, { recursive: true, filter: file => !['dist', 'node_modules'].some(name => file.split(path.sep).includes(name)) });
    const packageScope = path.join(projectRoot, 'node_modules/@pulse-compute');
    fs.mkdirSync(packageScope, { recursive: true });
    const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/pulse-release-manifest.json'), 'utf8'));
    for (const pkg of release.packages) fs.symlinkSync(path.join(repoRoot, pkg.dir), path.join(packageScope, pkg.name.split('/')[1]), process.platform === 'win32' ? 'junction' : 'dir');
    function run(args, timeout = 60000) {
      const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    }
    run([path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', 'src/index.ts', 'src/event.ts']);
    for (const profile of ['local', 'javascript', 'fastly']) {
      const tested = JSON.parse(run([path.join(repoRoot, 'wasm/scripts/pulse.cjs'), 'test', '--profile', profile, '--json']));
      assert.equal(tested.status, 'passed', profile);
      const built = JSON.parse(run([path.join(repoRoot, 'wasm/scripts/pulse.cjs'), 'build', '--profile', profile, '--json']));
      assert.equal(built.status, 'built', profile);
      console.log(`ok - public project ${profile}: three harness cases and build`);
    }
  } finally { fs.rmSync(projectRoot, { recursive: true, force: true }); }
  console.log(`ok - bounded application logic: ${rejected.length * 2} admission negatives, four plan mutations, ${vectors.length * lanes.length} value/byte cases, 16 pre-write rejection cases, and maximum nested Router execution`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
