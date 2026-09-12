'use strict';

// Executable specification only. No production provider imports this module.
const assert = require('node:assert/strict');
const { cloneKvValue } = require('../../../../packages/runtime/src/internal/bindings.js');
const contract = require('./contract.json');
const limits = contract.limits;
const ascii = /^[\x21-\x7e]+$/;

function token(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0 && value.length <= limits.generationBytes && ascii.test(value));
  return value;
}
function key(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.isWellFormed() && value.length > 0 && Buffer.byteLength(value) <= limits.keyUtf8Bytes);
  assert.doesNotMatch(value, /[\u0000-\u001f\u007f-\u009f]/u);
  return value;
}
function encode(value) {
  const normalized = cloneKvValue(value);
  const bytes = Buffer.from('{"__pulseKv":1,"value":' + JSON.stringify(normalized) + '}');
  assert.ok(bytes.length <= limits.wireUtf8Bytes);
  return bytes;
}
function decode(bytes) {
  assert.ok(bytes.length <= limits.wireUtf8Bytes);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const parsed = JSON.parse(text);
  // Check duplicate members before using JSON.parse's last-wins projection.
  // Whitespace, number spelling and object member order are not canonicalized.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  let cursor = 0, entries = 0;
  function visit(depth) {
    assert.ok(depth <= limits.valueDepth + 1 && ++entries <= limits.valueEntries + 2);
    const first = tokens[cursor++];
    if (first !== '{' && first !== '[') return;
    const end = first === '{' ? '}' : ']', names = new Set();
    if (tokens[cursor] === end) { cursor++; return; }
    while (true) {
      if (first === '{') {
        const name = JSON.parse(tokens[cursor++]);
        assert.equal(names.has(name), false, 'Duplicate JSON member'); names.add(name);
        assert.equal(tokens[cursor++], ':');
      }
      visit(depth + 1);
      if (tokens[cursor++] === end) return;
      assert.equal(tokens[cursor - 1], ',');
    }
  }
  visit(0); assert.equal(cursor, tokens.length);
  assert.ok(parsed && !Array.isArray(parsed) && parsed.__pulseKv === 1);
  assert.deepEqual(Object.keys(parsed).sort(), ['__pulseKv', 'value']);
  return cloneKvValue(parsed.value);
}
function fastlyToken(decimal) {
  assert.match(decimal, /^(0|[1-9][0-9]*)$/);
  const value = BigInt(decimal);
  assert.ok(value <= 0xffffffffffffffffn);
  return 'fastly-kv-v1:' + value.toString(16).padStart(16, '0');
}
function fastlyBits(value) {
  token(value);
  assert.match(value, /^fastly-kv-v1:[0-9a-f]{16}$/);
  return BigInt('0x' + value.slice(13));
}

function observation(state) {
  return state === null ? { status: 'not-found' }
    : { status: 'found', value: decode(Buffer.from(state.wire, 'utf8')), generation: token(state.generation) };
}
function readOutcome(input) {
  if (input.hostStatus !== 0) return { status: 'failed', reason: input.reason || 'transport' };
  if (input.kvError === 3) return { status: 'not-found' };
  if (input.kvError !== 1) return { status: 'failed', reason: ({ 5: 'too-large', 6: 'unavailable', 7: 'throttled' })[input.kvError] || 'protocol' };
  if (input.bodyFailure) return { status: 'failed', reason: input.bodyFailure };
  return observation(input.state);
}
function accept(state, operation) {
  key(operation.key);
  assert.ok(['insertIfAbsent', 'compareAndSwap'].includes(operation.kind));
  if (operation.kind === 'compareAndSwap') token(operation.expected);
  const wire = encode(operation.value).toString('utf8');
  const matches = operation.kind === 'insertIfAbsent' ? state === null : state !== null && state.generation === operation.expected;
  if (!matches) return { state, result: { status: 'conflict' } };
  token(operation.nextGeneration);
  assert.ok(state === null || state.generation !== operation.nextGeneration, 'An accepted update changes the generation even for equal bytes');
  return { state: { generation: operation.nextGeneration, wire }, result: { status: 'stored' } };
}

// Trust only complete provider outcomes. A nonzero host status makes output
// slots untrustworthy, even when they happen to contain OK or PRECONDITION.
function outcome(input) {
  if (input.cancelled) return { lifecycle: 'cancelled', mayHaveCommitted: input.dispatched === true };
  if (!input.dispatched) return { status: 'not-stored', reason: input.reason };
  if (input.hostStatus !== 0) return { status: 'unknown', reason: input.reason || 'transport' };
  if (input.operation === 'insertIfAbsent' && input.kvError === 3) return { status: 'unknown', reason: 'protocol' };
  switch (input.kvError) {
    case 1: return { status: 'stored' };
    case 2: return { status: 'not-stored', reason: 'rejected' };
    case 3: case 4: return { status: 'conflict' };
    case 5: return { status: 'not-stored', reason: 'too-large' };
    case 7: return { status: 'not-stored', reason: 'throttled' };
    case 6: return { status: 'unknown', reason: 'unavailable' };
    default: return { status: 'unknown', reason: 'protocol' };
  }
}

module.exports = { token, key, encode, decode, fastlyToken, fastlyBits, observation, readOutcome, accept, outcome };
