'use strict';
// MEM9-09C proposal evidence. The transport receiver below is a laboratory
// model, NOT a production host or a bypass of canonical ownership eligibility.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { NativeValueBudget } = require('../../packages/host-runtime/src/runtime/native-value-budget');
const contract = require('../../packages/contracts/src/handler/canonical-native-runtime');
const compiler = require('../../packages/compiler/src/canonical-native-compiler');
const { generateCanonicalNativeAssemblyScript: generate } = require('../../packages/runtime-core-as/src/compiler/canonical-native');
const { planFor, retentionBody, options } = require('../provider/assert-fastly-handle-ownership.cjs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const root = path.resolve(__dirname, '../../..');
const hash = data => createHash('sha256').update(data).digest('hex');

function compileProbe(directory, name, source, runtime, fixed = false) {
  const asc = resolveAsc(path.join(root, 'wasm'));
  assert(asc, 'lockfile-pinned AssemblyScript is required');
  const file = path.join(directory, name + '.ts'), output = path.join(directory, name + '.wasm');
  fs.writeFileSync(file, source);
  const args = [asc.script, path.basename(file), '--outFile', output,
    '--runtime', runtime, '--optimize', '--noAssert'];
  if (fixed) args.push('--initialMemory', '32', '--maximumMemory', '32', '--memoryBase', '262144');
  const r = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr || r.error?.stack);
  const wasm = fs.readFileSync(output);
  assert(WebAssembly.validate(wasm));
  return { wasm, sourceSha256: hash(source), wasmSha256: hash(wasm), bytes: wasm.length };
}

// Proposed complete-snapshot protocol: exact slot count from a validated
// descriptor, positive increasing epoch, aligned bounded i32 array, zero=empty.
// Only an unbudgeted heap is admitted. Descriptor completeness and compiler
// safe-point placement still require production implementation and review.
function rootReceiver(heap, memory, slots) {
  assert.equal(heap.budget, undefined, 'budget-v1 retain-until-terminal is excluded');
  let epoch = 0, failed = false;
  return {
    epoch: () => epoch,
    checkpoint(pointer, count, nextEpoch) {
      if (failed) throw new Error('latched-root-failure');
      try {
        assert(Number.isInteger(pointer) && pointer >= 0 && pointer % 4 === 0, 'root-alignment');
        assert.equal(count, slots, 'complete-root-snapshot');
        assert(Number.isInteger(nextEpoch) && nextEpoch > epoch && nextEpoch <= 0x7fffffff, 'root-epoch');
        const buffer = memory().buffer;
        assert(pointer <= buffer.byteLength && count <= (buffer.byteLength - pointer) / 4, 'root-bounds');
        const roots = new Int32Array(buffer, pointer, count), survivors = new Map();
        for (const handle of roots) {
          assert(handle >= 0, 'root-sign');
          if (handle !== 0) { assert(heap.has(handle), 'root-membership'); survivors.set(handle, heap.get(handle)); }
        }
        // No callbacks, provider calls, JS property access or nested guest calls
        // occur between validating the full snapshot and publishing this map.
        heap.values = survivors;
        epoch = nextEpoch;
        return 1;
      } catch (error) { failed = true; throw error; }
    }
  };
}

function transportProbe(directory) {
  const source = `@external("pulse_handle_roots_v1", "checkpoint")
declare function checkpoint(pointer: i32, count: i32, epoch: i32): i32;
const roots = new StaticArray<i32>(3);
export function snapshot(a:i32,b:i32,c:i32,epoch:i32):i32 {
  unchecked(roots[0]=a); unchecked(roots[1]=b); unchecked(roots[2]=c);
  return checkpoint(changetype<i32>(roots),3,epoch);
}
export function raw(pointer:i32,count:i32,epoch:i32):i32 { return checkpoint(pointer,count,epoch); }
export function pointer():i32 { return changetype<i32>(roots); }`;
  const artifact = compileProbe(directory, 'transport', source, 'stub');
  const module = new WebAssembly.Module(artifact.wasm);
  assert.throws(() => new WebAssembly.Instance(module, { env: { abort() { throw new Error('abort'); } } }), /import|module/i);
  assert.throws(() => compiler.inspectCanonicalNativeWasm(artifact.wasm), /unsupported module/,
    'current canonical ABI must reject the proposed extension');
  assert.throws(() => host.instantiateCanonicalNativeModule({ wasm: artifact.wasm }),
    error => error.code === 'PULSE_CANONICAL_NATIVE_ABI_IMPORT_MISMATCH'
      && error.detail.unsupportedModules.includes('pulse_handle_roots_v1'));
  function create() {
    const heap = new host.ValueHeap();
    let instance;
    const receiver = rootReceiver(heap, () => instance.exports.memory, 3);
    instance = new WebAssembly.Instance(module, {
      env: { abort() { throw new Error('abort'); } },
      pulse_handle_roots_v1: { checkpoint: receiver.checkpoint }
    });
    return { heap, receiver, ex: instance.exports };
  }
  const { heap, receiver, ex } = create();
  const child = { value: 7 }, parent = { child }; parent.self = parent;
  const parentHandle = heap.put(parent), alias = heap.put(parent), childHandle = heap.put(child);
  const deadCycle = {}; deadCycle.self = deadCycle; const dead = heap.put(deadCycle);
  assert.equal(ex.snapshot(parentHandle, alias, 0, 1), 1);
  assert.equal(heap.size(), 2); assert.equal(heap.get(parentHandle), heap.get(alias));
  assert.equal(heap.get(parentHandle).self, parent);
  assert.equal(heap.get(parentHandle).child, child, 'JS object edges preserve children without their old handle IDs');
  assert(!heap.has(childHandle)); assert(!heap.has(dead));
  assert.throws(() => heap.get(childHandle), { code: 'PULSE_CANONICAL_NATIVE_VALUE_HANDLE_INVALID' });
  const reacquired = heap.put(child); assert(reacquired > dead);
  assert.equal(heap.get(reacquired), child);
  ex.snapshot(parentHandle, alias, reacquired, 2);
  assert.equal(receiver.epoch(), 2);
  const rows = [];
  for (const iterations of [1, 8, 32]) {
    const probe = create(), live = probe.heap.put({ child });
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < 128; j++) probe.heap.put('fixed-' + j);
      probe.ex.snapshot(live, 0, 0, i + 1);
    }
    assert.equal(probe.heap.size(), 1); assert.equal(probe.heap.get(live).child, child);
    rows.push({ iterations, live: probe.heap.size(), issued: probe.heap.next - 1 });
  }
  const negatives = [
    ['unaligned', p => p.ex.raw(p.ex.pointer() + 1, 3, 2)],
    ['negative-pointer', p => p.ex.raw(-4, 3, 2)],
    ['out-of-bounds', p => p.ex.raw(p.ex.memory.buffer.byteLength - 4, 3, 2)],
    ['overflow-range', p => p.ex.raw(0x7ffffffc, 3, 2)],
    ['partial-snapshot', p => p.ex.raw(p.ex.pointer(), 2, 2)],
    ['excess-count', p => p.ex.raw(p.ex.pointer(), 0x7fffffff, 2)],
    ['replayed-epoch', p => p.ex.snapshot(1, 0, 0, 1)],
    ['wrapped-epoch', p => p.ex.snapshot(1, 0, 0, -2147483648)],
    ['unknown-handle', p => p.ex.snapshot(1, 9000, 0, 2)],
    ['negative-handle', p => p.ex.snapshot(1, -1, 0, 2)]
  ];
  for (const [name, fail] of negatives) {
    const p = create(); p.heap.put('root'); p.heap.put('dead'); p.ex.snapshot(1, 0, 0, 1);
    p.heap.put('another'); const before = p.heap.values;
    assert.throws(() => fail(p), undefined, name);
    assert.equal(p.heap.values, before, name + ': no partial publication');
    assert.equal(p.receiver.epoch(), 1);
    assert.throws(() => p.ex.snapshot(1, 0, 0, 2), /latched-root-failure/);
  }
  assert.throws(() => rootReceiver(new host.ValueHeap(new NativeValueBudget(contract.CANONICAL_NATIVE_READ_LOOP_MEMORY)), () => ex.memory, 3), /budget-v1/);
  return { classification: 'standalone Wasm protocol prototype; not a canonical runtime or JS-heap/cost qualification',
    wasmSha256: artifact.wasmSha256, sourceSha256: artifact.sourceSha256,
    oldHostRejected: true, currentCanonicalAbiRejected: true, negativeCases: negatives.map(([name]) => name), rows };
}

function budgetProbe() {
  const policy = contract.CANONICAL_NATIVE_READ_LOOP_MEMORY;
  assert.equal(policy.reclamation, 'retain-until-terminal');
  const stale = [];
  for (const value of ['cached scalar', { cached: 'object' }]) {
    const budget = new NativeValueBudget(policy), heap = new host.ValueHeap(budget);
    const handle = heap.put(value), before = budget.snapshot();
    heap.values.delete(handle); // Deliberately WRONG diagnostic, never runtime code.
    assert.equal(heap.put(value), handle, 'cache still returns the removed ID');
    assert(!heap.has(handle)); assert.deepEqual(budget.snapshot(), before);
    stale.push(typeof value);
  }
  const budget = new NativeValueBudget(policy), heap = new host.ValueHeap(budget);
  const handle = heap.put('cached'); const before = budget.snapshot();
  heap.values.delete(handle); heap.scalars.clear();
  const replacement = heap.put('cached'), after = budget.snapshot();
  assert(replacement > handle && after.values > before.values && after.bytes > before.bytes,
    'clearing the cache repairs lookup but changes cumulative accounting');
  const bounded = new host.ValueHeap(new NativeValueBudget(policy));
  for (let i = 0; i < 8200; i++) bounded.put('key-' + i);
  assert.equal(bounded.scalars.size, 8192); assert.equal(bounded.size(), 8200);
  const cachedBefore = bounded.budget.snapshot(), cached = bounded.put('key-8199');
  assert.equal(cached, 8200); assert.deepEqual(bounded.budget.snapshot(), cachedBefore);
  const evicted = bounded.put('key-0'); assert.equal(evicted, 8201);
  let closed = 0;
  const limit = new NativeValueBudget({ ...policy, maxBytes: 80, maxValues: 4 }, () => closed++);
  const limited = new host.ValueHeap(limit); limited.put(1); const atLimit = limit.snapshot();
  let failure; try { limited.put('long string'); } catch (e) { failure = e; }
  assert.equal(failure?.code, 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED');
  assert.equal(closed, 1);
  assert.throws(() => limited.put(1), e => e === failure, 'cached read cannot recover latched failure');
  assert.equal(closed, 1);
  return { reclamation: policy.reclamation, staleCacheKinds: stale,
    invalidationChangesCharges: { before, after }, scalarCapacity: 8192,
    evictionRetainsMappings: true, latchedFailurePreserved: true, atLimit,
    failure: { code: failure.code, detail: failure.detail } };
}

function allocatorProbe(directory) {
  const source = `let last: Uint8Array | null = null;
const retained = new Array<Uint8Array>();
export function allocate(keep:bool):i32 {
  const next = new Uint8Array(4096); next[0]=91; last=next;
  if(keep) retained.push(next);
  return changetype<i32>(next.buffer);
}
export function collect():void { __collect(); }
export function sentinel():i32 { return last![0]; }`;
  const fixedRuntime = path.join(root, 'packages/provider-fastly/src/build/fixed-memory-runtime.as');
  const rows = [];
  for (const runtime of ['stub', 'incremental', 'fixed']) {
    const artifact = compileProbe(directory, 'allocator-' + runtime, source,
      runtime === 'fixed' ? fixedRuntime : runtime, runtime === 'fixed');
    const module = new WebAssembly.Module(artifact.wasm);
    function run(keep) {
      const e = new WebAssembly.Instance(module, { env: { abort() { throw new Error('allocator-abort'); } } }).exports;
      const pointers = new Set(); let completed = 0, trapped = false;
      for (let i = 0; i < 512; i++) {
        try { pointers.add(e.allocate(keep)); e.collect(); assert.equal(e.sentinel(), 91); completed++; }
        catch (error) { if (!(error instanceof WebAssembly.RuntimeError)) throw error; trapped = true; break; }
      }
      return { keep, completed, distinctPointers: pointers.size, capacityBytes: e.memory.buffer.byteLength, trapped };
    }
    const released = run(false), retained = run(true);
    assert.equal(released.completed, 512);
    if (runtime === 'stub') assert.equal(released.distinctPointers, 512, 'stub collect does not recycle storage');
    else assert(released.distinctPointers < 16, 'managed runtime reuses unreachable allocations');
    if (runtime === 'fixed') {
      assert.equal(released.capacityBytes, 2097152); assert.equal(retained.capacityBytes, 2097152);
      assert(retained.trapped && retained.completed < 512, 'fixed memory still exhausts when roots retain every buffer');
    } else assert.equal(retained.completed, 512);
    rows.push({ runtime, wasmSha256: artifact.wasmSha256, sourceSha256: artifact.sourceSha256, released, retained });
  }
  return { classification: 'isolated allocator mechanics with forced GC; no handle tracer, foreign guest, provider or latency qualification', rows };
}

async function baselineProbe() {
  const plan = planFor(retentionBody), generated = generate(plan);
  assert.equal(generated.manifest.handleOwnership, undefined, 'portable generation does not select the Fastly policy');
  assert(!generated.source.includes('__pulse_handle_checkpoint'));
  const compiled = compiler.compileCanonicalNativePlan(plan, { cwd: root, emitWat: false });
  const rows = [];
  for (const n of [1, 8, 32]) {
    const r = await host.executeCanonicalNativeModule(compiled, { request: {
      method: 'POST', url: 'http://local/', headers: [['content-type', 'application/json']], body: JSON.stringify({ n })
    } });
    const body = JSON.parse(r.response.body);
    assert.equal(body.n, 70000.25 + n * 128 * .25);
    assert.equal(body.box.value, body.n);
    assert.equal(r.response.body, JSON.stringify({ n: body.n,
      text: 'fixed-working-set-'.repeat(9) + body.n, box: { value: body.n } }));
    rows.push({ n, valueHandleCount: r.valueHandleCount, responseSha256: hash(r.response.body) });
  }
  assert(rows[2].valueHandleCount > rows[0].valueHandleCount * 10);
  const stub = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(planFor("return ctx.text('ok');", false), options);
  assert.equal(stub.manifest.handleOwnership.reason, 'collector-unavailable');
  const exclusions = [];
  for (const capability of ['response.output', 'request.body.transform']) {
    const p = { ...plan, capabilities: [...plan.capabilities, capability] };
    const g = generate(p, { handleOwnership: 'fastly-handle-tracing-v1' });
    assert.equal(g.manifest.handleOwnership.enabled, false);
    assert.equal(g.manifest.handleOwnership.reason, 'retain-until-terminal-budget');
    exclusions.push({ capability, reason: g.manifest.handleOwnership.reason });
  }
  return { classification: 'current production Node artifact; mapping counts, not host RSS',
    wasmSha256: hash(compiled.wasm), nodePolicy: 'unselected; no ownership manifest or checkpoints',
    rows, stubReason: stub.manifest.handleOwnership.reason, budgetExclusions: exclusions };
}

function linkedBaseline(directory) {
  const { fixture } = require('../performance/mem9-06a-fixtures.cjs');
  const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
  const { packageLoweringForCanonicalNativePlan } = require('../../packages/compiler/src/spine/canonical-native-plan');
  const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const cwd = path.join(directory, 'linked');
  const f = fixture({ runtime: 'ES256', iterations: 0, arena: 'default' }, cwd);
  const project = tc.resolveProject({ cwd, profile: 'fastly' });
  const plan = buildCanonicalNativePlan(tc.compileProject(project));
  const lowering = packageLoweringForCanonicalNativePlan(plan);
  const selected = { ...options, cwd, bindings: project.providerConfig.bindings,
    guestUnits: lowering.guestUnits, realizationArtifacts: lowering.realizationArtifacts,
    targetDescriptor: require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native,
    synchronizedPackages: require('../../packages/cli/release-manifest.json').packages.map(({ name, version }) => ({ name, version })) };
  assert.equal(selected.guestUnits.length, 1);
  const generated = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, selected);
  assert.equal(generated.manifest.handleOwnership.enabled, false);
  assert.equal(generated.manifest.handleOwnership.reason, 'linked-runtime');
  assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,
    { ...selected, handleOwnership: 'fastly-handle-tracing-v1' }).source, generated.source,
    'caller options cannot enable tracing in a linked artifact');
  const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, selected);
  assert.equal(artifact.guestLink.audit.status, 'passed');
  assert.equal(artifact.guestLink.audit.instructions.memoryGrow, 0);
  assert(artifact.guestLink.audit.checks.every(check => check.status === 'passed'));
  const result = tc.executeFastlyNativePlatformCapabilities(artifact, { request: f.request,
    secrets: { TEST_KEY: JSON.stringify(f.key) }, clockUnixSeconds: 1800000000,
    fixtures: { 'https://mem9.test/value': { status: 200, body: 'ok' } } });
  assert.equal(result.response.status, 200);
  const body = JSON.parse(result.response.body), crypto = require('node:crypto');
  for (const name of ['before', 'after']) {
    const [header, payload, signature] = body[name].split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
    assert(crypto.verify('sha256', Buffer.from(header + '.' + payload),
      { key: crypto.createPublicKey({ key: f.key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  }
  assert.equal(result.instance.exports.memory.buffer.byteLength, 2097152);
  return { classification: 'current production linked Fastly artifact against the ABI fixture; no tracing or external-provider qualification',
    wasmSha256: hash(artifact.wasm), ownership: generated.manifest.handleOwnership,
    capacityBytes: result.instance.exports.memory.buffer.byteLength,
    finalAudit: artifact.guestLink.audit.status, memoryGrowInstructions: 0,
    independentlyVerifiedSignatures: 2, callerOverrideIgnored: true };
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mem9-09c-'));
  try {
    const report = { task: 'MEM9-09C', status: 'passed', productionEnablement: false,
      environment: { node: process.version, lockSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))) },
      baseline: await baselineProbe(), transport: transportProbe(directory),
      budget: budgetProbe(), allocator: allocatorProbe(directory), linked: linkedBaseline(directory) };
    console.log(JSON.stringify(report)); return report;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
