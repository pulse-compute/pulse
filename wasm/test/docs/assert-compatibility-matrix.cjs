#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  HANDLER_SURFACE_DEFINITIONS
} = require('../../packages/contracts/src/handler/surface-contract.js');
const {
  compileCanonicalSource
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixRelative = 'docs/reference/compatibility-matrix.md';
const matrixFile = path.join(repoRoot, matrixRelative);
const matrix = fs.readFileSync(matrixFile, 'utf8');
const sourceHeader = '| Source form | Node JS | Fastly JS | Node Native | Fastly Native | Notes |';
const capabilityHeader = '| Capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |';
const entitiesHeader = '| Entities capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |';
const candidateHeader = '| Candidate capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |';

function markdownFiles(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) markdownFiles(file, out);
    else if (entry.isFile() && file.endsWith('.md')) out.push(file);
  }
  return out;
}

function tableRows(source, header) {
  const lines = source.split(/\r?\n/);
  const start = lines.indexOf(header);
  assert.notEqual(start, -1, `missing table header ${header}`);
  assert.match(lines[start + 1], /^\|[-:|]+\|$/);
  const rows = [];
  for (let index = start + 2; index < lines.length && lines[index].startsWith('|'); index += 1) {
    rows.push(lines[index].split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return new Map(rows.map((row) => [row[0].replaceAll('`', ''), row]));
}

function targetCells(row) {
  assert.ok(row, 'expected matrix row');
  return row.slice(1, 5);
}

const canonicalOwners = markdownFiles(path.join(repoRoot, 'docs'))
  .filter((file) => fs.readFileSync(file, 'utf8').includes(sourceHeader))
  .map((file) => path.relative(repoRoot, file).replace(/\\/g, '/'))
  .sort();
assert.deepEqual(canonicalOwners, [matrixRelative], 'source-form matrix must have exactly one canonical documentation owner');
assert.equal((matrix.match(new RegExp(sourceHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
assert.equal((matrix.match(new RegExp(capabilityHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
assert.equal((matrix.match(new RegExp(entitiesHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
assert.equal((matrix.match(new RegExp(candidateHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);

const sourceRows = tableRows(matrix, sourceHeader);
for (const name of [
  'Async-shaped managed handler',
  'Static Router topology and terminal next()',
  'Sequential awaits of trusted Pulse effects',
  'await ctx.parallel({ fixed: effect })',
  'Request metadata, route parameters, request state, logging, and response construction',
  'Schema-bound request, fetch, and response JSON',
  'Generic bounded JSON with pulse.strict: false',
  'Direct opaque response pass-through',
  'Supported package-root Assets and GRIP calls'
]) {
  assert.deepEqual(targetCells(sourceRows.get(name)), ['Yes', 'Yes', 'Yes', 'Yes'], `${name} must remain four-mode`);
}
assert.deepEqual(targetCells(sourceRows.get('Ordinary target-compatible JavaScript package API')), ['Yes', 'Yes', 'No', 'No']);
assert.deepEqual(targetCells(sourceRows.get('Arbitrary Promise construction or library await')), ['JS only', 'JS only', 'No', 'No']);
assert.deepEqual(targetCells(sourceRows.get('Ambient fetch, timers, environment/process access, filesystem, sockets, or provider SDK')), ['No', 'No', 'No', 'No']);
assert.deepEqual(targetCells(sourceRows.get('Userland body streams, chunk transforms, or background work')), ['No', 'No', 'No', 'No']);

const capabilityRows = tableRows(matrix, capabilityHeader);
for (const name of [
  'Canonical handler and Router execution',
  'Request and structured responses',
  'Single, sequential, and keyed-parallel fetch',
  'Explicit JSON schemas and bounded generic JSON',
  'Opaque pass-through',
  'GRIP framing and configured broadcast',
  'ctx.log and redaction'
]) {
  assert.deepEqual(targetCells(capabilityRows.get(name)), ['Yes', 'Yes', 'Yes', 'Yes'], `${name} must remain four-mode`);
}
assert.deepEqual(targetCells(capabilityRows.get('Config reads')), ['Test/dev binding', 'Config Store', 'Test/dev binding', 'Config Store']);
assert.deepEqual(targetCells(capabilityRows.get('Secret reads')), ['Test/dev binding', 'Secret Store', 'Test/dev binding', 'Secret Store']);
assert.deepEqual(targetCells(capabilityRows.get('KV get and put')), ['In-memory binding', 'KV Store', 'In-memory binding', 'KV Store']);
assert.deepEqual(targetCells(capabilityRows.get('Deployment candidate')), ['Source package', 'Source package plus downstream runtime Wasm', 'Node build', '`bin/main.wasm`']);
assert.deepEqual(targetCells(capabilityRows.get('Production deployment and activation')), ['Not applicable', 'Human-operated', 'Not applicable', 'Human-operated']);

const entitiesRows = tableRows(matrix, entitiesHeader);
for (const name of [
  'Static EntityRouter declarations',
  'Deterministic catalog and inspection'
]) assert.deepEqual(targetCells(entitiesRows.get(name)), ['Yes', 'Yes', 'Yes', 'Yes']);
for (const name of [
  'Bounded JSON-RPC request execution',
  'Declared input/output schema codecs',
  'Managed handler effects'
]) assert.deepEqual(targetCells(entitiesRows.get(name)), ['Measured', 'Measured', 'Measured', 'Measured']);
assert.deepEqual(targetCells(entitiesRows.get('Ordinary project build integration')), ['Yes', 'Yes', 'No', 'No']);
assert.deepEqual(targetCells(entitiesRows.get('Ordinary project test/dev loading')), ['Blocked', 'Blocked', 'Not applicable', 'Not applicable']);
assert.deepEqual(targetCells(entitiesRows.get('Automatic target fallback')), ['No', 'No', 'No', 'No']);

const candidateRows = tableRows(matrix, candidateHeader);
assert.deepEqual(
  targetCells(candidateRows.get('HS256 MAC verification')),
  ['`runtime-builtin`', '`runtime-builtin`', '`guest-source:pulse-hmac-as`', '`guest-source:pulse-hmac-as`']
);
assert.deepEqual(
  targetCells(candidateRows.get('ES256 signature verification')),
  ['`runtime-builtin`', '`runtime-builtin`', '`guest-linked:pulse-es256-rustcrypto-p256`', '`guest-linked:pulse-es256-rustcrypto-p256`']
);
assert.deepEqual(
  targetCells(candidateRows.get('JWT verification')),
  ['HS256, ES256', 'HS256, ES256', 'HS256, ES256', 'HS256, ES256']
);

assert.equal(HANDLER_SURFACE_DEFINITIONS.every((entry) => entry.targetSupport.javascript), true);
const javascriptAwait = HANDLER_SURFACE_DEFINITIONS.find((entry) => entry.id === 'javascript.await');
assert.ok(javascriptAwait);
assert.deepEqual(javascriptAwait.targetSupport, { javascript: true, native: false });
assert.equal(
  HANDLER_SURFACE_DEFINITIONS
    .filter((entry) => entry.id !== 'javascript.await')
    .every((entry) => entry.targetSupport.native),
  true,
  'every managed core/package surface except general JavaScript await must remain Native-supported'
);

const declarations = fs.readFileSync(path.join(repoRoot, 'packages/runtime/src/index.d.ts'), 'utf8');
for (const signature of [
  /export type Handler = \(ctx: PulseContext\) => Promise<HandlerResult>;/,
  /export type RouteHandler = \(ctx: PulseRouteContext, next: RouterNext\) => Promise<HandlerResult>;/,
  /export type RouterNext = \(error\?: unknown\) => never;/
]) assert.match(declarations, signature);

const evidence = [
  'wasm/packages/contracts/src/handler/surface-contract.js',
  'packages/runtime/src/index.d.ts',
  'wasm/test/lowering/assert-canonical-api-lowering.cjs',
  'wasm/test/compiled/assert-canonical-native-wasm.cjs',
  'wasm/test/contracts/assert-four-mode-conformance.cjs',
  'wasm/test/support/four-mode-conformance.cjs',
  'wasm/test/contracts/assert-javascript-effect-adapter.cjs',
  'wasm/test/contracts/assert-node-router-context-parity.cjs',
  'wasm/test/contracts/assert-schema-codecs.cjs',
  'wasm/test/contracts/assert-fetch-projections-request-bodies.cjs',
  'wasm/test/runtime/assert-canonical-opaque-passthrough.cjs',
  'wasm/test/contracts/assert-config-secrets-kv-redaction.cjs',
  'wasm/test/compiled/assert-package-root-native.cjs',
  'wasm/test/contracts/assert-grip-cross-target-conformance.cjs',
  'wasm/test/entities/assert-entities-catalog.cjs',
  'wasm/test/entities/assert-entities-inspection.cjs',
  'wasm/test/entities/assert-entities-orchestration-demo.cjs',
  'wasm/test/entities/assert-entities-cross-target.cjs',
  'wasm/test/suite/registry.cjs',
  'release/pulse-release-manifest.json',
  'wasm/.test-results/boundary-h4/es256-six-cell-matrix.json'
];
for (const relative of evidence) {
  assert.equal(fs.existsSync(path.join(repoRoot, relative)), true, `missing matrix evidence ${relative}`);
  assert.equal(matrix.includes(`\`${relative}\``), true, `matrix must cite ${relative}`);
}

const portable = compileCanonicalSource(`
interface Result { readonly selected: number }
export default async function handler(ctx) {
  let value: number = 1
  value += 1
  const source = { value } as const
  const values = [value, 3]
  const key = 'value'
  const result: Result = ctx.req.path === '/x'
    ? { ...source, selected: source[key] ?? values[0] }
    : { selected: 0 }
  return ctx.json(result)
}
`, { fileName: 'compatibility-portable.ts', strict: true });
assert.ok(buildCanonicalNativePlan(portable));

function nativeBoundary(label, source, expectedCode) {
  assert.throws(() => {
    const compiled = compileCanonicalSource(source, { fileName: `${label}.ts`, strict: true });
    buildCanonicalNativePlan(compiled);
  }, (error) => {
    assert.ok((error.diagnostics || []).some((entry) => entry.code === expectedCode), `${label} must report ${expectedCode}`);
    return true;
  });
}

nativeBoundary(
  'loop',
  `export default async function handler(ctx) { let n = 0; while (n < 2) n++; return ctx.json({ n }); }`,
  'PULSE_CANONICAL_CONTROL_FLOW_UNSUPPORTED'
);
nativeBoundary(
  'throw',
  `export default async function handler(ctx) { throw new Error('x'); }`,
  'PULSE_CANONICAL_NATIVE_STATEMENT_UNSUPPORTED'
);
nativeBoundary(
  'class',
  `export default async function handler(ctx) { class Value {}; const value = new Value(); return ctx.json({ value }); }`,
  'PULSE_CANONICAL_NATIVE_STATEMENT_UNSUPPORTED'
);
nativeBoundary(
  'nested-function',
  `export default async function handler(ctx) { function value() { return 1; } return ctx.json({ value: value() }); }`,
  'PULSE_CANONICAL_NATIVE_STATEMENT_UNSUPPORTED'
);
nativeBoundary(
  'optional-chain',
  `export default async function handler(ctx) { const value = { ok: true }; return ctx.json({ ok: value?.ok }); }`,
  'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED'
);
nativeBoundary(
  'destructure',
  `export default async function handler(ctx) { const { path } = ctx.req; return ctx.json({ path }); }`,
  'PULSE_CANONICAL_NATIVE_BINDING_UNSUPPORTED'
);
nativeBoundary(
  'arbitrary-await',
  `export default async function handler(ctx) { const value = await Promise.resolve(1); return ctx.json({ value }); }`,
  'PULSE_NATIVE_AWAIT_UNSUPPORTED'
);
nativeBoundary(
  'ambient-fetch',
  `export default async function handler(ctx) { const value = fetch('https://example.test'); return ctx.json({ value }); }`,
  'PULSE_CANONICAL_AMBIENT_FETCH_UNSUPPORTED'
);

console.log('ok - one canonical matrix matches the managed handler registry, public types, evidence paths, target order, and focused Native language boundaries');
