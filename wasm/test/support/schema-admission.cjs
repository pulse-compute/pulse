'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { admission } = require('../../packages/contracts/src/schema-json/contracts.js');
const { admitJsonText, admitJsonValue, withAdmittedJsonText } = require('../../packages/schema-json/src/compiler/json-admission.js');
const { generateJsonAdmission } = require('../../packages/runtime-core-as/src/compiler/schema-admission.js');
const { generateFastlyJsonAdmission } = require('../../../packages/provider-fastly/src/build/schema-admission.js');
const corpus = require('../fixtures/conformance/json-admission-corpus.json');

function assertAdmissionJavascript() {
  const { limits } = corpus;
  const identity = admission.jsonAdmissionIdentity(limits);
  assert.deepEqual(identity, admission.jsonAdmissionIdentity(Object.fromEntries(Object.entries(limits).reverse())));
  for (const key of admission.JSON_LIMIT_FIELDS) {
    assert.notEqual(identity.hash, admission.jsonAdmissionIdentity({ ...limits, [key]: limits[key] + 1 }).hash);
    for (const value of [0, -1, 1.5, NaN, Infinity, 0x80000000, '4', undefined]) {
      assert.throws(() => admission.normalizeJsonAdmissionLimits({ ...limits, [key]: value }), { code: 'PULSEWASM_JSON_LIMITS_INVALID' });
    }
  }
  for (const input of [null, [], {}, Object.create(limits), { ...limits, extra: 1 }, { ...limits, [Symbol()]: 1 }]) {
    assert.throws(() => admission.normalizeJsonAdmissionLimits(input), { code: 'PULSEWASM_JSON_LIMITS_INVALID' });
  }
  let invoked = false;
  const accessor = { ...limits };
  Object.defineProperty(accessor, 'maxDepth', { get() { invoked = true; return 8; } });
  assert.throws(() => admission.normalizeJsonAdmissionLimits(accessor));
  assert.equal(invoked, false);
  const maximum = Object.fromEntries(admission.JSON_LIMIT_FIELDS.map(key => [key, 0x7fffffff]));
  const budget = new admission.JsonAdmissionBudget(admission.normalizeJsonAdmissionLimits(maximum));
  assert.equal(budget.addBytes(0x7fffffff), true);
  assert.equal(budget.addBytes(1), false);
  assert.equal(budget.jsonBytes, 0x7fffffff);
  assert.equal(budget.failure, 9);

  for (const test of corpus.cases) {
    let parses = 0;
    const run = () => withAdmittedJsonText(test.text, limits, text => { parses++; return JSON.parse(text); }, test.duplicatePolicy);
    if (test.reason === 'none') {
      const value = run();
      assert.equal(parses, 1, test.name);
      const report = admitJsonText(test.text, limits, test.duplicatePolicy);
      assert.equal(report.textBytes, Buffer.byteLength(test.text), test.name);
      if (!test.name.includes('duplicate-') && !test.name.startsWith('escaped-duplicate') && !test.name.startsWith('nested-duplicate')) {
        assert.deepEqual(admitJsonValue(value, limits), { nodes: report.nodes, depth: report.depth, jsonBytes: report.jsonBytes }, test.name);
      }
    } else {
      assert.throws(run, error => error.detail?.reason === test.reason, test.name);
      assert.equal(parses, 0, test.name + ': materializer must not run');
    }
  }
  const duplicates = admitJsonText('{"a":{"x":0,"\\u0078":1},"a":{}}', limits, 'report').duplicates;
  assert.deepEqual(duplicates, [{ objectStart: 5, keyStart: 12, firstKeyStart: 6 }, { objectStart: 0, keyStart: 24, firstKeyStart: 1 }]);
  assert.ok(Object.isFrozen(duplicates) && duplicates.every(Object.isFrozen));
  assert.equal(admitJsonText('"\\ud83d\\ude00"', limits).jsonBytes, 6);
  assert.equal(admitJsonText('"\\ud800"', limits).jsonBytes, 8);
  assert.equal(admitJsonText('1', limits).jsonBytes, 24);

  const cycle = {}; cycle.self = cycle;
  const cyclicArray = []; cyclicArray.push(cyclicArray);
  const badAccessor = {}; Object.defineProperty(badAccessor, 'value', { enumerable: true, get() { invoked = true; return 1; } });
  const badArray = [0]; Object.defineProperty(badArray, 0, { get() { invoked = true; return 1; } });
  const serializer = { toJSON() { invoked = true; return {}; } };
  for (const value of [undefined, 1n, Symbol(), () => 1, NaN, Infinity, new Date(), new Map(), Object.create({ inherited: 1 }),
    { x: undefined }, { [Symbol()]: 1 }, badAccessor, badArray, serializer, new Array(1), Object.assign([], { extra: true }),
    Object.defineProperty({}, 'hidden', { value: 1 })]) assert.throws(() => admitJsonValue(value, limits));
  assert.equal(invoked, false, 'admission must not invoke getters or toJSON');
  for (const value of [cycle, cyclicArray]) assert.throws(() => admitJsonValue(value, limits), error => error.detail?.reason === 'cycle');
  const child = { x: null };
  assert.equal(admitJsonValue([child, child], limits).nodes, 5, 'shared references count per occurrence and are not cycles');
  assert.equal(admitJsonValue(Object.assign(Object.create(null), { x: null }), limits).nodes, 2);
  const before = { nested: [{ x: true }] };
  admitJsonValue(before, limits);
  assert.equal(Object.isFrozen(before), false, 'admission does not mutate application values');
  assert.throws(() => admitJsonText({ toString() { invoked = true; return '{}'; } }, limits));
  assert.equal(invoked, false);
  assert.throws(() => admitJsonText('{}', limits, 'unknown'));
  assert.throws(() => generateFastlyJsonAdmission({ ...limits, maxDepth: 65 }));
  assert.equal(generateFastlyJsonAdmission({ ...limits, maxDepth: 65 }, 128).identity.limits.maxDepth, 65);

  // Deterministic mutation corpus uses the engine parser as an independent
  // syntax oracle; admission is stricter only for its explicit resource bounds.
  const seeds = ['{"a":[1,true,null,"x"]}', '[[],{},false]', '"é😀"', '-1.25e+2'];
  let mutations = 0;
  for (const seed of seeds) for (let i = 0; i < seed.length; i++) for (const token of ['', ',', ':', '}', 'x', '\\', '\n']) {
    const text = seed.slice(0, i) + token + seed.slice(i + 1);
    let valid = true; try { JSON.parse(text); } catch { valid = false; }
    if (valid) assert.doesNotThrow(() => admitJsonText(text, limits), text);
    else assert.throws(() => admitJsonText(text, limits), text);
    mutations++;
  }
  return mutations;
}

function fixtureExports(fastly) {
  return `
let __test_report: __PulseJsonTextAdmission | null = null
let __test_materializations: i32 = 0
let __test_value_kind: i32 = 0
export function admission_string_id(): i32 { return idof<string>() }
export function admission_run(text: string, mode: i32): i32 {
  const report = __pulse_json_admit(text, mode)
  __test_report = report
  __test_materializations = 0
  __test_value_kind = 0
  ${fastly ? `const before = __pulse_fastly_values.length
  const handle = __pulse_fastly_admitted_json(text, mode)
  __test_materializations = __pulse_fastly_values.length - before
  __test_value_kind = handle > 0 ? 1 : 0` : `if (report.failure == 0) {
    __test_materializations++
    __test_value_kind = JSON.parse<JSON.Value>(text).type + 1
  }`}
  return report.failure
}
export function admission_stat(index: i32): i32 {
  const report = changetype<__PulseJsonTextAdmission>(__test_report)
  if (index == 0) return report.nodes
  if (index == 1) return report.depth
  if (index == 2) return report.jsonBytes
  if (index == 3) return report.textBytes
  if (index == 4) return report.duplicateObjects.length
  if (index == 5) return __test_materializations
  return __test_value_kind
}
export function admission_duplicate(index: i32, column: i32): i32 {
  const report = changetype<__PulseJsonTextAdmission>(__test_report)
  if (column == 0) return report.duplicateObjects[index]
  if (column == 1) return report.duplicateKeys[index]
  return report.duplicateFirstKeys[index]
}
export function admission_deep(text: string): i32 {
  const limits = new __PulseJsonAdmissionLimits()
  limits.maxTextBytes = 20000; limits.maxDepth = 5000; limits.maxNodes = 5000
  limits.maxObjectMembers = 1; limits.maxArrayItems = 1
  limits.maxKeyLength = 1; limits.maxStringLength = 1; limits.maxJsonBytes = 20000
  const report = new __PulseJsonTextAdmission(text, limits, 0)
  report.scan()
  return report.failure
}
${fastly ? `
let __test_serializations: i32 = 0
let __test_value_report: __PulseJsonAdmissionBudget | null = null
function __test_admit_value(handle: i32): i32 {
  const report = __pulse_fastly_admit_value(handle)
  __test_value_report = report
  __test_serializations = 0
  __pulse_fastly_admitted_json_text(handle)
  return report.failure
}
export function admission_value(text: string): i32 { return __test_admit_value(__pulse_fastly_parse_json(text)) }
export function admission_value_stat(index: i32): i32 {
  const report = changetype<__PulseJsonAdmissionBudget>(__test_value_report)
  if (index == 0) return report.nodes
  if (index == 1) return report.depth
  if (index == 2) return report.jsonBytes
  return __test_serializations
}
export function admission_value_case(which: i32): i32 {
  if (which == 0) { const value = host_value_array(); host_value_array_push(value, value); return __test_admit_value(value); }
  if (which == 1) { const value = host_value_object(); host_value_object_set(value, __pulse_fastly_string_value('self'), value); return __test_admit_value(value); }
  if (which == 2) {
    const child = host_value_object(); host_value_object_set(child, __pulse_fastly_string_value('x'), host_value_null());
    const value = host_value_array(); host_value_array_push(value, child); host_value_array_push(value, child);
    return __test_admit_value(value);
  }
  if (which == 3) return __test_admit_value(host_value_number(Infinity))
  if (which == 4) return __test_admit_value(host_value_undefined())
  return __test_admit_value(0)
}
` : ''}
`;
}

function nativeFixtures() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
  const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
  const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler.js');
  const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
  const { generateCanonicalNativeAssemblyScript } = require('../../packages/runtime-core-as/src/compiler/canonical-native.js');
  const http = require('../../../packages/provider-fastly/src/build/native-http-effects.js');
  const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile.js');
  const projectRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/schema-scalar-records');
  const registry = extractSchemaRegistry(path.join(projectRoot, 'src/schemas.ts'), { projectRoot });
  const schemaBundle = buildCanonicalSchemaBundle(registry.registry);
  const source = `export default async function handler(ctx) {
    const value = await ctx.req.json('app.Event')
    const sent = await ctx.fetch('https://sink.invalid', { method: 'POST', json: value, schema: 'app.Event' }).text()
    return ctx.text(sent)
  }`;
  const plan = buildCanonicalNativePlan(compileCanonicalSource(source, { fileName: 'admission.ts', schemaBundle, requireAsync: true, target: 'native', strict: true }));
  const options = { cwd: repoRoot, backends: { 'https://sink.invalid': 'sink' }, requirePlatformCapability: false };
  const lanes = [
    ['native', generateCanonicalNativeAssemblyScript(plan), false],
    ['fastly-http', http.generateFastlyNativeHttpEffectsAssemblyScript(plan, options), true],
    ['fastly-platform', platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options), true]
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-schema-admission-'));
  const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
  const asc = resolveAsc(compilerRoot);
  assert.ok(asc, 'lockfile-pinned AssemblyScript is required');
  const transform = require.resolve('json-as', { paths: [compilerRoot] });
  return lanes.map(([lane, generated, fastly]) => {
    assert.equal(generated.source.includes('__pulse_json_admit'), false, 'existing artifacts must not emit the new admission policy');
    const helpers = fastly ? generateFastlyJsonAdmission(corpus.limits) : generateJsonAdmission(corpus.limits);
    const file = path.join(root, lane + '.ts');
    const output = path.join(root, lane + '.wasm');
    // Instrument the real provider serializer to prove value admission runs
    // before it, including cyclic inputs that must never reach serialization.
    const fixtureSource = fastly ? generated.source.replace('function __pulse_fastly_json(handle: i32, depth: i32): string {',
      'function __pulse_fastly_json(handle: i32, depth: i32): string { __test_serializations++;') : generated.source;
    if (fastly) assert.notEqual(fixtureSource, generated.source);
    fs.writeFileSync(file, fixtureSource + '\n' + helpers.source + fixtureExports(fastly));
    const run = spawnSync(asc.executable, [asc.script, file, '--outFile', output, '--runtime', 'incremental', '--exportRuntime', '--optimize',
      '--transform', transform, '--path', path.join(compilerRoot, 'node_modules'), '--path', path.resolve(transform, '../../../..')], {
      cwd: repoRoot, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' }
    });
    fs.writeFileSync(path.join(root, lane + '.log'), (run.stdout || '') + (run.stderr || ''));
    assert.equal(run.status, 0, `${lane}: ${run.error || run.stderr}`);
    return { lane, module: new WebAssembly.Module(fs.readFileSync(output)) };
  });
}

function instance(module) {
  let effects = 0;
  const imports = {};
  for (const item of WebAssembly.Module.imports(module)) {
    assert.equal(item.kind, 'function');
    imports[item.module] ||= {};
    imports[item.module][item.name] = () => { effects++; throw new Error(`Unexpected fixture host call: ${item.module}.${item.name}`); };
  }
  const { exports } = new WebAssembly.Instance(module, imports);
  function text(value, fn) {
    const pointer = exports.__pin(exports.__new(value.length * 2, exports.admission_string_id()));
    try {
      const units = new Uint16Array(exports.memory.buffer, pointer, value.length);
      for (let i = 0; i < value.length; i++) units[i] = value.charCodeAt(i);
      return fn(pointer);
    } finally { exports.__unpin(pointer); }
  }
  return { exports, text, effects: () => effects };
}

async function assertSchemaAdmission() {
  const mutations = assertAdmissionJavascript();
  const fixtures = nativeFixtures();
  for (const { lane, module } of fixtures) {
    for (const test of corpus.cases) {
      const guest = instance(module);
      const mode = ['allow', 'reject', 'report'].indexOf(test.duplicatePolicy);
      const reason = guest.text(test.text, pointer => guest.exports.admission_run(pointer, mode));
      assert.equal(admission.JSON_ADMISSION_FAILURES[reason], test.reason, lane + '/' + test.name);
      assert.equal(guest.effects(), 0, 'admission and local parsing have no host effects');
      const materialized = guest.exports.admission_stat(5);
      if (reason === 0) {
        assert.ok(materialized > 0, lane + '/' + test.name + ' invokes real parser');
        assert.ok(guest.exports.admission_stat(6) > 0, lane + '/' + test.name + ' parsed a value');
        const js = admitJsonText(test.text, corpus.limits, test.duplicatePolicy);
        assert.deepEqual([0, 1, 2, 3, 4].map(n => guest.exports.admission_stat(n)), [js.nodes, js.depth, js.jsonBytes, js.textBytes, js.duplicates.length], lane + '/' + test.name);
        assert.deepEqual(js.duplicates.map((_, i) => [0, 1, 2].map(c => guest.exports.admission_duplicate(i, c))),
          js.duplicates.map(d => [d.objectStart, d.keyStart, d.firstKeyStart]), lane + '/' + test.name);
      } else assert.equal(materialized, 0, lane + '/' + test.name + ' rejects before materialization');
    }
    if (lane.startsWith('fastly')) {
      for (const test of corpus.cases) {
        if (test.name === 'very-deep' || test.reason === 'non-finite-number') continue;
        let value;
        try { value = JSON.parse(test.text); } catch { continue; }
        let expected = 'none', stats;
        try { stats = admitJsonValue(value, corpus.limits); } catch (error) { expected = error.detail.reason; }
        const guest = instance(module);
        const reason = guest.text(test.text, pointer => guest.exports.admission_value(pointer));
        assert.equal(admission.JSON_ADMISSION_FAILURES[reason], expected, lane + '/value/' + test.name);
        const serializations = guest.exports.admission_value_stat(3);
        if (expected === 'none') {
          assert.ok(serializations > 0);
          assert.deepEqual([0, 1, 2].map(i => guest.exports.admission_value_stat(i)), [stats.nodes, stats.depth, stats.jsonBytes], lane + '/value/' + test.name);
        } else assert.equal(serializations, 0, lane + '/value/' + test.name + ': serializer must not run');
        assert.equal(guest.effects(), 0);
      }
      for (const [which, expected] of [[0, 'cycle'], [1, 'cycle'], [2, 'none'], [3, 'non-finite-number'], [4, 'unsupported-value'], [5, 'unsupported-value']]) {
        const guest = instance(module);
        assert.equal(admission.JSON_ADMISSION_FAILURES[guest.exports.admission_value_case(which)], expected, lane + '/constructed/' + which);
        if (expected !== 'none') assert.equal(guest.exports.admission_value_stat(3), 0, 'constructed invalid values cannot serialize');
        else assert.equal(guest.exports.admission_value_stat(0), 5, 'shared references count per occurrence');
        assert.equal(guest.effects(), 0);
      }
    }
    const guest = instance(module);
    const deep = '['.repeat(5000) + ']'.repeat(5000);
    assert.equal(guest.text(deep, pointer => guest.exports.admission_deep(pointer)), 0, lane + ' scanner uses bounded explicit frames, not call-stack recursion');
  }
  console.log(`ok - internal JSON admission (${corpus.cases.length} shared cases, ${mutations} syntax mutations, 3 compiled lanes, pre-materialization rejection)`);
}

module.exports = { assertSchemaAdmission };
if (require.main === module) assertSchemaAdmission().catch(error => { console.error(error); process.exitCode = 1; });
