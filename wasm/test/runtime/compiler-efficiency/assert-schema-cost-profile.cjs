'use strict';

const assert = require('node:assert/strict');
const { normalizeSchemaRegistry } = require('../../../packages/contracts/src/schema-json/registry');
const { profileRegistry, shape } = require('./schema-cost-profile.cjs');
const source = { file: 'schema-cost-controls.ts', line: 1, column: 1 };
const field = (name, value, required = true) => ({ name, value, required });
const object = fields => ({ kind: 'object', fields });
const roots = [
  object([field('id', { kind: 'string' }), field('count', { kind: 'i32' })]),
  object([field('é😀', { kind: 'string' }, false)]),
  object([field('data', { kind: 'scalar-record' })]),
  object([field('data', { kind: 'json-value' })]),
  { ...object([field('kind', { kind: 'string-enum', values: ['a', 'b'] })]), additionalProperties: { kind: 'json-value' } },
  object([field('items', { kind: 'array', element: object([field('flag', { kind: 'boolean' })]) })])
];
const input = normalizeSchemaRegistry({ source, schemas: roots.map((root, index) => ({ id: `proof.Control${index}`, typeName: `Control${index}`, source, root })),
  responses: [{ id: 'proof.responseOnly', schemaId: 'proof.Control5', status: 201, source }] });
const before = JSON.stringify(input);
const profile = profileRegistry(input, [{ id: 'proof.Control0', usage: 'request-decode' }]);
assert.equal(JSON.stringify(input), before, 'profiling cannot mutate registry semantics or identities');
assert.equal(profile.registryHash, input.registryHash);
assert.equal(profile.entries.length, 6);
assert.deepEqual(profile.entries.map(entry => entry.nativeRepresentation), ['typed-class', 'value-projection', 'value-projection', 'value-projection', 'value-projection', 'typed-class']);
assert.equal(profile.entries.filter(entry => entry.compilerReferences === 0).length, 5);
assert.deepEqual(profile.entries[5].responseCases, ['proof.responseOnly'], 'response-case roots are distinct from handler references');
assert.equal(profile.entries[4].jsonLimits.maxDepth, 32);
assert.equal(profile.entries[1].fields, 1);
assert.equal(profile.entries[1].optional, 1);
assert.equal(profile.entries[4].nodes, 3, 'open-object policy is counted as a node');
assert.ok(profile.portable.entries[3].families.json_scan > 0);
assert.ok(profile.portable.entries[0].families['typed-class'] > 0);
assert.deepEqual(profile.fastly.entries.slice(0, 2).map(entry => entry.bytes), [0, 0], 'flat helpers are charged to the shared bucket');
assert.ok(profile.fastly.entries.slice(2).every(entry => entry.families['value-projection'] > 0));
assert.ok(profile.fastly.shared.families['flat-object-projector'] > 0);
assert.ok(profile.portable.shared.families.dispatch > 0);
assert.ok(profile.fastly.shared.families.dispatch > 0);
assert.ok(profile.fastly.shared.families['scalar-projector'] > 0, 'shared validators are not charged to the first schema ID');
for (const target of [profile.portable, profile.fastly]) assert.equal(target.bytes, target.shared.bytes + target.entries.reduce((sum, entry) => sum + entry.bytes, 0));
assert.equal(shape(roots[0]).rootShapeSha256, shape({ ...roots[0], source }).rootShapeSha256, 'locations do not change structural grouping');
assert.notEqual(shape(roots[0]).rootShapeSha256, shape(object([...roots[0].fields].reverse())).rootShapeSha256, 'field order remains semantic');
assert.notEqual(shape(roots[0]).rootShapeSha256, shape(object([field('id', { kind: 'string' }, false), roots[0].fields[1]])).rootShapeSha256, 'presence remains semantic');
assert.throws(() => profileRegistry(input, [{ id: 'proof.Missing' }]), /unknown reference/);
console.log('ok - schema cost attribution preserves IDs, policies, response roots, Unicode byte accounting and production generation');
