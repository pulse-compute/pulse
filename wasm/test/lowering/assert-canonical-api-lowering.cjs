#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  CANONICAL_API_COMPILER_VERSION,
  CanonicalCompileError,
  compileCanonicalSource
} = require('../../packages/compiler/src/canonical-api-compiler.js');
const {
  EXAMPLES,
  compileExample,
  internalFixture,
  internalFixtureRoot
} = require('../support/canonical-projects.cjs');

function executableSource(compiled) {
  return String(compiled.generatedSource || '').split('const __pulse_metadata')[0];
}

const hello = compileExample(EXAMPLES.hello).compiled;
assert.equal(hello.version, CANONICAL_API_COMPILER_VERSION);
assert.equal(hello.metadata.effectCount, 0);
assert.equal(hello.metadata.continuationCount, 0);
assert.ok(hello.metadata.capabilities.includes('response.json'));
assert.ok(hello.metadata.capabilities.includes('response.text'));
assert.equal(hello.metadata.file, 'src/index.ts');

const schema = compileExample(EXAMPLES.schema).compiled;
assert.equal(schema.metadata.effectCount, 0);
assert.equal(schema.metadata.continuationCount, 0);
assert.ok(schema.metadata.capabilities.includes('request.json'));
assert.ok(schema.metadata.capabilities.includes('schema.decode'));
assert.ok(schema.metadata.capabilities.includes('schema.encode'));
assert.deepEqual(schema.metadata.schemaIds, ['app.CreateUserInput', 'app.CreateUserOutput']);
assert.equal(schema.metadata.schemaReferenceCount, 3);

const asyncNoEffect = compileCanonicalSource(`export default async function handler(ctx) { return ctx.json({ ok: true }); }`, { fileName: 'async-no-effect.ts', strict: true });
assert.equal(asyncNoEffect.metadata.userAuthoredAsync, true);
assert.equal(asyncNoEffect.metadata.promiseSemantics, false);
assert.equal(asyncNoEffect.metadata.asyncify, false);
assert.equal(asyncNoEffect.metadata.effectCount, 0);
assert.doesNotMatch(executableSource(asyncNoEffect), /Promise|Asyncify|async function|await\s/);

const asyncEffect = compileCanonicalSource(`export default async function handler(ctx) { const base = await ctx.config.get('BASE'); return ctx.json({ base }); }`, { fileName: 'async-effect.ts', strict: true });
assert.equal(asyncEffect.metadata.userAuthoredAsync, true);
assert.equal(asyncEffect.metadata.effectCount, 1);
assert.equal(asyncEffect.metadata.continuationCount, 1);
assert.equal(asyncEffect.metadata.effectSites[0].kind, 'config.get');
assert.doesNotMatch(executableSource(asyncEffect), /Promise|Asyncify|async function|await\s/);

const redundantSyncAwait = compileCanonicalSource(`export default async function handler(ctx) { const path = await ctx.req.path; return ctx.json({ path }); }`, { fileName: 'redundant-sync-await.ts', strict: true });
assert.deepEqual(redundantSyncAwait.metadata.warnings.map((entry) => entry.code), ['PULSE_AWAIT_SYNC_REDUNDANT']);
assert.equal(redundantSyncAwait.metadata.effectCount, 0);
assert.doesNotMatch(executableSource(redundantSyncAwait), /Promise|Asyncify|async function|await\s/);

const fetchComposition = compileExample(EXAMPLES.fetchComposition).compiled;
assert.equal(fetchComposition.metadata.file, 'src/index.ts');
assert.equal(fetchComposition.metadata.effectCount, 7);
assert.equal(fetchComposition.metadata.continuationCount, 3);
assert.equal(fetchComposition.metadata.groupedContinuationCount, 2);
assert.equal(fetchComposition.metadata.explicitParallelCount, 1);
assert.deepEqual(
  fetchComposition.metadata.continuationSites.map((site) => site.kind),
  ['single-fetch', 'fetch-group', 'parallel-group']
);
assert.deepEqual(
  fetchComposition.metadata.continuationSites.map((site) => site.effectIds),
  [
    ['fetch-1'],
    ['fetch-2', 'fetch-3', 'fetch-4'],
    ['fetch-5', 'fetch-6', 'fetch-7']
  ]
);
assert.match(fetchComposition.generatedSource, /yield __pulse\.effect/);
assert.match(fetchComposition.generatedSource, /yield __pulse\.group/);
assert.doesNotMatch(
  fetchComposition.generatedSource,
  /ctx\.resolve|Promise|async function|await /
);

const explicitParallel = compileCanonicalSource(`
export default async function handler(ctx) {
  const users = ctx.kv('users');
  const { profile, mode, stored } = await ctx.parallel({
    profile: ctx.fetch('https://origin.example.test/profile').json(),
    mode: ctx.config.get('MODE'),
    stored: users.get('last')
  });
  return ctx.json({ profile, mode, stored });
}
`, { fileName: 'explicit-parallel.ts', strict: true });
assert.equal(explicitParallel.metadata.effectCount, 3);
assert.equal(explicitParallel.metadata.continuationCount, 1);
assert.equal(explicitParallel.metadata.groupedContinuationCount, 1);
assert.equal(explicitParallel.metadata.explicitParallelCount, 1);
assert.equal(explicitParallel.metadata.continuationSites[0].kind, 'parallel-group');
assert.deepEqual(explicitParallel.metadata.continuationSites[0].effectIds, ['fetch-1', 'config-1', 'kv-get-1']);
assert.deepEqual(explicitParallel.metadata.effectSites.map((site) => [site.kind, site.grouped, site.groupKey]), [
  ['fetch', true, 'profile'],
  ['config.get', true, 'mode'],
  ['kv.get', true, 'stored']
]);
assert.match(explicitParallel.generatedSource, /yield __pulse\.group/);
assert.match(explicitParallel.generatedSource, /const profile = __pulse_parallel_fetch_1\.json\(\);/);
assert.match(explicitParallel.generatedSource, /const mode = __pulse_parallel_config_1;/);
assert.doesNotMatch(explicitParallel.generatedSource, /const \{ profile, mode, stored \}/);
assert.doesNotMatch(executableSource(explicitParallel), /ctx\.parallel|Promise|async function|await\s/);

const discardedParallel = compileCanonicalSource(`
export default async function handler(ctx) {
  await ctx.parallel({
    first: ctx.config.get('FIRST'),
    second: ctx.config.get('SECOND')
  });
  return ctx.text('ok');
}
`, { fileName: 'discarded-parallel.ts', strict: true });
assert.equal(discardedParallel.metadata.explicitParallelCount, 1);
assert.match(discardedParallel.generatedSource, /yield __pulse\.group/);

const dependent = internalFixture('continuation-chain').compiled;
assert.equal(dependent.metadata.effectCount, 2);
assert.equal(dependent.metadata.continuationCount, 2);
assert.equal(dependent.metadata.groupedContinuationCount, 0, 'a dependent fetch must not be eagerly grouped');
assert.deepEqual(dependent.metadata.continuationSites.map((site) => site.kind), ['single-fetch', 'single-fetch']);

const branching = internalFixture('branching').compiled;
assert.equal(branching.metadata.effectCount, 2);
assert.equal(branching.metadata.continuationCount, 2);
assert.match(branching.generatedSource, /if \(ctx\.req\.path === '\/health'\)/);

const opaque = compileExample(EXAMPLES.opaqueProxy);
assert.equal(opaque.compiled.metadata.opaqueReturnCount, 1);
assert.equal(opaque.compiled.metadata.continuationSites[0].kind, 'opaque-fetch-return');
assert.equal(typeof opaque.program.createHandler(), 'function');

const fastlyCapabilities = compileExample(EXAMPLES.fastlyCapabilities).compiled;
assert.equal(fastlyCapabilities.metadata.effectCount, 6);
assert.equal(fastlyCapabilities.metadata.continuationCount, 6);
assert.deepEqual(
  fastlyCapabilities.metadata.effectSites.map((site) => site.kind),
  ['config.get', 'secret.get', 'fetch', 'kv.get', 'kv.put', 'grip.broadcast']
);
assert.deepEqual(
  fastlyCapabilities.metadata.providerOperations.map((entry) => [entry.kind, entry.operation]),
  [
  ['config', 'get'],
  ['secret', 'get'],
  ['fetch', 'dispatch'],
  ['kv', 'get'],
  ['kv', 'put'],
  ['grip', 'broadcast']
  ]
);
assert.match(fastlyCapabilities.generatedSource, /kind: "config\.get"/);
assert.match(fastlyCapabilities.generatedSource, /kind: "secret\.get"/);
assert.match(fastlyCapabilities.generatedSource, /kind: "kv\.get"/);
assert.match(fastlyCapabilities.generatedSource, /kind: "kv\.put"/);
assert.deepEqual(
  fastlyCapabilities.packageExtensions.effects.map((entry) => entry.kind),
  ['grip.broadcast']
);
assert.doesNotMatch(
  fastlyCapabilities.generatedSource,
  /ctx\.config\.get\('API_BASE'\).*ctx\.secret\.get/s,
  'provider reads must not remain synchronous runtime calls'
);

const rejected = [
  ['missing effect await', `export default async function handler(ctx) { const value = ctx.config.get('NAME'); return ctx.json({ value }); }`, 'PULSE_EFFECT_AWAIT_REQUIRED'],
  ['arbitrary await', `export default async function handler(ctx) { const value = await arbitraryLibrary(); return ctx.json({ value }); }`, 'PULSE_NATIVE_AWAIT_UNSUPPORTED'],
  ['ambient fetch', `export default function handler(ctx) { const r = fetch('https://example.test'); return ctx.json({ r }); }`, 'PULSE_CANONICAL_AMBIENT_FETCH_UNSUPPORTED'],
  ['top-level state', `let count = 0; export default function handler(ctx) { count++; return ctx.json({ count }); }`, 'PULSE_CANONICAL_AMBIENT_STATE_UNSUPPORTED'],
  ['top-level helper', `function helper() { return 1; } export default function handler(ctx) { return ctx.json({ value: helper() }); }`, 'PULSE_CANONICAL_TOP_LEVEL_RUNTIME_UNSUPPORTED'],
  ['ambient process', `export default function handler(ctx) { return ctx.json({ value: process.env.SECRET }); }`, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED'],
  ['ambient timer', `export default function handler(ctx) { setTimeout(() => {}, 1); return ctx.json({ ok: true }); }`, 'PULSE_CANONICAL_AMBIENT_AUTHORITY_UNSUPPORTED'],
  ['ambient randomness', `export default function handler(ctx) { return ctx.json({ value: Math.random() }); }`, 'PULSE_CANONICAL_NONDETERMINISM_UNSUPPORTED'],
  ['runtime import', `import { defineHandler, somethingElse } from '@pulse-compute/runtime'; export default function handler(ctx) { return ctx.json({ ok: true }); }`, 'PULSE_CANONICAL_RUNTIME_IMPORT_UNSUPPORTED'],
  ['syntax error', `export default function handler(ctx) { return ctx.json({ ok: true });`, 'PULSE_CANONICAL_SYNTAX_ERROR'],
  ['unsupported fetch position', `export default function handler(ctx) { return ctx.json({ value: ctx.fetch('https://example.test').status }); }`, 'PULSE_CANONICAL_FETCH_POSITION_UNSUPPORTED'],
  ['unsupported provider effect position', `export default function handler(ctx) { return ctx.json({ value: ctx.secret.get('TOKEN') }); }`, 'PULSE_CANONICAL_PROVIDER_EFFECT_POSITION_UNSUPPORTED']
  ,['parallel requires await', `export default async function handler(ctx) { const value = ctx.parallel({ mode: ctx.config.get('MODE') }); return ctx.json({ value }); }`, 'PULSE_EFFECT_AWAIT_REQUIRED']
  ,['parallel requires object literal', `export default async function handler(ctx) { const effects = {}; const value = await ctx.parallel(effects); return ctx.json(value); }`, 'PULSE_PARALLEL_OBJECT_LITERAL_REQUIRED']
  ,['parallel rejects arrays', `export default async function handler(ctx) { await ctx.parallel([ctx.config.get('MODE')]); return ctx.text('ok'); }`, 'PULSE_PARALLEL_OBJECT_LITERAL_REQUIRED']
  ,['parallel rejects empty records', `export default async function handler(ctx) { await ctx.parallel({}); return ctx.text('ok'); }`, 'PULSE_PARALLEL_EMPTY']
  ,['parallel rejects spreads', `export default async function handler(ctx) { const value = await ctx.parallel({ ...{} }); return ctx.json(value); }`, 'PULSE_PARALLEL_PROPERTY_STATIC_REQUIRED']
  ,['parallel rejects computed keys', `export default async function handler(ctx) { const value = await ctx.parallel({ [ctx.req.path]: ctx.config.get('MODE') }); return ctx.json(value); }`, 'PULSE_PARALLEL_KEY_STATIC_REQUIRED']
  ,['parallel rejects index keys', `export default async function handler(ctx) { const value = await ctx.parallel({ '0': ctx.config.get('MODE') }); return ctx.json(value); }`, 'PULSE_PARALLEL_KEY_UNSUPPORTED']
  ,['parallel rejects duplicate keys', `export default async function handler(ctx) { const value = await ctx.parallel({ mode: ctx.config.get('A'), mode: ctx.config.get('B') }); return ctx.json(value); }`, 'PULSE_PARALLEL_KEY_DUPLICATE']
  ,['parallel rejects arbitrary values', `export default async function handler(ctx) { const value = await ctx.parallel({ mode: 'not-an-effect' }); return ctx.json(value); }`, 'PULSE_PARALLEL_EFFECT_REQUIRED']
];
for (const [label, source, code] of rejected) {
  assert.throws(() => compileCanonicalSource(source, { fileName: `${label}.ts` }), (error) => {
    assert.ok(error instanceof CanonicalCompileError);
    assert.ok(error.diagnostics.some((entry) => entry.code === code), `${label} should emit ${code}`);
    return true;
  });
}

for (const duplicate of ['fetch-composition', 'fastly-capabilities', 'opaque-proxy']) {
  assert.equal(fs.existsSync(require('node:path').join(internalFixtureRoot, duplicate)), false, `public example duplicate ${duplicate} must stay removed from internal fixtures`);
}
console.log('ok - documented canonical TypeScript examples are the lowering oracle while branch, continuation, body-edge, and failure fixtures remain internal');
