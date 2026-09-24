#!/usr/bin/env node
'use strict';

// Optional paired evidence against a dependency-restored checkout of the base.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function sourceFor(count) {
  const lines = ["import { Router } from '@pulse-compute/runtime'; const app = new Router();",
    "app.use((ctx, next) => { const gate = ctx.fetch('https://proof.test/gate').text(); if (gate === 'stop') return ctx.text('stopped'); return next(); });"];
  for (let index = 0; index < count; index++) lines.push(`app.get('/route/${index}', ctx => {
    let value = 0; ${'value += 1;'.repeat(16)}
    const reply = ctx.fetch('https://proof.test/value/${index}').text();
    return ctx.text('${index}:' + value + ':' + reply);
  });`);
  lines.push("app.error((error, ctx, next) => ctx.text(error.code, {status: 400})); export default app;");
  return lines.join('\n');
}

async function worker(repository, projectRoot, target, count) {
  const load = file => require(path.join(repository, file));
  const compilerSourcesSha256 = hash(JSON.stringify([
    'wasm/packages/compiler/src/spine/router-handler-ir.js',
    'wasm/packages/compiler/src/spine/handler-ir.js',
    'wasm/packages/compiler/src/spine/handler-ir-emitter.js',
    'wasm/packages/compiler/src/spine/canonical-handler-ir.js',
    'wasm/packages/compiler/src/canonical-native-plan.js',
    'wasm/packages/contracts/src/handler/canonical-native-plan.js',
    'wasm/packages/contracts/src/handler/canonical-native-runtime.js',
    'wasm/packages/runtime-core-as/src/compiler/canonical-native.js',
    'packages/provider-fastly/src/build/native-string-values.js',
    'packages/provider-fastly/src/build/native-platform-capabilities.js'
  ].map(file => [file, hash(fs.readFileSync(path.join(repository, file)))])));
  const { compileCanonicalProject } = load('wasm/packages/compiler/src/canonical-project-compiler');
  const { buildCanonicalNativePlan } = load('wasm/packages/compiler/src/canonical-native-plan');
  const compile = target === 'node'
    ? load('wasm/packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan
    : load('packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan;
  const started = performance.now();
  const project = compileCanonicalProject(path.join(projectRoot, 'src/index.ts'), { rootDir: projectRoot, workspaceRoot: repository });
  const plan = buildCanonicalNativePlan(project);
  const planningMs = performance.now() - started;
  const bindings = { effectBackends: Object.fromEntries(plan.effects.map(effect => [effect.id, 'proof'])) };
  const compiled = compile(plan, { cwd: repository, canonicalBuild: true, requirePlatformCapability: false, bindings });
  const buildMs = performance.now() - started;
  const compilerWorkerPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  const request = { method: 'GET', path: `/route/${count - 1}` };
  const coldStart = performance.now();
  let semantics;
  if (target === 'node') {
    const { executeCanonicalNativeModule } = load('wasm/packages/host-runtime/src/runtime/canonical-native-host');
    const { createNodeProviderAdapter } = load('packages/provider-node/src/runtime/canonical-api-runtime');
    const providerAdapter = createNodeProviderAdapter({ fetches: {
      'https://proof.test/gate': { body: 'go' },
      [`https://proof.test/value/${count - 1}`]: { body: 'done' }
    } });
    const seen = [];
    const options = { request, providerAdapter: { ...providerAdapter, dispatchEffect(effect, context) {
      seen.push(effect.parts.url); return providerAdapter.dispatchEffect(effect, context);
    } } };
    const result = await executeCanonicalNativeModule(compiled, options);
    assert.equal(result.response.body, `${count - 1}:16:done`);
    assert.equal(result.effectCount, 2);
    assert.deepEqual(seen, ['https://proof.test/gate', `https://proof.test/value/${count - 1}`]);
    const coldExecutionMs = performance.now() - coldStart;
    const limitedSeen = [];
    await assert.rejects(executeCanonicalNativeModule(compiled, { ...options, maxEffects: 1,
      providerAdapter: { ...providerAdapter, dispatchEffect(effect, context) {
        limitedSeen.push(effect.parts.url); return providerAdapter.dispatchEffect(effect, context);
      } } }), error => error.code === 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED');
    assert.deepEqual(limitedSeen, ['https://proof.test/gate']);
    semantics = { body: result.response.body, status: result.response.status, effects: seen,
      handles: result.valueHandleCount, states: result.continuations.map(site => site.states), limitedEffects: limitedSeen };
    semantics.coldExecutionMs = coldExecutionMs;
  } else {
    const { executeFastlyNativePlatformCapabilities } = load('packages/provider-fastly/src/testing/native-platform-capabilities-host');
    const seen = [];
    const result = executeFastlyNativePlatformCapabilities(compiled, { request,
      fixtures: { proof: { '/gate': { status: 200, body: 'go' }, [`/value/${count - 1}`]: { status: 200, body: 'done' } } },
      onOutboundRequest(item) { seen.push(new URL(item.url).pathname); }
    });
    assert.equal(result.response.body, `${count - 1}:16:done`);
    assert.deepEqual(seen, ['/gate', `/value/${count - 1}`]);
    semantics = { body: result.response.body, status: result.response.status, effects: seen,
      coldExecutionMs: performance.now() - coldStart };
  }
  const coldExecutionMs = semantics.coldExecutionMs;
  delete semantics.coldExecutionMs;
  const portable = target === 'node' ? compiled.manifest
    : load('wasm/packages/runtime-core-as/src/compiler/canonical-native').generateCanonicalNativeAssemblyScript(plan).manifest;
  console.log(JSON.stringify({ target, count, compilerSourcesSha256, planningMs, buildMs, firstExecutionMs: coldExecutionMs, compilerWorkerPeakRssBytes,
    sourceBytes: Buffer.byteLength(compiled.source), wasmBytes: compiled.wasm.length, wasmSha256: hash(compiled.wasm),
    bodyCount: plan.handlers?.length || 0,
    ownedLocals: plan.locals.filter(local => local.routerEntryStableId).length,
    localCount: plan.locals.length, dispatcher: portable.dispatcher,
    blockCount: portable.blockCount,
    sites: plan.effects.map(effect => [effect.id, effect.continuationId, effect.routerEntryStableId]), semantics }));
}

async function main() {
  if (process.argv[2] === '--worker') return worker(process.argv[3], process.argv[4], process.argv[5], Number(process.argv[6]));
  assert.equal(process.platform, 'linux', 'RSS collection uses Linux resourceUsage units');
  const baseline = process.env.PULSE_B02_BASELINE_ROOT;
  assert.ok(baseline && fs.existsSync(path.join(baseline, 'wasm/packages/compiler/src/canonical-native-plan.js')),
    'Set PULSE_B02_BASELINE_ROOT to a restored checkout of the pre-B02 commit');
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-b02-cost-'));
  try {
    const measuredSources = new Map();
    fs.mkdirSync(path.join(temporaryRoot, 'src'));
    fs.writeFileSync(path.join(temporaryRoot, 'src/index.ts'), sourceFor(32));
    const usageFile = path.join(temporaryRoot, 'usage.cjs');
    fs.writeFileSync(usageFile, `if (/assemblyscript.*asc\\.js$/.test(process.argv[1] || '')) process.once('exit', () => require('node:fs').writeFileSync(require('node:path').join(process.env.PULSE_B02_USAGE_DIR, process.pid + '.json'), JSON.stringify({pid:process.pid,rss:process.resourceUsage().maxRSS*1024})));`);
    for (const target of ['node', 'fastly']) for (let sample = 0; sample < 3; sample++) {
      const rows = [];
      for (const recipe of sample % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const usageDir = path.join(temporaryRoot, `${target}-${sample}-${recipe}`);
        fs.mkdirSync(usageDir);
        const result = spawnSync(process.execPath, [__filename, '--worker', recipe === 'baseline' ? path.resolve(baseline) : root, temporaryRoot, target, '32'], {
          encoding: 'utf8', timeout: 120000,
          env: { ...process.env, PULSE_B02_USAGE_DIR: usageDir,
            NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(usageFile)}` }
        });
        assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
        const row = JSON.parse(result.stdout.trim());
        if (measuredSources.has(recipe)) assert.equal(row.compilerSourcesSha256, measuredSources.get(recipe), 'all samples must measure the same compiler sources');
        measuredSources.set(recipe, row.compilerSourcesSha256);
        const rss = fs.readdirSync(usageDir).map(file => JSON.parse(fs.readFileSync(path.join(usageDir, file))).rss);
        assert.ok(rss.length > 0, 'AssemblyScript compiler RSS must be observed independently');
        row.assemblyScriptPeakRssBytes = Math.max(...rss);
        rows.push(row);
        console.log(JSON.stringify({ recipe, sample, fixtureSha256: hash(sourceFor(32)), ...row }));
      }
      assert.deepEqual(rows[0].semantics, rows[1].semantics, 'responses, effects, continuation lifecycle, allocation and budget boundary remain exact');
      assert.deepEqual(rows[0].sites, rows[1].sites, 'static effect and owning entry identities remain exact');
      assert.equal(rows[0].localCount, rows[1].localCount, 'separation does not add live local slots');
      assert.equal(rows[0].blockCount, rows[1].blockCount, 'separation does not add charged Native states');
    }
  } finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
