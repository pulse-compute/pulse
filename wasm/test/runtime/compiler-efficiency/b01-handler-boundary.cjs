#!/usr/bin/env node
'use strict';

// The B01 1/8/32 controls now track the B02 terminal-route boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../../..');
const { compileCanonicalRouterSource } = require('../../../packages/compiler/src/canonical-router-compiler.js');
const { handlerIrsForCanonicalRouterOutput } = require('../../../packages/compiler/src/spine/canonical-router.js');
const { compileCanonicalProject } = require('../../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan.js');

function fixture(count) {
  const middleware = count === 1 ? 0 : count / 2 - 1;
  const routes = count - middleware - (count === 1 ? 0 : 1);
  const lines = ["import { Router } from '@pulse-compute/runtime'", 'const app = new Router()'];
  for (let index = 0; index < middleware; index++) {
    lines.push(`app.use((ctx, next) => { const gate = ctx.fetch('https://example.test/gate/${index}').text(); if (gate === 'stop') return ctx.text('stopped'); return next() })`);
  }
  for (let index = 0; index < routes; index++) {
    lines.push(index === 0 && count > 1
      ? `app.get('/route/${index}', (ctx, next) => { if (ctx.req.header('x-error') === 'yes') return next({ code: 'probe' }); return ctx.text('route-${index}') })`
      : `app.get('/route/${index}', (ctx) => ctx.text('route-${index}'))`);
  }
  if (count > 1) lines.push("app.error((error, ctx, next) => ctx.text('error'))");
  lines.push('export default app');
  return { source: `${lines.join('\n')}\n`, middleware, routes, errors: count === 1 ? 0 : 1 };
}

function inspect(count, temporaryRoot) {
  const { source, middleware, routes, errors } = fixture(count);
  const projectRoot = path.join(temporaryRoot, `handlers-${count}`);
  const entryFile = path.join(projectRoot, 'src/index.ts');
  fs.mkdirSync(path.dirname(entryFile), { recursive: true });
  fs.writeFileSync(entryFile, source);

  const router = compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: projectRoot });
  const repeated = compileCanonicalRouterSource(source, { fileName: 'src/index.ts', rootDir: projectRoot });
  assert.equal(router.sourceText, repeated.sourceText, 'synthetic source is deterministic');
  const handlers = handlerIrsForCanonicalRouterOutput(router);
  const entries = router.metadata.entries;
  assert.equal(entries.length, count);
  assert.equal(handlers.length, count);
  assert.deepEqual(entries.map(({ kind }) => kind).reduce((totals, kind) => {
    totals[kind] = (totals[kind] || 0) + 1;
    return totals;
  }, {}), Object.assign({}, middleware ? { use: middleware } : {}, { route: routes }, errors ? { error: errors } : {}));
  const byId = new Map(entries.map((entry) => [entry.stableId, entry]));
  assert.equal(byId.size, count, 'entry identities are unique');
  assert.deepEqual(entries.map(({ stableId }) => stableId), repeated.metadata.entries.map(({ stableId }) => stableId));
  const ranges = [];
  for (const handler of handlers) {
    const entry = byId.get(handler.entryStableId);
    assert.ok(entry && entry.generatedRange, 'each handler retains a generated range');
    assert.equal(entry.handlerId, handler.canonicalIr.router.entry.handlerId);
    assert.equal(entry.index, handler.entryIndex);
    assert.deepEqual(handler.canonicalIr.router.entry.generatedRange, entry.generatedRange);
    assert.equal(handler.canonicalIr.router.entry.stableId, entry.stableId);
    const { start, end } = entry.generatedRange;
    assert.ok(start >= 0 && end > start && end <= router.sourceText.length);
    assert.ok(router.sourceText.slice(start, end).trim().length > 0);
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) {
    assert.ok(ranges[index - 1].end <= ranges[index].start, 'handler body ranges do not overlap');
  }
  const declarations = ts.createSourceFile('generated.ts', router.sourceText, ts.ScriptTarget.ES2022, true)
    .statements.filter(ts.isFunctionDeclaration).map((statement) => statement.name && statement.name.text);
  assert.deepEqual(declarations, ['__pulse_router_entry'], 'the dispatcher remains the single public entry');
  let privateBodies = 0;
  function countBodies(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith('__pulse_body_')) privateBodies++;
    ts.forEachChild(node, countBodies);
  }
  countBodies(ts.createSourceFile('generated.ts', router.sourceText, ts.ScriptTarget.ES2022, true));

  const project = compileCanonicalProject(entryFile, { rootDir: projectRoot, workspaceRoot: root });
  assert.equal(project.ok, true);
  assert.equal(project.router.sourceText, router.sourceText);
  const plan = buildCanonicalNativePlan(project);
  assert.equal(plan.entry.kind, 'router');
  assert.equal(plan.routing.entries.length, count);
  assert.deepEqual(plan.routing.entries.map(({ stableId }) => stableId), entries.map(({ stableId }) => stableId));
  assert.equal(plan.effects.length, middleware, 'one effect per middleware');
  assert.equal(plan.continuations.length, middleware, 'one continuation per middleware');
  for (const effect of plan.effects) {
    assert.equal(byId.get(effect.routerEntryStableId).kind, 'use');
    assert.equal(byId.get(effect.applicationEntryStableId).kind, 'use');
    assert.equal(plan.continuations.find((site) => site.id === effect.continuationId).routerEntryStableId, effect.routerEntryStableId);
  }
  const localOwned = plan.locals.filter((local) => Object.hasOwn(local, 'routerEntryStableId')).length;
  assert.equal(plan.handlers.length, routes - (count > 1 ? 1 : 0));
  assert.equal(privateBodies, plan.handlers.length);
  assert.equal(localOwned, plan.handlers.reduce((sum, handler) => sum + handler.localIds.length, 0));
  assert.ok(localOwned > 0, 'terminal route locals retain explicit handler identity');
  return {
    handlers: count, middleware, routes, errors,
    syntheticSourceBytes: Buffer.byteLength(router.sourceText),
    generatedHandlerBodyBytes: ranges.reduce((sum, range) => sum + Buffer.byteLength(router.sourceText.slice(range.start, range.end)), 0),
    syntheticTopLevelFunctions: declarations.length,
    privateHandlerFunctions: privateBodies,
    planEntryKind: plan.entry.kind,
    nativePlanLocals: plan.locals.length,
    nativePlanLocalsWithEntryId: localOwned,
    nativePlanEffects: plan.effects.length,
    nativePlanContinuations: plan.continuations.length,
    nativePlanStates: plan.states.length
  };
}

function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-b01-'));
  try {
    const rows = [1, 8, 32].map((count) => inspect(count, temporaryRoot));
    console.log(JSON.stringify({ source: 'B01 controls after B02 terminal-route separation', rows }, null, 2));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
