'use strict';
const assert = require('node:assert/strict');
const { planFor, corpus } = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { root } = require('../runtime/compiler-efficiency/schema-cost-profile.cjs');
const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const options = { cwd: root, canonicalBuild: true, requirePlatformCapability: false, bindings: { configStore: 'mem03', kv: { proof: 'proof' } } };

function customPlan(shape, limits) {
  const source = { file: 'mem03.ts', line: 1, column: 1 };
  const registry = normalizeSchemaRegistry({ source, schemas: [{ id: 'proof.Value', typeName: 'Value', source, root: shape,
    ...(limits ? { jsonLimits: limits } : {}) }] });
  return buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx) {
    const text = await ctx.req.text(); const value = ctx.decodeJson(text,'proof.Value'); return ctx.text(ctx.encodeJson(value,'proof.Value'));
  }`, { fileName: source.file, schemaBundle: buildCanonicalSchemaBundle(registry), strict: true, target: 'native', requireAsync: true }));
}

function eligibilityChecks() {
  const shape = planFor('text-only').schemas.registry.schemas[0].root;
  const replaced = node => ({ ...shape, fields: [{ name: 'value', required: false, value: node }] });
  const emit = plan => platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options).source;
  for (const kind of ['f64', 'i32', 'u32', 'string-enum', 'json-value', 'json-object']) {
    const node = kind === 'string-enum' ? { kind, values: ['ok'] } : { kind };
    assert.doesNotMatch(emit(customPlan(replaced(node))), /textResult: bool/, kind + ' remains on existing path');
  }
  assert.doesNotMatch(emit(customPlan({ ...shape, fields: shape.fields.map(f => ({ ...f, required: true })) })), /textResult: bool/, 'struct codec excluded');
  assert.doesNotMatch(emit(customPlan(shape, { maxTextBytes: 65536 })), /textResult: bool/, 'explicit admission policy excluded');
  let deep = { kind: 'string' }; for (let i = 0; i < 17; i++) deep = { kind: 'array', element: deep };
  assert.doesNotMatch(emit(customPlan(replaced(deep))), /textResult: bool/, 'unproved deep shapes excluded');
  const loop = planFor('text-only', `export default async function handler(ctx) {
    const text = await ctx.req.text(); const value = ctx.decodeJson(text,'proof.Value'); let encoded = '';
    for(let i=0;i<2;i++){await ctx.kv('proof').getVersioned('key'); encoded=ctx.encodeJson(value,'proof.Value');}
    return ctx.text(encoded);
  }`);
  const source = emit(loop);
  assert.match(source, /function __pulse_memory_charge/);
  assert.doesNotMatch(source, /textResult: bool/, 'PS3 plan preserves original charges and error points');
  return loop;
}

function textCases() {
  const cases = corpus('text-only'), value = cases[0].expected;
  for (const [name, text] of Object.entries({
    controls: Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join(''),
    slash: 'a/b', surrogates: '\ud800x\udfff', backslashes: '\\u003f\\\\', separators: '\u2028\u2029\ufeff',
    allBmp: Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i)).join('')
  })) {
    // Keep each authored request bounded, including UTF-8 expansion/escaping.
    for (let at = 0; at < text.length; at += 4000) {
      const expected = { ...value, text: text.slice(at, at + 4000) };
      cases.push({ name: `${name}-${at}`, body: JSON.stringify(expected), expected });
    }
  }
  cases.push({ name: 'empty-containers', body: '{"rows":[],"active":false,"text":""}', expected: { text: '', active: false, rows: [] } });
  return cases;
}

function fixtures() {
  const alias = { text: 'before', active: true, rows: [{ name: 'before' }], note: null };
  const field = (name, value, required = true) => ({ name, value, required });
  const weirdKey = 'label';
  const nestedShape = { kind: 'object', fields: [
    field(weirdKey, { kind: 'string' }),
    field('nested', { kind: 'nullable', value: { kind: 'object', fields: [field('ok', { kind: 'boolean' }),
      field('items', { kind: 'array', element: { kind: 'nullable', value: { kind: 'string' } } })] } }),
    field('optional', { kind: 'boolean' }, false)
  ] };
  const nested = { [weirdKey]: 'x\\"\u0000', nested: { ok: false, items: [null, 'a', '雪😀'] }, optional: false };
  return [
    { name: 'text-only', plan: planFor('text-only'), cases: textCases() },
    { name: 'nested-text', plan: customPlan(nestedShape), cases: [
      { name: 'nullable-array-and-escaped-key', body: JSON.stringify(nested), expected: nested },
      { name: 'nullable-object-and-absent-field', body: JSON.stringify({ [weirdKey]: '', nested: null }), expected: { [weirdKey]: '', nested: null } }
    ] },
    { name: 'codec-failure', plan: customPlan({ kind: 'object', fields: [
      field('quote"\\\n雪', { kind: 'string' }), field('optional', { kind: 'string' }, false)
    ] }), cases: [{ name: 'preserve-existing-escaped-key-codec-trap', body: JSON.stringify({ ['quote"\\\n雪']: 'x' }), trap: true }] },
    { name: 'mutable-alias', plan: planFor('text-only', `export default async function handler(ctx) {
      const value = {text:'before',active:true,rows:[{name:'before'}],note:null}; const alias = value.rows;
      const encoded = ctx.encodeJson(value,'proof.Value'); value.text = 'after'; alias[0].name = 'after';
      return ctx.text(encoded + '|' + value.text + '|' + alias[0].name);
    }`), cases: [{ name: 'detached-text-and-mutable-input', body: '', exact: JSON.stringify(alias) + '|after|after' }] },
    { name: 'encode-admission', plan: planFor('text-only', `export default async function handler(ctx) {
      const text = await ctx.req.text(); const value = {text:text+text,active:true,rows:[]};
      const encoded = ctx.encodeJson(value,'proof.Value'); await ctx.config.get('after'); return ctx.text(encoded);
    }`), cases: [
      { name: 'valid-then-effect', body: 'ok', expected: { text: 'okok', active: true, rows: [] } },
      { name: 'encode-byte-limit', body: 'x'.repeat(33000), error: true, errorCode: 1005, errorStage: 21 }
    ] },
    { name: 'encode-invalid', plan: planFor('text-only', `export default async function handler(ctx) {
      const encoded = ctx.encodeJson({text:false,active:true,rows:[]},'proof.Value');
      await ctx.config.get('after'); return ctx.text(encoded);
    }`), cases: [{ name: 'invalid-before-effect', body: '', error: true, errorCode: 1005, errorStage: 52 }] }
  ];
}

function outcome(wasm, test, run = execute, probe) {
  try {
    const result = run(wasm, { request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: test.body },
      configStore: 'mem03', config: { after: 'ok' }, kvStore: 'proof', kv: {}, ...(probe ? { mem01: probe } : {}) });
    return { result, summary: { status: result.response.status, body: result.response.body, trace: result.trace } };
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) return { summary: { error: 'WASM_TRAP' } };
    if (!error.code?.startsWith('PULSE_FASTLY_')) throw error;
    return { summary: { error: error.code, lastError: error.detail?.lastError, errorStage: error.detail?.errorStage,
      errorEffect: error.detail?.errorEffect, trace: error.detail?.trace } };
  }
}

function checkOutcome(test, observed) {
  if (test.trap) assert.equal(observed.error, 'WASM_TRAP', test.name);
  else if (test.status) { assert.equal(observed.status, test.status); assert.equal(observed.body, 'Payload Too Large'); }
  else if (test.error) {
    assert.ok(observed.error, test.name);
    assert.equal(observed.lastError, test.errorCode || 1005, test.name);
    if (test.errorStage) assert.equal(observed.errorStage, test.errorStage, test.name);
    assert.ok(!observed.trace.some(entry => JSON.stringify(entry).includes('fastly_config_store')), 'encode failure blocks subsequent effects');
  } else {
    assert.equal(observed.status, 200, test.name);
    if (test.exact !== undefined) assert.equal(observed.body, test.exact, test.name);
    else { assert.deepEqual(JSON.parse(observed.body), test.expected, test.name); assert.equal(observed.body, JSON.stringify(test.expected), test.name + ' byte identity'); }
  }
}

function main() {
  eligibilityChecks();
  for (const fixture of fixtures()) {
    const artifact = platform.compileFastlyNativePlatformCapabilitiesPlan(fixture.plan, options);
    for (const test of fixture.cases) checkOutcome(test, outcome(artifact.wasm, test).summary);
  }
  console.log('ok - explicit Fastly text encode preserves exact bytes, Unicode, projection, alias mutation, admission and pre-effect failures');
}
module.exports = { fixtures, textCases, options, outcome, checkOutcome, eligibilityChecks, main };
if (require.main === module) main();
