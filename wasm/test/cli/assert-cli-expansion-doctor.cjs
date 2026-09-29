#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('../runtime/compiler-efficiency/o18-reusable-stage.cjs');
const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { inspectNativeExpansion, MAX_OWNERS } = require('../../packages/cli/src/internal/native-expansion');
const { writeHumanResult } = require('../../packages/cli/src/internal/command-reporter');
const { run } = require('./helpers.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-o22-'));
let checks = 0;
function compile(count, middleware = false) {
  const root = path.join(tmp, String(count) + (middleware ? '-middleware' : ''));
  fs.mkdirSync(root);
  fixture(count, root);
  if (middleware) {
    const file = path.join(root, 'src/index.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/app.get\('\/chain\/(\d+)',stage\)/g, "app.use('/chain/$1',stage)"));
  }
  const project = tc.resolveProject({ cwd: root, profile: 'native' });
  const compiled = tc.compileProject(project);
  return { root, project, compiled, plan: buildCanonicalNativePlan(compiled) };
}

try {
  for (const count of [1, 2, 16]) {
    const { compiled, plan } = compile(count);
    const before = JSON.stringify({ compiled, plan });
    const report = inspectNativeExpansion(compiled, plan);
    assert.equal(report.summary.repeatedOwners, count === 1 ? 0 : 1);
    if (count > 1) {
      const row = report.owners[0];
      assert.equal(row.name, 'stage'); assert.equal(row.source.file, 'src/stage.ts');
      assert.equal(row.registrationCount, count); assert.equal(row.nativeBodyInstances, 1);
      assert.equal(row.sharedStageRegistrations, count); assert.equal(row.sharing, 'retained');
      assert.equal(row.expensiveUnshared, false); assert.ok(row.loweredSourceBytes > 1000 * count);
      assert.equal(row.registrationExamples.length, Math.min(count, 3));
      const expanded = inspectNativeExpansion(compiled, buildCanonicalNativePlan(compiled, { sharedStages: false }));
      assert.equal(expanded.owners[0].nativeBodyInstances, count);
      assert.equal(expanded.owners[0].sharing, 'not-retained');
      assert.equal(expanded.summary.expensiveUnsharedOwners, 1);
    }
    assert.equal(JSON.stringify({ compiled, plan }), before, 'inspection must not mutate compiler data');
    assert.deepEqual(inspectNativeExpansion(compiled, plan), report, 'projection is deterministic');
    checks++;
  }
  const { root, project, compiled, plan } = compile(2, true);
  const report = inspectNativeExpansion(compiled, plan), row = report.owners[0];
  assert.equal(row.registrationCount, 2); assert.equal(row.nativeBodyInstances, 2);
  assert.equal(row.sharing, 'not-retained'); assert.equal(row.expensiveUnshared, true);
  assert.match(row.observations[0], /Middleware/); checks++;
  const unknown = inspectNativeExpansion(compiled);
  assert.equal(unknown.owners[0].nativeBodyInstances, null);
  assert.equal(unknown.owners[0].sharing, 'unavailable');
  assert.equal(unknown.summary.expensiveUnsharedOwners, 0); checks++;

  const terminalRoot = path.join(tmp, 'terminal'); fs.mkdirSync(terminalRoot); fixture(2, terminalRoot);
  fs.writeFileSync(path.join(terminalRoot, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
const app=new Pulse({auto:true});
const terminal=async(ctx)=>{let value='start';${"value=value+'piece';".repeat(80)}return ctx.text(value);};
app.get('/a',terminal);app.get('/b',terminal);export default app;`);
  const terminal = tc.compileProject(tc.resolveProject({ cwd: terminalRoot, profile: 'native' }));
  const terminalPlan = buildCanonicalNativePlan(terminal);
  const terminalRow = inspectNativeExpansion(terminal, terminalPlan).owners[0];
  assert.equal(terminalPlan.handlers.length, 2); assert.equal(terminalRow.nativeBodyInstances, 2);
  assert.equal(terminalRow.expensiveUnshared, true); assert.match(terminalRow.observations[0], /Terminal private/); checks++;

  // Byte accounting is UTF-8, and absent ranges do not become an invented cost.
  const small = { router: { sourceText: 'éé', handlerTable: { handlers: [] } }, metadata: { file: 'src/a.ts', router: { entries: [0, 1].map(i => ({ handlerId: 'same', stableId: String(i), kind: 'route', generatedRange: { start: i, end: i + 1 } })) } } };
  assert.equal(inspectNativeExpansion(small).owners[0].loweredSourceBytes, 4);
  delete small.metadata.router.entries[1].generatedRange;
  assert.equal(inspectNativeExpansion(small).owners[0].loweredSourceBytes, null); checks++;
  const bounded = structuredClone(small);
  bounded.metadata.router.entries = Array.from({ length: MAX_OWNERS + 1 }, (_, i) => [0, 1].map(j => ({ handlerId: 'owner-' + i, stableId: `${i}-${j}`, kind: 'route' }))).flat();
  const limited = inspectNativeExpansion(bounded);
  assert.equal(limited.owners.length, MAX_OWNERS); assert.equal(limited.summary.omittedOwners, 1);
  assert.equal(limited.summary.registrations, 42); checks++;

  const normal = run(['doctor', '--profile', 'native', '--json'], root);
  assert.equal(normal.status, 0, normal.stderr || normal.stdout);
  const audit = JSON.parse(normal.stdout), check = audit.checks.find(c => c.id === 'native-expansion');
  assert.equal(check.status, 'warning'); assert.equal(check.code, 'PULSE_NATIVE_EXPANSION_REPEATED');
  assert.deepEqual(check.detail, JSON.parse(JSON.stringify(report))); assert.ok(check.docs.endsWith('#pulse-native-expansion-repeated'));
  const strict = run(['doctor', '--profile', 'native', '--strict', '--json'], root);
  assert.equal(strict.status, 1, strict.stderr); assert.equal(JSON.parse(strict.stdout).status, 'failed'); checks++;
  let human = '';
  writeHumanResult({ write: value => { human += value; } }, 'doctor', audit);
  assert.match(human, /src\/stage.ts:1:7 \(stage\): 2 registrations, 2 Native plan bodies, not-retained/);
  assert.match(human, /Middleware/); assert.match(human, /help:.*full target build/); checks++;
  const js = run(['doctor', '--profile', 'js', '--json'], root);
  assert.equal(js.status, 0, js.stderr);
  assert.equal(JSON.parse(js.stdout).checks.find(c => c.id === 'native-expansion').status, 'passed'); checks++;

  // Capture the existing plan before a failing compiler call; no second plan or build.
  const compiler = require('../../packages/compiler/src/canonical-native-compiler');
  const compilerPath = require.resolve('../../packages/compiler/src/canonical-native-compiler');
  const executionPath = require.resolve('../../packages/cli/src/project-execution');
  let calls = 0;
  try {
    require.cache[compilerPath].exports = { ...compiler, compileCanonicalNativePlan() { calls++; const error = new Error('injected compile failure'); error.code = 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED'; throw error; } };
    delete require.cache[executionPath];
    const failed = require(executionPath).doctorProject(project);
    assert.equal(failed.status, 'failed'); assert.equal(calls, 1);
    assert.equal(failed.checks.find(c => c.id === 'native-expansion').detail.planHash, plan.planHash);
    assert.equal(failed.checks.find(c => c.id === 'canonical-native-wasm').status, 'failed'); checks++;
  } finally { require.cache[compilerPath].exports = compiler; delete require.cache[executionPath]; }
  console.log(JSON.stringify({ status: 'passed', checks, heavyEvidenceLaneAdded: false }));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
