'use strict';
// Pinned Binaryen text subset; any unsupported control shape rejects the graph.
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
  assert.ok(Buffer.byteLength(wat) <= 32 * 1024 * 1024 && functions.length <= 100000, 'graph limit');
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
  assert.ok(edges.length <= 100000, 'edge limit');
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

module.exports = { captureGraph, parseGraph };
