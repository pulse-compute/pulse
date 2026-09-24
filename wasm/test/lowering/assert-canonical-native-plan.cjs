#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CANONICAL_NATIVE_PLAN_VERSION,
  CANONICAL_NATIVE_PLAN_COMPILER_VERSION,
  CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION,
  CanonicalNativePlanError,
  buildCanonicalNativePlan,
  validateCanonicalNativePlan,
  writeCanonicalNativePlan,
  stableStringify
} = require('../../packages/compiler/src/canonical-native-plan.js');
const nativePlanContract = require('../../packages/contracts/src/handler/canonical-native-plan.js');
const {
  compileCanonicalFile,
  compileCanonicalSource
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  EXAMPLES,
  compileExample,
  internalFixture
} = require('../support/canonical-projects.cjs');

function walkExpression(expression, visit) {
  if (!expression || typeof expression !== 'object') return;
  visit(expression);
  for (const value of Object.values(expression)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          if (item.kind === 'value' || item.kind === 'spread') walkExpression(item.value, visit);
          else if (item.kind === 'property') {
            if (item.key && item.key.kind === 'computed') walkExpression(item.key.value, visit);
            walkExpression(item.value, visit);
          } else if (nativePlanContract.CANONICAL_NATIVE_EXPRESSION_KINDS.includes(item.kind)) walkExpression(item, visit);
        }
      }
    } else if (value && typeof value === 'object' && nativePlanContract.CANONICAL_NATIVE_EXPRESSION_KINDS.includes(value.kind)) {
      walkExpression(value, visit);
    }
  }
}

function walkStatements(statements, visit) {
  for (const statement of statements || []) {
    visit(statement);
    if (statement.kind === 'if') {
      walkStatements(statement.then, visit);
      walkStatements(statement.else, visit);
    }
  }
}

function expressionLocalIds(expression) {
  const ids = [];
  walkExpression(expression, (item) => { if (item.kind === 'local') ids.push(item.id); });
  return ids;
}

function effect(plan, id) {
  const found = plan.effects.find((entry) => entry.id === id);
  assert.ok(found, `plan must contain ${id}`);
  return found;
}

function input(effectRecord, name) {
  const found = effectRecord.inputs.find((entry) => entry.name === name);
  assert.ok(found, `${effectRecord.id} must contain input ${name}`);
  return found.value;
}

assert.equal(CANONICAL_NATIVE_PLAN_VERSION, nativePlanContract.CANONICAL_NATIVE_PLAN_VERSION);
assert.equal(CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION, nativePlanContract.CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION);
assert.equal(CANONICAL_NATIVE_PLAN_COMPILER_VERSION, 'pulse.canonical-native-plan-compiler.v3');
assert.equal(nativePlanContract.CANONICAL_NATIVE_PLAN_POLICY.providerNeutral, true);
assert.equal(nativePlanContract.CANONICAL_NATIVE_PLAN_POLICY.javascriptRuntime, false);
assert.equal(nativePlanContract.CANONICAL_NATIVE_PLAN_POLICY.promiseSemantics, false);
assert.equal(nativePlanContract.CANONICAL_NATIVE_PLAN_POLICY.asyncify, false);

const plans = new Map();
for (const [name, example] of Object.entries(EXAMPLES)) {
  const compiled = compileExample(example).compiled;
  const first = buildCanonicalNativePlan(compiled);
  const second = buildCanonicalNativePlan(compiled);
  assert.equal(first.version, CANONICAL_NATIVE_PLAN_VERSION, `${example} plan version`);
  assert.equal(first.planHash, second.planHash, `${example} plan hash must be deterministic`);
  assert.equal(stableStringify(first), stableStringify(second), `${example} plan JSON must be deterministic`);
  assert.deepEqual(validateCanonicalNativePlan(first), validateCanonicalNativePlan(second));
  assert.deepEqual(first.effects.map((entry) => entry.id), compiled.metadata.effectSites.map((entry) => entry.id), `${example} effect order must remain canonical`);
  assert.deepEqual(first.continuations.map((entry) => entry.id), compiled.metadata.continuationSites.map((entry) => entry.id), `${example} continuation order must remain canonical`);
  assert.deepEqual(first.capabilities, [...compiled.metadata.capabilities].sort(), `${example} capabilities must remain canonical`);
  assert.equal(first.ownership.providerNeutral, true);
  assert.equal(first.ownership.provider, null);
  assert.equal(first.ownership.providerSpecificUserland, false);
  assert.equal(first.ownership.providerSdkUserland, false);
  assert.equal(first.ownership.javascriptRuntime, false);
  assert.equal(first.ownership.promiseSemantics, false);
  assert.equal(first.ownership.asyncify, false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'generatedSource'), false, 'plan must not embed generated JavaScript');
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'provider'), false, 'plan root must not select a provider');
  plans.set(name, first);
}

const hello = plans.get('hello');
assert.equal(hello.effects.length, 0);
assert.equal(hello.continuations.length, 0);
assert.equal(hello.application.rootKind, 'pulse');
assert.deepEqual(hello.application.router.routes.map(({ method, path }) => ({ method, path })), [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/hello' },
  { method: 'GET', path: '/*' }
]);
assert.deepEqual(hello.capabilities, ['response.json', 'response.text']);
assert.equal(hello.summary.branchCount, 7);
assert.equal(hello.summary.returnCount, 5);

const schema = plans.get('schema');
assert.deepEqual(schema.schemas.ids, ['app.CreateUserInput', 'app.CreateUserOutput']);
assert.equal(schema.schemas.references.length, 3);
assert.equal(schema.schemas.registry.schemas.length, 2);
assert.ok(schema.capabilities.includes('schema.decode'));
assert.ok(schema.capabilities.includes('schema.encode'));

const fetchComposition = plans.get('fetchComposition');
assert.equal(fetchComposition.effects.length, 7);
assert.equal(fetchComposition.continuations.length, 3);
assert.deepEqual(fetchComposition.application.router.routes.map(({ method, path }) => ({ method, path })), [
  { method: 'GET', path: '/user' },
  { method: 'GET', path: '/user-summary' },
  { method: 'GET', path: '/user-summary-parallel' }
]);
const singleFetch = effect(fetchComposition, 'fetch-1');
assert.equal(singleFetch.kind, 'fetch');
assert.equal(singleFetch.result.valueKind, 'json');
assert.deepEqual(singleFetch.result.decoder, { kind: 'json', arguments: [] });
assert.ok(fetchComposition.locals.some((entry) => entry.id === singleFetch.result.localId && entry.valueKind === 'json'), 'single-fetch handler must bind the host-decoded JSON effect result');
assert.equal(fetchComposition.summary.effectGroupCount, 2);
const groupStatements = [];
walkStatements(fetchComposition.entry.body, (statement) => { if (statement.kind === 'effect-group') groupStatements.push(statement); });
for (const handler of fetchComposition.handlers) walkStatements(handler.body, (statement) => { if (statement.kind === 'effect-group') groupStatements.push(statement); });
assert.equal(groupStatements.length, 2);
assert.deepEqual(groupStatements.map((statement) => statement.effectIds), [
  ['fetch-2', 'fetch-3', 'fetch-4'],
  ['fetch-5', 'fetch-6', 'fetch-7']
]);
assert.deepEqual(fetchComposition.continuations.map((entry) => [entry.kind, entry.effectIds]), [
  ['single-fetch', ['fetch-1']],
  ['fetch-group', ['fetch-2', 'fetch-3', 'fetch-4']],
  ['parallel-group', ['fetch-5', 'fetch-6', 'fetch-7']]
]);

function rejectOwnedPlan(mutate, message) {
  const plan = JSON.parse(stableStringify(fetchComposition));
  mutate(plan);
  delete plan.planHash;
  plan.planHash = crypto.createHash('sha256').update(stableStringify(plan)).digest('hex');
  assert.throws(() => validateCanonicalNativePlan(plan), error => error instanceof CanonicalNativePlanError
    && error.diagnostics.some(item => message.test(item.message)));
}
rejectOwnedPlan(plan => { plan.handlers[0].body.push({ kind: 'handler-call', handlerId: plan.handlers[0].id }); }, /originate in the dispatcher/);
rejectOwnedPlan(plan => { plan.handlers[0].body.push({ kind: 'expression', expression: { kind: 'local', id: plan.locals[0].id, valueKind: 'number' } }); }, /crosses a lexical boundary/);
rejectOwnedPlan(plan => { plan.entry.body.push({ kind: 'handler-call', handlerId: plan.handlers[0].id }); }, /exactly one static call/);
rejectOwnedPlan(plan => { plan.effects[0].routerEntryStableId = plan.handlers[1].id; }, /effect ownership mismatch/);
rejectOwnedPlan(plan => { plan.continuations[0].routerEntryStableId = plan.handlers[1].id; }, /resume in its effect owner/);
rejectOwnedPlan(plan => { plan.handlers[0].source.file = 'another.ts'; }, /original source/);

const fastlyCapabilities = plans.get('fastlyCapabilities');
assert.deepEqual(fastlyCapabilities.effects.map((entry) => entry.kind), [
  'config.get',
  'secret.get',
  'fetch',
  'kv.get',
  'kv.put',
  'grip.broadcast'
]);
const configResult = effect(fastlyCapabilities, 'config-1').result.localId;
const secretResult = effect(fastlyCapabilities, 'secret-1').result.localId;
const dynamicFetch = effect(fastlyCapabilities, 'fetch-1');
assert.ok(expressionLocalIds(input(dynamicFetch, 'init')).includes(configResult), 'fetch headers must retain config-result dependency');
assert.ok(expressionLocalIds(input(dynamicFetch, 'init')).includes(secretResult), 'fetch headers must retain secret-result dependency');

assert.equal(effect(fastlyCapabilities, 'kv-get-1').result.valueKind, 'json-or-undefined');
assert.equal(effect(fastlyCapabilities, 'kv-put-1').result.mode, 'discard');

const opaque = plans.get('opaqueProxy');
assert.equal(opaque.effects.length, 1);
assert.deepEqual(opaque.application.router.routes.map(({ method, path }) => ({ method, path })), [
  { method: 'GET', path: '/archive' }
]);
assert.equal(opaque.continuations[0].kind, 'opaque-fetch-return');
assert.equal(opaque.effects[0].result.valueKind, 'opaque-response');
assert.equal(opaque.effects[0].result.mode, 'return');
assert.equal(opaque.summary.returnCount, 3, 'effect-backed return and Router-owned exhaustion paths must count as returns');

assert.deepEqual(fastlyCapabilities.packages.effects.map((entry) => entry.kind), ['grip.broadcast']);
assert.equal(effect(fastlyCapabilities, 'grip-broadcast-1').result.mode, 'bind');

const dependent = buildCanonicalNativePlan(internalFixture('continuation-chain').compiled);
assert.equal(dependent.effects.length, 2);
assert.equal(dependent.continuations.length, 2);
assert.equal(dependent.summary.effectGroupCount, 0);
const firstResult = effect(dependent, 'fetch-1').result.localId;
assert.ok(expressionLocalIds(input(effect(dependent, 'fetch-2'), 'url')).includes(firstResult), 'dependent continuation input must retain the first effect result local');

const branching = buildCanonicalNativePlan(internalFixture('branching').compiled);
assert.equal(branching.summary.branchCount, 3);
assert.equal(branching.summary.returnCount, 4);
assert.ok(branching.entry.body.some((statement) => statement.kind === 'if'));

const structuredBody = buildCanonicalNativePlan(internalFixture('structured-body').compiled);
assert.equal(structuredBody.effects.length, 0);
assert.ok(structuredBody.capabilities.includes('request.json'));
assert.ok(structuredBody.capabilities.includes('response.response'));

function headerGuardPlan(body) {
  return buildCanonicalNativePlan(compileCanonicalSource(`
    export default function handler(ctx) { ${body} return ctx.text('ok'); }
  `, { fileName: 'header-guard.ts' }));
}

for (const guard of ['value !== undefined', 'undefined !== value']) {
  const plan = headerGuardPlan(`const value = ctx.req.header('x-value'); if (${guard}) ctx.state.set('value', value);`);
  const writes = [];
  walkStatements(plan.entry.body, (statement) => {
    if (statement.kind === 'expression') walkExpression(statement.expression, (expression) => {
      if (expression.kind === 'intrinsic' && expression.name === 'state.set') writes.push(expression);
    });
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].arguments[1].valueKind, 'string');
}
headerGuardPlan(`const value = ctx.req.header('x-value'); if (value === undefined) return ctx.text('missing'); else ctx.state.set('value', value);`);
for (const body of [
  `const value = ctx.req.header('x-value'); ctx.state.set('value', value);`,
  `let value = ctx.req.header('x-value'); if (value !== undefined) ctx.state.set('value', value);`,
  `const value = ctx.req.header('x-value'); if (value === undefined) ctx.state.set('value', value);`,
  `const value = ctx.req.header('x-value'); if (value !== undefined) ctx.state.set('inside', value); ctx.state.set('outside', value);`,
  `const value = ctx.req.header('x-value'); if (value !== undefined) { value = undefined; ctx.state.set('value', value); }`,
  `const value = 1; value++;`,
  `const value = 1; ++value;`
]) {
  assert.throws(() => headerGuardPlan(body), (error) => {
    assert.ok(error instanceof CanonicalNativePlanError);
    assert.ok(error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED'));
    return true;
  });
}

const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-native-plan-'));
try {
  const output = path.join(tempRoot, 'canonical-native-plan.json');
  const written = writeCanonicalNativePlan(fastlyCapabilities, output);
  assert.equal(written.planHash, fastlyCapabilities.planHash);
  assert.ok(written.bytes > 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), JSON.parse(stableStringify(fastlyCapabilities)));

  const source = `export default function handler(ctx) { const response = ctx.fetch('https://example.test').json(); return ctx.json({ response }); }`;
  const copyA = path.join(tempRoot, 'copy-a', 'src', 'index.ts');
  const copyB = path.join(tempRoot, 'copy-b', 'src', 'index.ts');
  fs.mkdirSync(path.dirname(copyA), { recursive: true });
  fs.mkdirSync(path.dirname(copyB), { recursive: true });
  fs.writeFileSync(copyA, source);
  fs.writeFileSync(copyB, source);
  const rootA = path.join(tempRoot, 'copy-a');
  const rootB = path.join(tempRoot, 'copy-b');
  const planA = buildCanonicalNativePlan(compileCanonicalFile(copyA, { rootDir: rootA }));
  const planB = buildCanonicalNativePlan(compileCanonicalFile(copyB, { rootDir: rootB }));
  assert.equal(planA.planHash, planB.planHash, 'native plan must not depend on absolute checkout path');
  assert.equal(stableStringify(planA), stableStringify(planB));

  const tampered = JSON.parse(stableStringify(fastlyCapabilities));
  tampered.effects[0].kind = 'tampered';
  assert.throws(() => validateCanonicalNativePlan(tampered), (error) => {
    assert.ok(error instanceof CanonicalNativePlanError);
    assert.ok(error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_NATIVE_PLAN_INVALID' && /hash mismatch/.test(entry.message)));
    return true;
  });

  const compiled = compileCanonicalSource(`export default function handler(ctx) { return ctx.json({ value: 1 }); }`, { fileName: 'unsupported-native.ts' });
  const unsupported = Object.freeze({
    ...compiled,
    generatedSource: compiled.generatedSource.replace('value: 1', 'value: Math.abs(1)')
  });
  assert.throws(() => buildCanonicalNativePlan(unsupported), (error) => {
    assert.ok(error instanceof CanonicalNativePlanError);
    assert.ok(error.diagnostics.some((entry) => entry.code === 'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED'));
    return true;
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('ok - canonical handler analysis lowers deterministically to a provider-neutral native execution plan across nine public examples and retained control-flow fixtures');
