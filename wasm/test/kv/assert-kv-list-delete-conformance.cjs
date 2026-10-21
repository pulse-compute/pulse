'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const { compileCanonicalSource, loadCanonicalModule } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const { createNodeKvReference } = require('../../../packages/provider-node/src/runtime/conditional-kv');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host');
async function main() {
  const filename = path.join(__dirname, 'list-delete/consumer.ts'), source = fs.readFileSync(filename, 'utf8');
  const compiled = compileCanonicalSource(source, { fileName: filename, strict: false });
  const plan = buildCanonicalNativePlan(compiled), native = compileCanonicalNativePlan(plan), program = loadCanonicalModule(compiled);
  const live = new Module(filename, module); live.filename = filename; live.paths = module.paths;
  live._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  for (const target of ['javascript', 'native', 'generator']) {
    const ref = createNodeKvReference({ kv: { catalog: { 'item/a': null, 'item/b': null, 'item/雪': null, 'other': null } } });
    async function invoke(command) {
      const request = { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: JSON.stringify(command) };
      const adapter = createNodeProviderAdapter({ kvReference: ref });
      if (target === 'javascript') return (await executeNodeJavascriptApplication(live.exports.default, new Request('http://kv.test/', { method: 'POST', headers: request.headers, body: request.body }), { kvReference: ref, strict: false })).json();
      const result = target === 'native' ? await nativeHost.executeCanonicalNativeModule(native, { request, strict: false, providerAdapter: adapter })
        : await canonicalHost.createCanonicalHostRuntime({ providerAdapter: adapter }).execute(program, { request, strict: false });
      return JSON.parse(result.response.body);
    }
    const first = await invoke({ operation: 'list', options: { limit: 2, prefix: 'item/' } }); assert.deepEqual(first.keys, ['item/a', 'item/b']);
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 2, prefix: 'item/', cursor: first.cursor } }), { status: 'listed', keys: ['item/雪'], cursor: null });
    assert.deepEqual(await invoke({ operation: 'delete', key: 'item/a' }), { status: 'deleted' });
    assert.deepEqual(await invoke({ operation: 'delete', key: 'item/a' }), { status: 'not-found' });
    assert.deepEqual(await invoke({ operation: 'get', key: 'item/a' }), { status: 'not-found' });
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 1, cursor: 'rejected' } }), { status: 'failed', reason: 'invalid-cursor' });
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 101 } }), { status: 'failed', reason: 'invalid-options' });
    const race = await invoke({ operation: 'parallel', key: 'item/b', options: { limit: 1 } }); assert.deepEqual([race.first.status, race.second.status].sort(), ['deleted', 'not-found']);
    assert.deepEqual(await invoke({ operation: 'put', key: 'item/a', value: { revision: 1 } }), { stored: true });
    assert.deepEqual((await invoke({ operation: 'get', key: 'item/a' })).value, { revision: 1 });
    console.log(`ok - KV list/delete ${target} actual execution, pagination, deletion, parallel race and existing get/put compatibility`);
  }
  for (const method of ['list({limit:1})', "delete('key')"]) assert.throws(() => compileCanonicalSource(`export default async function h(ctx) { const result = await ctx.kv(ctx.req.header('store')).${method}; return ctx.json(result); }`, { fileName: 'invalid.ts', strict: false }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
