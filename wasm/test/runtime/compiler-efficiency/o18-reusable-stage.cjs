#!/usr/bin/env node
'use strict';

// Opt-in evidence, not a default CI lane or a production sharing transform.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { createNodeProviderAdapter } = require('../../../../packages/provider-node/src/runtime/canonical-api-runtime');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const root = path.resolve(__dirname, '../../../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const suffix = Array.from({ length: 16 }, (_, i) => `:${i}`).join('');

function fixture(count, cwd) {
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  fs.symlinkSync(path.join(root, 'packages/pulse'), path.join(cwd, 'node_modules/@pulse-compute/pulse'), 'dir');
  const stage = `const stage=async(ctx,next)=>{
  const input=ctx.req.header('x-input')||'';
  const mode=ctx.req.header('x-mode')||'';
  if(mode==='early')return ctx.text('early:'+input,{status:409});
  let value=input;
  ${Array.from({ length: 16 }, (_, i) => `value=value+':${i}';`).join('\n  ')}
  ctx.state.set('value',value);
  const first=await ctx.fetch('https://proof.test/first').text();
  if(mode==='stop')return ctx.text('stop:'+value+':'+first,{status:409});
  if(mode==='error')return next({code:'STAGE_ERROR',message:'stage rejected'});
  const second=await ctx.fetch('https://proof.test/second').text();
  ctx.state.set('value',value+':'+first+':'+second);
  return next();
}; export default stage;`;
  const entry = `import {Pulse} from '@pulse-compute/pulse';
import stage from './stage';
const app=new Pulse({auto:true});
${Array.from({ length: count }, (_, i) => `app.get('/chain/${i}',stage);
app.get('/chain/${i}',async(ctx)=>{
  const done=await ctx.fetch('https://proof.test/terminal').text();
  return ctx.text('${i}|'+ctx.state.get('value')+'|'+done);
});`).join('\n')}
app.error(async(error,ctx,next)=>ctx.text((error.code==='PULSE_RUNTIME_UNHANDLED_ERROR'?error.cause.message:error.code)+'|'+ctx.state.get('value'),{status:418}));
export default app;`;
  fs.writeFileSync(path.join(cwd, 'src/stage.ts'), stage);
  fs.writeFileSync(path.join(cwd, 'src/index.ts'), entry);
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},native:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));`);
  return { sourceSha256: hash(stage + '\n' + entry), stageBytes: Buffer.byteLength(stage) };
}

async function measure(count) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-o18-'));
  try {
    const source = fixture(count, cwd), tc = acceptanceToolchain();
    const started = performance.now();
    const project = tc.resolveProject({ cwd, profile: 'native' });
    const { compiled, plan, native } = tc.compileNativeProjectInMemory(project, { emitWat: false });
    const portableBuildMs = performance.now() - started;
    const fastlyStarted = performance.now();
    const fastly = compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, canonicalBuild: true,
      requirePlatformCapability: false, emitWat: false,
      bindings: { effectBackends: Object.fromEntries(plan.effects.map(effect => [effect.id, 'proof'])) } });
    const fastlyBuildMs = performance.now() - fastlyStarted;
    const js = tc.prepareJavascriptApplication(tc.resolveProject({ cwd, profile: 'js' }));
    const entries = compiled.metadata.router.entries.filter(entry => entry.kind === 'route' && entry.index % 2 === 0);
    assert.equal(entries.length, count);
    assert.equal(new Set(entries.map(entry => entry.handlerId)).size, 1, 'One authored stage reused at every chain');
    const stageIds = new Set(entries.map(entry => entry.stableId));
    const sites = plan.effects.filter(effect => stageIds.has(effect.routerEntryStableId));
    assert.equal(sites.length, 2 * count);
    assert.equal(new Set(sites.map(effect => effect.id)).size, sites.length);
    assert.equal(new Set(sites.map(effect => effect.continuationId)).size, sites.length);
    const ranges = entries.map(entry => entry.generatedRange);
    assert.ok(ranges.every(range => range && range.end > range.start));

    let requests = 0;
    const javascriptFailures = [];
    async function execute(target, index, input, mode = '', pause) {
      const value = input + suffix;
      const expected = mode === 'early' ? [409, 'early:' + input, []]
        : mode === 'stop' ? [409, 'stop:' + value + ':one', ['/first']]
        : mode === 'error' ? [418, 'STAGE_ERROR|' + value, ['/first']]
        : [200, `${index}|${value}:one:two|done`, ['/first', '/second', '/terminal']];
      const request = { method: 'GET', path: `/chain/${index}`, url: `https://app.test/chain/${index}`,
        headers: [['x-input', input], ['x-mode', mode]] };
      const seen = [], bodies = { '/first': 'one', '/second': 'two', '/terminal': 'done' };
      let response;
      if (target === 'node') {
        const adapter = createNodeProviderAdapter({ fetches: Object.fromEntries(Object.entries(bodies).map(([key, body]) => ['https://proof.test' + key, { body }])) });
        const result = await tc.executeCanonicalNativeModule(native, { request, providerAdapter: { ...adapter,
          async dispatchEffect(effect, context) {
            const pathname = new URL(effect.parts.url).pathname; seen.push(pathname);
            if (pause && pathname === '/first') await pause();
            return adapter.dispatchEffect(effect, context);
          } } });
        response = result.response;
        assert.equal(result.effectCount, expected[2].length);
        assert.equal(result.continuations.length, expected[2].length);
        for (const continuation of result.continuations) {
          assert.ok(continuation.states.includes('resumed'));
          assert.equal(continuation.states.at(-1), 'completed');
        }
        const allowed = new Set(plan.effects.filter(effect => [entries[index].stableId, compiled.metadata.router.entries[index * 2 + 1].stableId].includes(effect.routerEntryStableId)).map(effect => effect.id));
        for (const event of result.trace.filter(event => event.type === 'native-effect-start')) assert.ok(allowed.has(event.effectId), 'Effect belongs to selected registration');
      } else if (target === 'fastly') {
        ({ response } = tc.executeFastlyNativePlatformCapabilities(fastly, { request,
          fixtures: { proof: Object.fromEntries(Object.entries(bodies).map(([key, body]) => [key, { status: 200, body }])) },
          onOutboundRequest(item) { seen.push(new URL(item.url).pathname); } }));
      } else {
        const result = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { headers: request.headers }), {
          strict: false, fetchImplementation: async url => { const pathname = new URL(url).pathname; seen.push(pathname); return new Response(bodies[pathname]); }
        });
        response = { status: result.status, body: await result.text() };
      }
      requests++;
      const actual = [response.status, response.body, seen];
      if (target === 'javascript' && JSON.stringify(actual) !== JSON.stringify(expected)) {
        javascriptFailures.push({ index, input, mode, expected, actual });
      } else assert.deepEqual(actual, expected, `${target}: chain ${index}, ${mode || 'normal'}, ${input}`);
    }
    for (const target of ['node', 'fastly', 'javascript']) {
      for (let index = 0; index < count; index++) await execute(target, index, `request-${index}`);
      for (const mode of ['early', 'stop', 'error', '']) await execute(target, count - 1, 'after-' + mode, mode);
    }
    // Keep A suspended while B completes, then resume A with its original locals.
    let release, arrived;
    const held = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { arrived = resolve; });
    const a = execute('node', 0, 'isolated-A', '', () => { arrived(); return held; });
    try { await Promise.race([waiting, a.then(() => { throw new Error('A never suspended'); })]);
      await execute('node', count - 1, 'isolated-B');
    } finally { release(); await a; }
    const artifact = built => ({ sourceBytes: Buffer.byteLength(built.source), wasmBytes: built.wasm.length, wasmSha256: hash(built.wasm) });
    return { chains: count, ...source, authoredStageBodies: 1, expandedStageRanges: ranges.length,
      expandedStageCharacters: ranges.reduce((sum, range) => sum + range.end - range.start, 0),
      preservedStageBodies: (plan.handlers || []).filter(handler => stageIds.has(handler.id)).length,
      stageEffectSites: sites.length, locals: plan.locals.length, blocks: native.manifest.blockCount,
      node: artifact(native), fastly: artifact(fastly), portableBuildMs, fastlyBuildMs,
      semantics: { status: javascriptFailures.length ? 'failed' : 'passed', requests, interleavedNativeRequests: 2,
        native: 'passed', fastly: 'passed', javascriptFailures },
      sharingGate: { status: 'blocked', reason: 'No verified single retained effectful-stage body; registration-owned ranges are expanded. Source reuse and helper merging are insufficient proof.' } };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

async function main() {
  if (process.argv[2] === '--worker') {
    const count = Number(process.argv[3]); assert.ok([1, 2, 16].includes(count));
    console.log(JSON.stringify(await measure(count))); return;
  }
  let output, requireSharing = false;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--require-sharing') requireSharing = true;
    else if (arg === '--output') { output = process.argv[++index]; assert.ok(output && path.isAbsolute(output), '--output requires an absolute path'); }
    else throw new Error('Unknown argument: ' + arg);
  }
  const rows = [];
  for (const count of [1, 2, 16]) {
    rows.push(JSON.parse(execFileSync(process.execPath, [__filename, '--worker', String(count)], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 })));
    console.error(`O-18: ${count} chains measured; semantics ${rows.at(-1).semantics.status}; sharing gate blocked`);
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const report = { version: 1, status: 'measured', sharingGate: 'blocked', compilerCommit: git(['rev-parse', 'HEAD']),
    worktree: git(['status', '--porcelain']), probeSha256: hash(fs.readFileSync(__filename)),
    note: 'Serial fresh workers; one timing observation per cell, not a build-time improvement claim. No production transform is enabled.', rows };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (requireSharing) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); if (error.diagnostics) console.error(JSON.stringify(error.diagnostics)); process.exitCode = 1; });
