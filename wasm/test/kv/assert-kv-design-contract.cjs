#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');
const spec = require('./k1/reference.cjs');
const contract = require('./k1/contract.json');
const vectors = require('./k1/vectors.json');
const mapping = require('./k1/provider-mapping.json');
const bindings = require('../../../packages/runtime/src/internal/bindings.js');

assert.equal(contract.authority.owner, '@pulse-compute/runtime');
assert.equal(contract.authority.providerSdkIsCanonical, false);
assert.equal(mapping.targets['fastly-javascript'].blocksOtherTargets, false);
assert.equal(mapping.targets['fastly-javascript'].conditionalEligibility, false);
assert.equal(contract.limits.valueJsonUtf8Bytes, bindings.DEFAULT_MAX_KV_VALUE_BYTES);
assert.equal(contract.limits.valueDepth, bindings.DEFAULT_MAX_KV_VALUE_DEPTH);
assert.equal(contract.limits.valueEntries, bindings.DEFAULT_MAX_KV_VALUE_ENTRIES);

for (const row of vectors.tokens) {
  assert.equal(spec.fastlyToken(row.decimal), row.token);
  const bits = spec.fastlyBits(row.token);
  assert.equal(bits.toString(), row.decimal);
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(bits);
  assert.equal(bytes.toString('hex'), row.littleEndian);
  assert.equal(JSON.parse(JSON.stringify({ generation: row.token })).generation, row.token);
}
assert.notEqual(BigInt(Number('9007199254740993')).toString(), '9007199254740993');
for (const value of [...vectors.invalidTokens, 1n, 'a'.repeat(257)]) assert.throws(() => spec.token(value));
for (const value of vectors.invalidFastlyTokens) assert.throws(() => spec.fastlyBits(value));
for (const value of ['-1', '01', '18446744073709551616']) assert.throws(() => spec.fastlyToken(value));
assert.equal(spec.token('provider-defined-opaque-v1:abc'), 'provider-defined-opaque-v1:abc');
for (const value of ['', '\u0000', '\ud800', 'a'.repeat(1025)]) assert.throws(() => spec.key(value));
for (const value of ['.', '..', '#;?^|', '%2F', '/a//b/', '雪'.repeat(341) + 'a']) assert.equal(spec.key(value), value, 'Pulse exact-key semantics are not SDK URL restrictions');

for (const { value, wire } of vectors.wire) {
  assert.equal(spec.encode(value).toString(), wire);
  assert.deepEqual(spec.decode(Buffer.from(wire)), value);
}
assert.deepEqual(spec.decode(Buffer.from('{ "value": {"n":1e0}, "__pulseKv": 1 }')), { n: 1 });
for (const wire of vectors.invalidWire) assert.throws(() => spec.decode(Buffer.from(wire)), wire);
assert.throws(() => spec.decode(Buffer.from([0xff])));
assert.throws(() => spec.decode(Buffer.from('{"__pulseKv":1,"value":null}truncated')));
const maximumValue = 'x'.repeat(contract.limits.valueJsonUtf8Bytes - 2);
assert.equal(Buffer.byteLength(JSON.stringify(maximumValue)), 65536);
assert.equal(spec.decode(spec.encode(maximumValue)), maximumValue);
assert.ok(spec.encode(maximumValue).length > 65536, 'K3 must allow envelope overhead beyond the old Native buffer');
assert.throws(() => spec.encode(maximumValue + 'x'));
assert.throws(() => spec.encode(undefined));
assert.throws(() => spec.encode({ value: NaN }));
assert.throws(() => spec.encode({ value: 1n }));
const immutable = spec.decode(spec.encode({ nested: [1, 2] }));
assert.ok(Object.isFrozen(immutable) && Object.isFrozen(immutable.nested));
assert.throws(() => immutable.nested.push(3));
const deepest = (n) => { let value = null; while (n--) value = [value]; return value; };
assert.deepEqual(spec.decode(spec.encode(deepest(64))), deepest(64));
assert.throws(() => spec.encode(deepest(65)));
assert.throws(() => spec.decode(Buffer.from('{"__pulseKv":1,"value":' + '['.repeat(66) + 'null' + ']'.repeat(66) + '}')));
assert.throws(() => spec.encode(Array(10000).fill(0)));
assert.throws(() => spec.decode(Buffer.from('{"__pulseKv":1,"value":[' + Array(10000).fill('0').join(',') + ']}')));
const worstRequest = { namespace: 'n'.repeat(256), key: '"'.repeat(1024), generation: '"'.repeat(256), value: maximumValue };
const worstResponse = { status: 'found', generation: worstRequest.generation, value: maximumValue };
for (const value of [worstRequest, worstResponse]) assert.ok(Buffer.byteLength(JSON.stringify(value)) < contract.limits.effectEnvelopeBytes);

// Independently fixed expected outcomes, including invalid output slots after a
// host failure. A provider's rejection and an unconfirmed dispatch differ.
for (const row of vectors.outcomes) assert.deepEqual(spec.outcome(row.input), row.expected, row.id);
for (const row of vectors.readOutcomes) assert.deepEqual(spec.readOutcome(row.input), row.expected, row.id);

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map((tail) => [value, ...tail]));
}
const seed = { generation: 'seed:9007199254740993', wire: spec.encode({ revision: 0 }).toString() };
let schedules = 0;
for (const kind of ['insertIfAbsent', 'compareAndSwap']) {
  for (const order of permutations([0, 1, 2])) {
    let state = kind === 'insertIfAbsent' ? null : seed;
    const results = [];
    for (const id of order) {
      const applied = spec.accept(state, { kind, key: 'same-key', expected: seed.generation, value: { writer: id }, nextGeneration: `next:${id}` });
      results.push(applied.result.status); state = applied.state;
    }
    assert.equal(results.filter((status) => status === 'stored').length, 1);
    assert.equal(results.filter((status) => status === 'conflict').length, 2);
    assert.equal(spec.observation(state).value.writer, order[0]); schedules++;
  }
}
assert.deepEqual(spec.observation(null), { status: 'not-found' });
assert.deepEqual(spec.accept(null, { kind: 'compareAndSwap', key: 'key', expected: seed.generation, value: null, nextGeneration: 'next:1' }).result, { status: 'conflict' });
const staleRead = spec.observation(seed);
const accepted = spec.accept(seed, { kind: 'compareAndSwap', key: 'key', expected: staleRead.generation, value: { revision: 1, receipt: 'accepted-command' }, nextGeneration: 'next:1' });
const staleWrite = spec.accept(accepted.state, { kind: 'compareAndSwap', key: 'key', expected: staleRead.generation, value: { revision: 2 }, nextGeneration: 'next:2' });
assert.deepEqual(staleWrite.result, { status: 'conflict' }); assert.equal(staleWrite.state, accepted.state);
assert.equal(staleRead.value.receipt, undefined);
assert.equal(spec.outcome({ dispatched: true, hostStatus: 1, reason: 'timeout' }).status, 'unknown');
assert.equal(spec.observation(accepted.state).value.receipt, 'accepted-command', 'A stale read missing a receipt cannot prove an ambiguous write failed');
const unchanged = spec.accept(seed, { kind: 'compareAndSwap', key: 'key', expected: seed.generation, value: { revision: 0 }, nextGeneration: 'different:1' });
assert.equal(unchanged.result.status, 'stored'); assert.notEqual(unchanged.state.generation, seed.generation);
assert.throws(() => spec.accept(seed, { kind: 'compareAndSwap', key: 'key', expected: seed.generation, value: 1, nextGeneration: seed.generation }));
const recreated = spec.accept(null, { kind: 'insertIfAbsent', key: 'key', value: { revision: 0 }, nextGeneration: 'new-incarnation:1' });
assert.equal(spec.accept(recreated.state, { kind: 'compareAndSwap', key: 'key', expected: seed.generation, value: 1, nextGeneration: 'unused' }).result.status, 'conflict');
// If a provider reuses a token after deletion/recreation, same-token CAS cannot
// distinguish the incarnation. This is explicitly outside the base promise.
assert.equal(spec.accept({ ...recreated.state, generation: seed.generation }, { kind: 'compareAndSwap', key: 'key', expected: seed.generation, value: 1, nextGeneration: 'next:incarnation' }).result.status, 'stored');

const root = path.resolve(__dirname, '../../..');
const program = ts.createProgram({ rootNames: [path.join(__dirname, 'k1/types.ts')], options: {
  noEmit: true, strict: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  baseUrl: root, paths: { '@pulse-compute/runtime': ['packages/runtime/src/index.d.ts'] },
} });
assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
console.log(JSON.stringify({ status: 'passed', proof: 'K1-executable-specification', tokens: vectors.tokens.length, outcomeVectors: vectors.outcomes.length, readOutcomeVectors: vectors.readOutcomes.length, raceSchedules: schedules, publicRuntimeSupport: false, providerReality: false }));
