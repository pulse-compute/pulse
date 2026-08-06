#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const {
  CanonicalProjectCompileError,
  compileCanonicalProject
} = require('../../packages/compiler/src/canonical-project-compiler.js');
const {
  CanonicalRouterCompileError
} = require('../../packages/compiler/src/canonical-router-compiler.js');
const {
  extractSchemaRegistry
} = require('../../packages/schema-json/src/compiler/schema-registry.js');

const proofArgIndex = process.argv.indexOf('--proof');
const proofOutputFile = proofArgIndex >= 0 && process.argv[proofArgIndex + 1]
  ? path.resolve(process.argv[proofArgIndex + 1])
  : null;

function write(root, relative, source) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

function projectMetadata() {
  return {
    selectedProfile: { name: 'test', source: 'events-static-topology' },
    strict: true,
    target: 'native',
    host: 'node',
    projectHash: '1'.repeat(64),
    configPlanHash: '2'.repeat(64),
    bindings: { config: [], secret: [] },
    fragments: {}
  };
}

function compileOptions(root, extra = {}) {
  return {
    rootDir: root,
    workspaceRoot: repoRoot,
    tsconfigFile: path.join(root, 'tsconfig.json'),
    applicationProjectMetadata: projectMetadata(),
    strict: true,
    requireAsync: true,
    requireEffectAwait: true,
    ...extra
  };
}

function schemaOptions(root) {
  write(root, 'src/pulse/schemas/models.ts', `
export interface DeviceButton {
  enabled: boolean
  sequence: number
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
  return {
    registry: extracted.registry,
    dependencies: extracted.dependencies,
    codecInputs: extracted.codecInputs
  };
}

function writeSharedProject(root, mode) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const schemas = schemaOptions(root);
  write(root, 'src/handlers/events.ts', `
export async function onButton(ctx) {
  const eventBodyMustNotBeLowered = ctx.event.payload
  void eventBodyMustNotBeLowered
}

export async function onTick(ctx) {
  const tickBodyMustNotBeLowered = ctx.event.type
  void tickBodyMustNotBeLowered
}
`);
  write(root, 'src/handlers/http.ts', `
export async function health(ctx) {
  return ctx.text('ok')
}
`);
  const httpImport = mode === 'event-only' ? '' : "import { health } from './handlers/http.js'\n";
  const registrations = mode === 'http-only'
    ? `app.get('/health', health)\n`
    : mode === 'event-only'
      ? `app.on('device.button.pressed', { schema: 'events.DeviceButton' }, onButton)\napp.on('system.tick', { schema: null }, onTick)\n`
      : `app.on('device.button.pressed', { schema: 'events.DeviceButton' }, onButton)\napp.get('/health', health)\napp.on('system.tick', { schema: null }, onTick)\n`;
  const eventImport = mode === 'http-only' ? '' : "import { onButton, onTick } from './handlers/events.js'\n";
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
${eventImport}${httpImport}
const app = new Pulse({ auto: true })
${registrations}
export default app
`);
  return { entry, schemas };
}

function compileShared(root, mode) {
  const project = writeSharedProject(root, mode);
  return compileCanonicalProject(project.entry, compileOptions(root, { schemas: project.schemas }));
}

function compileEmitProject(root) {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  const schemas = schemaOptions(root);
  write(root, 'src/handlers.ts', `
export async function onButton(ctx) {
  await ctx.emit('device.led.set', { schema: 'events.DeviceButton', payload: { enabled: true, sequence: 1 } })
  await ctx.parallel({ tick: ctx.emit('system.tick', { schema: null }) })
}

export async function health(ctx) {
  await ctx.emit('health.checked', { schema: null })
  return ctx.text('ok')
}
`);
  const entry = write(root, 'src/index.ts', `
import { Pulse } from '@pulse-compute/pulse'
import { onButton, health } from './handlers.js'
const app = new Pulse({ auto: true })
app.on('device.button.pressed', { schema: 'events.DeviceButton' }, onButton)
app.get('/health', health)
export default app
`);
  return compileCanonicalProject(entry, compileOptions(root, { schemas }));
}

function writeDiagnosticProject(root, source, handlers = '') {
  write(root, 'tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}\n');
  if (handlers) write(root, 'src/handlers.ts', handlers);
  return write(root, 'src/index.ts', source);
}

function expectDiagnostic(root, code, source, handlers = '') {
  const entry = writeDiagnosticProject(root, source, handlers);
  assert.throws(
    () => compileCanonicalProject(entry, compileOptions(root)),
    (error) => {
      assert.ok(error instanceof CanonicalProjectCompileError || error instanceof CanonicalRouterCompileError || Array.isArray(error && error.diagnostics), error && error.stack);
      assert.ok((error.diagnostics || []).some((diagnostic) => diagnostic.code === code), `expected ${code}; got ${(error.diagnostics || []).map((diagnostic) => diagnostic.code).join(', ')}`);
      return true;
    }
  );
}

const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-events-static-topology-'));
try {
  const copyA = compileShared(path.join(tempRoot, 'copy-a'), 'event-only');
  const copyB = compileShared(path.join(tempRoot, 'copy-b'), 'event-only');
  assert.equal(copyA.router.routePlan.routes.length, 0);
  assert.equal(copyA.router.metadata.routes.length, 0);
  assert.equal(copyA.router.executionPlan.entries.length, 0);
  assert.deepEqual(copyA.eventCatalog, copyB.eventCatalog, 'event catalogs must be checkout-independent');
  assert.deepEqual(copyA.router.handlerTable.handlers.map((handler) => handler.id), copyB.router.handlerTable.handlers.map((handler) => handler.id), 'event handler IDs must be checkout-independent');
  assert.deepEqual(copyA.eventCatalog.events.map((event) => [event.runtimeId, event.type, event.schemaId]), [
    [0, 'device.button.pressed', 'events.DeviceButton'],
    [1, 'system.tick', null]
  ]);
  assert.ok(copyA.eventCatalog.events.every((event) => event.source.file === 'src/index.ts'));
  assert.ok(copyA.eventCatalog.events.every((event) => event.source.column === 0));
  assert.ok(copyA.eventCatalog.events.every((event) => event.eligibility.javascript === false && event.eligibility.native === true));
  assert.ok(copyA.eventCatalog.events.every((event) => event.hostRequirements.includes('event.ingress')));
  assert.equal(copyA.eventTopology.policy.handlerExecution, true);
  assert.equal(copyA.eventTopology.policy.nativeHandlerExecution, true);
  assert.equal(copyA.eventTopology.policy.eventRoutesAreHttpRoutes, false);
  assert.equal(copyA.eventOutboundRequirements.status, 'implemented-node-javascript-and-native');
  assert.equal(copyA.eventOutboundRequirements.policy.sourceRecognition, true);
  assert.equal(copyA.eventOutboundRequirements.policy.effectLowering, true);
  assert.equal(copyA.eventOutboundRequirements.policy.execution, true);
  assert.equal(copyA.eventOutboundRequirements.policy.javascriptExecution, true);
  assert.equal(copyA.eventOutboundRequirements.policy.nativeEffectLowering, true);
  assert.equal(copyA.eventOutboundRequirements.policy.nativeExecution, true);
  assert.deepEqual(copyA.eventOutboundRequirements.callsites, []);
  assert.deepEqual(copyA.eventOutboundRequirements.capabilities, []);
  assert.deepEqual(copyA.eventOutboundRequirements.packageOperations, []);
  assert.deepEqual(copyA.eventOutboundRequirements.hostRequirements, []);
  assert.deepEqual(copyA.router.handlerTable.handlers.map((handler) => handler.roles), [['event'], ['event']]);
  assert.deepEqual(copyA.reachableGraph.handlers.filter((handler) => handler.role === 'event').map((handler) => handler.localName).sort(), ['onButton', 'onTick']);
  assert.match(copyA.router.sourceText, /eventBodyMustNotBeLowered/);
  assert.match(copyA.router.sourceText, /tickBodyMustNotBeLowered/);
  assert.match(copyA.generatedSource, /eventBodyMustNotBeLowered/);
  assert.match(copyA.generatedSource, /tickBodyMustNotBeLowered/);
  assert.match(copyA.router.sourceText, /Not Found/);

  const httpOnly = compileShared(path.join(tempRoot, 'http-only'), 'http-only');
  const mixed = compileShared(path.join(tempRoot, 'mixed'), 'mixed');
  assert.equal(Object.prototype.hasOwnProperty.call(httpOnly, 'eventCatalog'), false, 'HTTP-only project output must remain event-free');
  assert.equal(Object.prototype.hasOwnProperty.call(httpOnly.router, 'eventCatalog'), false, 'HTTP-only Router output must remain event-free');
  assert.equal(Object.prototype.hasOwnProperty.call(httpOnly.router.handlerTable.roleSignatures, 'event'), false, 'HTTP-only handler-table shape must remain unchanged');
  const routeIdentity = (route) => ({ stableId: route.stableId, runtimeId: route.runtimeId, order: route.order, method: route.method, path: route.path, handler: route.handler });
  assert.deepEqual(mixed.router.routePlan.routes.map(routeIdentity), httpOnly.router.routePlan.routes.map(routeIdentity), 'event registration must not perturb HTTP route identity');
  const routeMetadataIdentity = ({ generatedRange, ...route }) => route;
  assert.deepEqual(mixed.router.metadata.routes.map(routeMetadataIdentity), httpOnly.router.metadata.routes.map(routeMetadataIdentity), 'event registration must preserve canonical HTTP route evidence apart from generated-source offsets');
  assert.equal(mixed.router.handlerTable.handlers[0].roles.includes('route'), true);
  assert.equal(mixed.router.handlerTable.handlers[0].id, httpOnly.router.handlerTable.handlers[0].id, 'HTTP handler stable ID must remain unchanged');
  assert.deepEqual(mixed.router.handlerTable.handlers.slice(1).map((handler) => handler.roles), [['event'], ['event']]);
  assert.equal(mixed.router.executionPlan.entries.filter((entry) => entry.kind === 'route').length, 1);
  assert.equal(mixed.eventCatalog.events.length, 2);
  assert.match(mixed.router.sourceText, /eventBodyMustNotBeLowered/);
  assert.match(mixed.router.sourceText, /tickBodyMustNotBeLowered/);

  const emitsA = compileEmitProject(path.join(tempRoot, 'emits-a'));
  const emitsB = compileEmitProject(path.join(tempRoot, 'emits-b'));
  assert.deepEqual(emitsA.eventOutboundRequirements, emitsB.eventOutboundRequirements, 'emit callsite metadata must be checkout-independent');
  assert.equal(emitsA.eventOutboundRequirements.status, 'implemented-node-javascript-and-native');
  assert.deepEqual(emitsA.eventOutboundRequirements.capabilities, ['event.emit']);
  assert.deepEqual(emitsA.eventOutboundRequirements.hostRequirements, ['event.emit']);
  assert.equal(emitsA.eventOutboundRequirements.callsites.length, 3);
  assert.equal(emitsA.eventOutboundRequirements.summary.schemaBound, 1);
  assert.equal(emitsA.eventOutboundRequirements.summary.noPayload, 2);
  assert.equal(emitsA.eventOutboundRequirements.summary.grouped, 1);
  assert.deepEqual(emitsA.eventOutboundRequirements.callsites.map((entry) => [entry.type, entry.schemaId, entry.grouped]), [
    ['device.led.set', 'events.DeviceButton', false],
    ['system.tick', null, true],
    ['health.checked', null, false]
  ]);
  assert.ok(emitsA.eventOutboundRequirements.callsites.every((entry) => entry.version === 'pulse.event-emit-callsite.v1'));
  assert.ok(emitsA.eventOutboundRequirements.callsites.every((entry) => entry.stableId.startsWith('emit_')));
  assert.ok(emitsA.eventOutboundRequirements.callsites.every((entry) => entry.source.file === 'src/handlers.ts'));
  assert.deepEqual(emitsA.eventCatalog.events[0].capabilities, ['event.emit']);
  assert.deepEqual(emitsA.eventCatalog.events[0].hostRequirements, ['event.emit', 'event.ingress']);
  assert.equal(emitsA.eventCatalog.events[0].eligibility.native, true, 'Native ctx.emit lowers through the canonical effect and continuation protocol');

  const handlerSource = `export async function eventHandler(ctx) {}\nexport async function badHandler(ctx, extra) {}\nexport async function health(ctx) { return ctx.text('ok') }\n`;
  const validPreamble = `import { Pulse } from '@pulse-compute/pulse'\nimport { eventHandler, health } from './handlers.js'\nconst app = new Pulse({ auto: true })\n`;
  expectDiagnostic(path.join(tempRoot, 'dynamic-type'), 'PULSEWASM_EVENTS_TYPE_INVALID', `${validPreamble}const type = 'device.changed'\napp.on(type, { schema: null }, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'dynamic-declaration'), 'PULSEWASM_EVENTS_DECLARATION_INVALID', `${validPreamble}const declaration = { schema: null }\napp.on('device.changed', declaration, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'dynamic-schema'), 'PULSEWASM_EVENTS_DECLARATION_INVALID', `${validPreamble}const schemaId = 'events.Input'\napp.on('device.changed', { schema: schemaId }, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'duplicate'), 'PULSEWASM_EVENTS_TYPE_DUPLICATE', `${validPreamble}app.on('device.changed', { schema: null }, eventHandler)\napp.on('device.changed', { schema: null }, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'unresolved-schema'), 'PULSEWASM_EVENTS_SCHEMA_UNRESOLVED', `${validPreamble}app.on('device.changed', { schema: 'events.Missing' }, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'signature'), 'PULSEWASM_ROLE_SIGNATURE_MISMATCH', `import { Pulse } from '@pulse-compute/pulse'\nimport { badHandler, health } from './handlers.js'\nconst app = new Pulse({ auto: true })\napp.on('device.changed', { schema: null }, badHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'arity'), 'PULSEWASM_EVENTS_SIGNATURE_UNSUPPORTED', `${validPreamble}app.on('device.changed', eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'hidden'), 'PULSEWASM_EVENTS_REGISTRATION_HIDDEN', `${validPreamble}function register() { app.on('device.changed', { schema: null }, eventHandler) }\nvoid register\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'aliased-root'), 'PULSEWASM_EVENTS_REGISTRATION_HIDDEN', `${validPreamble}const events = app\nevents.on('device.changed', { schema: null }, eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'extracted-on'), 'PULSEWASM_EVENTS_REGISTRATION_HIDDEN', `${validPreamble}const register = app.on\nvoid register\napp.get('/health', health)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'child'), 'PULSEWASM_EVENTS_ROOT_ONLY', `import { Pulse } from '@pulse-compute/pulse'\nimport { Router } from '@pulse-compute/runtime'\nimport { eventHandler, health } from './handlers.js'\nconst child = new Router()\nconst app = new Pulse({ auto: true })\nchild.on('device.changed', { schema: null }, eventHandler)\nchild.get('/health', health)\napp.mount('/child', child)\nexport default app\n`, handlerSource);
  expectDiagnostic(path.join(tempRoot, 'retired-router-lifecycle'), 'PULSE_CANONICAL_ROUTER_OPERATION_RETIRED', `import { Router } from '@pulse-compute/runtime'\nimport { eventHandler, health } from './handlers.js'\nconst app = new Router()\napp.on('connect', eventHandler)\napp.get('/health', health)\nexport default app\n`, handlerSource);

  const emitPreamble = `import { Pulse } from '@pulse-compute/pulse'\nimport { eventHandler, health } from './handlers.js'\nconst app = new Pulse({ auto: true })\napp.on('device.changed', { schema: null }, eventHandler)\napp.get('/health', health)\nexport default app\n`;
  expectDiagnostic(path.join(tempRoot, 'emit-dynamic-type'), 'PULSEWASM_EVENTS_EMIT_TYPE_STATIC_REQUIRED', emitPreamble, `export async function eventHandler(ctx) { const type = 'device.out'; await ctx.emit(type, { schema: null }) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'emit-dynamic-declaration'), 'PULSEWASM_EVENTS_EMIT_DECLARATION_STATIC_REQUIRED', emitPreamble, `export async function eventHandler(ctx) { const event = { schema: null }; await ctx.emit('device.out', event) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'emit-await-required'), 'PULSE_EFFECT_AWAIT_REQUIRED', emitPreamble, `export async function eventHandler(ctx) { ctx.emit('device.out', { schema: null }) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'emit-schema-unresolved'), 'PULSEWASM_EVENTS_EMIT_SCHEMA_UNRESOLVED', emitPreamble, `export async function eventHandler(ctx) { await ctx.emit('device.out', { schema: 'events.Missing', payload: {} }) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'emit-payload-required'), 'PULSEWASM_EVENTS_EMIT_PAYLOAD_REQUIRED', emitPreamble, `export async function eventHandler(ctx) { await ctx.emit('device.out', { schema: 'events.Payload' }) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'emit-payload-forbidden'), 'PULSEWASM_EVENTS_EMIT_PAYLOAD_FORBIDDEN', emitPreamble, `export async function eventHandler(ctx) { await ctx.emit('device.out', { schema: null, payload: {} }) }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'event-http-surface'), 'PULSE_EVENT_CONTEXT_HTTP_SURFACE_UNSUPPORTED', emitPreamble, `export async function eventHandler(ctx) { void ctx.req.path }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'event-result'), 'PULSE_EVENT_HANDLER_RESULT_UNSUPPORTED', emitPreamble, `export async function eventHandler(ctx) { return { status: 204 } }\nexport async function health(ctx) { return ctx.text('ok') }\n`);
  expectDiagnostic(path.join(tempRoot, 'http-event-surface'), 'PULSE_HTTP_CONTEXT_EVENT_SURFACE_UNSUPPORTED', emitPreamble, `export async function eventHandler(ctx) {}\nexport async function health(ctx) { void ctx.event.payload; return ctx.text('ok') }\n`);

  const proof = {
    version: 'pulse.events-static-topology-proof.v1',
    catalogHash: copyA.eventCatalog.catalogHash,
    catalogSha256: crypto.createHash('sha256').update(JSON.stringify(copyA.eventCatalog)).digest('hex'),
    eventStableIds: copyA.eventCatalog.events.map((event) => event.stableId),
    handlerStableIds: copyA.eventCatalog.events.map((event) => event.handlerStableId),
    sourceFiles: [...new Set(copyA.eventCatalog.events.map((event) => event.source.file))],
    modes: { httpOnly: true, eventOnly: true, mixed: true },
    handlerExecution: true,
    nativeHandlerExecution: true,
    providerSupportChanged: true,
    outboundRequirements: copyA.eventOutboundRequirements,
    emitCallsiteCount: emitsA.eventOutboundRequirements.callsites.length,
    emitCallsiteStableIds: emitsA.eventOutboundRequirements.callsites.map((entry) => entry.stableId)
  };
  if (proofOutputFile) {
    fs.mkdirSync(path.dirname(proofOutputFile), { recursive: true });
    fs.writeFileSync(proofOutputFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(proof, null, 2));
  console.log('ok - static Pulse event topology is schema-resolved, uniquely owned, deterministic, inspectable, and Native-lowerable');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
