'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [variant, directory] = process.argv.slice(2);
assert(['unpatched', 'patched'].includes(variant));
fs.mkdirSync(directory, { recursive: true });
const originalSpawn = child.spawnSync;
require('./arena-transform-control.cjs').install(variant);
const controlledSpawn = child.spawnSync;
let builds = 0;
child.spawnSync = function(executable, args, options) {
  const result = controlledSpawn(executable, args, options);
  if (!args?.[0]?.endsWith('/assemblyscript/bin/asc.js')) return result;
  assert.equal(result.status, 0, result.stderr);
  builds++;
  fs.copyFileSync(args[args.indexOf('--outFile') + 1], path.join(directory, 'control.wasm'));
  fs.copyFileSync(path.resolve(options.cwd, args[1]), path.join(directory, 'generated.ts'));
  for (const mode of ['trace', 'periodic', 'exact-growth', 'large-gc', 'reduced']) {
    const actual = args.slice(1);
    actual[actual.indexOf('--outFile') + 1] = path.join(directory, mode + '.wasm');
    if (actual.includes('--textFile')) actual.splice(actual.indexOf('--textFile'), 2);
    if (variant === 'patched') actual.push('--transform', path.join(__dirname, 'schema-cache-arena-transform.cjs'));
    const run = originalSpawn(executable, [path.join(__dirname, 'gc-diagnostic-asc.mjs'), args[0], mode, ...actual], { ...options, timeout: 180000 });
    fs.writeFileSync(path.join(directory, mode + '.build.log'), run.stdout + run.stderr);
    assert.equal(run.status, 0, run.stderr || run.error?.message);
  }
  return result;
};
let controlOutcome = 'passed';
try { require('../provider/assert-fastly-schema-allocation.cjs').main(); }
catch (error) {
  assert.equal(variant, 'patched'); assert.equal(error.code, 'ERR_ASSERTION');
  assert.match(error.message, /^schema allocation used 155189248 bytes$/);
  controlOutcome = error.message;
}
assert.equal(builds, 1);
child.spawnSync = originalSpawn;
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const rows = [];
for (const mode of ['control', 'trace', 'periodic', 'exact-growth', 'large-gc', 'reduced']) {
  const wasm = fs.readFileSync(path.join(directory, mode + '.wasm'));
  const cases = mode === 'reduced'
    ? [0, 1, 64, 128, 256].map(iterations => ['small-' + iterations, 'a', iterations])
    : [['escaped', '\u0001'.repeat(80000), 256], ['unicode', '😀雪"\\\n'.repeat(8000), 256], ['small', 'a', 256]];
  for (const [shape, text, iterations] of cases) {
    const events = [], histogram = {}, stats = { allocations: 0, requestedBytes: 0, freedBytes: 0, cycles: 0, fullCollections: 0, lastAllocation: null };
    let free = null, phase = 'workload';
    const Original = WebAssembly.Instance;
    WebAssembly.Instance = new Proxy(Original, { construct(Target, args) {
      const imports = { ...args[1], perf806: { event(kind, a, b, c, d, e) {
        if (kind === 1) {
          stats.allocations++; stats.requestedBytes += a;
          stats.lastAllocation = { size: a, id: b, managedBefore: c, threshold: d, state: e };
          const key = b + ':' + a; histogram[key] = (histogram[key] || 0) + 1;
        } else if (kind === 5) stats.freedBytes += a;
        else if (kind === 4) { stats.cycles++; assert(events.length < 50000); events.push({ phase, kind: 'cycle', allocation: stats.allocations, managed: a, threshold: b, pages: c }); }
        else if (kind === 6) { stats.fullCollections++; events.push({ phase, kind: 'fullGC', allocation: stats.allocations, managed: a, threshold: b, pages: c, state: d }); }
        else if (kind === 3) free = { total: a, largest: b, blocks: c };
        else if (kind === 2) events.push({ phase, kind: 'growth', allocation: stats.allocations, request: a, pagesBefore: b, pagesNeeded: c, pagesWanted: d, free, ...stats.lastAllocation });
        else assert.fail('Unexpected event ' + kind);
      } } };
      const instance = Reflect.construct(Target, [args[0], imports]);
      if (mode === 'reduced') instance.exports.perf_iterations(iterations);
      return instance;
    } });
    try {
      const result = executeFastlyNativePlatformCapabilities(wasm, { request: { method: 'POST', path: '/encode', headers: [['content-type', 'application/json']], body: JSON.stringify({ text }) } });
      const encoded = JSON.stringify({ rows: [{ text, total: 70000 + iterations * 256 * 8 }, { text: 'independent', total: 7 }] });
      assert.equal(result.response.status, 200);
      assert.deepEqual(JSON.parse(result.response.body), { encoded, digest: { status: 'ok', byteLength: Buffer.byteLength(encoded), sha256: hash(encoded) } });
      const capacityBytes = result.instance.exports.memory.buffer.byteLength;
      const valueCount = result.instance.exports.perf_value_count?.() ?? null;
      const valueType = result.instance.exports.perf_value_id?.() ?? null;
      phase = 'post-response-GC';
      result.instance.exports.__collect();
      const afterCollectBytes = result.instance.exports.memory.buffer.byteLength;
      if (mode !== 'control') { phase = 'released-table-GC'; result.instance.exports.perf_release_values(); result.instance.exports.__collect(); }
      rows.push({ mode, shape, iterations, valueCount, valueType, sha256: hash(wasm), capacityBytes, afterCollectBytes, stats, histogram, events });
    } finally { WebAssembly.Instance = Original; }
  }
}
fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ status: 'completed', variant, node: process.version, controlOutcome, rows }, null, 2) + '\n');
console.log(variant + ': ' + rows.map(r => r.mode + '/' + r.shape + '=' + r.capacityBytes).join(', '));
