'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const f = require('./report-fixtures.cjs');
const codec = require('../../packages/cli/src/internal/report/encoding');
const capsule = require('../../packages/cli/src/internal/report/capsule');
const { compareCapsules, parseComparison, serializeComparison } = require('../../packages/cli/src/internal/report/comparison');
module.exports = function normalizationCases() {
  const completion = require('../../packages/cli/src/internal/report/completion');
  const { sha256 } = require('../../packages/cli/src/internal/report/data');
  const completed = f.completed(), stored = Buffer.from(capsule.serializeStoredCapsule(capsule.parseCapsule(completed.files.get('inventory.json'))));
  completed.files.set('inventory.json', stored);
  Object.assign(completed.completion.sidecars[0], { version: 2, bytes: stored.length, sha256: sha256(stored) });
  function admit() {
    const bytes = Buffer.from(JSON.stringify(completed.completion));
    Object.assign(completed.manifest.reportCompletion, { bytes: bytes.length, sha256: sha256(bytes) });
    return completion.admitCompletedBuild(completed.manifest, bytes, { files: completed.files });
  }
  admit();
  completed.completion.sidecars[0].version = 1;
  assert.throws(admit, { code: 'REPORT_INPUT_VERSION' }, 'completion binds the exact storage version');
  assert.equal(completion.classifyInput(stored).kind, 'historical-capsule');
  const source = fs.readFileSync(f.reportRoot + '/encoding.js', 'utf8');
  const browserContext = vm.createContext({});
  const browser = vm.runInContext(source + '\nreportEncoding', browserContext);
  for (const rich of [false, true]) {
    const value = f.createCapsule(f.fixture(rich)), old = capsule.serializeCapsule(value), wire = capsule.serializeStoredCapsule(value);
    assert.equal(capsule.serializeCapsule(capsule.parseCapsule(wire)), old);
    assert.equal(capsule.serializeCapsule(capsule.parseCapsule(old)), old);
    assert.equal(wire, capsule.serializeStoredCapsule(value));
    assert.equal(browser.stringify(browser.decode(vm.runInContext('(' + wire + ')', browserContext))) + '\n', old);
    assert.equal(codec.store(Object.fromEntries(Object.entries(value).reverse())), wire, 'object insertion order is irrelevant');
    const compared = compareCapsules(value, capsule.parseCapsule(wire));
    assert.equal(serializeComparison(parseComparison(codec.store(compared))), serializeComparison(compared));
    const bad = structuredClone(value); bad.application.name = 'tampered';
    assert.throws(() => capsule.parseCapsule(codec.store(bad)), { code: 'REPORT_HASH' });
  }
  const value = f.createCapsule(f.fixture()), bad = structuredClone(value);
  bad.routes.push(structuredClone(bad.routes[0]));
  assert.throws(() => capsule.parseCapsule(codec.store(bad)), /Report input rejected/, 'semantic duplicate identities still rejected');
  assert.equal(codec.store('tiny'), '"tiny"\n', 'avoid table overhead when larger');
  const shape = { a: ['first', 'second'], b: ['first', 'second'], c: '</script>\u2028😀\ud800', d: null, e: false, f: -0 };
  const encoded = codec.encode(shape), decoded = codec.decode(encoded);
  assert.equal(codec.stringify(decoded), codec.stringify(shape));
  assert.equal(decoded.a, decoded.b, 'share repeated decoded values');
  assert.ok(Object.isFrozen(decoded.a));
  // Local indexes are not semantic IDs: a valid topological table permutation
  // still expands to identical canonical data.
  const permuted = structuredClone(encoded);
  [permuted.nodes[0], permuted.nodes[1]] = [permuted.nodes[1], permuted.nodes[0]];
  const swap = n => n === 0 ? 1 : n === 1 ? 0 : n;
  permuted.nodes = permuted.nodes.map(n => Array.isArray(n) ? n.map((v, i) => i >= (n[0] === 0 ? 1 : 2) ? swap(v) : v) : n);
  assert.equal(codec.stringify(codec.decode(permuted)), codec.stringify(decoded));
  const reject = edit => { const v = structuredClone(encoded); edit(v); assert.throws(() => codec.decode(v), /Report input rejected/); };
  reject(v => { v.encodingVersion++; }); reject(v => { v.extra = true; }); reject(v => { v.root = -1; });
  reject(v => { v.nodes[v.root][2] = v.root; }); // self/forward reference
  for (const ref of [-1, 0.5, '0', null, 999999, {}, []]) reject(v => { v.nodes[v.root][2] = ref; });
  reject(v => { v.nodes[v.root][0] = 2; }); reject(v => { v.nodes[v.root][1] = -1; });
  reject(v => { v.nodes[v.root].push(0); }); reject(v => { v.shapes[0][0] = '__proto__'; });
  reject(v => { v.shapes[0][1] = v.shapes[0][0]; }); reject(v => { v.shapes[0].reverse(); });
  reject(v => { v.shapes.push(v.shapes[0]); }); reject(v => { v.nodes[0] = {}; });
  reject(v => { v.nodes.push('unreachable'); v.root++; });
  assert.throws(() => capsule.parseCapsule('{"kind":"pulse.report-data","kind":"other"}'), { code: 'REPORT_DUPLICATE_KEY' });
  assert.throws(() => codec.decode(codec.encode('x'.repeat(codec.LIMITS.stringBytes + 1))), { code: 'REPORT_LIMIT' });
  const bomb = { kind: codec.KIND, encodingVersion: 1, shapes: [], nodes: ['x'], root: 0 };
  for (let i = 0; i < 30; i++) bomb.nodes.push([0, i, i]);
  bomb.root = bomb.nodes.length - 1;
  assert.throws(() => codec.decode(bomb), { code: 'REPORT_LIMIT' }, 'expanded node/work budget before materialization');
  const bytes = { ...bomb, nodes: ['x'.repeat(1024)] };
  for (let i = 0; i < 15; i++) bytes.nodes.push([0, i, i]);
  bytes.root = bytes.nodes.length - 1;
  assert.throws(() => codec.decode(bytes), { code: 'REPORT_LIMIT' }, 'expanded bytes independently bounded');
  const deep = { ...bomb, nodes: [null] };
  for (let i = 0; i < 66; i++) deep.nodes.push([0, i]);
  deep.root = deep.nodes.length - 1;
  assert.throws(() => codec.decode(deep), { code: 'REPORT_LIMIT' }, 'expanded depth independently bounded');
  const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { throw Error('accessor executed'); } });
  assert.throws(() => codec.decode(getter), { code: 'REPORT_DATA' });
  console.log('ok - AN9-09 normalized storage, canonical compatibility, browser codec, semantic validation and bounded hostile expansion');
};
