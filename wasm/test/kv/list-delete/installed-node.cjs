'use strict';
// Copied into the isolated package consumer by the installed qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function main() {
  assert.equal(__dirname, process.cwd());
  const { resolveProject } = require('@pulse-compute/cli/project-config');
  const { compileNativeProjectInMemory, prepareJavascriptApplication } = require('@pulse-compute/cli/project-execution');
  const { executeCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
  const { createNodeProviderAdapter } = require('@pulse-compute/provider-node/runtime/canonical-api-runtime');
  const { createNodeJavascriptBindingCapabilities } = require('@pulse-compute/provider-node/javascript/bindings-adapter');
  const { executeNodeJavascriptApplication } = require('@pulse-compute/provider-node/javascript/runtime-host');
  const native = compileNativeProjectInMemory(resolveProject({ cwd: __dirname, profile: 'node-native' }));
  const javascript = prepareJavascriptApplication(resolveProject({ cwd: __dirname, profile: 'node-javascript' }));
  const scenarios = [];
  for (const target of ['node-native', 'node-javascript']) {
    const capabilities = createNodeJavascriptBindingCapabilities({ kv: { catalog: { 'user/a': 1, 'user/b': 2, 'user/雪': 3, other: 4 } } });
    const adapter = createNodeProviderAdapter({ kvReference: capabilities });
    async function invoke(command) {
      const body = JSON.stringify(command), headers = [['content-type', 'application/json']];
      let result;
      if (target === 'node-javascript') {
        const response = await executeNodeJavascriptApplication(javascript.loaded.application, new Request('http://kv.test/', { method: 'POST', headers, body }), { capabilities, strict: false });
        assert.equal(response.status, 200); result = await response.json();
      } else {
        const response = await executeCanonicalNativeModule(native.native, { providerAdapter: adapter, strict: false, request: { method: 'POST', path: '/', headers, body } });
        assert.equal(response.response.status, 200); result = JSON.parse(response.response.body);
      }
      scenarios.push({ target, command, result }); return result;
    }
    const first = await invoke({ operation: 'list', options: { limit: 2, prefix: 'user/' } });
    assert.deepEqual(first.keys, ['user/a', 'user/b']); assert.equal(typeof first.cursor, 'string');
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 2, prefix: 'user/', cursor: first.cursor } }), { status: 'listed', keys: ['user/雪'], cursor: null });
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 1, prefix: 'empty/' } }), { status: 'listed', keys: [], cursor: null });
    assert.deepEqual(await invoke({ operation: 'delete', key: 'user/a' }), { status: 'deleted' });
    assert.deepEqual(await invoke({ operation: 'delete', key: 'user/a' }), { status: 'not-found' });
    assert.deepEqual(await invoke({ operation: 'delete', key: 'missing' }), { status: 'not-found' });
    assert.deepEqual(await invoke({ operation: 'get', key: 'user/a' }), { status: 'not-found' });
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 0 } }), { status: 'failed', reason: 'invalid-options' });
    assert.deepEqual(await invoke({ operation: 'list', options: { limit: 1, cursor: 'invalid' } }), { status: 'failed', reason: 'invalid-cursor' });
    assert.deepEqual(await invoke({ operation: 'delete', key: '' }), { status: 'not-deleted', reason: 'invalid-key' });
    assert.deepEqual(await invoke({ operation: 'put', key: 'user/a', value: { revision: 2 } }), { stored: true });
    assert.deepEqual((await invoke({ operation: 'get', key: 'user/a' })).value, { revision: 2 });
    const parallel = await invoke({ operation: 'parallel', key: 'user/b', options: { limit: 1 } });
    assert.deepEqual([parallel.first.status, parallel.second.status].sort(), ['deleted', 'not-found']);
  }
  for (const file of Object.keys(require.cache)) assert.ok(file === __filename || file.startsWith(path.join(__dirname, 'node_modules') + path.sep), 'Installed probes cannot load workspace product modules: ' + file);
  const wasm = native.native.wasm;
  fs.writeFileSync(path.join(process.argv[2], 'node-native.wasm'), wasm);
  fs.writeFileSync(path.join(process.argv[2], 'node-scenarios.json'), JSON.stringify(scenarios, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', targets: ['node-native', 'node-javascript'], scenarios: scenarios.length, workspaceProductModules: 0, nativeWasmSha256: crypto.createHash('sha256').update(wasm).digest('hex') }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
