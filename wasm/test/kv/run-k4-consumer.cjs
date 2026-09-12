#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { toolchain, project } = require('./k4/toolchain.cjs');
const { scenarios } = require('./k4/scenarios.cjs');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function main(options = {}) {
  const cwd = options.packedRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-k4-consumer-'));
  const tools = toolchain(options.packedRoot);
  // Required, with no skip result or emulated fallback. Inspect before building.
  const launcher = options.compute && tools.inspectFastlyComputeLauncher({ env: process.env, timeoutMs: 5000 });
  let server;
  try {
    project(cwd, options.packedRoot);
    const node = tools.compileNativeProjectInMemory(tools.resolveProject({ cwd, profile: 'node-native' }));
    const js = tools.prepareJavascriptApplication(tools.resolveProject({ cwd, profile: 'node-javascript' }));
    const built = tools.buildProject(tools.resolveProject({ cwd, profile: 'fastly-native' }));
    assert.equal(built.status, 'built');
    const wasmFile = path.join(built.outDir, 'bin/main.wasm');
    const wasm = fs.readFileSync(wasmFile);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    for (const name of ['lookup_wait_v2', 'insert', 'insert_wait']) assert.ok(imports.some((i) => i.module === 'fastly_kv_store' && i.name === name));
    assert.ok(imports.some((i) => i.module === 'fastly_async_io' && i.name === 'select'));
    assert.equal(imports.some((i) => /pulse_host|js_compute|^env$/.test(i.module)), false);
    const limits = { strict: false, maxRequestBodyBytes: 262144, maxStructuredBodyBytes: 262144, maxBodyBytes: 262144 };
    const results = {};
    for (const target of ['node-native', 'node-javascript']) {
      function invoker(hooks = {}) {
        const capabilities = tools.createNodeJavascriptBindingCapabilities({ kvHooks: hooks });
        const adapter = tools.createNodeProviderAdapter({ kvReference: capabilities });
        return async (command) => {
          const body = JSON.stringify(command);
          if (target === 'node-javascript') {
            const response = await tools.executeNodeJavascriptApplication(js.loaded.application,
              new Request('http://k4.test/', { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
              { ...limits, capabilities });
            assert.equal(response.status, 200); return response.json();
          }
          const result = await tools.executeCanonicalNativeModule(node.native, { ...limits, providerAdapter: adapter,
            request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body } });
          assert.equal(result.response.status, 200); return JSON.parse(result.response.body);
        };
      }
      results[target] = await scenarios(invoker(), target);
      // The mutation is accepted once, but its acknowledgement is lost. The
      // adapter must neither retry nor convert a later read into a stored ack.
      for (const phase of ['prepare', 'afterCommit']) {
        let faults = 0, dispatches = 0;
        const invoke = invoker({ dispatch() { dispatches++; }, [phase](effect) {
          if (effect.kind === 'kv.insertIfAbsent') { faults++; throw new Error('lost private acknowledgement'); }
        } });
        assert.deepEqual(await invoke({ operation: 'create', key: 'lost', value: { receipt: 'one' } }),
          { status: phase === 'prepare' ? 'not-stored' : 'unknown', reason: phase === 'prepare' ? 'unavailable' : 'transport' });
        assert.equal(faults, 1); assert.equal(dispatches, phase === 'prepare' ? 0 : 1);
        const observed = await invoke({ operation: 'get', key: 'lost' });
        assert.equal(observed.status, phase === 'prepare' ? 'not-found' : 'found');
        if (phase === 'afterCommit') assert.deepEqual(observed.value, { receipt: 'one' });
      }
      results[target].ambiguousCompletion = 'passed';
    }
    if (options.compute) {
      const manifestFile = path.join(built.outDir, 'fastly.toml');
      fs.writeFileSync(manifestFile, tools.renderFastlyLocalConfig({ name: 'pulse-k4-local', kvStores: { k4_catalog: {
        legacy: '{"legacy":true}', malformed: '{"__pulseKv":1,"value":0,"value":1}',
      } } }));
      server = await tools.startFastlyComputeServe({ launcher, packageRoot: built.outDir, wasmFile, manifestFile,
        env: process.env, startTimeoutMs: 120000, stopTimeoutMs: 5000 });
      const invoke = async (command) => {
        const response = await tools.requestFastlyCompute(server, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command), timeoutMs: 30000 });
        assert.equal(response.status, 200, `Compute ${command.operation}: ${response.body.toString().slice(0, 200)}`);
        return JSON.parse(response.body);
      };
      results['fastly-compute'] = await scenarios(invoke, 'fastly');
      results['fastly-compute'].lostResponse = await require('./k4/lost-response.cjs').lostResponse(server, tools, invoke);
      for (const key of ['legacy', 'malformed']) assert.deepEqual(await invoke({ operation: 'get', key }), { status: 'failed', reason: 'protocol' });
      const binaryEvidence = (tool) => tool ? { version: tool.version, sha256: sha256(fs.readFileSync(tool.binary)) } : null;
      results['fastly-compute'].toolchain = { launcher: launcher.kind,
        fastlyCli: binaryEvidence(launcher.fastlyCliInspection), viceroy: binaryEvidence(launcher.viceroyInspection) };
      results['fastly-compute'].manifestSha256 = sha256(fs.readFileSync(manifestFile));
    }
    const evidence = { version: 'pulse.kv-k4-consumer.v1', status: Object.values(results).every((r) => r.status === 'passed') ? 'passed' : 'failed', results,
      module: { sha256: sha256(wasm), bytes: wasm.length, imports },
      providerReality: Boolean(options.compute), deployed: 'pending-T2' };
    if (!options.quiet) console.log(JSON.stringify(evidence));
    return evidence;
  } finally {
    if (server) await server.stop();
    if (!options.packedRoot) fs.rmSync(cwd, { recursive: true, force: true });
  }
}
module.exports = { main };
if (require.main === module) main({ compute: process.argv.includes('--compute') }).then((result) => {
  if (result.status !== 'passed') process.exitCode = 1;
}).catch((error) => {
  console.error(error.stack || error); console.error(JSON.stringify(error.detail || error.diagnostics || {})); process.exitCode = 1;
});
