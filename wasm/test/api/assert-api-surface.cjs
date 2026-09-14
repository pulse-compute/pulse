#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const runtimeRoot = path.join(repoRoot, 'packages', 'runtime');
const pulseRoot = path.join(repoRoot, 'packages', 'pulse');
const gripRoot = path.join(repoRoot, 'packages', 'grip');
const runtime = require(path.join(runtimeRoot, 'src', 'index.js'));
const runtimeHost = require(path.join(runtimeRoot, 'src', 'host.js'));
const pulse = require(path.join(pulseRoot, 'src', 'index.js'));
const handlerTypesContract = require(path.join(wasmRoot, 'packages/contracts/src/handler/types-contract.js'));
const ctxContract = require(path.join(wasmRoot, 'packages/contracts/src/handler/ctx-contract.js'));
const runtimePulseLive = require(path.join(wasmRoot, 'packages/contracts/src/package/runtime-pulse-live.js'));
const declarationFile = path.join(runtimeRoot, 'src', 'index.d.ts');
const declarations = fs.readFileSync(declarationFile, 'utf8');
const pulseDeclarations = fs.readFileSync(path.join(pulseRoot, 'src', 'index.d.ts'), 'utf8');
const hostDeclarations = fs.readFileSync(path.join(runtimeRoot, 'src', 'host.d.ts'), 'utf8');

assert.equal(runtime.RUNTIME_API_VERSION, 'pulse.runtime-authoring.v4');
assert.equal(runtime.ROUTER_API_VERSION, 'pulse.router-authoring.v2');
assert.equal(typeof runtime.Router, 'function');
const handler = async (ctx) => ctx;
const router = new runtime.Router();
assert.equal(router.use(handler), router);
assert.equal(router.use('/api', handler), router);
assert.equal(router.get('/health', handler), router);
assert.equal(router.head('/health', handler), router);
assert.equal(router.post('/health', handler), router);
assert.equal(router.put('/health', handler), router);
assert.equal(router.patch('/health', handler), router);
assert.equal(router.delete('/health', handler), router);
assert.equal(router.mount('/api', new runtime.Router()), router);
assert.equal(router.error(handler), router);
assert.equal(Object.prototype.hasOwnProperty.call(router, 'on'), false, 'Router must remain HTTP-only');
assert.equal(Object.prototype.hasOwnProperty.call(runtime.Router.prototype, 'on'), false, 'Router prototype must not gain event registration');
assert.equal(Object.prototype.hasOwnProperty.call(runtime, 'defineHandler'), false, 'defineHandler must not be public');
assert.equal(Object.prototype.hasOwnProperty.call(runtime, 'Pulse'), false, 'Pulse application root belongs to @pulse-compute/pulse');
assert.equal(runtimeHost.RUNTIME_HOST_API_VERSION, 'pulse.runtime-host.v3');
assert.equal(typeof runtimeHost.executeEvent, 'function');
assert.equal(typeof runtimeHost.createEventRecordingAdapter, 'function');
assert.deepEqual(Object.keys(pulse), ['defineConfig', 'Pulse', 'PULSE_APPLICATION_API_VERSION'], 'public Pulse package must expose the configuration and application-root surface');
assert.equal(typeof pulse.Pulse, 'function');
assert.equal(pulse.PULSE_APPLICATION_API_VERSION, 'pulse.application-authoring.v3');
const eventApplication = new pulse.Pulse({ auto: true });
assert.equal(eventApplication.put('/items/:id', handler), eventApplication);
assert.equal(eventApplication.patch('/items/:id', handler), eventApplication);
assert.equal(eventApplication.delete('/items/:id', handler), eventApplication);
assert.equal(eventApplication.on('system.tick', { schema: null }, async () => undefined), eventApplication);
assert.equal(Object.prototype.hasOwnProperty.call(eventApplication, 'emit'), false, 'event emit remains unavailable');

assert.match(declarations, /export interface PulseEffect<T> extends Promise<T>/);
assert.match(declarations, /export type Handler = \(ctx: PulseContext\) => Promise<HandlerResult>/);
assert.match(declarations, /export type RouteHandler = \(ctx: PulseRouteContext, next: RouterNext\) => Promise<HandlerResult>/);
assert.match(declarations, /export type PulseHandlerResult = HandlerResult/);
assert.match(declarations, /export type PulseHandler = Handler/);
assert.match(declarations, /export type PulseRouteHandler = RouteHandler/);
assert.match(declarations, /export type PulseMiddleware = RouterMiddleware/);
assert.match(declarations, /export type PulseErrorHandler = RouterErrorHandler/);
assert.match(declarations, /readonly state: PulseState/);
assert.match(declarations, /export interface PulseLogger/);
assert.match(declarations, /export interface PulseExecutionContext/);
assert.match(declarations, /export interface PulseContext extends PulseExecutionContext/);
assert.match(declarations, /export interface PulseEvent<Payload = unknown>/);
assert.match(declarations, /export interface PulseEventContext<Payload = unknown> extends PulseExecutionContext/);
assert.match(declarations, /export type PulseEmitEvent<Payload = unknown>/);
assert.match(declarations, /emit<Payload = unknown>\(/);
assert.match(declarations, /export type PulseEventHandler<Payload = unknown> = \(ctx: PulseEventContext<Payload>\) => Promise<void>/);
assert.match(declarations, /error\(message: string\): void/);
assert.match(declarations, /warn\(message: string\): void/);
assert.match(declarations, /info\(message: string\): void/);
assert.match(declarations, /debug\(message: string\): void/);
assert.match(declarations, /readonly log: PulseLogger/);
assert.match(declarations, /get\(key: string\): string \| undefined/);
assert.match(declarations, /set\(key: string, value: string\): void/);
assert.match(declarations, /fetch\(url: string/);
assert.match(declarations, /json<T = unknown>\(schemaId\?: string\): PulseEffect<T>/);
assert.match(declarations, /schema\?: string/);
assert.match(declarations, /bodyHandle: unknown/);
assert.match(declarations, /export declare class Router/);
assert.match(declarations, /param\(name: string\): string \| undefined/);
assert.match(declarations, /RouterNext = \(error\?: unknown\) => never/);
assert.doesNotMatch(declarations, /AsyncIterable|Symbol\.asyncIterator|ctx\.fastly|ctx\.cloudflare|providerSdk/i);
assert.doesNotMatch(declarations, /bytes\(\)|stream\(\)|transformStream|backgroundTask/i);
assert.match(pulseDeclarations, /export declare class Pulse extends Router/);
assert.match(pulseDeclarations, /export type PulseEventDeclaration/);
assert.match(pulseDeclarations, /on<Payload = unknown>\(/);
assert.match(pulseDeclarations, /handler: import\('@pulse-compute\/runtime'\)\.PulseEventHandler<Payload>/);
assert.match(pulseDeclarations, /constructor\(options: PulseAutoOptions\)/);
assert.match(pulseDeclarations, /constructor\(config: PulseConfigFactory\)/);
assert.doesNotMatch(pulseDeclarations, /selectedProfile|process\.env/);
assert.match(pulseDeclarations, /defineConfig<const Declaration extends PulseProjectDeclaration>/);
assert.match(pulseDeclarations, /config<const Name extends string>/);
assert.match(pulseDeclarations, /secret<const Name extends string>/);
assert.match(pulseDeclarations, /PulseReportingLevel = 'off' \| 'error' \| 'warn' \| 'info' \| 'debug'/);
assert.match(pulseDeclarations, /reporting\?: PulseReportingLevel/);
for (const typeName of ['PulseEffect', 'PulseEmitEvent', 'PulseExecutionContext', 'PulseContext', 'PulseRouteContext', 'PulseEvent', 'PulseEventContext', 'PulseEventHandler', 'Handler', 'RouteHandler', 'RouterNext', 'PulseHandler', 'PulseMiddleware', 'PulseErrorHandler']) {
  assert.match(pulseDeclarations, new RegExp(`\\b${typeName}\\b`), `${typeName} must be available from @pulse-compute/pulse as a runtime-owned type re-export`);
}
assert.doesNotMatch(pulseDeclarations, /export\s+\{\s*Router\s*\}/);
assert.doesNotMatch(pulseDeclarations, /\blisten\(|\bconfig\(\)|\benv:/);
assert.match(hostDeclarations, /export type PulseEventFrame<Payload = unknown>/);
assert.match(hostDeclarations, /export type PulseEventExecutionResult/);
assert.match(hostDeclarations, /export declare function executeEvent\(/);
assert.match(hostDeclarations, /export declare function createEventRecordingAdapter\(/);
assert.match(hostDeclarations, /readonly autoLoopback: false/);
assert.doesNotMatch(hostDeclarations, /eventListener|queueTransport|executeCall/);

const handlerTypes = handlerTypesContract.defaultHandlerTypesContract();
assert.equal(handlerTypes.version, 'pulse.handler-types.v4');
assert.equal(handlerTypes.runtimeVersion, 'pulse.runtime-authoring.v4');
assert.deepEqual(handlerTypes.executionContexts.shared, ['state', 'log', 'fetch', 'parallel', 'config', 'secret', 'kv', 'emit', 'encodeJson']);
assert.deepEqual(handlerTypes.executionContexts.event, ['event.type', 'event.payload']);
assert.equal(handlerTypes.executionContexts.emitPublished, true);
assert.equal(handlerTypes.compiler.acceptsEventHandlers, true);
assert.equal(handlerTypes.compiler.eventEmitRecognition, true);
assert.equal(handlerTypes.compiler.eventEmitNativeLowering, false);

const contextContract = ctxContract.validateCtxContract();
assert.equal(contextContract.version, 'pulse.ctx-contract.v4');
assert.equal(contextContract.policies.stateRepresentation, 'execution-local-string-map');
assert.equal(contextContract.policies.stateClearedPerExecution, true);
assert.equal(contextContract.planes.eventExecutionImplemented, true);
assert.equal(contextContract.planes.emitPublished, true);
assert.equal(contextContract.planes.emitJavascriptExecutionImplemented, true);
assert.equal(contextContract.planes.emitNativeExecutionImplemented, false);

const liveContract = runtimePulseLive.defaultRuntimePulseLiveContract();
assert.equal(liveContract.version, 'pulse.runtime-pulse-live-contract.v4');
assert.equal(liveContract.internalEventRuntimeVersion, 'pulse.javascript-event-runtime.v2');
assert.equal(liveContract.surfaces.some((entry) => entry.id === 'pulse.event-registration' && entry.status === 'implemented-static-and-javascript-direct'), true);
assert.equal(liveContract.surfaces.some((entry) => entry.id === 'runtime.event-execution' && entry.status === 'implemented-node-javascript-direct'), true);
assert.equal(liveContract.policies.pulseOwnsEventRegistration, true);
assert.equal(liveContract.policies.routerEventRegistration, false);
assert.equal(liveContract.policies.eventHandlersExecuted, true);
assert.equal(liveContract.policies.eventExecutionTarget, 'node-javascript-direct');
assert.equal(liveContract.policies.eventStateIsolatedPerInvocation, true);
assert.equal(liveContract.policies.eventEmitPublished, true);
assert.equal(liveContract.policies.eventEmitParallelEligible, true);
assert.equal(liveContract.policies.eventEmitAutomaticLoopback, false);

const vnextFiles = [
  path.join(runtimeRoot, 'test', 'vnext-types.ts'),
  path.join(runtimeRoot, 'test', 'vnext-types-negative.ts'),
  path.join(runtimeRoot, 'test', 'canon-types.ts'),
  path.join(runtimeRoot, 'test', 'canon-types-negative.ts'),
  path.join(runtimeRoot, 'test', 'host-types.ts'),
  path.join(pulseRoot, 'test', 'vnext-types.ts'),
  path.join(pulseRoot, 'test', 'vnext-types-negative.ts'),
  path.join(pulseRoot, 'test', 'canon-types.ts'),
  path.join(pulseRoot, 'test', 'canon-types-negative.ts'),
  path.join(gripRoot, 'test', 'vnext-types.ts')
];
const vnextProgram = ts.createProgram({
  rootNames: vnextFiles,
  options: {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    baseUrl: repoRoot,
    paths: {
      '@pulse-compute/runtime': ['packages/runtime/src/index.d.ts'],
      '@pulse-compute/pulse': ['packages/pulse/src/index.d.ts'],
      '@pulse-compute/grip/pulsewasm': ['packages/grip/src/pulsewasm.ts']
    },
    skipLibCheck: true,
    types: []
  }
});
assert.deepEqual(
  ts.getPreEmitDiagnostics(vnextProgram).map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, '\n')),
  [],
  'runtime and Pulse async-shaped positive and negative TypeScript contract fixtures must type-check'
);

console.log('ok - runtime owns one async provider-neutral type algebra and Pulse re-exports it without a second Router value');
