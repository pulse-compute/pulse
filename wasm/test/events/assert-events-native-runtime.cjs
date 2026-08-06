#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const events = require('../../packages/contracts/src/events/contracts.js');
const { extractSchemaRegistry } = require('../../packages/schema-json/src/compiler/schema-registry.js');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler.js');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function projectMetadata() {
  return {
    selectedProfile: { name: 'test', source: 'events-native-runtime' },
    strict: true,
    target: 'native',
    host: 'node',
    projectHash: '3'.repeat(64),
    configPlanHash: '4'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {}
  };
}

function writeProject(root, mode) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  write(root, 'src/pulse/schemas/models.ts', `
export interface DeviceButton {
  key: string
  enabled: boolean
}
`);
  const schemaFile = write(root, 'src/pulse/schemas/index.ts', `
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { DeviceButton } from './models.js'

export default defineSchemaRegistry({
  schemas: {
    'events.DeviceButton': schema<DeviceButton>()
  }
})
`);
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: root });
  write(root, 'src/handlers.ts', `
export async function onButton(ctx) {
  const mode = await ctx.config.get(ctx.event.payload.key)
  ctx.state.set('mode', mode ?? 'missing')
  ctx.log.info(ctx.event.type + ':' + ctx.event.payload.enabled)
}

export async function onTick(ctx) {
  ctx.state.set('tick', ctx.event.payload === null ? 'yes' : 'no')
}

export async function health(ctx) {
  return ctx.text('ok')
}
  `);
  const http = mode === 'mixed' ? "app.get('/health', health)\n" : '';
  const handlers = mode === 'mixed' ? 'onButton, onTick, health' : 'onButton, onTick';
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import { ${handlers} } from './handlers.js'
const app = new Pulse({ auto: true })
app.on('device.button', { schema: 'events.DeviceButton' }, onButton)
${http}app.on('system.tick', { schema: null }, onTick)
export default app
`);
  return { entry, schemas: { registry: extracted.registry, dependencies: extracted.dependencies, codecInputs: extracted.codecInputs } };
}

function compileProject(root, mode) {
  const project = writeProject(root, mode);
  return compileCanonicalProject(project.entry, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    applicationProjectMetadata: projectMetadata(),
    schemas: project.schemas,
    strict: true,
    requireAsync: true,
    requireEffectAwait: true
  });
}

function compileEmitBlockedProject(root) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  write(root, 'src/pulse/schemas/models.ts', `
export interface DeviceButton {
  key: string
  enabled: boolean
}
`);
  const schemaFile = write(root, 'src/pulse/schemas/index.ts', `
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { DeviceButton } from './models.js'

export default defineSchemaRegistry({
  schemas: {
    'events.DeviceButton': schema<DeviceButton>()
  }
})
`);
  const extracted = extractSchemaRegistry(schemaFile, { projectRoot: root });
  write(root, 'src/handlers.ts', `
export async function onTick(ctx) {
  await ctx.emit('system.outbound', { schema: 'events.DeviceButton', payload: { key: 'led', enabled: true } })
}
`);
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import { onTick } from './handlers.js'
const app = new Pulse({ auto: true })
app.on('system.tick', { schema: null }, onTick)
export default app
`);
  return compileCanonicalProject(entry, {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    applicationProjectMetadata: projectMetadata(),
    schemas: { registry: extracted.registry, dependencies: extracted.dependencies, codecInputs: extracted.codecInputs },
    strict: true,
    requireAsync: true,
    requireEffectAwait: true
  });
}

function adapter(record) {
  return {
    id: 'native-event-test',
    version: 'pulse.native-event-test-adapter.v1',
    async dispatchEffect(effect) {
      record.push(Object.freeze({ id: effect.id, kind: effect.kind, name: effect.name, frame: effect.frame }));
      if (effect.kind === 'config.get') return effect.name === 'device-mode' ? 'armed' : undefined;
      if (effect.kind === 'event.emit') return undefined;
      throw new Error(`unexpected effect ${effect.kind}`);
    },
    disposeExecution() {}
  };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-events-native-runtime-'));
  try {
    const eventA = compileProject(path.join(tempRoot, 'event-a'), 'event-only');
    const eventB = compileProject(path.join(tempRoot, 'event-b'), 'event-only');
    assert.deepEqual(eventA.eventCatalog, eventB.eventCatalog, 'event catalog must be checkout-independent');
    assert.ok(eventA.eventCatalog.events.every((entry) => entry.eligibility.native === true));
    assert.deepEqual(eventA.eventCatalog.events.map((entry) => entry.capabilities), [
      ['config.get', 'logging', 'state.set'],
      ['state.set']
    ]);
    assert.match(eventA.router.sourceText, /__pulse_event_runtime_id\(\) === 0/);
    assert.match(eventA.router.sourceText, /ctx\.event\.payload\.key/);
    assert.doesNotMatch(eventA.router.sourceText, /ctx\.event\.type/);

    const planA = buildCanonicalNativePlan(eventA);
    const planB = buildCanonicalNativePlan(eventB);
    assert.equal(planA.entry.kind, 'application');
    assert.equal(planA.events.abi.version, events.EVENT_NATIVE_ABI_EXTENSION_VERSION);
    assert.deepEqual(planA.events.catalog, planB.events.catalog);
    assert.deepEqual(planA.applicationEntries.filter((entry) => entry.plane === 'event').map((entry) => [entry.eventRuntimeId, entry.eventType]), [
      [0, 'device.button'],
      [1, 'system.tick']
    ]);
    const configEffect = planA.effects.find((effect) => effect.kind === 'config.get');
    assert.ok(configEffect);
    assert.equal(configEffect.applicationEntryPlane, 'event');
    assert.equal(configEffect.eventRuntimeId, 0);
    assert.equal(configEffect.eventType, 'device.button');
    assert.equal(configEffect.routeStableId, undefined);
    assert.equal(planA.continuations[0].applicationEntryPlane, 'event');

    const nativeA = compileCanonicalNativePlan(planA, { cwd: repoRoot, timeoutMs: 180000 });
    const nativeB = compileCanonicalNativePlan(planB, { cwd: os.tmpdir(), timeoutMs: 180000 });
    assert.deepEqual(nativeA.wasm, nativeB.wasm, 'event-only Native bytes must be reproducible across independent roots');
    const eventExports = nativeA.inspection.exports.filter((entry) => entry.name.startsWith('pulse_event_')).map((entry) => entry.name).sort();
    assert.deepEqual(eventExports, ['pulse_event_abi_version', 'pulse_event_start']);
    assert.deepEqual(nativeA.inspection.imports.filter((entry) => entry.name.startsWith('pulse_event_')), []);
    assert.equal(nativeA.manifest.events.abiVersion, 1);
    assert.equal(nativeA.manifest.events.count, 2);

    const direct = nativeHost.instantiateCanonicalNativeModule(nativeA, { executionPlane: 'event' });
    assert.equal(direct.exports.pulse_event_abi_version(), 1);
    assert.equal(direct.exports.pulse_event_start(-1, 0), -1);
    assert.throws(
      () => direct.start(),
      (error) => error && error.code === 'PULSE_CANONICAL_NATIVE_EXECUTION_PLANE_MISMATCH'
    );
    const httpController = nativeHost.instantiateCanonicalNativeModule(nativeA);
    assert.throws(
      () => httpController.startEvent({ version: events.EVENT_FRAME_VERSION, type: 'system.tick', schemaId: null }),
      (error) => error && error.code === 'PULSE_CANONICAL_NATIVE_EXECUTION_PLANE_MISMATCH'
    );
    const wrongPayload = nativeHost.instantiateCanonicalNativeModule(nativeA, { executionPlane: 'event' });
    assert.equal(wrongPayload.exports.pulse_event_start(0, 0), -1, 'schema-bound entries require a positive payload handle');
    const wrongNoPayload = nativeHost.instantiateCanonicalNativeModule(nativeA, { executionPlane: 'event' });
    assert.equal(wrongNoPayload.exports.pulse_event_start(1, 7), -1, 'no-payload entries require handle zero');

    const observedEffects = [];
    let eventEvidence;
    const completed = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'device.button',
      schemaId: 'events.DeviceButton',
      payload: { key: 'device-mode', enabled: true }
    }, {
      providerAdapter: adapter(observedEffects),
      onEventExecutionEvidence(value) { eventEvidence = value; }
    });
    assert.deepEqual(completed, { version: events.EVENT_EXECUTION_RESULT_VERSION, status: events.EVENT_EXECUTION_STATUS.COMPLETED });
    assert.deepEqual(observedEffects.map((entry) => [entry.kind, entry.name]), [['config.get', 'device-mode']]);
    assert.equal(eventEvidence.event.runtimeId, 0);
    assert.equal(eventEvidence.effectCount, 1);
    assert.equal(eventEvidence.continuations.length, 1);
    assert.deepEqual(eventEvidence.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);

    const noPayload = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'system.tick',
      schemaId: null
    }, { providerAdapter: adapter([]) });
    assert.equal(noPayload.status, events.EVENT_EXECUTION_STATUS.COMPLETED);
    const missing = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'missing.event',
      schemaId: null
    }, { providerAdapter: adapter([]) });
    assert.equal(missing.status, events.EVENT_EXECUTION_STATUS.FAILED);
    assert.equal(missing.error.category, 'handler-not-found');
    const schemaMismatch = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'device.button',
      schemaId: null
    }, { providerAdapter: adapter([]) });
    assert.equal(schemaMismatch.status, events.EVENT_EXECUTION_STATUS.FAILED);
    assert.equal(schemaMismatch.error.category, 'schema-mismatch');
    const schemaFailure = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'device.button',
      schemaId: 'events.DeviceButton',
      payload: { key: 'device-mode', enabled: 'not-a-boolean' }
    }, { providerAdapter: adapter([]) });
    assert.equal(schemaFailure.status, events.EVENT_EXECUTION_STATUS.FAILED);
    assert.equal(schemaFailure.error.category, 'schema-validation-failed');
    const effectFailure = await nativeHost.executeCanonicalNativeEvent(nativeA, {
      version: events.EVENT_FRAME_VERSION,
      type: 'device.button',
      schemaId: 'events.DeviceButton',
      payload: { key: 'device-mode', enabled: true }
    }, {
      providerAdapter: {
        id: 'native-event-failure-test',
        version: 'pulse.native-event-failure-test-adapter.v1',
        async dispatchEffect() {
          const error = new Error('config unavailable');
          error.code = 'PULSE_TEST_EVENT_EFFECT_FAILED';
          throw error;
        },
        disposeExecution() {}
      }
    });
    assert.equal(effectFailure.status, events.EVENT_EXECUTION_STATUS.FAILED);
    assert.equal(effectFailure.error.category, 'handler-failed');
    assert.equal(effectFailure.error.code, 'PULSE_TEST_EVENT_EFFECT_FAILED');

    const emitProject = compileEmitBlockedProject(path.join(tempRoot, 'emit-native'));
    assert.equal(emitProject.eventCatalog.events[0].eligibility.native, true);
    const emitPlan = buildCanonicalNativePlan(emitProject);
    const emitEffect = emitPlan.effects.find((entry) => entry.kind === 'event.emit');
    assert.ok(emitEffect, 'ctx.emit must lower to a canonical Native effect');
    assert.equal(emitEffect.providerKind, 'event');
    assert.equal(emitEffect.operation, 'emit');
    assert.equal(emitEffect.capability, 'event.emit');
    assert.deepEqual(emitEffect.inputs.map((entry) => entry.name), ['type', 'emission']);
    assert.equal(emitEffect.result.valueKind, 'ack');
    const emitNative = compileCanonicalNativePlan(emitPlan, { cwd: repoRoot, timeoutMs: 180000 });
    const emitted = [];
    let emitEvidence;
    const emitResult = await nativeHost.executeCanonicalNativeEvent(emitNative, {
      version: events.EVENT_FRAME_VERSION,
      type: 'system.tick',
      schemaId: null
    }, {
      providerAdapter: adapter(emitted),
      onEventExecutionEvidence(value) { emitEvidence = value; }
    });
    assert.equal(emitResult.status, events.EVENT_EXECUTION_STATUS.COMPLETED);
    assert.deepEqual(emitted.map((entry) => entry.frame), [{
      version: events.EVENT_FRAME_VERSION,
      type: 'system.outbound',
      schemaId: 'events.DeviceButton',
      payload: { enabled: true, key: 'led' }
    }]);
    assert.equal(emitEvidence.effectCount, 1);
    assert.deepEqual(emitEvidence.continuations[0].states, ['created', 'waiting', 'resumed', 'completed']);
    assert.equal(emitNative.inspection.imports.some((entry) => /javascript|asyncify/i.test(`${entry.module}.${entry.name}`)), false);

    const mixedProject = compileProject(path.join(tempRoot, 'mixed'), 'mixed');
    const mixed = compileCanonicalNativePlan(buildCanonicalNativePlan(mixedProject), { cwd: repoRoot, timeoutMs: 180000 });
    assert.ok(mixed.inspection.exports.some((entry) => entry.name === 'pulse_start'));
    assert.ok(mixed.inspection.exports.some((entry) => entry.name === 'pulse_event_start'));
    const http = await nativeHost.executeCanonicalNativeModule(mixed, {
      request: { method: 'GET', url: 'https://example.test/health', path: '/health', headers: [], body: '' },
      providerAdapter: adapter([])
    });
    assert.equal(http.response.status, 200);
    assert.equal(http.response.body, 'ok');
    const mixedEvent = await nativeHost.executeCanonicalNativeEvent(mixed, {
      version: events.EVENT_FRAME_VERSION,
      type: 'system.tick',
      schemaId: null
    }, { providerAdapter: adapter([]) });
    assert.equal(mixedEvent.status, events.EVENT_EXECUTION_STATUS.COMPLETED);

    console.log(JSON.stringify({
      version: 'pulse.events-native-runtime-proof.v1',
      eventOnlySha256: nativeA.inspection.sha256,
      mixedSha256: mixed.inspection.sha256,
      eventCount: planA.events.catalog.events.length,
      effects: planA.effects.length,
      continuations: planA.continuations.length,
      imports: nativeA.inspection.imports.length,
      eventExports
    }));
    console.log('ok - exact Native event dispatch, schema payloads, effect resume, event-only/mixed entries, and conditional ABI are provider-neutral and deterministic');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  if (error && Array.isArray(error.diagnostics)) console.error(JSON.stringify(error.diagnostics, null, 2));
  process.exitCode = 1;
});
