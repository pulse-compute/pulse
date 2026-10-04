#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const fastly = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const fastlyHost = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { executeRouter } = require('../../../packages/runtime/src/internal/index.js');
const fixture = path.resolve(__dirname, '../fixtures/router-selected-groups/index.ts');
const source = fs.readFileSync(fixture, 'utf8');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-selected-groups-'));
  try {
    const compiled = compileCanonicalProject(fixture, { rootDir: path.dirname(fixture), workspaceRoot: root });
    const entries = compiled.metadata.router.entries;
    const mounts = entries.filter(e => e.eligibility);
    assert.equal(mounts.length, 4);
    for (const mount of mounts) {
      const block = compiled.router.sourceText.slice(mount.generatedBlockRange.start, mount.generatedBlockRange.end);
      assert.ok(block.includes(`ctx.state.get(${JSON.stringify(mount.eligibility.state)}) === ${JSON.stringify(mount.eligibility.equals)}`), block);
      assert.match(block, new RegExp(`else \\{\\s*__pulse_router_cursor = ${mount.parentContinueIndex};`));
    }
    const changed = compileCanonicalRouterSource(source.replace("equals: 'collection'", "equals: 'other'"), { fileName: fixture, rootDir: root });
    const original = compileCanonicalRouterSource(source, { fileName: fixture, rootDir: root });
    assert.notEqual(changed.metadata.entries.find(e => e.eligibility).stableId, original.metadata.entries.find(e => e.eligibility).stableId);
    const plan = buildCanonicalNativePlan(compiled);
    assert.equal(plan.effects.length, 2, 'each family effect has one placement');
    assert.equal(plan.continuations.length, 2);
    const portable = compileCanonicalNativePlan(plan, { cwd: root });
    const bindings = { effectBackends: Object.fromEntries(plan.effects.map(e => [e.id, 'effects'])) };
    const native = fastly.compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, bindings, canonicalBuild: true, requirePlatformCapability: false });
    const emitted = fastly.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, { cwd: root, bindings, canonicalBuild: true, requirePlatformCapability: false }).source;
    for (const marker of ['collection.enter>', 'collection.effect>', 'collection.finish>', 'history.enter>', 'history.effect>', 'tail>']) {
      assert.equal(emitted.split(JSON.stringify(marker)).length - 1, 1, `one emitted placement: ${marker}`);
    }
    assert.equal(native.inspection.imports.some(e => /pulse_host|wasi|js[_-]?compute/i.test(`${e.module}:${e.name}`)), false);
    // Execute original async source through the live runtime, not normalized compiler output.
    const js = ts.transpileModule(source.replace('@pulse-compute/runtime', path.join(root, 'packages/runtime/src/index.js')), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const entry = path.join(tmp, 'app.cjs'); fs.writeFileSync(entry, js);
    const app = require(entry).default;
    const collection = 'collection.enter>collection.effect>collection.finish>';
    const cases = [
      ...['items', 'requests', 'hosting'].map(p => ({ path: '/api/' + p, prefix: collection, value: 'collection', effect: 'collection' })),
      { path: '/api/items', mode: 'terminal', expected: collection + 'collection', effect: 'collection' },
      { path: '/api/items', mode: 'error', status: 409, expected: collection + 'collection.error>parent.error>REFUSED', effect: 'collection' },
      { path: '/api/items', mode: 'error', local: '1', status: 409, expected: collection + 'collection.error>REFUSED', effect: 'collection' },
      { path: '/api/items/42/history', prefix: 'history.enter>history.effect>id=42>', value: 'history', effect: 'history' },
      { path: '/api/items/42' }, { path: '/api/requests', method: 'POST' },
      { path: '/api/unknown' }, { path: '/outside', family: 'collection' },
      { path: '/api/items', mode: 'preerror', status: 409, expected: 'parent.error>EARLY' }, { path: '/api/items', method: 'PUT' }
    ];
    for (const c of cases) {
      const events = [];
      const method = c.method || 'GET';
      const headers = { 'x-mode': c.mode || 'continue', 'x-local': c.local || '', 'x-family': c.family || '' };
      const expected = { status: c.status || 200, body: c.expected || (c.prefix || '') + 'tail>' + (c.value || '') + '|' + method + '|' + c.path };
      const response = await executeRouter(app, new Request('https://fixture.test' + c.path, { method, headers }), {
        effectAdapter: { id: 'selected-groups', dispatch: async effect => {
          const family = new URL(effect.url).pathname.slice(1);
          events.push('suspend:' + family);
          await new Promise(resolve => setImmediate(resolve));
          events.push('resume:' + family);
          return new Response(family);
        } }
      });
      assert.deepEqual({ status: response.status, body: await response.text() }, expected, JSON.stringify(c));
      assert.deepEqual(events, c.effect ? ['suspend:' + c.effect, 'resume:' + c.effect] : []);
      const request = { method, path: c.path, url: 'https://fixture.test' + c.path, headers };
      const fetches = { 'https://effects.test/collection': { body: 'collection' }, 'https://effects.test/history': { body: 'history' } };
      const pr = await nativeHost.executeCanonicalNativeModule(portable, { request, fetches, providerAdapter: createNodeProviderAdapter({ fetches }) });
      assert.deepEqual({ status: pr.response.status, body: pr.response.body }, expected);
      const nr = fastlyHost.executeFastlyNativePlatformCapabilities(native, { request, fixtures: { effects: { '/collection': { body: 'collection' }, '/history': { body: 'history' } } } });
      assert.deepEqual({ status: nr.response.status, body: nr.response.body }, expected);
      assert.equal(nr.outboundRequests.length, c.effect ? 1 : 0);
    }
    for (const value of ['async ctx => await ctx.config.get("family")', '{ state: "family", equals: readFamily() }', '{ state: "family", equals: "collection", extra: true }', '{ state: "family" }', '{ state: "family", state: "other" }', '{ ["state"]: "family", equals: "collection" }', '{ get state() { return "family" }, equals: "collection" }', '{ ...selection }', 'selection', '{ state: "family", equals: 1 }']) {
      assert.throws(() => compileCanonicalRouterSource(source.replace("{ state: 'family', equals: 'collection' }", value), { fileName: fixture, rootDir: root }), e => e.diagnostics?.some(d => d.code === 'PULSEWASM_UNSUPPORTED_MOUNT_ELIGIBILITY'), value);
    }
    const { extractFromSourceFile } = require('../../packages/compiler/src/extractor.js');
    assert.throws(() => extractFromSourceFile(ts.createSourceFile(fixture, source, ts.ScriptTarget.ES2022, true)), e => e.diagnostics?.some(d => d.code === 'PULSEWASM_UNSUPPORTED_MOUNT_ELIGIBILITY' && /canonical Router compiler/.test(d.message)));
    console.log(JSON.stringify({ status: 'passed', cases: cases.length, executions: cases.length * 3, effects: plan.effects.length, continuations: plan.continuations.length, nativeBytes: native.wasm.length }));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
