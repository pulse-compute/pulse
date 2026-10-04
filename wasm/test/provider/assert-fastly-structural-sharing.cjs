'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { diagnosticCompile } = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const options = { canonicalBuild: true, requirePlatformCapability: false, emitWat: false };
const field = (name, value, required = true) => ({ name, value, required });
const object = fields => ({ kind: 'object', fields });
const source = { file: 'structural-sharing.ts', line: 1, column: 1 };
const value = { name: '雪😀', count: -7, active: true, tag: 'b' };

function fixture() {
  const fields = [field('name', { kind: 'string' }), field('count', { kind: 'i32' }),
    field('active', { kind: 'boolean' }), field('tag', { kind: 'string-enum', values: ['a', 'b'] }),
    field('note', { kind: 'string' }, false)];
  const flat = object(fields);
  const roots = {
    A: flat, B: flat, Reordered: object([...fields].reverse()),
    Required: object(fields.map(f => ({ ...f, required: true }))),
    Renamed: object(fields.map(f => f.name === 'name' ? { ...f, name: 'title' } : f)),
    Unsigned: object(fields.map(f => f.name === 'count' ? { ...f, value: { kind: 'u32' } } : f)),
    Enum: object(fields.map(f => f.name === 'tag' ? { ...f, value: { kind: 'string-enum', values: ['a', 'c'] } } : f)),
    EnumOrder: object(fields.map(f => f.name === 'tag' ? { ...f, value: { kind: 'string-enum', values: ['b', 'a'] } } : f)),
    Open: { ...flat, additionalProperties: { kind: 'json-value' } },
    Nullable: object(fields.map(f => f.name === 'note' ? { ...f, value: { kind: 'nullable', value: f.value } } : f)),
    Composite: object([field('left', flat), field('right', flat), field('rows', { kind: 'array', element: flat })]),
    Tight: flat, Loose: flat
  };
  const registry = normalizeSchemaRegistry({ source, schemas: Object.entries(roots).map(([name, root]) => ({
    id: `proof.${name}`, typeName: name, source, root,
    ...(name === 'Tight' || name === 'Loose' ? { jsonLimits: { maxStringLength: name === 'Tight' ? 8 : 64 } } : {})
  })) });
  const handler = "export default async function handler(ctx) { const text = await ctx.req.text(); const value = ctx.decodeJson(text, 'proof.A'); return ctx.text(ctx.encodeJson(value, 'proof.B')); }";
  const plan = buildCanonicalNativePlan(compileCanonicalSource(handler, { fileName: source.file,
    schemaBundle: buildCanonicalSchemaBundle(registry), strict: true, target: 'native', requireAsync: true }));
  return { registry, plan };
}

function rootName(text, id) {
  const branch = text.split(`schemaId == "proof.${id}") {`)[1];
  assert.ok(branch, `registered ID ${id} remains dispatched`);
  return branch.match(/const projected = (\w+)\(/)[1];
}

function instrumentation(text) {
  return text + `
export function gen03_apply(id: string, text: string, encode: bool): string {
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0;
  const schema = __pulse_fastly_string_value(id);
  const result = encode ? host_schema_encode(__pulse_fastly_parse_json(text), schema)
    : host_schema_decode(__pulse_fastly_string_value(text), schema);
  if (__pulse_fastly_last_error != 0 || result <= 0) return "";
  return encode ? __pulse_fastly_string(result) : __pulse_fastly_json(result, 0);
}
export function gen03_alias(checkDuplicates: bool): i32 {
  __pulse_fastly_last_error = 0;
  const input = __pulse_fastly_parse_json(${JSON.stringify(JSON.stringify(value))});
  const a = ${rootName(text, 'A')}(input, checkDuplicates);
  const b = ${rootName(text, 'B')}(input, checkDuplicates);
  if (a == input || b == input || a == b) return 1;
  if (changetype<usize>(__pulse_fastly_value(a)) == changetype<usize>(__pulse_fastly_value(b))) return 2;
  const key = __pulse_fastly_string_value("name");
  host_value_object_set(a, key, __pulse_fastly_string_value("changed"));
  if (__pulse_fastly_string(host_value_property(b, key)) != "雪😀") return 3;
  if (__pulse_fastly_string(host_value_property(input, key)) != "雪😀") return 4;
  host_value_object_set(input, key, __pulse_fastly_string_value("later"));
  const c = ${rootName(text, 'B')}(input, checkDuplicates);
  if (c == a || c == b || c == input) return 5;
  if (__pulse_fastly_string(host_value_property(c, key)) != "later") return 6;
  if (__pulse_fastly_string(host_value_property(a, key)) != "changed") return 7;
  if (__pulse_fastly_string(host_value_property(b, key)) != "雪😀") return 8;
  const container = host_value_object();
  const left = __pulse_fastly_string_value("left"), right = __pulse_fastly_string_value("right"), rows = __pulse_fastly_string_value("rows");
  host_value_object_set(container, left, input); host_value_object_set(container, right, input);
  const array = host_value_array(); host_value_array_push(array, input); host_value_array_push(array, input);
  host_value_object_set(container, rows, array);
  const projected = ${rootName(text, 'Composite')}(container, checkDuplicates);
  const l = host_value_property(projected, left), r = host_value_property(projected, right);
  const items = __pulse_fastly_value(host_value_property(projected, rows));
  const x = unchecked(items.values[0]), y = unchecked(items.values[1]);
  if (l == r || l == x || l == y || r == x || r == y || x == y || l == input || x == input) return 9;
  host_value_object_set(l, key, __pulse_fastly_string_value("left only"));
  if (__pulse_fastly_string(host_value_property(r, key)) != "later"
    || __pulse_fastly_string(host_value_property(x, key)) != "later"
    || __pulse_fastly_string(host_value_property(y, key)) != "later"
    || __pulse_fastly_string(host_value_property(input, key)) != "later") return 10;
  if (__pulse_fastly_value(input).immutable || __pulse_fastly_value(a).immutable) return 11;
  return __pulse_fastly_last_error == 0 ? 0 : 12;
}
export function gen03_frozen(): i32 {
  __pulse_fastly_last_error = 0;
  const text = __pulse_fastly_string_value(${JSON.stringify(JSON.stringify(value))});
  const a = host_schema_decode(text, __pulse_fastly_string_value("proof.A"));
  const b = host_schema_decode(text, __pulse_fastly_string_value("proof.B"));
  if (a == b || !__pulse_fastly_value(a).immutable || !__pulse_fastly_value(b).immutable) return 1;
  host_value_object_set(a, __pulse_fastly_string_value("name"), __pulse_fastly_string_value("forbidden"));
  return __pulse_fastly_error_stage == 32 ? 0 : 2;
}
`;
}

function controls(artifact, directory) {
  const request = { request: { method: 'POST', path: '/', body: JSON.stringify({ ...value, dropped: 1 }) } };
  const production = execute(artifact, request);
  assert.deepEqual(JSON.parse(production.response.body), value);
  const noOp = diagnosticCompile(artifact.source, 'control', path.join(directory, 'noop'));
  assert.deepEqual(noOp, artifact.wasm, 'diagnostic recipe without instrumentation matches production bytes');
  const wasm = diagnosticCompile(instrumentation(artifact.source), 'control', path.join(directory, 'probe'));
  const diagnostic = execute(wasm, request), e = diagnostic.instance.exports;
  assert.deepEqual(diagnostic.response, production.response);
  assert.deepEqual(diagnostic.trace, production.trace);
  assert.equal(e.gen03_alias(0), 0, 'encode-direction projections allocate independently');
  assert.equal(e.gen03_alias(1), 0, 'decode-direction projections allocate independently');
  assert.equal(e.gen03_frozen(), 0, 'separate decoded results stay immutable');
  const put = text => {
    const pointer = e.__pin(e.__new(text.length * 2, e.pulse_schema_string_id()));
    const chars = new Uint16Array(e.memory.buffer, pointer, text.length);
    for (let i = 0; i < text.length; i++) chars[i] = text.charCodeAt(i);
    return pointer;
  };
  const records = [];
  function run(id, input, encode, expected, stage = 0) {
    const schema = put(`proof.${id}`), text = put(typeof input === 'string' ? input : JSON.stringify(input));
    try {
      const result = e.gen03_apply(schema, text, encode);
      const error = e.pulse_fastly_last_error(), errorStage = e.pulse_fastly_error_stage();
      assert.equal(errorStage, stage, `${id}, encode=${encode}`);
      assert.equal(error, stage ? 1005 : 0, `${id}, encode=${encode}`);
      const length = new DataView(e.memory.buffer).getUint32(result - 4, true);
      const output = Buffer.from(e.memory.buffer, result, length).toString('utf16le');
      if (!stage) {
        assert.deepEqual(JSON.parse(output), expected);
        assert.deepEqual(Object.keys(JSON.parse(output)), Object.keys(expected), 'declared field order');
      }
      records.push({ id, encode, input, output, error, errorStage });
    } finally { e.__unpin(schema); e.__unpin(text); }
  }
  for (const encode of [false, true]) {
    for (const id of ['A', 'B', 'EnumOrder', 'Loose', 'Tight']) {
      run(id, { ...value, dropped: 1 }, encode, value);
      run(id, { ...value, note: 'present' }, encode, { ...value, note: 'present' });
      run(id, { ...value, note: null }, encode, null, 52);
      run(id, { ...value, count: 2147483648 }, encode, null, 53);
      run(id, { ...value, tag: 'c' }, encode, null, 54);
    }
    run('Reordered', value, encode, { tag: 'b', active: true, count: -7, name: '雪😀' });
    run('Required', value, encode, null, 51);
    run('Required', { ...value, note: 'ok' }, encode, { ...value, note: 'ok' });
    run('Renamed', value, encode, null, 51);
    run('Renamed', { ...value, title: 'title' }, encode, { title: 'title', count: -7, active: true, tag: 'b' });
    run('Unsigned', value, encode, null, 53);
    run('Unsigned', { ...value, count: 4294967295 }, encode, { ...value, count: 4294967295 });
    run('Enum', value, encode, null, 54);
    run('Enum', { ...value, tag: 'c' }, encode, { ...value, tag: 'c' });
    run('Nullable', { ...value, note: null }, encode, { ...value, note: null });
    run('Open', { ...value, extra: { x: [1] } }, encode, { ...value, extra: { x: [1] } });
    const nested = { left: value, right: { ...value, name: 'right' }, rows: [value, { ...value, count: 8 }] };
    run('Composite', nested, encode, nested);
    const duplicate = '{"name":"first","name":"last","count":1,"active":true,"tag":"a"}';
    run('A', duplicate, encode, { name: 'last', count: 1, active: true, tag: 'a' });
    run('Open', duplicate, encode, { name: 'last', count: 1, active: true, tag: 'a' }, encode ? 0 : 57);
    run('Loose', { ...value, name: 'longer than eight' }, encode, { ...value, name: 'longer than eight' });
    run('Tight', { ...value, name: 'longer than eight' }, encode, null, 57);
    run('A', {}, encode, null, 51);
    run('A', [], encode, null, 50);
  }
  return { cases: records.length, records, response: production.response, trace: production.trace,
    freshContainers: true, aliasedInputsDetached: true, decodedResultsFrozen: true, controlByteIdentical: true };
}

function main() {
  const { registry, plan } = fixture(), before = JSON.stringify(registry);
  const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  assert.equal(JSON.stringify(registry), before);
  const name = id => rootName(artifact.source, id);
  for (const id of ['B', 'Tight', 'Loose']) assert.equal(name(id), name('A'));
  const distinct = ['A', 'Reordered', 'Required', 'Renamed', 'Unsigned', 'Enum', 'EnumOrder', 'Open', 'Nullable', 'Composite'];
  assert.equal(new Set(distinct.map(name)).size, distinct.length, 'different projection behavior cannot share');
  assert.equal([...artifact.source.matchAll(/^function __pulse_fastly_schema_flat_object_\d+\(/gm)].length, 7);
  const generation = () => platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options).source;
  assert.equal(generation(), artifact.source);
  platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(fixture().plan, options);
  assert.equal(generation(), artifact.source, 'sharing maps never escape a generation');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-gen03-proof-'));
  try {
    const result = controls(artifact, directory);
    console.log(`ok - Fastly structural code sharing: ${result.cases} semantic controls, fresh projections, alias isolation and frozen decoded values`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { main, fixture, options, controls };
if (require.main === module) main();
