'use strict';

// Evidence-only, direct-call subset of the existing O08 disassembly method.
// The input is the verified names companion from the final emission, not a
// recompiled source or a newly optimized module. Unknown shapes fail closed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const symbol = name => name.replace(/(?:\\[a-f0-9]{2})+/gi, escaped =>
  Buffer.from([...escaped.matchAll(/\\([a-f0-9]{2})/gi)].map(match => parseInt(match[1], 16))).toString('utf8'));

function parseGraph(wat, functions, importedCount) {
  assert.ok(!/\((?:table|elem)\b/.test(wat), 'tables or element segments are outside the direct-call proof');
  assert.ok(!/\b(?:call_indirect|call_ref|return_call(?:_indirect|_ref)?|ref\.func)\b/.test(wat),
    'indirect, reference, or tail calls are outside the direct-call proof');
  const imports = [...wat.matchAll(/\(import [^\n]*\(func \$([^\s()]+)/g)]
    .map((match, index) => ({ index, name: symbol(match[1]) }));
  assert.equal(imports.length, importedCount, 'every imported function is accounted for');
  const rows = [...wat.matchAll(/^ \(func \$([^\s(]+)([\s\S]*?)^ \)/gm)];
  assert.equal(rows.length, functions.length, 'every defined function is parsed');
  assert.equal((wat.match(/^ \(func\b/gm) || []).length, rows.length, 'no unparsed function declarations');
  const byName = new Map(imports.map(row => [row.name, row.index]));
  const definitions = rows.map((match, ordinal) => {
    const row = functions[ordinal], name = symbol(match[1]);
    assert.equal(row.index, importedCount + ordinal, 'code-body index includes function imports');
    assert.equal(name, row.name ?? String(ordinal), 'disassembly order and name agree with final emitted index');
    assert.ok(!byName.has(name), 'function names identify one final function');
    byName.set(name, row.index);
    return { index: row.index, bytes: row.bytes, name, text: match[2] };
  });
  assert.equal(byName.size, imports.length + definitions.length, 'import and definition names are unique');
  const edges = definitions.flatMap(row => {
    const calls = new Map();
    for (const match of row.text.matchAll(/\(call \$([^\s()]+)/g)) {
      const name = symbol(match[1]);
      assert.ok(byName.has(name), 'every direct-call target resolves: ' + name);
      const callee = byName.get(name);
      calls.set(callee, (calls.get(callee) || 0) + 1);
    }
    return [...calls].map(([callee, sites]) => ({ caller: row.index, callee, sites }));
  });
  return { status: 'available', method: 'verified-final-binary-direct-calls',
    importedFunctions: imports.length, definedFunctions: definitions.length,
    functions: definitions.map(({ text, ...row }) => row), imports, edges,
    tables: 0, indirectCalls: 0,
    interpretation: 'Static direct-call closure includes every conditional callee and shared runtime body; excludes imported implementation bytes, data, section framing, and execution frequency.' };
}

function captureGraph(binaryen, named, functions, importedCount) {
  let module;
  try {
    module = binaryen.readBinary(named);
    return { ...parseGraph(module.emitText(), functions, importedCount), namedCompanionSha256: hash(named) };
  } catch (error) {
    return { status: 'unavailable', reason: error.message, namedCompanionSha256: hash(named) };
  } finally {
    if (module) module.dispose();
  }
}

function directCallClosure(graph, rootIndices) {
  if (graph.status !== 'available') return { status: 'unavailable', reason: graph.reason };
  const functions = new Map(graph.functions.map(row => [row.index, row]));
  const imports = new Set(graph.imports.map(row => row.index));
  const outgoing = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.caller)) outgoing.set(edge.caller, []);
    outgoing.get(edge.caller).push(edge.callee);
  }
  const roots = [...new Set(rootIndices)];
  if (!roots.length || roots.some(index => !functions.has(index))) {
    return { status: 'unavailable', reason: 'all roots must be mapped defined bodies' };
  }
  const visited = new Set(), reachedImports = new Set(), queue = [...roots];
  for (let position = 0; position < queue.length; position++) {
    const index = queue[position];
    if (visited.has(index)) continue;
    if (imports.has(index)) { reachedImports.add(index); continue; }
    if (!functions.has(index)) return { status: 'unavailable', reason: 'unresolved direct-call target' };
    visited.add(index);
    queue.push(...(outgoing.get(index) || []));
  }
  const bodyIndices = [...visited].sort((a, b) => a - b);
  return { status: 'available', rootIndices: roots, bodyIndices,
    bodyBytes: bodyIndices.reduce((total, index) => total + functions.get(index).bytes, 0),
    importedFunctionIndices: [...reachedImports].sort((a, b) => a - b),
    additiveAcrossRoutes: false };
}

function selfCheck() {
  const wat = '(module\n (import "host" "effect" (func $host))\n'
    + ' (func $a\n  (call $shared)\n  (call $shared)\n )\n'
    + ' (func $b\n  (call $shared)\n )\n'
    + ' (func $shared\n  (call $a)\n  (call $host)\n )\n)';
  const rows = [{ index: 1, name: 'a', bytes: 5 }, { index: 2, name: 'b', bytes: 7 },
    { index: 3, name: 'shared', bytes: 11 }];
  const graph = parseGraph(wat, rows, 1);
  assert.equal(graph.edges.find(edge => edge.caller === 1).sites, 2);
  assert.equal(directCallClosure(graph, [1]).bodyBytes, 16, 'cycles and repeat calls count bodies once');
  assert.equal(directCallClosure(graph, [1, 2, 1]).bodyBytes, 23, 'shared helper and repeated roots count once');
  assert.deepEqual(directCallClosure(graph, [2]).importedFunctionIndices, [0]);
  assert.equal(directCallClosure(graph, [999]).status, 'unavailable');
  assert.throws(() => parseGraph(wat.replace('(module', '(module\n (table 1 funcref)'), rows, 1), /tables/);
  assert.throws(() => parseGraph(wat.replace('(call $host)', '(call_indirect (type $t))'), rows, 1), /indirect/);
  assert.throws(() => parseGraph(wat.replace('(call $host)', '(call $missing)'), rows, 1), /resolves/);
  assert.throws(() => parseGraph(wat, [{ ...rows[0], index: 0 }, ...rows.slice(1)], 1), /index/);
  const renamed = wat.replaceAll('$shared', '$2');
  assert.equal(parseGraph(renamed, [...rows.slice(0, 2), { ...rows[2], name: null }], 1).status, 'available');
  let disposed = false;
  const unsupported = captureGraph({ readBinary: () => ({
    emitText: () => '(module (table 1 funcref))', dispose: () => { disposed = true; }
  }) }, Buffer.from('fixture'), [], 0);
  assert.equal(unsupported.status, 'unavailable');
  assert.equal(disposed, true, 'temporary module disposed on unsupported shape');
  return { status: 'passed', checks: 12 };
}

if (require.main === module) console.log(JSON.stringify(selfCheck()));
module.exports = { captureGraph, directCallClosure, parseGraph, selfCheck };
