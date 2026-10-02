'use strict';
// Frozen R1-01 development comparison; not a product rule owner or benchmark.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const base = '6c33e869198c4fea23325b20e58d1c24bdf98f04';
const file = 'wasm/packages/compiler/src/pure-helper-values.js';
const prior = execFileSync('git', ['show', base + ':' + file], { cwd: root, encoding: 'utf8' });
const old = new Module(path.join(root, file + '.baseline.cjs'));
old.filename = path.join(root, file + '.baseline.cjs');
old.paths = Module._nodeModulePaths(path.dirname(old.filename));
old._compile(prior, old.filename);
const current = require(path.join(root, file));
const builder = execFileSync('git', ['show', base + ':wasm/packages/compiler/src/canonical-native-plan.js'], { cwd: root, encoding: 'utf8' });
const source = builder.match(/function inferBinaryValueKind\(operator, left, right\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(source, 'Pinned baseline must contain the original kind-inference owner.');
const oldKind = vm.runInNewContext('(' + source + ')');
const descriptors = [undefined, 'unknown', 'string', 'number', 'boolean', 'string-or-undefined',
  'object', 'array', { kind: 'number-array' }, { kind: 'record', fields: [{ name: 'n', type: 'number' }] },
  { kind: 'record', fields: [{ name: 'n', type: 'string' }] }];
const operators = ['===', '!==', '==', '!=', '<', '<=', '>', '>=', 'in',
  '&&', '||', '??', '+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>', 'invalid', '__proto__'];
let provenCases = 0, kindCases = 0;
for (const operator of operators) for (const a of descriptors) for (const b of descriptors) {
  const types = new Map([['a', a], ['b', b]]);
  const expression = { kind: 'binary', operator, left: { kind: 'local', id: 'a' }, right: { kind: 'local', id: 'b' } };
  assert.deepEqual(current.readType(expression, types), old.exports.readType(expression, types), `${operator} proven`);
  provenCases++;
  const ak = current.kind(a), bk = current.kind(b);
  assert.equal(current.binaryKind(operator, ak, bk), oldKind(operator, { valueKind: ak }, { valueKind: bk }), `${operator} kind`);
  kindCases++;
}
let indexCases = 0;
for (const object of descriptors) for (const index of [0, 1, -1, 0.5, 'n', 'length', 'missing', true, null]) {
  const types = new Map([['value', object]]);
  const expression = { kind: 'element', object: { kind: 'local', id: 'value' }, index: { kind: 'literal', value: index } };
  assert.deepEqual(current.readType(expression, types), old.exports.readType(expression, types));
  indexCases++;
}
console.log(JSON.stringify({ status: 'passed', base, provenCases, kindCases, indexCases,
  claim: 'All compared inference results equal the pinned implementation; admission remains independently validated.' }));
