import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { bindEntitySchemaCodecBridge } from '../src/internal/schema-codec-bridge.js';

const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any };
const runtime = require('../../runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>;
};

function frozenInput(value: unknown): Readonly<Record<string, unknown>> {
  const input = value as Record<string, unknown>;
  return Object.freeze({
    name: String(input.name),
    nested: Object.freeze({ enabled: Boolean((input.nested as Record<string, unknown>).enabled) }),
  });
}

const codecs = Object.freeze({
  registry: Object.freeze({ contentTypePolicy: 'require-json', maxBytes: 256 }),
  ids: Object.freeze(['tools.Input', 'tools.Output']),
  has(schemaId: string) { return this.ids.includes(schemaId); },
  decodeJsonText(schemaId: string, text: string) {
    if (schemaId !== 'tools.Input' && schemaId !== 'tools.Output') throw new Error('unknown schema');
    return frozenInput(JSON.parse(text));
  },
  encodeJsonText(schemaId: string, value: unknown) {
    if (schemaId !== 'tools.Output') throw new Error('unknown schema');
    return JSON.stringify(frozenInput(value));
  },
  createTraceEvent(event: unknown) { return Object.freeze({ ...(event as Record<string, unknown>) }); },
});

describe('@pulse-compute/entities private schema codec bridge', () => {
  it('binds only the declared codec pair to the active managed request', async () => {
    const app = new Router();
    let publicKeys: readonly string[] = [];
    let decoded: Readonly<Record<string, unknown>> | undefined;
    let encoded = '';
    let capturedBridge: ReturnType<typeof bindEntitySchemaCodecBridge> | undefined;
    const traces: unknown[] = [];

    app.post('/rpc', async (ctx: any) => {
      const bridge = bindEntitySchemaCodecBridge(ctx, { input: 'tools.Input', output: 'tools.Output' });
      capturedBridge = bridge;
      publicKeys = Object.keys(bridge);
      decoded = bridge.decodeEmbeddedJson('tools.Input', '{"name":"Ada","nested":{"enabled":true},"ignored":"drop"}') as Readonly<Record<string, unknown>>;
      encoded = bridge.encodeEmbeddedJson('tools.Output', {
        name: 'Grace',
        nested: { enabled: false },
        ignored: 'drop',
      });
      expect(() => bridge.decodeEmbeddedJson('tools.Output', '{}')).toThrowError(expect.objectContaining({
        code: 'PULSE_RUNTIME_PACKAGE_SCHEMA_NOT_DECLARED',
      }));
      return ctx.text('ok');
    });

    const response = await runtime.executeRouter(app, new Request('https://example.test/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }), {
      schemaCodecs: codecs,
      strict: true,
      onJsonTrace(event: unknown) { traces.push(event); },
    });

    expect(await response.text()).toBe('ok');
    expect(publicKeys).toEqual(['decodeEmbeddedJson', 'encodeEmbeddedJson']);
    expect(decoded).toEqual({ name: 'Ada', nested: { enabled: true } });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.nested)).toBe(true);
    expect(encoded).toBe('{"name":"Grace","nested":{"enabled":false}}');
    expect(traces).toHaveLength(2);
    expect(() => capturedBridge!.encodeEmbeddedJson('tools.Output', {})).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
    }));
  });
});
