#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const events = require('../../packages/contracts/src/events/contracts.js');
const contractsRoot = require('../../packages/contracts/src/index.js');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile.js');
const { EXAMPLES, compileExample } = require('../support/canonical-projects.cjs');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan.js');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
const compilerRequire = createRequire(path.join(compilerRoot, 'package.json'));
const controlFile = path.join(__dirname, 'events-ev0-http-control.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expectCode(callback, code, label) {
  assert.throws(callback, (error) => error && error.name === 'EventContractError' && error.code === code, label);
}

function contractProof() {
  assert.equal(events.EVENT_CONTRACT_VERSION, 'pulse.events-contract.v1');
  assert.equal(events.EVENT_DECLARATION_VERSION, 'pulse.event-declaration.v1');
  assert.equal(events.EVENT_FRAME_VERSION, 'pulse.event-frame.v1');
  assert.equal(events.EVENT_CATALOG_VERSION, 'pulse.event-catalog.v1');
  assert.equal(events.EVENT_ADAPTER_VERSION, 'pulse.event-adapter.v1');
  assert.equal(events.EVENT_EXECUTION_RESULT_VERSION, 'pulse.event-execution-result.v1');
  assert.equal(events.EVENT_DIAGNOSTIC_VERSION, 'pulse.events-diagnostics.v1');
  assert.deepEqual(events.EVENT_DEFAULT_LIMITS, {
    maxTypeBytes: 128,
    maxSchemaIdBytes: 256,
    maxPayloadBytes: 65_536,
    maxPayloadDepth: 32,
    maxPayloadEntries: 4_096,
    maxEvents: 256,
    maxQueueDepth: 65_536,
    maxErrorBytes: 4_096
  });

  const declaration = events.normalizeEventDeclaration({ schema: 'events.DeviceButton' });
  assert.deepEqual(declaration, { version: events.EVENT_DECLARATION_VERSION, schemaId: 'events.DeviceButton' });
  assert.equal(Object.isFrozen(declaration), true);
  assert.deepEqual(events.normalizeEventDeclaration({ schema: null }), { version: events.EVENT_DECLARATION_VERSION, schemaId: null });

  const original = {
    enabled: true,
    nested: { attempts: 2 },
    tags: ['front', 'blue']
  };
  const frame = events.normalizeEventFrame({
    version: events.EVENT_FRAME_VERSION,
    type: 'device.button',
    schemaId: 'events.DeviceButton',
    payload: original
  });
  assert.deepEqual(frame, {
    version: events.EVENT_FRAME_VERSION,
    type: 'device.button',
    schemaId: 'events.DeviceButton',
    payload: { enabled: true, nested: { attempts: 2 }, tags: ['front', 'blue'] }
  });
  assert.notEqual(frame.payload, original);
  assert.notEqual(frame.payload.nested, original.nested);
  assert.equal(Object.isFrozen(frame), true);
  assert.equal(Object.isFrozen(frame.payload), true);
  assert.equal(Object.isFrozen(frame.payload.nested), true);
  assert.equal(Object.isFrozen(frame.payload.tags), true);
  original.nested.attempts = 9;
  original.tags.push('late');
  assert.equal(frame.payload.nested.attempts, 2);
  assert.deepEqual(frame.payload.tags, ['front', 'blue']);

  const noPayload = events.normalizeEventFrame({
    version: events.EVENT_FRAME_VERSION,
    type: 'system.tick',
    schemaId: null
  });
  assert.equal(Object.prototype.hasOwnProperty.call(noPayload, 'payload'), false);
  assert.equal(Object.isFrozen(noPayload), true);

  expectCode(() => events.normalizeEventLimits({ maxPayloadBytes: 0 }), events.EVENT_DIAGNOSTIC_CODES.LIMIT_INVALID, 'zero limit');
  expectCode(() => events.normalizeEventDeclaration({}), events.EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'missing declaration schema');
  expectCode(() => events.normalizeEventDeclaration({ schema: null, metadata: {} }), events.EVENT_DIAGNOSTIC_CODES.DECLARATION_INVALID, 'unknown declaration field');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: '', schemaId: null }), events.EVENT_DIAGNOSTIC_CODES.TYPE_INVALID, 'empty type');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x'.repeat(129), schemaId: null }), events.EVENT_DIAGNOSTIC_CODES.TYPE_INVALID, 'type byte limit');
  expectCode(() => events.normalizeEventFrame({ version: 'pulse.event-frame.v2', type: 'x', schemaId: null }), events.EVENT_DIAGNOSTIC_CODES.FRAME_INVALID, 'frame version');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'not-dotted', payload: {} }), events.EVENT_DIAGNOSTIC_CODES.SCHEMA_ID_INVALID, 'schema format');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input' }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_REQUIRED, 'schema payload required');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: null, payload: undefined }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_FORBIDDEN, 'no-schema payload forbidden');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: null, timestamp: 1 }), events.EVENT_DIAGNOSTIC_CODES.FRAME_INVALID, 'frame unknown field');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input', payload: Infinity }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID, 'finite payload');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input', payload: undefined }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID, 'JSON payload');
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input', payload: { text: 'xxxx' } }, { maxPayloadBytes: 8 }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID, 'payload byte limit');
  const cyclic = {};
  cyclic.self = cyclic;
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input', payload: cyclic }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID, 'cycle rejection');
  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { return 'hidden'; } });
  expectCode(() => events.normalizeEventFrame({ version: events.EVENT_FRAME_VERSION, type: 'x', schemaId: 'events.Input', payload: accessor }), events.EVENT_DIAGNOSTIC_CODES.PAYLOAD_INVALID, 'accessor rejection');

  const handlerStableId = 'handler_1234567890abcdef12345678';
  const alphaStableId = events.createEventStableId({ type: 'alpha.event', schemaId: null, handlerStableId });
  const betaStableId = events.createEventStableId({ type: 'beta.event', schemaId: 'events.Beta', handlerStableId });
  function catalogInput(inputEvents) {
    return { version: events.EVENT_CATALOG_VERSION, contractId: events.EVENT_CONTRACT_ID, events: inputEvents };
  }
  const alpha = {
    type: 'alpha.event', schemaId: null, stableId: alphaStableId, runtimeId: 0, handlerStableId,
    source: { file: 'src/app.ts', line: 5, column: 2 },
    capabilities: ['log'], packageOperations: [], eligibility: { javascript: true, native: true }, hostRequirements: ['event.ingress']
  };
  const beta = {
    type: 'beta.event', schemaId: 'events.Beta', stableId: betaStableId, runtimeId: 1, handlerStableId,
    source: { file: 'src/events.ts', line: 9, column: 0 },
    capabilities: ['state', 'event.emit'], packageOperations: ['package.beta'], eligibility: { javascript: true, native: false }, hostRequirements: ['event.ingress', 'event.emit']
  };
  const catalog = events.normalizeEventCatalog(catalogInput([beta, alpha]));
  const reordered = events.normalizeEventCatalog(catalogInput([alpha, beta]));
  assert.equal(catalog.catalogHash, reordered.catalogHash);
  assert.deepEqual(catalog.events.map((entry) => entry.type), ['alpha.event', 'beta.event']);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.events), true);
  assert.equal(Object.isFrozen(catalog.events[0].source), true);
  assert.match(catalog.catalogHash, /^[a-f0-9]{64}$/);
  expectCode(() => events.normalizeEventCatalog(catalogInput([alpha, { ...beta, type: alpha.type, stableId: alphaStableId }])), events.EVENT_DIAGNOSTIC_CODES.TYPE_DUPLICATE, 'duplicate event type');
  expectCode(() => events.normalizeEventCatalog(catalogInput([{ ...alpha, source: { file: '/checkout/app.ts', line: 1, column: 0 } }])), events.EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'absolute source');
  expectCode(() => events.normalizeEventCatalog(catalogInput([{ ...alpha, stableId: 'event_wrong' }])), events.EVENT_DIAGNOSTIC_CODES.CATALOG_INVALID, 'stable identity mismatch');

  const adapter = events.normalizeEventAdapter({
    version: events.EVENT_ADAPTER_VERSION,
    id: 'node-test',
    maxQueueDepth: 32,
    semantics: events.EVENT_ADAPTER_SEMANTICS
  });
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(adapter.semantics, events.EVENT_ADAPTER_SEMANTICS);
  expectCode(() => events.normalizeEventAdapter({ version: events.EVENT_ADAPTER_VERSION, id: 'loopback', maxQueueDepth: 1, semantics: { ...events.EVENT_ADAPTER_SEMANTICS, autoLoopback: true } }), events.EVENT_DIAGNOSTIC_CODES.ADAPTER_INVALID, 'loopback semantics');

  assert.deepEqual(events.normalizeEventExecutionResult({ version: events.EVENT_EXECUTION_RESULT_VERSION, status: 'completed' }), { version: events.EVENT_EXECUTION_RESULT_VERSION, status: 'completed' });
  const failure = events.normalizeEventExecutionResult({ version: events.EVENT_EXECUTION_RESULT_VERSION, status: 'failed', error: { category: 'handler-failed' } });
  assert.equal(Object.isFrozen(failure.error), true);
  expectCode(() => events.normalizeEventExecutionResult({ version: events.EVENT_EXECUTION_RESULT_VERSION, status: 'completed', error: {} }), events.EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID, 'completed error forbidden');
  expectCode(() => events.normalizeEventExecutionResult({ version: events.EVENT_EXECUTION_RESULT_VERSION, status: 'failed' }), events.EVENT_DIAGNOSTIC_CODES.EXECUTION_RESULT_INVALID, 'failed error required');

  assert.equal(events.EVENT_NATIVE_ABI_EXTENSION.abiVersion, 1);
  assert.deepEqual(events.EVENT_NATIVE_ABI_EXTENSION.imports, []);
  assert.deepEqual(events.EVENT_NATIVE_ABI_EXTENSION.exports.map((entry) => [entry.name, entry.parameters, entry.result]), [
    ['pulse_event_abi_version', [], 'i32'],
    ['pulse_event_start', ['i32', 'i32'], 'i32']
  ]);
  assert.deepEqual(events.EVENT_NATIVE_ABI_EXTENSION.startStatus, { complete: 0, failed: -1, invalidStartErrorCode: 1 });
  assert.equal(events.EVENT_NATIVE_ABI_EXTENSION.policy.httpOnlyArtifactIdentityUnchanged, true);
  assert.deepEqual(events.EVENT_CALL_DISPOSITION, {
    status: 'deferred',
    publicSurfaceReserved: false,
    compilerOpcodeReserved: false,
    runtimeCapabilityReserved: false,
    adapterOperationReserved: false,
    reevaluateAfter: ['a real browser Worker host exists', 'ordinary Entities lifecycle blockers are resolved']
  });

  const diagnostics = Object.values(events.EVENT_DIAGNOSTIC_CODES);
  assert.equal(new Set(diagnostics).size, diagnostics.length);
  assert.ok(diagnostics.every((code) => /^PULSEWASM_EVENTS_[A-Z0-9_]+$/.test(code)));

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wasm/packages/contracts/package.json'), 'utf8'));
  assert.equal(packageJson.exports['./events'], './src/events/contracts.js');
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.exports, './events/contracts'), false);
  assert.equal(Object.keys(contractsRoot).some((key) => /event/i.test(key)), false);
  assert.equal(compilerRequire('@pulse-compute/wasm-contracts/events').EVENT_CONTRACT_VERSION, events.EVENT_CONTRACT_VERSION);
  assert.throws(
    () => require('@pulse-compute/wasm-contracts/events/contracts'),
    (error) => error && ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(error.code)
  );

  return Object.freeze({
    versions: 8,
    diagnostics: diagnostics.length,
    catalogHash: catalog.catalogHash,
    applicationRootExport: false,
    internalToolchainExport: '@pulse-compute/wasm-contracts/events',
    handlerExecution: false,
    emitExecution: false,
    callReserved: false
  });
}

function eventProbeSource(enabled) {
  const base = [
    'export function pulse_start(): i32 { return 0 }'
  ];
  if (!enabled) return `${base.join('\n')}\n`;
  return `${base.join('\n')}

let eventState: i32 = 0
let eventRuntimeId: i32 = -1
let eventPayloadHandle: i32 = -1
let eventError: i32 = 0

export function pulse_event_abi_version(): i32 { return 1 }

export function pulse_event_start(runtimeId: i32, payloadHandle: i32): i32 {
  if (eventState != 0 || runtimeId < 0 || payloadHandle < 0) {
    eventError = 1
    return -1
  }
  eventState = 1
  eventRuntimeId = runtimeId
  eventPayloadHandle = payloadHandle
  return 0
}

// Probe-only observability; these are not part of the selected production ABI.
export function pulse_ev0_probe_runtime_id(): i32 { return eventRuntimeId }
export function pulse_ev0_probe_payload_handle(): i32 { return eventPayloadHandle }
export function pulse_ev0_probe_last_error(): i32 { return eventError }
`;
}

function compileProbe(source, parent, name) {
  const asc = resolveAsc(compilerRoot);
  assert.ok(asc, 'lockfile-pinned AssemblyScript compiler must resolve');
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  const sourceFile = path.join(root, 'event-entry.as.ts');
  const wasmFile = path.join(root, 'event-entry.wasm');
  fs.writeFileSync(sourceFile, source, 'utf8');
  const result = spawnSync(asc.executable, [
    asc.script,
    path.basename(sourceFile),
    '--outFile', wasmFile,
    '--runtime', 'stub',
    '--noAssert',
    '--optimize'
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bytes = fs.readFileSync(wasmFile);
  assert.equal(WebAssembly.validate(bytes), true);
  const module = new WebAssembly.Module(bytes);
  return Object.freeze({
    bytes,
    module,
    imports: WebAssembly.Module.imports(module),
    exports: WebAssembly.Module.exports(module)
  });
}

function nativeFeasibilityProof() {
  const control = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
  const plan = buildCanonicalNativePlan(compileExample(EXAMPLES.hello).compiled);
  const first = compileCanonicalNativePlan(plan, { cwd: repoRoot });
  const second = compileCanonicalNativePlan(plan, { cwd: os.tmpdir() });
  assert.deepEqual(first.wasm, second.wasm, 'ordinary HTTP Wasm must be byte-identical across independent realization roots');
  assert.equal(first.source, second.source, 'ordinary HTTP generated source must be identical');
  assert.equal(first.wasm.length, control.bytes);
  assert.equal(sha256(first.wasm), control.sha256);
  assert.equal(sha256(first.source), control.sourceSha256);
  assert.equal(plan.planHash, control.planHash);
  const productionEventImports = first.inspection.imports.filter((entry) => entry.name.startsWith('pulse_event_'));
  const productionEventExports = first.inspection.exports.filter((entry) => entry.name.startsWith('pulse_event_'));
  assert.deepEqual(productionEventImports, control.eventImports);
  assert.deepEqual(productionEventExports, control.eventExports);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-events-ev0-'));
  try {
    const httpProbeA = compileProbe(eventProbeSource(false), temp, 'http-a');
    const httpProbeB = compileProbe(eventProbeSource(false), temp, 'http-b');
    assert.deepEqual(httpProbeA.bytes, httpProbeB.bytes, 'conditional probe generator must keep disabled output byte-identical');
    assert.deepEqual(httpProbeA.imports, []);
    assert.equal(httpProbeA.exports.some((entry) => entry.name.startsWith('pulse_event_')), false);

    const eventProbe = compileProbe(eventProbeSource(true), temp, 'event');
    assert.deepEqual(eventProbe.imports, [], 'event entry does not require a new host import');
    const eventExportNames = eventProbe.exports.map((entry) => entry.name);
    for (const required of ['pulse_start', 'pulse_event_abi_version', 'pulse_event_start']) assert.ok(eventExportNames.includes(required), `${required} export`);
    const withPayload = new WebAssembly.Instance(eventProbe.module, {});
    assert.equal(withPayload.exports.pulse_event_abi_version(), 1);
    assert.equal(withPayload.exports.pulse_event_abi_version.length, 0);
    assert.equal(withPayload.exports.pulse_event_start.length, 2);
    assert.equal(withPayload.exports.pulse_event_start(7, 33), 0);
    assert.equal(withPayload.exports.pulse_ev0_probe_runtime_id(), 7);
    assert.equal(withPayload.exports.pulse_ev0_probe_payload_handle(), 33);
    assert.equal(withPayload.exports.pulse_event_start(8, 34), -1, 'one instance rejects same-stack reentry');
    assert.equal(withPayload.exports.pulse_ev0_probe_last_error(), 1);
    const withoutPayload = new WebAssembly.Instance(eventProbe.module, {});
    assert.equal(withoutPayload.exports.pulse_event_start(2, 0), 0, 'handle zero crosses the boundary as explicit no payload');
    assert.equal(withoutPayload.exports.pulse_ev0_probe_payload_handle(), 0);
    assert.equal(new WebAssembly.Instance(eventProbe.module, {}).exports.pulse_event_start(-1, 0), -1, 'negative runtime IDs fail closed');
    assert.equal(new WebAssembly.Instance(eventProbe.module, {}).exports.pulse_event_start(0, -1), -1, 'negative value handles fail closed');

    return Object.freeze({
      assemblyScript: JSON.parse(fs.readFileSync(path.join(ascPackageRoot(compilerRoot), 'package.json'), 'utf8')).version,
      httpControlBytes: first.wasm.length,
      httpControlSha256: sha256(first.wasm),
      disabledProbeSha256: sha256(httpProbeA.bytes),
      eventProbeSha256: sha256(eventProbe.bytes),
      eventImports: eventProbe.imports.length,
      selectedExports: events.EVENT_NATIVE_ABI_EXTENSION.exports.map((entry) => entry.name),
      payloadBoundary: 'host-owned-i32-value-handle',
      noPayloadSentinel: 0
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function ascPackageRoot(cwd) {
  return path.dirname(require.resolve('assemblyscript/package.json', { paths: [cwd] }));
}

const contract = contractProof();
const native = nativeFeasibilityProof();
console.log(JSON.stringify({
  version: events.EVENT_CONTRACT_VERSION,
  contract,
  native,
  releaseAssigned: false,
  providersChanged: false,
  ev0ProofPublishesApi: false
}));
console.log('ok - repository-only event contract and conditional Native event entry are exact while ordinary HTTP Wasm remains byte-identical');
