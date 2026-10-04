'use strict';
const assert = require('node:assert/strict');
const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const source = { file: 'scalar-sharing.ts', line: 1, column: 1 };
const field = (name, value, required = true) => ({ name, value, required });
const object = fields => ({ kind: 'object', fields });
function main() {
  const root = object([
    ...['string', 'boolean', 'i32', 'u32', 'f64'].map(kind => field(kind, { kind })),
    field('enum', { kind: 'string-enum', values: ['a', 'b'] }),
    field('otherEnum', { kind: 'string-enum', values: ['a', 'c'] }),
    field('reverseEnum', { kind: 'string-enum', values: ['b', 'a'] }),
    field('nested', object([field('string', { kind: 'string' })])),
    field('items', { kind: 'array', element: { kind: 'string' } }),
    field('note', { kind: 'nullable', value: { kind: 'string' } }, false)
  ]);
  const registry = normalizeSchemaRegistry({ source, schemas: ['Input', 'Output', 'Unused'].map(id => ({ id: `proof.${id}`, typeName: id, source, root })) });
  const before = JSON.stringify(registry);
  const bundle = buildCanonicalSchemaBundle(registry);
  const compiled = compileCanonicalSource("export default async function handler(ctx) { const value = await ctx.req.json('proof.Input'); return ctx.json(value, {schema:'proof.Output'}); }", {
    fileName: source.file, schemaBundle: bundle, strict: true, target: 'native', requireAsync: true
  });
  const plan = buildCanonicalNativePlan(compiled);
  const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { canonicalBuild: true, requirePlatformCapability: false, emitWat: false });
  assert.equal(JSON.stringify(registry), before);
  const declarations = [...artifact.source.matchAll(/^function (__pulse_fastly_schema_scalar_\d+)\(/gm)];
  assert.equal(declarations.length, 8, 'five scalar kinds and three exact enum bodies');
  assert.equal([...artifact.source.matchAll(/^function __pulse_fastly_schema_\d+_\d+\(/gm)].length, 9, 'each non-flat root, array and nullable keeps its own projector');
  assert.equal([...artifact.source.matchAll(/^function __pulse_fastly_schema_flat_object_\d+\(/gm)].length, 1, 'the three identical flat nested projectors share code');
  for (const id of ['Input', 'Output', 'Unused']) assert.ok(artifact.source.includes(`schemaId == "proof.${id}"`));
  assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, { canonicalBuild: true, requirePlatformCapability: false }).source, artifact.source, 'sharing state is local to generation');
  const value = { string: '雪😀', boolean: true, i32: -2147483648, u32: 4294967295, f64: 1.25, enum: 'b', otherEnum: 'c', reverseEnum: 'a', nested: { string: 'nested' }, items: ['x', 'y'], note: null };
  const request = body => ({ request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: JSON.stringify(body) } });
  for (const body of [value, { ...value, i32: 2147483647, u32: 0 }, { ...value, note: 'present' }]) {
    const result = execute(artifact, request({ ...body, dropped: true }));
    assert.equal(result.response.status, 200);
    assert.deepEqual(JSON.parse(result.response.body), body);
  }
  const absent = { ...value }; delete absent.note;
  assert.deepEqual(JSON.parse(execute(artifact, request(absent)).response.body), absent);
  for (const [key, invalid, stage] of [
    ['string', 1, 52], ['boolean', 'true', 52], ['i32', 2147483648, 53], ['i32', -2147483649, 53],
    ['i32', 1.5, 53], ['u32', -1, 53], ['u32', 4294967296, 53], ['u32', 0.5, 53],
    ['f64', '1.25', 53], ['enum', 'c', 54], ['otherEnum', 'b', 54], ['reverseEnum', 'c', 54],
    ['items', [1], 52], ['note', false, 52]
  ]) assert.throws(() => execute(artifact, request({ ...value, [key]: invalid })), error => error.detail?.lastError === 1005 && error.detail?.errorStage === stage, `${key} rejects ${JSON.stringify(invalid)} at stage ${stage}`);
  console.log('ok - Fastly scalar sharing preserves numeric bounds, distinct enums, nested projections, optionality, errors and generation isolation');
}
module.exports = { main };
if (require.main === module) main();
