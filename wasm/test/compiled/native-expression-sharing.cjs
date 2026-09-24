'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../packages/build-support/src/native-optimization');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root = path.resolve(__dirname, '../../..');

function assertSharedCalls(wat) {
  const helpers = [...wat.matchAll(/^ \(func \$([^\s]*\/__pulse_expr_\d+)\b/gm)].map(match => match[1]);
  assert.ok(helpers.length > 0, 'optimized Wasm must retain a shared expression body');
  assert.ok(helpers.some(name => wat.split(`call $${name}\n`).length > 2),
    'a retained body must have multiple direct call sites');
}

function assertToolchainBoundary() {
  const work = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-retention-'));
  try {
    // A custom annotation alone is ignored by asc. The Pulse transform must
    // attach Binaryen's real no-inline flags before optimization starts.
    fs.writeFileSync(path.join(work, 'canonical-native.as.ts'), `
@external('env', 'tap') declare function tap(value: i32): i32;
@noinline function __pulse_expr_0(value: i32): i32 { return value + 1; }
export function run(value: i32): i32 { return __pulse_expr_0(value) + __pulse_expr_0(value + 1); }
function left(value: i32): i32 { return tap(value) + 1; }
function right(value: i32): i32 { return tap(value) + 7; }
const handlers: Array<(value: i32) => i32> = [left, right];
const mapping = memory.data<i32>([101, 307]);
export function dispatch(index: i32, value: i32): i32 { return handlers[index & 1](value); }
export function lookup(index: i32): i32 { return load<i32>(mapping + <usize>((index & 1) << 2)); }
`);
    const asc = resolveAsc(path.join(root, 'wasm'));
    for (const retained of [false, true]) {
      const args = [asc.script, 'canonical-native.as.ts', '--outFile', 'module.wasm', '--textFile', 'module.wat',
        '--runtime', 'stub', '--noAssert', '--optimize'];
      if (retained) {
        appendAssemblyScriptOptimizationArgs(args);
        assert.deepEqual(args.slice(-2), ['--runPasses', 'merge-similar-functions']);
        const guestArgs = [];
        appendAssemblyScriptOptimizationArgs(guestArgs, undefined, { guestLinked: true });
        assert.equal(guestArgs.includes('--runPasses'), false, 'guest input waits for audited post-link merging');
      }
      const result = spawnSync(asc.executable, args, { cwd: work, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      const wat = fs.readFileSync(path.join(work, 'module.wat'), 'utf8');
      assert.equal(/\(func \$canonical-native\.as\/__pulse_expr_0\b/.test(wat), retained,
        'retention must depend on the pre-optimization transform');
      if (retained) assertSharedCalls(wat);
      assert.match(wat, /\(table /, 'a live dynamic dispatch table survives optimization');
      assert.match(wat, /call_indirect/, 'a dynamic selector retains indirect dispatch');
      const calls = [];
      const module = new WebAssembly.Module(fs.readFileSync(path.join(work, 'module.wasm')));
      const instance = new WebAssembly.Instance(module, { env: {
        tap(value) { calls.push(value); return value * 3; },
        abort() { throw new Error('unexpected fixture abort'); }
      } });
      assert.equal(instance.exports.run(4), 11);
      assert.equal(instance.exports.dispatch(0, 10), 31);
      assert.equal(instance.exports.dispatch(1, 10), 37);
      assert.equal(instance.exports.lookup(0), 101);
      assert.equal(instance.exports.lookup(1), 307);
      assert.deepEqual(calls, [10, 10]);
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

async function main() {
  assertToolchainBoundary();
  const source = `export default async function handler(ctx) {
    let left = 0; let right = 100;
    ${'left = left + 1;'.repeat(256)}
    right = right + 1;
    const first = { value: left }; const second = { value: left }; const alias = first;
    return ctx.text('' + left + ':' + right + ':' + (first === second) + ':' + (alias === first));
  }`;
  const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'shared-expressions.ts', strict: false }));
  let nodeHandles;
  for (const nativeOptimization of [undefined, 'experimental-native-size', 'experimental-native-bounded-size']) {
    const native = compileCanonicalNativePlan(plan, { cwd: root, emitWat: true, nativeOptimization });
    const declarations = [...native.source.matchAll(/^function __pulse_expr_\d+\(/gm)].length;
    assert.ok(declarations < native.manifest.expressionCount / 2, 'equivalent source bodies share declarations');
    assertSharedCalls(native.wat);
    const result = await executeCanonicalNativeModule(native);
    assert.equal(result.response.body, '256:101:false:true', 'calls keep mutation, binding and fresh-object semantics');
    assert.equal(result.effectCount, 0);
    nodeHandles ??= result.valueHandleCount;
    assert.equal(result.valueHandleCount, nodeHandles, 'optimization preserves allocation count');

    const fastly = compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, emitWat: true, nativeOptimization, canonicalBuild: true, requirePlatformCapability: false });
    assertSharedCalls(fastly.wat);
    const fastlyResult = executeFastlyNativePlatformCapabilities(fastly.wasm);
    assert.equal(fastlyResult.response.body, '256:101:false:true');
  }
  const repeated = `export default async function handler(ctx){let value=0;${'value=value+1;'.repeat(2000)}return ctx.text(''+value)}`;
  const repeatedPlan = buildCanonicalNativePlan(compileCanonicalSource(repeated, {
    fileName: 'shared-repeat.ts', strict: false, requireAsync: true
  }));
  const merged = compileCanonicalNativePlan(repeatedPlan, { cwd: root });
  assert.ok(merged.wasm.length <= 12000, 'the ordinary Native build must retain the bounded merge win');
  const repeatedResult = await executeCanonicalNativeModule(merged);
  assert.equal(repeatedResult.response.body, '2000');
  assert.equal(repeatedResult.valueHandleCount, 4005, 'merging preserves allocated handle accounting');
  console.log('ok - real Binaryen retention preserves shared calls, distinct bindings, fresh allocations, live tables and mappings on both Native targets');
}

module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
