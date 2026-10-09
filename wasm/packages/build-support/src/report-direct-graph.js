'use strict';
// Pinned Binaryen text subset; unsupported control never becomes a partial graph.
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_TEXT_BYTES = 32 * 1024 * 1024, MAX_RECORDS = 100000;
const symbol = name => name.replace(/(?:\\[a-f0-9]{2})+/gi, escaped =>
  Buffer.from([...escaped.matchAll(/\\([a-f0-9]{2})/gi)].map(match => parseInt(match[1], 16))).toString('utf8'));
class GraphProofError extends Error {
  constructor(reason, code, functionIndex = null, observed = null, expected = null) {
    super(code);
    this.diagnostic = { reason, code, functionIndex, observed, expected };
  }
}
function demand(condition, reason, code, functionIndex = null, observed = null, expected = null) {
  if (!condition) throw new GraphProofError(reason, code, functionIndex, observed, expected);
}
// Strings and nested comments cannot introduce declarations or instructions.
// Preserve offsets, but never return their contents in a diagnostic.
function maskText(text) {
  const parts = []; let last = 0;
  for (let i = 0; i < text.length; i++) {
    const start = i;
    if (text[i] === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      demand(i < text.length, 'graph-parser-mismatch', 'malformed-text'); i++;
    } else if (text.startsWith(';;', i)) {
      const end = text.indexOf('\n', i); i = end < 0 ? text.length : end;
    } else if (text.startsWith('(;', i)) {
      let depth = 1; i += 2;
      while (i < text.length && depth) {
        if (text.startsWith('(;', i)) { depth++; i += 2; }
        else if (text.startsWith(';)', i)) { depth--; i += 2; }
        else i++;
      }
      demand(depth === 0, 'graph-parser-mismatch', 'malformed-text');
    } else continue;
    parts.push(text.slice(last, start), ' '.repeat(i - start)); last = i; i--;
  }
  parts.push(text.slice(last)); return parts.join('');
}
function moduleFields(text) {
  demand(/^\s*\(module(?=[\s()])/.test(text), 'graph-parser-mismatch', 'malformed-text');
  let depth = 0, start = 0, modules = 0; const fields = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      if (depth === 0) modules++;
      if (depth === 1) start = i;
      depth++;
    } else if (text[i] === ')') {
      demand(depth > 0, 'graph-parser-mismatch', 'malformed-text');
      if (--depth === 1) fields.push(text.slice(start, i + 1));
    } else if (depth === 0) demand(/\s/.test(text[i]), 'graph-parser-mismatch', 'malformed-text');
  }
  demand(depth === 0 && modules === 1, 'graph-parser-mismatch', 'malformed-text');
  return fields;
}
function parseGraph(wat, functions, importedCount) {
  const textBytes = Buffer.byteLength(wat);
  demand(textBytes <= MAX_TEXT_BYTES, 'graph-budget-exhausted', 'text-byte-limit', null, textBytes, MAX_TEXT_BYTES);
  demand(functions.length <= MAX_RECORDS, 'graph-budget-exhausted', 'function-limit', null, functions.length, MAX_RECORDS);
  const text = maskText(wat), fields = moduleFields(text);
  // These exclusions are proof boundaries, including apparently static tables.
  const controls = new Set(), excluded = new Set(['table', 'elem', 'call_indirect', 'call_ref', 'ref.func', 'return_call', 'return_call_indirect', 'return_call_ref']);
  let expectedCalls = 0;
  for (const match of text.matchAll(/[^\s()]+/g)) {
    if (excluded.has(match[0])) controls.add(match[0]);
    if (match[0] === 'call') expectedCalls++;
  }
  // Instruction-specific failures precede their supporting table declaration.
  if (['return_call', 'return_call_indirect', 'return_call_ref'].some(op => controls.has(op))) throw new GraphProofError('unsupported-tail-call', 'tail-call');
  if (controls.has('call_indirect')) throw new GraphProofError('unsupported-indirect-control', 'indirect-call');
  if (controls.has('call_ref') || controls.has('ref.func')) throw new GraphProofError('unsupported-reference-control', 'reference-control');
  if (controls.has('table') || controls.has('elem')) throw new GraphProofError('unsupported-table-control', controls.has('table') ? 'table' : 'element-segment');
  const imports = fields.filter(row => /^\(\s*import\b/.test(row)).flatMap(row => {
    if (!/\(\s*func\b/.test(row)) return [];
    const match = /\(\s*func\s+\$([^\s()]+)/.exec(row);
    demand(match, 'unresolved-function-identity', 'import-name');
    return [{ name: symbol(match[1]) }];
  }).map((row, index) => ({ index, ...row }));
  demand(imports.length === importedCount, 'graph-parser-mismatch', 'import-count', null, imports.length, importedCount);
  const rows = fields.filter(row => /^\(\s*func\b/.test(row));
  demand(rows.length === functions.length, 'graph-parser-mismatch', 'definition-count', null, rows.length, functions.length);
  const byName = new Map();
  for (const row of imports) {
    demand(!byName.has(row.name), 'unresolved-function-identity', 'duplicate-name', row.index);
    byName.set(row.name, row.index);
  }
  const definitions = rows.map((text, ordinal) => {
    const row = functions[ordinal], match = /^\(\s*func\s+\$([^\s()]+)/.exec(text);
    demand(row.index === importedCount + ordinal, 'unresolved-function-identity', 'function-index', null, row.index, importedCount + ordinal);
    demand(match, 'unresolved-function-identity', 'function-name', row.index);
    const name = symbol(match[1]);
    demand(name === (row.name ?? String(ordinal)), 'unresolved-function-identity', 'function-name', row.index);
    demand(!byName.has(name), 'unresolved-function-identity', 'duplicate-name', row.index);
    byName.set(name, row.index);
    return { index: row.index, bytes: row.bytes, name, text };
  });
  const edges = []; let parsedCalls = 0;
  for (const row of definitions) {
    const calls = new Map(); let count = 0;
    for (const match of row.text.matchAll(/\(\s*call\s+\$([^\s()]+)/g)) {
      const name = symbol(match[1]); count++;
      demand(byName.has(name), 'unresolved-function-identity', 'direct-target', row.index);
      const callee = byName.get(name);
      if (!calls.has(callee)) demand(edges.length + calls.size < MAX_RECORDS,
        'graph-budget-exhausted', 'edge-limit', row.index, edges.length + calls.size + 1, MAX_RECORDS);
      calls.set(callee, (calls.get(callee) || 0) + 1);
    }
    let expected = 0;
    for (const token of row.text.matchAll(/[^\s()]+/g)) if (token[0] === 'call') expected++;
    demand(count === expected, 'graph-parser-mismatch', 'direct-call-shape', row.index, count, expected);
    parsedCalls += count;
    for (const [callee, sites] of calls) edges.push({ caller: row.index, callee, sites });
  }
  demand(parsedCalls === expectedCalls, 'graph-parser-mismatch', 'direct-call-scope', null, parsedCalls, expectedCalls);
  return { status: 'available', method: 'verified-final-binary-direct-calls',
    importedFunctions: imports.length, definedFunctions: definitions.length,
    functions: definitions.map(({ text, ...row }) => row), imports, edges,
    tables: 0, indirectCalls: 0,
    interpretation: 'Static direct-call closure includes every conditional callee and shared runtime body; excludes imported implementation bytes, data, section framing, and execution frequency.' };
}
function captureGraph(binaryen, named, functions, importedCount) {
  let module, phase = 'binaryen-read';
  try {
    module = binaryen.readBinary(named); phase = 'binaryen-text';
    const wat = module.emitText(); phase = 'unexpected-parser-failure';
    return { ...parseGraph(wat, functions, importedCount), namedCompanionSha256: hash(named) };
  } catch (error) {
    const diagnostic = error instanceof GraphProofError ? error.diagnostic
      : { reason: 'graph-parser-mismatch', code: phase, functionIndex: null, observed: null, expected: null };
    return { status: 'unavailable', reason: diagnostic.reason, diagnostic, namedCompanionSha256: hash(named) };
  } finally {
    if (module) try { module.dispose(); } catch { /* optional observer cleanup */ }
  }
}
module.exports = { captureGraph, parseGraph };
