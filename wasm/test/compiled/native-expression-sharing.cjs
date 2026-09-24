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
const NativeRetentionTransform = require('../../packages/build-support/src/native-retention-transform.cjs');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const root = path.resolve(__dirname, '../../..');

function assertRetentionPatterns() {
  function check(names, selected) {
    const transform = new NativeRetentionTransform();
    transform.retainedNames = selected;
    let argument = 'previous-policy';
    const patterns = [];
    transform.binaryen = {
      getPassArgument: () => argument,
      setPassArgument: (_, value) => { argument = value; },
      Function: { getName: name => name }
    };
    const module = {
      getFunction: name => names.includes(name) ? name : 0,
      getNumFunctions: () => names.length,
      getFunctionByIndex: index => names[index],
      runPasses(passes) { assert.deepEqual(passes, ['no-inline']); patterns.push(argument); }
    };
    transform.afterCompile(module);
    assert.equal(argument, 'previous-policy', 'the transform restores Binaryen global options');
    const actual = names.filter(name => patterns.some(pattern => pattern.endsWith('*')
      ? name.startsWith(pattern.slice(0, -1)) : name === pattern));
    assert.deepEqual(actual.sort(), names.filter(name => selected.includes(name)).sort(),
      'batched matches must equal precisely the emitted annotated set');
    assert.ok(patterns.length <= new Set(selected.filter(name => names.includes(name))).size);
    return { transform, module, patterns, argument: () => argument };
  }
  const prefix = 'canonical-native.as/__pulse_expr_';
  check([], []);
  check([`${prefix}1`], [`${prefix}1`, `${prefix}2`]);
  check([`${prefix}1`, `${prefix}10`, `${prefix}100`, `${prefix}11`, `${prefix}2`],
    [`${prefix}1`, `${prefix}100`, `${prefix}11`, `${prefix}2`]);
  let seed = 17;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let trial = 0; trial < 100; trial++) {
    const names = Array.from({ length: 128 }, (_, index) => `${prefix}${index}`);
    const selected = names.filter(() => random() % 7 < 4);
    names.push('ordinary/__pulse_expr_1', 'canonical-native.as/__pulse_expr_1~overload', 'canonical-native.as/__pulse_chunk_1');
    if (trial % 2) names.reverse();
    check(names, selected);
  }
  const chunks = Array.from({ length: 512 }, (_, index) => `canonical-native.as/__pulse_chunk_${index}`);
  const { transform, module, patterns, argument } = check([...chunks, `${prefix}0`], chunks);
  assert.equal(patterns.length, 1, 'a fully selected dispatcher family takes one module pass');
  module.runPasses = () => { throw new Error('fixture pass failure'); };
  assert.throws(() => transform.afterCompile(module), /fixture pass failure/);
  assert.equal(argument(), 'previous-policy', 'failure must also restore Binaryen global options');

  const declaration = name => ({ name: { text: name }, decorators: [{ name: { text: 'noinline' } }] });
  const guarded = new NativeRetentionTransform();
  guarded.afterParse({ sources: [
    { internalPath: 'ordinary', statements: [declaration('__pulse_expr_0')] },
    { internalPath: 'canonical-native.as', statements: [declaration('ordinary'), declaration('__pulse_expr_0')] },
    { internalPath: 'fastly-native-platform-capabilities.as', statements: [declaration('__pulse_chunk_0')] }
  ] });
  assert.deepEqual(guarded.retainedNames, [
    'canonical-native.as/__pulse_expr_0', 'fastly-native-platform-capabilities.as/__pulse_chunk_0'
  ], 'only existing compiler-owned annotation names grant retention');
}

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
@noinline function __pulse_expr_1(value: i32): i32 { return value + 2; }
function __pulse_expr_10(value: i32): i32 { return value + 3; }
@noinline function __pulse_expr_20(value: i32): i32 { return value + 4; }
@noinline function __pulse_expr_21(value: i32): i32 { return value + 5; }
export function selected(value: i32): i32 { return __pulse_expr_1(value) + __pulse_expr_10(value) + __pulse_expr_20(value) + __pulse_expr_21(value); }
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
      for (const index of [1, 20, 21]) {
        assert.equal(new RegExp(`\\(func \\$canonical-native\\.as/__pulse_expr_${index}\\b`).test(wat), retained);
      }
      assert.doesNotMatch(wat, /\(func \$canonical-native\.as\/__pulse_expr_10\b/,
        'a numeric prefix collision must leave the unannotated leaf eligible for inlining');
      assert.match(wat, /\(table /, 'a live dynamic dispatch table survives optimization');
      assert.match(wat, /call_indirect/, 'a dynamic selector retains indirect dispatch');
      const calls = [];
      const module = new WebAssembly.Module(fs.readFileSync(path.join(work, 'module.wasm')));
      const instance = new WebAssembly.Instance(module, { env: {
        tap(value) { calls.push(value); return value * 3; },
        abort() { throw new Error('unexpected fixture abort'); }
      } });
      assert.equal(instance.exports.run(4), 11);
      assert.equal(instance.exports.selected(4), 30);
      assert.equal(instance.exports.dispatch(0, 10), 31);
      assert.equal(instance.exports.dispatch(1, 10), 37);
      assert.equal(instance.exports.lookup(0), 101);
      assert.equal(instance.exports.lookup(1), 307);
      assert.deepEqual(calls, [10, 10]);
    }
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

async function main() {
  assertRetentionPatterns();
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
