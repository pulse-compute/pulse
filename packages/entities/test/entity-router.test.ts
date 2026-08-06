import { describe, expect, expectTypeOf, it } from 'vitest';
import { EntityRouter, jsonRpc } from '../src/index.js';
import type {
  DeepReadonly,
  EntityDeclaration,
  EntityHandler,
  JsonRpcAdapter,
} from '../src/index.js';

interface Input {
  name: string;
  nested: { enabled: boolean };
}

interface Output {
  id: string;
}

function lookup(_ctx: never, input: DeepReadonly<Input>): Output {
  return { id: input.name };
}

describe('@pulse-compute/entities declaration surface', () => {
  it('creates one frozen first-party JSON-RPC adapter with bounded defaults', () => {
    const adapter = jsonRpc();
    expect(adapter).toMatchObject({
      version: 'pulse.entities-adapter.v1',
      id: 'json-rpc',
      adapterVersion: 'pulse.entities-json-rpc-adapter.v1',
      options: { namedParamsOnly: true, acceptEmptyObjectForNoInput: false },
    });
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.options)).toBe(true);
    expect(Object.isFrozen(adapter.limits)).toBe(true);
    expectTypeOf(adapter).toEqualTypeOf<JsonRpcAdapter>();
  });

  it('normalizes supported adapter options and rejects surface expansion', () => {
    expect(jsonRpc({ acceptEmptyObjectForNoInput: true }).options).toEqual({
      namedParamsOnly: true,
      acceptEmptyObjectForNoInput: true,
    });
    expect(() => jsonRpc({ namedParamsOnly: false as true })).toThrow(/namedParamsOnly/);
    expect(() => jsonRpc({ batch: true } as never)).toThrow(/unsupported fields: batch/);
  });

  it('records named registrations, returns this, and rejects duplicates', () => {
    const router = new EntityRouter({ adapter: jsonRpc() });
    const declaration: EntityDeclaration = {
      input: 'tools.LookupInput',
      output: 'tools.LookupOutput',
      metadata: { title: 'Lookup', tags: ['read', 'customer'] },
    };
    const handler = lookup as unknown as EntityHandler<Input, Output>;
    expect(router.on('customer.lookup', declaration, handler)).toBe(router);
    expect(() => router.on('customer.lookup', declaration, handler)).toThrow(/already registered/);
  });

  it('supports explicit no-input and no-output declarations', () => {
    const router = new EntityRouter({ adapter: jsonRpc({ acceptEmptyObjectForNoInput: true }) });
    function notify(): void {}
    expect(router.on('system.notify', { input: null, output: null }, notify)).toBe(router);
  });

  it('rejects malformed declarations, dynamic handlers, and invalid metadata', () => {
    const router = new EntityRouter({ adapter: jsonRpc() });
    function validHandler(): void {}
    expect(() => router.on('', { input: null, output: null }, validHandler)).toThrow(/non-empty/);
    expect(() => router.on('bad.schema', { input: 'missing-dot', output: null }, validHandler)).toThrow(/dotted schema ID/);
    expect(() => router.on('bad.handler', { input: null, output: null }, (() => {}) as never)).toThrow(/named function reference/);
    expect(() => router.on('bad.metadata', {
      input: null,
      output: null,
      metadata: { invalid: Number.NaN },
    }, validHandler)).toThrow(/must be finite/);
  });

  it('exposes only the terminal handle binding at package root', () => {
    const router = new EntityRouter({ adapter: jsonRpc() });
    expect(typeof router.handle).toBe('function');
    expect('handler' in router).toBe(false);
  });
});
