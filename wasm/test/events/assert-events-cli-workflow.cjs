#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { repoRoot, run, parseJson, parseError } = require('../cli/helpers.cjs');

const fixtureSource = path.join(repoRoot, 'wasm', 'test', 'fixtures', 'projects', 'events-cli');
const expectedFrame = Object.freeze({
  version: 'pulse.event-frame.v1',
  type: 'output.accepted',
  schemaId: 'events.Output',
  payload: Object.freeze({ accepted: true, sequence: 7 })
});

function command(projectRoot, name, profile) {
  return run([name, '--profile', profile, '--json'], projectRoot, { timeout: 180000 });
}

function namedCase(result, name) {
  const testCase = result.cases.find((entry) => entry.name === name);
  assert.ok(testCase, `missing test case ${name}`);
  return testCase;
}

function assertRealChild(root, candidate, message) {
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  const relative = path.relative(realRoot, realCandidate);

  assert.ok(
    relative !== ''
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    message || `${realCandidate} must be inside ${realRoot}`
  );
}

function assertEventProjection(events, provider, target, status) {
  assert.equal(events.version, 'pulse.event-inspection.v1');
  assert.equal(events.contractId, 'pulse.events');
  assert.deepEqual(events.registrations.map((entry) => [entry.type, entry.schemaId]), [
    ['input.received', 'events.Input']
  ]);
  assert.deepEqual(events.callsites.map((entry) => [entry.type, entry.schemaId]), [
    ['output.accepted', 'events.Output']
  ]);
  assert.deepEqual(events.schemas, {
    registrations: ['events.Input'],
    emissions: ['events.Output'],
    all: ['events.Input', 'events.Output']
  });
  assert.deepEqual(events.capabilities, ['event.emit']);
  assert.deepEqual(events.hostRequirements, ['event.emit', 'event.ingress']);
  assert.equal(events.targetSupport.provider, provider);
  assert.equal(events.targetSupport.target, target);
  assert.equal(events.targetSupport.status, status);
  assert.equal(events.targetSupport.automaticFallback, false);
  assert.equal(events.policy.publicInjectionCommand, false);
  assert.equal(events.policy.automaticLoopback, false);
  assert.equal(events.policy.automaticFallback, false);
}

function assertNodeTest(result, target) {
  assert.equal(result.status, 'passed');
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.passed, 2);
  assert.equal(result.summary.failed, 0);
  if (target === 'javascript') assert.equal(result.target, 'javascript');
  const httpCase = namedCase(result, 'http health remains unchanged');
  assert.deepEqual(httpCase.response, { status: 200, bodyClass: 'structured', kind: 'text' });
  const eventCase = namedCase(result, 'event ingress records exact emitted frames');
  assert.equal(eventCase.kind, 'event');
  assert.deepEqual(eventCase.event, { type: 'input.received', schemaId: 'events.Input' });
  assert.deepEqual(eventCase.result, {
    version: 'pulse.event-execution-result.v1',
    status: 'completed'
  });
  assert.deepEqual(eventCase.emittedFrames, [expectedFrame]);
  assert.equal(eventCase.emittedFrameCount, 1);
  assert.equal(eventCase.effects, 1);
  assert.equal(eventCase.adapter.acceptedOutbound, 1);
  assert.equal(eventCase.adapter.automaticLoopback, false);
  return Object.freeze({ httpCase, eventCase });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertBuild(projectRoot, result, provider, target) {
  assert.equal(result.status, 'built');
  assert.equal(result.provider, provider);
  assert.equal(result.configuredTarget || result.manifest.configuredTarget, target);
  assertEventProjection(result.events, provider, target, 'eligible');
  assert.ok(fs.existsSync(result.files.eventCatalog));
  assert.ok(fs.existsSync(result.files.eventInspection));
  assert.equal(path.dirname(result.files.eventCatalog), result.outDir);
  assert.equal(path.dirname(result.files.eventInspection), result.outDir);
  assert.deepEqual(readJson(result.files.eventCatalog), result.events.catalog);
  assert.deepEqual(readJson(result.files.eventInspection), result.events);
  assert.equal(result.manifest.events.files.catalog, 'event-catalog.json');
  assert.equal(result.manifest.events.files.inspection, 'event-inspection.json');
  assert.equal(result.manifest.events.targetSupport.status, 'eligible');
  assertRealChild(
    projectRoot,
    result.files.eventCatalog,
    'event catalog must remain inside the project root'
  );
  assertRealChild(
    projectRoot,
    result.files.eventInspection,
    'event inspection must remain inside the project root'
  );
}

function assertFastlyBlocked(projectRoot, profile, target) {
  const inspect = parseJson(command(projectRoot, 'inspect', profile));
  assertEventProjection(inspect.events, 'fastly', target, 'blocked');
  assert.equal(inspect.events.targetSupport.diagnosticCode, 'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED');
  assert.deepEqual(inspect.events.targetSupport.requirements.map((entry) => [entry.id, entry.status]), [
    ['event.ingress', 'blocked'],
    ['event.emit', 'blocked']
  ]);
  assert.equal(inspect.compiler.providerLowering.status, 'blocked');
  assert.equal(inspect.compiler.providerLowering.code, 'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED');
  assert.equal(inspect.provider.realization.status, 'unavailable-for-project');

  const doctorResult = command(projectRoot, 'doctor', profile);
  assert.equal(doctorResult.status, 1, doctorResult.stderr || doctorResult.stdout);
  const doctor = JSON.parse(doctorResult.stdout);
  const eventCheck = doctor.checks.find((entry) => entry.id === 'events');
  assert.equal(eventCheck.status, 'failed');
  assert.equal(eventCheck.code, 'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED');
  assertEventProjection(doctor.events, 'fastly', target, 'blocked');

  const outDir = path.join(projectRoot, `.event-fastly-${target}`);
  assert.equal(fs.existsSync(outDir), false);
  for (const name of ['build', 'test']) {
    const failure = parseError(command(projectRoot, name, profile), 3);
    assert.equal(failure.error.code, 'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED');
    assert.equal(failure.error.category, 'provider');
    assert.equal(failure.error.detail.provider, 'fastly');
    assert.equal(failure.error.detail.target, target);
    assert.equal(failure.error.detail.command, name);
    assert.equal(failure.error.detail.automaticFallback, false);
    assert.equal(fs.existsSync(outDir), false, `${name} must fail before writing ${outDir}`);
  }
}

function assertFastlyEmitOnlyBlocked(projectRoot, profile, target) {
  const inspect = parseJson(command(projectRoot, 'inspect', profile));
  assert.equal(inspect.events.version, 'pulse.event-inspection.v1');
  assert.deepEqual(inspect.events.registrations, []);
  assert.deepEqual(inspect.events.callsites.map((entry) => [entry.type, entry.schemaId]), [
    ['output.accepted', 'events.Output']
  ]);
  assert.deepEqual(inspect.events.schemas, {
    registrations: [],
    emissions: ['events.Output'],
    all: ['events.Output']
  });
  assert.deepEqual(inspect.events.hostRequirements, ['event.emit']);
  assert.equal(inspect.events.targetSupport.provider, 'fastly');
  assert.equal(inspect.events.targetSupport.target, target);
  assert.equal(inspect.events.targetSupport.status, 'blocked');
  assert.equal(inspect.events.targetSupport.diagnosticCode, 'PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED');
  assert.deepEqual(inspect.events.targetSupport.requirements.map((entry) => [entry.id, entry.status]), [
    ['event.emit', 'blocked']
  ]);

  const doctorResult = command(projectRoot, 'doctor', profile);
  assert.equal(doctorResult.status, 1, doctorResult.stderr || doctorResult.stdout);
  const doctor = JSON.parse(doctorResult.stdout);
  const eventCheck = doctor.checks.find((entry) => entry.id === 'events');
  assert.equal(eventCheck.status, 'failed');
  assert.equal(eventCheck.code, 'PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED');

  const outDir = path.join(projectRoot, `.event-fastly-${target}`);
  for (const name of ['build', 'test']) {
    const failure = parseError(command(projectRoot, name, profile), 3);
    assert.equal(failure.error.code, 'PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED');
    assert.equal(failure.error.detail.command, name);
    assert.equal(failure.error.detail.automaticFallback, false);
    assert.equal(fs.existsSync(outDir), false, `${name} must fail before writing ${outDir}`);
  }
}

function assertInvalidHarness(projectRoot, source, code) {
  fs.writeFileSync(path.join(projectRoot, 'tests', 'pulse.harness.ts'), source, 'utf8');
  const failure = parseError(command(projectRoot, 'inspect', 'node-native'), 2);
  assert.equal(failure.error.code, code);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-events-cli-'));
  const projectRoot = path.join(tempRoot, 'project');
  try {
    fs.cpSync(fixtureSource, projectRoot, { recursive: true });
    const packageScope = path.join(projectRoot, 'node_modules', '@pulse-compute');
    fs.mkdirSync(packageScope, { recursive: true });
    for (const [name, source] of [
      ['pulse', path.join(repoRoot, 'packages', 'pulse')],
      ['runtime', path.join(repoRoot, 'packages', 'runtime')],
      ['wasm-contracts', path.join(repoRoot, 'wasm', 'packages', 'contracts')]
    ]) {
      fs.symlinkSync(source, path.join(packageScope, name), process.platform === 'win32' ? 'junction' : 'dir');
    }

    const cliSpec = readJson(path.join(repoRoot, 'wasm', 'packages', 'cli', 'cli-spec.json'));
    assert.equal(cliSpec.commands.some((entry) => entry.name === 'event'), false);

    const invalidHarnessRoot = path.join(tempRoot, 'invalid-harness');
    fs.cpSync(fixtureSource, invalidHarnessRoot, { recursive: true });
    assertInvalidHarness(invalidHarnessRoot, `export default [{
  name: 'explicit discriminant required',
  event: { type: 'input.received', schema: 'events.Input', payload: { sequence: 7 } },
  expect: { status: 'completed' },
}]\n`, 'PULSE_TEST_EVENT_INVALID');
    assertInvalidHarness(invalidHarnessRoot, `export default [{
  name: 'one schema field',
  kind: 'event',
  event: { type: 'input.received', schema: 'events.Input', schemaId: 'events.Input', payload: { sequence: 7 } },
  expect: { status: 'completed' },
}]\n`, 'PULSE_TEST_EVENT_INVALID');
    assertInvalidHarness(invalidHarnessRoot, `export default [{
  name: 'event is not HTTP',
  kind: 'event',
  event: { type: 'input.received', schema: 'events.Input', payload: { sequence: 7 } },
  request: { path: '/health' },
  expect: { status: 'completed' },
}]\n`, 'PULSE_TEST_EVENT_INVALID');
    assertInvalidHarness(invalidHarnessRoot, `export default [{
  name: 'bounded canonical frame',
  kind: 'event',
  event: { type: 'input.received', schema: 'events.Input', payload: { sequence: 7 }, transport: 'hidden' },
  expect: { status: 'completed' },
}]\n`, 'PULSE_TEST_EVENT_INVALID');
    assertInvalidHarness(invalidHarnessRoot, `export default [{
  name: 'ordered expected frames',
  kind: 'event',
  event: { type: 'input.received', schema: 'events.Input', payload: { sequence: 7 } },
  expect: { status: 'completed', emitted: {} },
}]\n`, 'PULSE_TEST_EXPECT_INVALID');

    const javascriptTest = parseJson(command(projectRoot, 'test', 'node-javascript'));
    const nativeTest = parseJson(command(projectRoot, 'test', 'node-native'));
    const javascriptCases = assertNodeTest(javascriptTest, 'javascript');
    const nativeCases = assertNodeTest(nativeTest, 'native');
    assert.deepEqual(nativeCases.httpCase.response, javascriptCases.httpCase.response);
    assert.deepEqual(nativeCases.eventCase.result, javascriptCases.eventCase.result);
    assert.deepEqual(nativeCases.eventCase.emittedFrames, javascriptCases.eventCase.emittedFrames);

    for (const [profile, target] of [['node-javascript', 'javascript'], ['node-native', 'native']]) {
      const inspect = parseJson(command(projectRoot, 'inspect', profile));
      assertEventProjection(inspect.events, 'node', target, 'eligible');
      assert.equal(inspect.provider.eventTargetSupport.evidenceHash, inspect.events.targetSupport.evidenceHash);
      assert.deepEqual(inspect.compiler.schemas.unused, []);
      const doctor = parseJson(command(projectRoot, 'doctor', profile));
      assert.equal(doctor.status, 'passed');
      const eventCheck = doctor.checks.find((entry) => entry.id === 'events');
      assert.equal(eventCheck.status, 'passed');
      const schemaCheck = doctor.checks.find((entry) => entry.id === 'schemas');
      assert.equal(schemaCheck.status, 'passed');
      assert.deepEqual(schemaCheck.detail.eventReferences, ['events.Input', 'events.Output']);
      assertEventProjection(doctor.events, 'node', target, 'eligible');
      const build = parseJson(command(projectRoot, 'build', profile));
      assertBuild(projectRoot, build, 'node', target);
    }

    const compiled = parseJson(command(projectRoot, 'compile', 'inspection'));
    assert.equal(compiled.status, 'compiled');
    assert.equal(compiled.provider, null);
    assertEventProjection(compiled.events, 'none', 'native', 'inspection-only');
    assert.equal(compiled.events.targetSupport.inspectionOnly, true);
    assert.ok(fs.existsSync(compiled.files.eventCatalog));
    assert.ok(fs.existsSync(compiled.files.eventInspection));
    assert.equal(compiled.manifest.events.files.catalog, 'event-catalog.json');
    assert.equal(compiled.manifest.events.files.inspection, 'event-inspection.json');

    assertFastlyBlocked(projectRoot, 'fastly-javascript', 'javascript');
    assertFastlyBlocked(projectRoot, 'fastly-native', 'native');

    const emitOnlyRoot = path.join(tempRoot, 'emit-only');
    fs.cpSync(fixtureSource, emitOnlyRoot, { recursive: true });
    fs.writeFileSync(path.join(emitOnlyRoot, 'src', 'index.ts'), `import { Pulse } from '@pulse-compute/pulse'
const app = new Pulse({ auto: true })
app.get('/emit', async (ctx) => {
  await ctx.emit('output.accepted', {
    schema: 'events.Output',
    payload: { accepted: true, sequence: 7 },
  })
  return ctx.text('accepted')
})
export default app
`, 'utf8');
    assertFastlyEmitOnlyBlocked(emitOnlyRoot, 'fastly-javascript', 'javascript');
    assertFastlyEmitOnlyBlocked(emitOnlyRoot, 'fastly-native', 'native');

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      version: 'pulse.events-cli-workflow.v1',
      nodeTargets: ['javascript', 'native'],
      eventCases: 2,
      httpCases: 2,
      packagedCatalogs: 3,
      fastlyBlockedCells: 4,
      publicEventCommand: false,
      automaticFallback: false
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
