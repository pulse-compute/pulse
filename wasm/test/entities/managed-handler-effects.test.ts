import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assets } from '../../../packages/assets/src/index.js';
import { EntityRouter, jsonRpc } from '../../../packages/entities/src/index.js';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = path.join(repoRoot, 'wasm/test/fixtures/projects/entities-managed-handler-effects');
const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs') as any;
const graphApi = require('../../packages/compiler/src/project/reachable-graph-builder.js') as any;
const packageSeam = require('../../packages/compiler/src/spine/package-operation-seam.js') as any;
const managed = require('../../packages/compiler/src/spine/handler-ir-managed.js') as any;
const providerAuthority = require('../../packages/compiler/src/spine/provider-requirement-authority.js') as any;
const { Router } = require('../../../packages/runtime/src/index.js') as { Router: new () => any };
const runtime = require('../../../packages/runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>;
};

const schemaIds = Object.freeze(['tools.LookupInput', 'tools.LookupOutput']);

function schemaBundle() {
  return Object.freeze({
    declaredSchemaIds: schemaIds,
    schemaIds,
    registry: Object.freeze({ schemas: Object.freeze(schemaIds.map((id) => Object.freeze({ id }))) }),
  });
}

function descriptorFromEntry(entry: any) {
  const start = entry.loc?.start ?? { line: 1, column: 1 };
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.router}:${entry.discriminator}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: entry.loc.file, line: start.line, column: start.column }),
    source: Object.freeze({
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName,
    }),
    input: Object.freeze({
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema,
    }),
    result: Object.freeze({
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema,
    }),
  });
}

function packageRecognitionForGraph(graphBuild: any, projectRoot: string) {
  const context = graphApi.projectGraphContext(graphBuild);
  const recognitions: any[] = [];
  for (const module of [...context.projectModules.values()]
    .filter((entry: any) => entry.runtime)
    .sort((left: any, right: any) => left.path.localeCompare(right.path))) {
    const selectedContracts = new Set<string>();
    for (const relation of [...module.imports, ...module.reExports]) {
      if (relation.kind === 'type-import' || relation.typeOnly === true) continue;
      const resolution = module.resolutions.find((entry: any) => entry.relation === relation);
      const target = resolution && context.packageModules.get(resolution.targetKey);
      if (target?.packageContract) selectedContracts.add(target.packageContract);
    }
    if (selectedContracts.size === 0) continue;
    const recognition = packageSeam.recognizeProjectPackageOperations(module.absolutePath, {
      rootDir: projectRoot,
      workspaceRoot: repoRoot,
      sourceText: module.sourceText,
      sourceName: module.path,
      publicSourceName: module.path,
      selectedContracts: [...selectedContracts].sort(),
      schemaBundle: schemaBundle(),
    });
    expect(recognition.errors).toEqual([]);
    recognitions.push(recognition);
  }
  return packageSeam.combinePackageOperationRecognitions(recognitions);
}

function compileFixture() {
  const entryFile = path.join(fixture, 'src/index.ts');
  const graphBuild = graphApi.buildReachableProjectGraph(entryFile, {
    rootDir: fixture,
    workspaceRoot: repoRoot,
    configFile: path.join(fixture, 'tsconfig.json'),
  });
  const lowered = entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: fixture,
    sourcePath: entryFile,
    sourceText: fs.readFileSync(entryFile, 'utf8'),
    schemaBundle: schemaBundle(),
  });
  expect(lowered.hasErrors).toBe(false);
  const descriptors = lowered.entries.map(descriptorFromEntry);
  const packageOperationRecognition = packageRecognitionForGraph(graphBuild, fixture);
  const bundle = managed.compileManagedHandlerDescriptors({
    graphBuild,
    descriptors,
    packageOperationRecognition,
  });
  return Object.freeze({ graphBuild, descriptors, packageOperationRecognition, bundle });
}

function walkOperationKinds(operation: any, out: string[] = []) {
  if (!operation || typeof operation !== 'object') return out;
  if (typeof operation.kind === 'string') out.push(operation.kind);
  if (operation.kind === 'block') for (const child of operation.statements ?? []) walkOperationKinds(child, out);
  if (operation.kind === 'if') {
    walkOperationKinds(operation.thenOperation, out);
    walkOperationKinds(operation.elseOperation, out);
  }
  return out;
}

function descriptorFor(exportName: string, id = `negative:${exportName}`) {
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: 'src/index.ts', line: 1, column: 1 }),
    source: Object.freeze({ file: 'src/handlers.js', exportName, localName: exportName }),
    input: Object.freeze({ kind: 'schema-value', schemaId: 'tools.LookupInput' }),
    result: Object.freeze({ kind: 'schema-value', schemaId: 'tools.LookupOutput' }),
  });
}

function expectCodes(base: ReturnType<typeof compileFixture>, descriptors: any[], expected: string[]) {
  expect(() => managed.compileManagedHandlerDescriptors({
    graphBuild: base.graphBuild,
    descriptors,
    packageOperationRecognition: base.packageOperationRecognition,
  })).toThrowError(expect.objectContaining({
    code: 'PULSE_MANAGED_HANDLER_COMPILE_FAILED',
    diagnostics: expect.arrayContaining(expected.map((code) => expect.objectContaining({ code }))),
  }));
}

function codecs() {
  return Object.freeze({
    registry: Object.freeze({ contentTypePolicy: 'require-json', maxBytes: 32_768 }),
    ids: schemaIds,
    has(schemaId: string) { return schemaIds.includes(schemaId); },
    decodeJsonText(schemaId: string, text: string) {
      const value = JSON.parse(text);
      if (schemaId === 'tools.LookupInput') return Object.freeze({ id: String(value.id) });
      if (schemaId === 'tools.LookupOutput') return Object.freeze({ ...value });
      throw new Error('unknown schema');
    },
    encodeJsonText(schemaId: string, value: unknown) {
      if (schemaId !== 'tools.LookupOutput') throw new Error('unknown schema');
      return JSON.stringify(value);
    },
    createTraceEvent(event: unknown) { return Object.freeze({ ...(event as Record<string, unknown>) }); },
  });
}

async function dispatch(
  router: EntityRouter,
  body: string,
  options: Readonly<Record<string, unknown>> = {},
) {
  const app = new Router();
  app.post('/rpc', async (ctx: any) => router.handle(ctx));
  return runtime.executeRouter(app, new Request('https://entities.test/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }), {
    schemaCodecs: codecs(),
    strict: true,
    target: 'javascript',
    provider: 'node',
    reporting: 'debug',
    ...options,
  });
}

describe('I6 effectful managed handlers', () => {
  it('projects only declared reachable canonical effects and exact provider requirements', () => {
    const positive = compileFixture();
    const reordered = managed.compileManagedHandlerDescriptors({
      graphBuild: positive.graphBuild,
      descriptors: [...positive.descriptors].reverse(),
      packageOperationRecognition: positive.packageOperationRecognition,
    });
    expect(reordered).toEqual(positive.bundle);
    const nativeBundle = managed.compileManagedHandlerNativeBundle(positive.bundle);
    expect(nativeBundle).toMatchObject({
      version: managed.MANAGED_HANDLER_NATIVE_BUNDLE_VERSION,
      handlerIrBundleVersion: managed.MANAGED_HANDLER_IR_BUNDLE_VERSION,
      handlerIrVersion: managed.MANAGED_HANDLER_IR_VERSION,
      nativeFactsVersion: managed.MANAGED_HANDLER_NATIVE_FACTS_VERSION,
      policy: {
        genericDataOnly: true,
        sourceAstExcluded: true,
        packageSemanticsExcluded: true,
        publicHandlerIrVersionFrozen: true,
        automaticFallback: false,
      },
      summary: { handlers: 2, effects: 6, continuations: 5 },
    });
    expect(managed.compileManagedHandlerNativeBundle(reordered)).toEqual(nativeBundle);
    expect(positive.bundle.version).toBe(managed.MANAGED_HANDLER_IR_BUNDLE_VERSION);
    expect(positive.bundle.handlerIrVersion).toBe(managed.MANAGED_HANDLER_IR_VERSION);
    expect(positive.bundle.summary).toMatchObject({
      handlers: 2,
      effects: 6,
      continuations: 5,
      capabilities: 9,
      nativeEligible: 2,
    });
    expect(positive.bundle.reachability).toMatchObject({
      version: managed.MANAGED_HANDLER_REACHABILITY_VERSION,
      scope: 'declared-reachable-managed-handlers',
      policy: {
        staticHandlerTable: true,
        selectedHandlerExecutesAtRuntime: true,
        undeclaredHandlersExcluded: true,
        recursiveDispatch: false,
        dynamicDispatch: false,
      },
    });
    expect(positive.bundle.reachability.capabilities).toEqual([
      'assets.lookup',
      'config.get',
      'fetch',
      'kv.get',
      'kv.put',
      'logging',
      'schema.decode',
      'schema.encode',
      'secret.get',
    ]);
    expect(positive.bundle.reachability.packages).toEqual([{
      handlerId: 'rpc:customer.lookup',
      contractId: 'pulse.assets',
      import: '@pulse-compute/assets',
      package: '@pulse-compute/assets',
    }]);

    const lookup = positive.bundle.handlers.find((entry: any) => entry.id === 'rpc:customer.lookup');
    const notify = positive.bundle.handlers.find((entry: any) => entry.id === 'rpc:system.notify');
    expect(lookup.effects.sites.map((entry: any) => entry.kind)).toEqual([
      'config.get',
      'kv.get',
      'fetch',
      'kv.put',
      'assets.lookup',
    ]);
    expect(lookup.effects.continuations).toHaveLength(4);
    expect(lookup.effects.logging).toEqual([
      expect.objectContaining({ id: 'logging-1', capability: 'logging', level: 'info' }),
    ]);
    expect(lookup.effects.packageOperations).toHaveLength(1);
    expect(lookup.effects.packageOperations[0]).toMatchObject({
      contractId: 'pulse.assets',
      kind: 'assets.lookup',
      payload: { store: 'public', key: '/app.js', method: 'HEAD' },
    });
    expect(walkOperationKinds(lookup.body)).toEqual(expect.arrayContaining([
      'local', 'parallel', 'effect', 'logging', 'schema-result',
    ]));
    expect(lookup.effectPlan).toMatchObject({
      version: managed.MANAGED_HANDLER_EFFECT_PLAN_VERSION,
      handlerId: 'rpc:customer.lookup',
      ownership: { providerNeutral: true },
    });
    expect(lookup.providerRequirements).toMatchObject({
      version: providerAuthority.PROVIDER_REQUIREMENT_RECORD_VERSION,
      planVersion: managed.MANAGED_HANDLER_EFFECT_PLAN_VERSION,
      planHash: lookup.effectPlan.planHash,
      providerNeutral: true,
      capabilities: [
        'assets.lookup',
        'config.get',
        'fetch',
        'kv.get',
        'kv.put',
        'logging',
        'schema.decode',
        'schema.encode',
      ],
      providerKinds: ['assets', 'config', 'fetch', 'kv'],
      hostCapabilities: ['assets', 'headers', 'result'],
    });
    expect(lookup.providerRequirements.operations.map((entry: any) => entry.source.handlerId))
      .toEqual(Array(5).fill('rpc:customer.lookup'));
    expect(lookup.providerRequirements.packageOperationIds).toHaveLength(1);
    expect(notify.effects.sites.map((entry: any) => entry.kind)).toEqual(['secret.get']);
    expect(notify.providerRequirements.capabilities).toEqual(['logging', 'secret.get']);
    expect(notify.providerRequirements.providerKinds).toEqual(['secret']);
    expect(notify.effects.logging[0]).toMatchObject({ level: 'debug' });

    const nativeLookup = nativeBundle.handlers.find((entry: any) => entry.id === 'rpc:customer.lookup');
    const nativeNotify = nativeBundle.handlers.find((entry: any) => entry.id === 'rpc:system.notify');
    expect(nativeLookup.effects.runtimeInputs.map((entry: any) => [
      entry.effectId,
      entry.inputs.map((input: any) => input.name),
    ])).toEqual([
      ['config-1', ['name']],
      ['kv-get-1', ['store', 'key']],
      ['fetch-1', ['url', 'decoderArgument0']],
      ['kv-put-1', ['store', 'key', 'value']],
      ['assets-lookup-1', []],
    ]);
    expect(nativeNotify.effects.runtimeInputs.map((entry: any) => [
      entry.effectId,
      entry.inputs.map((input: any) => input.name),
    ])).toEqual([['secret-1', ['name']]]);
    expect(JSON.stringify(nativeBundle)).not.toMatch(/SyntaxKind|sourceFile|typeChecker|EntityRouter|jsonRpc/);

    const serialized = JSON.stringify(positive.bundle);
    expect(serialized).not.toContain('UNREACHABLE_CONFIG');
    expect(serialized).not.toContain('/unreachable.js');
    for (const handler of positive.bundle.handlers) {
      const canonical = managed.canonicalHandlerIrForManagedHandler(handler);
      expect(canonical.effectSites).toEqual(handler.effects.sites);
      expect(canonical.continuationSites).toEqual(handler.effects.continuations);
      expect(handler.eligibility).toMatchObject({
        scope: 'handler-syntax',
        inspectionScope: 'declared-handler-effects',
        inspected: true,
        packageTargetPromotion: false,
        javascript: { eligible: true },
        native: { eligible: true },
      });
    }

    expectCodes(positive, [descriptorFor('recursiveManagedCall')], [
      'PULSE_MANAGED_HANDLER_RECURSION_UNSUPPORTED',
    ]);
    expectCodes(positive, [
      descriptorFor('directManagedCall'),
      descriptorFor('lookupCustomer', 'negative:lookup-target'),
    ], ['PULSE_MANAGED_HANDLER_DIRECT_CALL_UNSUPPORTED']);
    expectCodes(positive, [descriptorFor('dynamicPromise')], [
      'PULSE_NATIVE_AWAIT_UNSUPPORTED',
    ]);
    expectCodes(positive, [descriptorFor('unsupportedTypeScript')], [
      'PULSE_CANONICAL_CONTROL_FLOW_UNSUPPORTED',
    ]);
  });

  it('executes existing request-owned effects only in the selected Node-hosted entity handler', async () => {
    const effectObservations: any[] = [];
    const logObservations: any[] = [];
    const dispatched: any[] = [];
    const stores = new Map<string, Map<string, unknown>>([
      ['users', new Map([['7', Object.freeze({ name: 'stored' })]])],
    ]);
    let lookupCalls = 0;
    let notifyCalls = 0;
    let handlerFailure: unknown;
    const router = new EntityRouter({ adapter: jsonRpc() });

    async function lookup(ctx: any, input: { readonly id: string }) {
      lookupCalls += 1;
      try {
        const users = ctx.kv('users');
        const { mode, current } = await ctx.parallel({
          mode: ctx.config.get('MODE'),
          current: users.get(input.id),
        });
        const remote = await ctx.fetch(`https://users.example.test/${input.id}`).json('tools.LookupOutput');
        await ctx.kv('users').put(input.id, { current, remote });
        const asset = await assets.lookup(ctx, 'public', '/app.js', { method: 'HEAD' });
        ctx.log.info('managed lookup complete', { id: input.id, assetStatus: asset.status });
        return { id: input.id, mode, current, remote, assetStatus: asset.status };
      } catch (error) {
        handlerFailure = error;
        throw error;
      }
    }
    async function notify(ctx: any) {
      notifyCalls += 1;
      await ctx.secret.get('TOKEN');
    }
    router.on('customer.lookup', { input: 'tools.LookupInput', output: 'tools.LookupOutput' }, lookup as never);
    router.on('system.notify', { input: null, output: null }, notify as never);

    const response = await dispatch(router, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"id":"7"},"id":"req-7"}', {
      capabilities: {
        config: async (name: string) => name === 'MODE' ? 'test' : undefined,
        secret: async () => 'must-not-be-read',
        kv(namespace: string) {
          const store = stores.get(namespace) ?? new Map<string, unknown>();
          stores.set(namespace, store);
          return {
            async get(key: string) { return store.get(key); },
            async put(key: string, value: unknown) { store.set(key, value); return true; },
          };
        },
        async fetch(url: string) {
          return new Response(JSON.stringify({ name: `remote:${url.split('/').at(-1)}` }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
        async effect(descriptor: any) {
          dispatched.push(descriptor);
          if (descriptor.kind === 'assets.lookup') return new Response(null, { status: 204 });
          throw new Error(`unexpected package effect ${descriptor.kind}`);
        },
      },
      onEffectObservation(observation: unknown) { effectObservations.push(observation); },
      onLogObservation(observation: unknown) { logObservations.push(observation); },
    });

    expect(response.status).toBe(200);
    expect(handlerFailure).toBeUndefined();
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      result: {
        id: '7',
        mode: 'test',
        current: { name: 'stored' },
        remote: { name: 'remote:7' },
        assetStatus: 204,
      },
      id: 'req-7',
    });
    expect(lookupCalls).toBe(1);
    expect(notifyCalls).toBe(0);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      package: '@pulse-compute/assets',
      contractId: 'pulse.assets',
      kind: 'assets.lookup',
      providerKind: 'assets',
      operation: 'lookup',
      capability: 'assets.lookup',
      payload: { store: 'public', key: '/app.js', method: 'HEAD' },
    });
    const effectKinds = effectObservations
      .filter((entry) => entry.type === 'effect-dispatched')
      .map((entry) => entry.effect.kind);
    expect(effectKinds).toEqual(['request.body.text', 'config.get', 'kv.get', 'fetch', 'kv.put', 'assets.lookup']);
    expect(effectKinds).not.toContain('secret.get');
    expect(effectObservations.some((entry) => entry.type === 'parallel-dispatched')).toBe(true);
    expect(logObservations.some((entry) => entry.level === 'info' || entry.type === 'log')).toBe(true);
    expect(stores.get('users')?.get('7')).toEqual({
      current: { name: 'stored' },
      remote: { name: 'remote:7' },
    });
  });

  it('contains selected-handler effect failures through the existing adapter error path', async () => {
    const observations: any[] = [];
    const router = new EntityRouter({ adapter: jsonRpc() });
    async function failingLookup(ctx: any) {
      await ctx.fetch('https://users.example.test/fail').json();
      return { id: 'unreachable' };
    }
    router.on('customer.lookup', { input: 'tools.LookupInput', output: 'tools.LookupOutput' }, failingLookup as never);
    const response = await dispatch(router, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"id":"7"},"id":9}', {
      capabilities: {
        async fetch() { throw new Error('upstream-secret-71f'); },
      },
      onEffectObservation(observation: unknown) { observations.push(observation); },
    });
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: 9,
    });
    expect(text).not.toContain('upstream-secret-71f');
    expect(observations.some((entry) => entry.type === 'effect-settled' && entry.status === 'rejected')).toBe(true);
  });
});
