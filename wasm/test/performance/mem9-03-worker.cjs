'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { createHash } = require('node:crypto');
const { fixture } = require('./mem9-03-fixtures.cjs');
const hash = b => createHash('sha256').update(b).digest('hex');
const [id, count, directory] = process.argv.slice(2);
assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
const report = { id, iterations: Number(count), status: 'running', rows: [], recipes: [] };
const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
const persist = () => write('result.json', report);
persist();
// Install before loading the Fastly compiler, which captures spawnSync.
const originalSpawn = child.spawnSync;
let observed = false;
child.spawnSync = function(executable, args, options) {
  if (!args?.[0]?.endsWith('/assemblyscript/bin/asc.js') || !String(args[1]).includes('fastly-native-platform-capabilities')) return originalSpawn(executable, args, options);
  report.recipes.push({ mode: observed ? 'observed' : 'control', executable, args, cwd: options.cwd });
  const source = fs.readFileSync(path.resolve(options.cwd, args[1]), 'utf8');
  write((observed ? 'observed' : 'control') + '.generated.ts', source);
  return originalSpawn(executable, observed ? [path.join(__dirname, 'mem9-03-asc.mjs'), ...args] : args, options);
};
async function main() {
  const cwd = path.join(directory, 'fixture');
  const f = fixture(id, Number(count), cwd);
  // Archive authored bytes without node_modules symlinks.
  write('fixture.json', f.files); report.liveData = f.liveData;
  const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const project = tc.resolveProject({ cwd, profile: 'node' });
  const compiled = tc.compileNativeProjectInMemory(project);
  const { plan, native } = compiled;
  write('plan.json', plan); write('node.wasm', native.wasm);
  report.plan = { hash: plan.planHash, helpers: plan.helpers?.length || 0, handlers: plan.handlers?.length || 0, stages: plan.stages?.length || 0, effects: plan.effects.map(e => e.kind), capabilities: plan.capabilities };
  if (id === 'pure-helper') assert.equal(report.plan.helpers, 1);
  if (id === 'shared-stage') assert(report.plan.stages > 0, 'Must measure shared stages, not inlined middleware');
  if (id === 'read-loop') assert(require('../../packages/contracts/src/handler/canonical-native-runtime').hasBoundedReadLoop(plan));
  const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
  const options = { request: f.request, secrets: f.secrets, strict: false, captureJwtWallClock: () => ({ trusted: true, unixEpochSeconds: 1800000000 }),
    providerAdapter: { id: 'node', dispatchEffect: () => id === 'shared-stage' ? new Response('fixture') : ({ status: 'not-found' }) } };
  // JWT requires the actual Node provider's secret/crypto services.
  const nodeOptions = id === 'linked' ? tc.driver.executionOptions(project.providerConfig, options) : options;
  const control = await host.executeCanonicalNativeModule(native, nodeOptions);
  let heap;
  const put = host.ValueHeap.prototype.put;
  host.ValueHeap.prototype.put = function(...args) { heap = this; return put.apply(this, args); };
  let result;
  try { result = await host.executeCanonicalNativeModule(native, nodeOptions); } finally { host.ValueHeap.prototype.put = put; }
  assert.deepEqual(result.response, control.response);
  assert.equal(result.valueHandleCount, control.valueHandleCount);
  assert.equal(result.effectCount, control.effectCount);
  assert.equal(result.response.status, 200); assert.equal(result.response.body, f.expected);
  const kinds = {};
  for (const value of heap.values.values()) { const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; kinds[kind] = (kinds[kind] || 0) + 1; }
  assert.equal(heap.size(), result.valueHandleCount);
  report.rows.push({ target: 'node', handles: heap.size(), kinds, responseSha256: hash(result.response.body), expectedSha256: hash(f.expected), effectCount: result.effectCount, wasmSha256: hash(native.wasm), memoryBudget: result.memory || null, domain: 'host ValueHeap entries; not bytes or Wasm roots' }); persist();
  const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
  const fp = tc.resolveProject({ cwd, profile: 'fastly' });
  const buildOptions = { cwd, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, reportCapture: false, bindings: fp.providerConfig.bindings, guestUnits: native.guestUnits, realizationArtifacts: native.realizationArtifacts,
    targetDescriptor: require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native,
    synchronizedPackages: require('../../packages/cli/release-manifest.json').packages.map(({ name, version }) => ({ name, version })) };
  const controls = [];
  for (const mode of ['control', 'observed']) {
    observed = mode === 'observed';
    const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, buildOptions);
    write(mode + '.wasm', artifact.wasm); write(mode + '.manifest.json', artifact.manifest);
    const r = tc.executeFastlyNativePlatformCapabilities(artifact, { request: f.request, secrets: f.secrets, clockUnixSeconds: 1800000000, kvStores: { pages: {} }, fixtures: { 'https://mem9-origin.test/value': { status: 200, body: 'fixture' } } });
    assert.equal(r.response.status, 200); assert.equal(r.response.body, f.expected);
    const ex = r.instance.exports;
    const row = { target: 'fastly', mode, wasmSha256: hash(artifact.wasm), responseSha256: hash(r.response.body), expectedSha256: hash(f.expected), capacityBytes: ex.memory.buffer.byteLength, numericRegions: artifact.manifest.numericRegions, handles: null, kinds: null, managedAfterFullGc: null, domain: 'guest handle table and linear memory; not host RSS' };
    if (observed) {
      row.handles = ex.mem9_count(); row.kinds = {};
      const source = fs.readFileSync(path.join(directory, 'observed.generated.ts'), 'utf8');
      for (const match of source.matchAll(/const PULSE_VALUE_(\w+): i32 = (\d+)/g)) row.kinds[match[1].toLowerCase()] = ex.mem9_kind(Number(match[2]));
      assert.equal(Object.values(row.kinds).reduce((a, b) => a + b, 0), row.handles);
      row.managedAfterFullGc = ex.mem9_collect?.() ?? null;
      assert.equal(ex.mem9_count(), row.handles, 'GC does not reclaim strong table roots');
      assert.equal(ex.memory.buffer.byteLength, row.capacityBytes);
    }
    controls.push({ response: r.response, trace: r.trace, outboundRequests: r.outboundRequests });
    report.rows.push(row); persist();
  }
  assert.deepEqual(controls[0], controls[1], 'Instrumentation preserves responses and host lifecycle');
  assert.equal(report.recipes.length, 2);
  const runtime = report.recipes[0].args[report.recipes[0].args.indexOf('--runtime') + 1];
  report.runtime = runtime;
  assert.equal(runtime === 'stub', id === 'stub');
  assert.equal(runtime.includes('fixed-memory-runtime'), id === 'linked');
  report.status = 'passed'; persist();
  console.log(`ok - MEM9-03 ${id}/${count}: Node + Fastly control/observed`);
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; report.detail = error.detail || error.diagnostics; persist(); console.error(error.stack); process.exitCode = 1; }).finally(() => { child.spawnSync = originalSpawn; });
