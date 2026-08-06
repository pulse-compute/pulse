import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { Router } = require('../src/index.js') as { Router: new () => any }
const runtime = require('../src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>
}
const packageRuntime = require('../src/package.js') as {
  PACKAGE_RUNTIME_BRIDGE_VERSION: string
  PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION: string
  TRUSTED_PACKAGE_EFFECT_CATALOG: Readonly<Record<string, unknown>>
  clonePackageEffectPayload(value: Record<string, unknown>, limits?: Record<string, number>): Readonly<Record<string, unknown>>
  createPackageRuntime(definition: Record<string, unknown>): {
    context(ctx: object): {
      request: Request
      params: Readonly<Record<string, string>>
      path: { absolute: string; relative: string }
      signal?: AbortSignal
    }
    effect(ctx: object, operation: string, payload?: Record<string, unknown>): Promise<unknown>
  }
  createPackageSchemaCodecRuntime(definition: Record<string, unknown>): {
    version: string
    bind(ctx: object, declaration: { input: string | null; output: string | null }): {
      decodeEmbeddedJson(schemaId: string, text: string): unknown
      encodeEmbeddedJson(schemaId: string, value: unknown): string
    }
  }
}

const assetsRuntimeDefinition = Object.freeze({
  package: '@pulse-compute/assets',
  contractId: 'pulse.assets',
  providerKind: 'assets',
  operations: Object.freeze({
    lookup: Object.freeze({
      kind: 'assets.lookup',
      capability: 'assets.lookup',
      result: 'asset',
    }),
  }),
})

function createAssetsRuntime() {
  return packageRuntime.createPackageRuntime(assetsRuntimeDefinition)
}

describe('@pulse-compute/runtime trusted package bridge', () => {
  it('binds a bodyless request metadata view and scoped path to an explicit managed context', async () => {
    const app = new Router()
    const assets = createAssetsRuntime()
    let seenRequest: Request | undefined
    let seenSignal: AbortSignal | undefined

    app.use('/assets/:tenant', async (ctx: any) => {
      const view = assets.context(ctx)
      seenRequest = view.request
      seenSignal = view.signal
      return ctx.json({
        absolute: view.path.absolute,
        relative: view.path.relative,
        tenant: view.params.tenant,
        requestUrl: view.request.url,
        requestMethod: view.request.method,
        requestHeader: view.request.headers.get('x-package-test'),
        requestBodyExposed: view.request.body !== null,
        lifecycleSignalAborted: view.signal?.aborted ?? false,
      })
    })

    const request = new Request('https://example.test/assets/acme/js/app.js?v=1', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-package-test': 'metadata',
      },
      body: 'application-owned-body',
    })
    const response = await runtime.executeRouter(app, request)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      absolute: '/assets/acme/js/app.js',
      relative: '/js/app.js',
      tenant: 'acme',
      requestUrl: 'https://example.test/assets/acme/js/app.js?v=1',
      requestMethod: 'POST',
      requestHeader: 'metadata',
      requestBodyExposed: false,
      lifecycleSignalAborted: false,
    })
    expect(seenRequest).toBeInstanceOf(Request)
    expect(seenRequest).not.toBe(request)
    expect(seenRequest?.body).toBeNull()
    expect(seenSignal?.aborted).toBe(false)
    await expect(seenRequest!.text()).rejects.toMatchObject({
      code: 'PULSE_RUNTIME_PACKAGE_REQUEST_BODY_UNAVAILABLE',
    })
    const cloned = seenRequest!.clone()
    expect(cloned).not.toBe(seenRequest)
    expect(cloned.url).toBe(seenRequest!.url)
    expect(cloned.method).toBe(seenRequest!.method)
    expect(cloned.body).toBeNull()
    await expect(cloned.json()).rejects.toMatchObject({
      code: 'PULSE_RUNTIME_PACKAGE_REQUEST_BODY_UNAVAILABLE',
    })
  })

  it('dispatches package effects through the request-owned adapter and ctx.parallel', async () => {
    const app = new Router()
    const assets = createAssetsRuntime()
    const descriptors: any[] = []
    const observations: any[] = []

    app.get('/direct/:name', async (ctx: any) => {
      const result = await assets.effect(ctx, 'lookup', {
        store: 'public',
        key: `/${ctx.param('name')}`,
      })
      return ctx.json(result)
    })
    app.get('/asset/:name', async (ctx: any) => {
      const lookup = assets.effect(ctx, 'lookup', {
        store: 'public',
        key: `/${ctx.param('name')}`,
        options: { integrity: true },
      })
      const result = await ctx.parallel({
        asset: lookup,
        mode: ctx.config.get('MODE'),
      })
      return ctx.json(result)
    })

    const executionOptions = {
      capabilities: {
        config: async (name: string) => name === 'MODE' ? 'test' : undefined,
        effect: async (descriptor: any) => {
          descriptors.push(descriptor)
          return Object.freeze({ found: true, key: descriptor.payload.key })
        },
      },
      onEffectObservation: (observation: unknown) => observations.push(observation),
    }

    const directResponse = await runtime.executeRouter(
      app,
      new Request('https://example.test/direct/direct.js'),
      executionOptions,
    )
    expect(directResponse.status).toBe(200)
    expect(await directResponse.json()).toEqual({ found: true, key: '/direct.js' })
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({ kind: 'assets.lookup', operation: 'lookup' })
    descriptors.length = 0
    observations.length = 0

    const response = await runtime.executeRouter(
      app,
      new Request('https://example.test/asset/app.js'),
      executionOptions,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      asset: { found: true, key: '/app.js' },
      mode: 'test',
    })
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({
      package: '@pulse-compute/assets',
      contractId: 'pulse.assets',
      kind: 'assets.lookup',
      providerKind: 'assets',
      operation: 'lookup',
      capability: 'assets.lookup',
      result: 'asset',
      payload: {
        store: 'public',
        key: '/app.js',
        options: { integrity: true },
      },
    })
    expect(Object.isFrozen(descriptors[0].payload)).toBe(true)
    expect(Object.isFrozen(descriptors[0].payload.options)).toBe(true)

    const dispatched = observations.filter((entry) => entry.type === 'effect-dispatched')
    expect(dispatched.map((entry) => entry.effect.kind)).toEqual(['assets.lookup', 'config.get'])
    expect(dispatched[0].effect).toMatchObject({
      package: '@pulse-compute/assets',
      contractId: 'pulse.assets',
    })
    expect(JSON.stringify(observations)).not.toContain('/app.js')
    expect(observations.some((entry) => entry.type === 'parallel-dispatched')).toBe(true)
  })

  it('clones payloads without invoking accessors and rejects nonportable data', () => {
    const source = { nested: { value: 1 }, list: ['a', 'b'] }
    const cloned = packageRuntime.clonePackageEffectPayload(source)
    expect(cloned).toEqual(source)
    expect(cloned).not.toBe(source)
    expect(cloned.nested).not.toBe(source.nested)
    expect(Object.isFrozen(cloned)).toBe(true)
    expect(Object.isFrozen(cloned.nested)).toBe(true)
    expect(Object.isFrozen(cloned.list)).toBe(true)

    let accessorCalled = false
    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'token', {
      enumerable: true,
      get() {
        accessorCalled = true
        return 'must-not-run'
      },
    })
    expect(() => packageRuntime.clonePackageEffectPayload(accessor)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(accessorCalled).toBe(false)

    const protoKey: Record<string, unknown> = Object.create(null)
    Object.defineProperty(protoKey, '__proto__', {
      enumerable: true,
      value: { polluted: true },
    })
    const clonedProtoKey = packageRuntime.clonePackageEffectPayload(protoKey)
    expect(Object.prototype.hasOwnProperty.call(clonedProtoKey, '__proto__')).toBe(true)
    expect((clonedProtoKey as any).__proto__).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(clonedProtoKey)).toBe(Object.prototype)
    expect(({} as any).polluted).toBeUndefined()

    let arrayAccessorCalled = false
    const arrayAccessor: unknown[] = []
    Object.defineProperty(arrayAccessor, '0', {
      enumerable: true,
      get() {
        arrayAccessorCalled = true
        return 'must-not-run'
      },
    })
    expect(() => packageRuntime.clonePackageEffectPayload({ value: arrayAccessor })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(arrayAccessorCalled).toBe(false)

    const repeated = { value: true }
    expect(() => packageRuntime.clonePackageEffectPayload({ first: repeated, second: repeated })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(() => packageRuntime.clonePackageEffectPayload({ value: Number.NaN })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(() => packageRuntime.clonePackageEffectPayload([] as unknown as Record<string, unknown>)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(() => packageRuntime.clonePackageEffectPayload({ value: '1234' }, { maxBytes: 4 })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(() => packageRuntime.clonePackageEffectPayload({ nested: { value: true } }, { maxDepth: 1 })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
    expect(() => packageRuntime.clonePackageEffectPayload({ first: true, second: true }, { maxEntries: 1 })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_PAYLOAD_INVALID',
    }))
  })

  it('keeps registration first-party and request-bound', async () => {
    expect(packageRuntime.PACKAGE_RUNTIME_BRIDGE_VERSION).toBe('pulse.package-runtime-bridge.v1')
    expect(Object.isFrozen(packageRuntime.TRUSTED_PACKAGE_EFFECT_CATALOG)).toBe(true)
    expect(() => packageRuntime.createPackageRuntime({
      package: '@example/arbitrary-effects',
      contractId: 'example.effects',
      providerKind: 'example',
      operations: { run: { kind: 'example.run', capability: 'example.run', result: 'value' } },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_RUNTIME_PACKAGE_EFFECT_UNTRUSTED' }))

    const assets = createAssetsRuntime()
    expect(() => assets.context({})).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED',
    }))
    expect(() => assets.effect({}, 'lookup', { store: 'public', key: '/app.js' })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED',
    }))

    const app = new Router()
    let capturedContext: any
    app.get('/capture', async (ctx: any) => {
      capturedContext = ctx
      return ctx.text('ok')
    })
    const response = await runtime.executeRouter(app, new Request('https://example.test/capture'))
    expect(await response.text()).toBe('ok')
    expect(() => assets.effect(capturedContext, 'lookup', { store: 'public', key: '/late.js' })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_EFFECT_EXECUTION_CLOSED',
    }))
    expect(() => assets.effect(capturedContext, 'missing', {})).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_EFFECT_OPERATION_UNSUPPORTED',
    }))
  })

  it('keeps package schema codec authority first-party and request-bound', async () => {
    expect(packageRuntime.PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION).toBe('pulse.first-party-embedded-schema-codec-bridge.v1')
    expect(() => packageRuntime.createPackageSchemaCodecRuntime({
      package: '@example/arbitrary-schema-consumer',
      contractId: 'example.schemas',
    })).toThrowError(expect.objectContaining({ code: 'PULSE_RUNTIME_PACKAGE_SCHEMA_BRIDGE_UNTRUSTED' }))

    const schemas = packageRuntime.createPackageSchemaCodecRuntime({
      package: '@pulse-compute/entities',
      contractId: 'pulse.entities',
    })
    expect(schemas.version).toBe(packageRuntime.PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION)
    expect(() => schemas.bind({}, { input: 'app.input', output: 'app.output' })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PACKAGE_CONTEXT_REQUIRED',
    }))
  })
})
