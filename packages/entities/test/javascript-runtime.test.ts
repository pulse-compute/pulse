import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EntityRouter, jsonRpc } from '../src/index.js';
import { snapshotEntityRouterCatalog } from '../src/entity-router.js';
import type { JsonRpcAdapter } from '../src/types.js';

const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any };
const runtime = require('../../runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>;
};
const entitiesRuntime = require('@pulse-compute/wasm-contracts/entities/runtime') as any;
const entitiesJsonRpc = require('@pulse-compute/wasm-contracts/entities/json-rpc') as any;
const catalogContracts = require('@pulse-compute/wasm-contracts/entities/catalog') as any;
const lowerer = require('../pulsewasm.compiler.cjs') as any;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface CodecEvidence {
  readonly decoded: string[];
  readonly encoded: string[];
}

function codecs(evidence: CodecEvidence = { decoded: [], encoded: [] }) {
  const ids = Object.freeze(['tools.LookupInput', 'tools.LookupOutput']);
  return Object.freeze({
    registry: Object.freeze({ contentTypePolicy: 'require-json', maxBytes: 32_768 }),
    ids,
    has(schemaId: string) { return ids.includes(schemaId); },
    decodeJsonText(schemaId: string, text: string) {
      evidence.decoded.push(schemaId);
      const value = JSON.parse(text) as Record<string, unknown>;
      if (!value || Array.isArray(value) || typeof value.name !== 'string') {
        throw new Error('secret input detail must stay private');
      }
      if (schemaId === 'tools.LookupOutput') {
        if (typeof value.id !== 'string') throw new Error('secret output trace detail must stay private');
        return Object.freeze({ id: value.id, name: value.name });
      }
      if (schemaId !== 'tools.LookupInput') throw new Error('unknown input schema');
      const nested = value.nested as Record<string, unknown> | undefined;
      return Object.freeze({
        name: value.name,
        nested: Object.freeze({ enabled: nested?.enabled === true }),
      });
    },
    encodeJsonText(schemaId: string, value: unknown) {
      evidence.encoded.push(schemaId);
      if (schemaId !== 'tools.LookupOutput') throw new Error('unknown output schema');
      const output = value as Record<string, unknown>;
      if (!output || typeof output.id !== 'string' || typeof output.name !== 'string') {
        throw new Error('secret output detail must stay private');
      }
      return JSON.stringify({ id: output.id, name: output.name });
    },
    createTraceEvent(event: unknown) { return Object.freeze({ ...(event as Record<string, unknown>) }); },
  });
}

function adapterWithLimits(limits: Readonly<Record<string, number>>): JsonRpcAdapter {
  return entitiesJsonRpc.createJsonRpcAdapter({}, {
    ...entitiesRuntime.ENTITIES_DEFAULT_LIMITS,
    ...limits,
  }) as JsonRpcAdapter;
}

async function dispatch(
  router: EntityRouter,
  body: string,
  options: Readonly<Record<string, unknown>> = {},
): Promise<Response> {
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
    maxRequestBodyBytes: 131_072,
    ...options,
  });
}

describe('@pulse-compute/entities I4 JavaScript runtime', () => {
  it('selects before decode, invokes once, and embeds schema-ordered output with the raw ID', async () => {
    const evidence: CodecEvidence = { decoded: [], encoded: [] };
    let calls = 0;
    let capturedInput: unknown;
    const router = new EntityRouter({ adapter: jsonRpc() });
    function lookup(_ctx: unknown, input: any) {
      calls += 1;
      capturedInput = input;
      return { name: input.name, id: `id:${input.name}`, ignored: 'drop' };
    }
    router.on('customer.lookup', {
      input: 'tools.LookupInput',
      output: 'tools.LookupOutput',
    }, lookup as never);

    const response = await dispatch(router, '{"jsonrpc":"2.0","method":"customer.lookup","params":{"name":"Ada","nested":{"enabled":true},"ignored":"drop"},"id":"req\\u002d1"}', {
      schemaCodecs: codecs(evidence),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('{"jsonrpc":"2.0","result":{"id":"id:Ada","name":"Ada"},"id":"req\\u002d1"}');
    expect(calls).toBe(1);
    expect(capturedInput).toEqual({ name: 'Ada', nested: { enabled: true } });
    expect(Object.isFrozen(capturedInput)).toBe(true);
    expect(Object.isFrozen((capturedInput as any).nested)).toBe(true);
    expect(evidence).toEqual({
      decoded: ['tools.LookupInput', 'tools.LookupOutput'],
      encoded: ['tools.LookupOutput'],
    });

    const unknown = await dispatch(router, '{"jsonrpc":"2.0","method":"customer.missing","params":{"name":"secret"},"id":7}', {
      schemaCodecs: codecs(evidence),
    });
    expect(await unknown.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not found' },
      id: 7,
    });
    expect(evidence.decoded).toEqual(['tools.LookupInput', 'tools.LookupOutput']);
  });

  it('uses result null for no-output requests and an empty 204 for synchronous notifications', async () => {
    let calls = 0;
    const router = new EntityRouter({
      adapter: jsonRpc({ acceptEmptyObjectForNoInput: true }),
    });
    function notify(_ctx: unknown, input: unknown): void {
      calls += 1;
      expect(input).toBeUndefined();
    }
    router.on('system.notify', { input: null, output: null }, notify as never);

    const request = await dispatch(router, '{"jsonrpc":"2.0","method":"system.notify","id":null}');
    expect(request.status).toBe(200);
    expect(await request.json()).toEqual({ jsonrpc: '2.0', result: null, id: null });

    const notification = await dispatch(router, '{"jsonrpc":"2.0","method":"system.notify","params":{ }}');
    expect(notification.status).toBe(204);
    expect(notification.headers.get('content-type')).toBeNull();
    expect(await notification.text()).toBe('');
    expect(calls).toBe(2);

    const strict = new EntityRouter({ adapter: jsonRpc() });
    let strictCalls = 0;
    function strictNotify(): void { strictCalls += 1; }
    strict.on('system.notify', { input: null, output: null }, strictNotify);
    const rejected = await dispatch(strict, '{"jsonrpc":"2.0","method":"system.notify","params":{},"id":1}');
    expect(await rejected.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32602, message: 'Invalid params' },
      id: 1,
    });
    expect(strictCalls).toBe(0);
  });

  it('maps protocol, input, execution, output, and size failures without sensitive values', async () => {
    const observations: any[] = [];
    const router = new EntityRouter({ adapter: jsonRpc() });
    function throwsSecret(): never { throw new Error('handler-secret-93fda'); }
    function invalidOutput() { return { id: 7, name: 'output-secret-f24c8' }; }
    function validOutput() { return { id: 'long-id', name: 'output' }; }
    router.on('secret.throw', { input: null, output: null }, throwsSecret);
    router.on('output.invalid', { input: null, output: 'tools.LookupOutput' }, invalidOutput as never);

    const malformed = await dispatch(router, '{"jsonrpc":', { onLogObservation(event: unknown) { observations.push(event); } });
    expect(await malformed.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
    const invalidEnvelope = await dispatch(router, '[]');
    expect((await invalidEnvelope.json()).error).toEqual({ code: -32600, message: 'Invalid Request' });
    const positional = await dispatch(router, '{"jsonrpc":"2.0","method":"secret.throw","params":["input-secret"],"id":"p"}');
    expect((await positional.json()).error).toEqual({ code: -32602, message: 'Invalid params' });

    const execution = await dispatch(router, '{"jsonrpc":"2.0","method":"secret.throw","id":"e"}', {
      onLogObservation(event: unknown) { observations.push(event); },
    });
    const executionText = await execution.text();
    expect(JSON.parse(executionText).error).toEqual({ code: -32603, message: 'Internal error' });
    expect(executionText).not.toContain('handler-secret-93fda');

    const invalid = await dispatch(router, '{"jsonrpc":"2.0","method":"output.invalid","id":"o"}');
    const invalidText = await invalid.text();
    expect(JSON.parse(invalidText).error).toEqual({ code: -32603, message: 'Internal error' });
    expect(invalidText).not.toContain('output-secret-f24c8');

    const limited = new EntityRouter({ adapter: adapterWithLimits({ maxOutputBytes: 8 }) });
    limited.on('output.large', { input: null, output: 'tools.LookupOutput' }, validOutput as never);
    const oversized = await dispatch(limited, '{"jsonrpc":"2.0","method":"output.large","id":9}');
    expect((await oversized.json()).error).toEqual({ code: -32603, message: 'Internal error' });

    const serializedEvidence = JSON.stringify(observations);
    expect(serializedEvidence).not.toContain('handler-secret-93fda');
    expect(serializedEvidence).not.toContain('input-secret');
    expect(serializedEvidence).toContain('execution-failed');
  });

  it('contains recursive dispatch before a second handler invocation', async () => {
    let calls = 0;
    let recursiveResponse: Response | undefined;
    const router = new EntityRouter({ adapter: jsonRpc() });
    async function recursive(ctx: any): Promise<void> {
      calls += 1;
      recursiveResponse = await router.handle(ctx);
    }
    router.on('system.recursive', { input: null, output: null }, recursive as never);

    const response = await dispatch(router, '{"jsonrpc":"2.0","method":"system.recursive","id":4}');
    expect(await response.json()).toEqual({ jsonrpc: '2.0', result: null, id: 4 });
    expect(calls).toBe(1);
    expect(await recursiveResponse!.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: null,
    });
  });

  it('produces the same deterministic catalog identity as the I2 compiler catalog', () => {
    function alphaHandler(): void {}
    function betaHandler(): void {}
    const router = new EntityRouter({ adapter: jsonRpc() });
    router.on('beta.notify', {
      input: null,
      output: null,
      metadata: { title: 'Beta', tags: ['notify', 'bounded'] },
    }, betaHandler);
    router.on('alpha.lookup', {
      input: 'tools.LookupInput',
      output: 'tools.LookupOutput',
      metadata: { title: 'Alpha', nested: { order: 1 } },
    }, alphaHandler as never);

    const sourceText = `import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
function alphaHandler() {}
function betaHandler() {}
const rpc = new EntityRouter({ adapter: jsonRpc() })
rpc.on('beta.notify', {
  input: null,
  output: null,
  metadata: { title: 'Beta', tags: ['notify', 'bounded'] },
}, betaHandler)
rpc.on('alpha.lookup', {
  input: 'tools.LookupInput',
  output: 'tools.LookupOutput',
  metadata: { title: 'Alpha', nested: { order: 1 } },
}, alphaHandler)
export default function handler(ctx) { return rpc.handle(ctx) }
`;
    const compiler = lowerer.buildEntitiesLoweringPlan({
      cwd: repoRoot,
      sourcePath: 'src/catalog.ts',
      sourceText,
      schemaBundle: {
        declaredSchemaIds: ['tools.LookupInput', 'tools.LookupOutput'],
        registry: { schemas: [{ id: 'tools.LookupInput' }, { id: 'tools.LookupOutput' }] },
      },
    });
    const runtimeCatalog = catalogContracts.normalizeEntityCatalog(
      snapshotEntityRouterCatalog(router, 'rpc'),
    );

    expect(compiler.artifact.status).toBe('ok');
    expect(runtimeCatalog).toEqual(compiler.artifact.catalog);
    expect(runtimeCatalog.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(runtimeCatalog)).not.toContain('Handler');
  });
});
