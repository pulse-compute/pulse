import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = require('../src/index.js') as Record<string, unknown>
const { Pulse } = require('../../pulse/src/index.js') as { Pulse: new (options: { auto: true }) => any }
const host = require('../src/host.js') as {
  RUNTIME_HOST_API_VERSION: string
  JAVASCRIPT_EFFECT_PROTOCOL_VERSION: string
  JAVASCRIPT_EFFECT_ADAPTER_VERSION: string
  JAVASCRIPT_EFFECT_OBSERVATION_VERSION: string
  EVENT_ADAPTER_VERSION: string
  EVENT_ADAPTER_SEMANTICS: Record<string, unknown>
  createEventRecordingAdapter(options?: Record<string, unknown>): any
  createJavascriptEffectExecution(options?: Record<string, unknown>): any
  isPulseJavascriptEffect(value: unknown): boolean
  assertRouterApplication(value: unknown): object
  normalizeApplication(value: unknown): object
  executeApplication(application: unknown, request: Request, options?: Record<string, unknown>): Promise<Response>
  executeEvent(application: unknown, frame: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, any>>
  isRouterApplication(value: unknown): boolean
  createOpaqueFetchResponse(input?: Record<string, unknown>): any
  isPulseFetchResponse(value: unknown): boolean
  markOpaqueResponse(response: Response): Response
  responseBodyClass(response: Response): 'structured' | 'opaque'
  responseHeaderPairs(response: Response): readonly (readonly [string, string])[]
  cloneKvValue<T>(value: T, options?: Record<string, unknown>): T
  normalizeBindingName(kind: string, value: unknown, options?: Record<string, unknown>): string
  normalizeBindingValue(capability: string, name: string, value: unknown, options?: Record<string, unknown>): string | undefined
  normalizeKvNamespace(value: unknown, options?: Record<string, unknown>): string
  normalizeKvKey(value: unknown, options?: Record<string, unknown>): string
  normalizeKvPutResult(value: unknown): boolean
  createRedactionState(values?: Iterable<unknown> | string): any
}
const { Router } = root as { Router: new () => any }

describe('@pulse-compute/runtime host bridge', () => {
  it('keeps the application root surface unchanged and exposes a separate provider-maintainer bridge', () => {
    expect(Object.keys(root)).toEqual(['RUNTIME_API_VERSION', 'ROUTER_API_VERSION', 'Router'])
    expect(host.RUNTIME_HOST_API_VERSION).toBe('pulse.runtime-host.v3')
    expect(root).not.toHaveProperty('executeRouter')
    expect(root).not.toHaveProperty('executeApplication')
  })

  it('normalizes Router applications and plain managed handlers without adding lifecycle methods', async () => {
    const router = new Router()
    router.get('/health', async (ctx: any) => ctx.json({ ok: true }))
    expect(host.isRouterApplication(router)).toBe(true)
    expect(host.assertRouterApplication(router)).toBe(router)

    const response = await host.executeApplication(router, new Request('https://example.test/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    const plain = async (ctx: any) => ctx.text('plain')
    const normalized = host.normalizeApplication(plain) as any
    expect(host.isRouterApplication(normalized)).toBe(true)
    expect(normalized).not.toHaveProperty('handle')
    expect(normalized).not.toHaveProperty('listen')
    expect(normalized).not.toHaveProperty('serve')
    const plainResponse = await host.executeApplication(plain, new Request('https://example.test/'))
    expect(await plainResponse.text()).toBe('plain')
  })

  it('directly executes one no-payload event without constructing an HTTP context', async () => {
    const app = new Pulse({ auto: true })
    let observed: Record<string, unknown> | undefined
    app.on('system.tick', { schema: null }, async (ctx: any) => {
      observed = {
        type: ctx.event.type,
        payload: ctx.event.payload,
        request: Object.prototype.hasOwnProperty.call(ctx, 'req'),
        response: Object.prototype.hasOwnProperty.call(ctx, 'response'),
      }
    })
    const result = await host.executeEvent(app, {
      version: 'pulse.event-frame.v1',
      type: 'system.tick',
      schemaId: null,
    })
    expect(result).toEqual({ version: 'pulse.event-execution-result.v1', status: 'completed' })
    expect(observed).toEqual({ type: 'system.tick', payload: null, request: false, response: false })
  })

  it('dispatches one-way ctx.emit effects through the bounded reference adapter', async () => {
    expect(host.EVENT_ADAPTER_VERSION).toBe('pulse.event-adapter.v1')
    expect(host.EVENT_ADAPTER_SEMANTICS).toMatchObject({
      acceptance: 'host-accepted',
      deliveryGuarantee: 'none',
      autoLoopback: false,
      sameStackReentry: false,
    })
    const app = new Pulse({ auto: true })
    let loopbackCalls = 0
    app.on('audit.recorded', { schema: null }, async () => { loopbackCalls += 1 })
    app.get('/emit', async (ctx: any) => {
      expect(await ctx.emit('audit.recorded', { schema: null })).toBeUndefined()
      return ctx.text('accepted')
    })
    const adapter = host.createEventRecordingAdapter({ id: 'test.event-recording', maxQueueDepth: 2 })
    const response = await host.executeApplication(app, new Request('https://example.test/emit'), {
      effectAdapter: adapter,
    })
    expect(await response.text()).toBe('accepted')
    expect(adapter.acceptedFrames()).toEqual([
      { version: 'pulse.event-frame.v1', type: 'audit.recorded', schemaId: null },
    ])
    expect(Object.isFrozen(adapter.acceptedFrames()[0])).toBe(true)
    expect(loopbackCalls).toBe(0)
  })


  it('preserves provider-supplied request and response header pairs across the host bridge', async () => {
    const router = new Router()
    router.get('/headers', async (ctx: any) => ctx.json({
      first: ctx.req.header('x-repeat'),
      headers: ctx.req.headers,
    }, {
      headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2'], ['x-repeat', 'one'], ['x-repeat', 'two']],
    }))

    const response = await host.executeApplication(
      router,
      new Request('https://example.test/headers', { headers: { 'x-repeat': 'combined' } }),
      { requestHeaders: [['x-repeat', 'one'], ['x-repeat', 'two']] },
    )
    expect(await response.json()).toEqual({
      first: 'one',
      headers: [['x-repeat', 'one'], ['x-repeat', 'two']],
    })
    expect(host.responseHeaderPairs(response)).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
      ['x-repeat', 'one'],
      ['x-repeat', 'two'],
      ['content-type', 'application/json; charset=utf-8'],
    ])
  })

  it('allows provider adapters to preserve or explicitly override opaque response status', async () => {
    const upstream = new Response('partial', { status: 206 })
    const preserved = host.createOpaqueFetchResponse({ response: upstream })
    const overridden = host.createOpaqueFetchResponse({ response: new Response('complete', { status: 206 }), status: 200 })

    expect(host.isPulseFetchResponse(preserved)).toBe(true)
    expect(preserved.status).toBe(206)
    expect(preserved.ok).toBe(true)
    expect(overridden.status).toBe(200)
    expect(overridden.ok).toBe(true)

    const adopted = await host.executeApplication(async () => overridden, new Request('https://example.test/'))
    expect(adopted.status).toBe(200)
    expect(await adopted.text()).toBe('complete')
  })

  it('preserves provider-owned opaque body metadata when HEAD suppresses the body', async () => {
    const router = new Router()
    router.head('/asset', async () => host.markOpaqueResponse(new Response('provider-owned', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })))

    const response = await host.executeApplication(
      router,
      new Request('https://example.test/asset', { method: 'HEAD' }),
    )
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(host.responseBodyClass(response)).toBe('opaque')
    expect(await response.text()).toBe('')
  })


  it('owns one bounded request effect lifecycle and rejects ambiguous adapter injection', async () => {
    expect(host.JAVASCRIPT_EFFECT_PROTOCOL_VERSION).toBe('pulse.javascript-effect.v1')
    expect(host.JAVASCRIPT_EFFECT_ADAPTER_VERSION).toBe('pulse.javascript-effect-adapter.v1')
    expect(host.JAVASCRIPT_EFFECT_OBSERVATION_VERSION).toBe('pulse.javascript-effect-observation.v1')
    expect(() => host.createJavascriptEffectExecution({
      capabilities: {},
      effectAdapter: { dispatch: () => undefined },
    })).toThrowError(expect.objectContaining({ code: 'PULSE_RUNTIME_EFFECT_ADAPTER_AMBIGUOUS' }))

    let disposed = 0
    const execution = host.createJavascriptEffectExecution({
      maxEffects: 2,
      effectAdapter: {
        id: 'test.host-effect-lifecycle',
        dispatch: (effect: any) => effect.capability,
        dispose: () => { disposed += 1 },
      },
    })
    const first = execution.dispatch({
      kind: 'test.first',
      providerKind: 'test',
      operation: 'read',
      capability: 'first',
    })
    const second = execution.dispatch({
      kind: 'test.second',
      providerKind: 'test',
      operation: 'read',
      capability: 'second',
    })
    expect(host.isPulseJavascriptEffect(first)).toBe(true)
    expect(await execution.parallel({ first, second })).toEqual({ first: 'first', second: 'second' })
    expect(() => execution.dispatch({
      kind: 'test.third',
      providerKind: 'test',
      operation: 'read',
      capability: 'third',
    })).toThrowError(expect.objectContaining({ code: 'PULSE_RUNTIME_EFFECT_LIMIT_EXCEEDED' }))
    await execution.close()
    await execution.close()
    expect(disposed).toBe(1)
    expect(execution.summary()).toMatchObject({ effectCount: 2, parallelCount: 1, closed: true })
  })

  it('propagates request cancellation through one stable effect error and adapter signal', async () => {
    const controller = new AbortController()
    let adapterSawAbort = false
    const execution = host.createJavascriptEffectExecution({
      signal: controller.signal,
      effectAdapter: {
        id: 'test.host-effect-cancellation',
        dispatch: (_effect: any, requestExecution: any) => new Promise((_resolve, reject) => {
          requestExecution.signal.addEventListener('abort', () => {
            adapterSawAbort = true
            reject(requestExecution.signal.reason)
          }, { once: true })
        }),
      },
    })
    const effect = execution.dispatch({
      kind: 'test.cancel', providerKind: 'test', operation: 'wait', capability: 'test.cancel',
    })
    await Promise.resolve()
    controller.abort(new Error('request cancelled'))
    await expect(effect).rejects.toMatchObject({ code: 'PULSE_RUNTIME_EFFECT_ABORTED' })
    expect(adapterSawAbort).toBe(true)
    expect(execution.summary()).toMatchObject({ aborted: true, effectCount: 1 })
    await execution.close()
  })

  it('enforces the runtime keyed-parallel shape and one-time effect-root ownership', async () => {
    const execution = host.createJavascriptEffectExecution({
      effectAdapter: { dispatch: (effect: any) => effect.capability },
    })
    expect(() => execution.parallel({})).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_EMPTY',
    }))
    const nullPrototype = Object.create(null)
    Object.defineProperty(nullPrototype, 'value', { enumerable: true, value: execution.dispatch({
      kind: 'test.null-prototype', providerKind: 'test', operation: 'read', capability: 'null-prototype',
    }) })
    expect(() => execution.parallel(nullPrototype)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_OBJECT_REQUIRED',
    }))

    const indexed: Record<string, unknown> = {}
    Object.defineProperty(indexed, '0', { enumerable: true, value: execution.dispatch({
      kind: 'test.index', providerKind: 'test', operation: 'read', capability: 'index',
    }) })
    expect(() => execution.parallel(indexed)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_KEY_UNSUPPORTED',
    }))

    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 'not-an-effect' })
    expect(() => execution.parallel(accessor)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_DATA_PROPERTY_REQUIRED',
    }))

    const root = execution.dispatch({
      kind: 'test.root', providerKind: 'test', operation: 'read', capability: 'root',
    })
    const projection = execution.project(root, 'identity', (value: unknown) => value)
    expect(() => execution.parallel({ root, projection })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_EFFECT_DUPLICATE',
    }))
    const result = await execution.parallel({ root })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.isFrozen(result)).toBe(false)
    expect(Object.getOwnPropertyDescriptor(result, 'root')).toMatchObject({
      enumerable: true, configurable: true, writable: true, value: 'root',
    })
    expect(() => execution.parallel({ reused: root })).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_PARALLEL_EFFECT_DUPLICATE',
    }))
    await execution.close()
  })

  it('normalizes binding and KV values at the shared adapter boundary', async () => {
    const source = { profile: { name: 'Ada' } }
    let observedPut: any
    const providerGet = { nested: { count: 1 } }
    const execution = host.createJavascriptEffectExecution({
      effectAdapter: {
        id: 'test.bindings',
        dispatch: async (effect: any) => {
          if (effect.kind === 'config.get') return 'test'
          if (effect.kind === 'secret.get') return 'secret-value'
          if (effect.kind === 'kv.get') return providerGet
          if (effect.kind === 'kv.put') { observedPut = effect.value; return true }
          return undefined
        },
      },
    })

    const config = execution.dispatch({ kind: 'config.get', capability: 'config.get', name: 'MODE' })
    const secret = execution.dispatch({ kind: 'secret.get', capability: 'secret.get', name: 'TOKEN' })
    const get = execution.dispatch({ kind: 'kv.get', capability: 'kv.get', namespace: 'users', key: 'last' })
    const put = execution.dispatch({ kind: 'kv.put', capability: 'kv.put', namespace: 'users', key: 'last', value: source })
    source.profile.name = 'Grace'

    expect(await config).toBe('test')
    expect(await secret).toBe('secret-value')
    const got = await get
    providerGet.nested.count = 9
    expect(got).toEqual({ nested: { count: 1 } })
    expect(Object.isFrozen(got)).toBe(true)
    expect(await put).toBe(true)
    expect(observedPut).toEqual({ profile: { name: 'Ada' } })
    expect(Object.isFrozen(observedPut)).toBe(true)
    await execution.close()
  })

  it('fails closed on invalid provider binding, KV value, and acknowledgement shapes', async () => {
    const invalidBinding = host.createJavascriptEffectExecution({
      effectAdapter: { dispatch: () => ({ leaked: 'never-report-this' }) },
    })
    await expect(invalidBinding.dispatch({
      kind: 'secret.get', capability: 'secret.get', name: 'TOKEN',
    })).rejects.toMatchObject({ code: 'PULSE_BINDING_VALUE_INVALID' })
    await invalidBinding.close()

    const invalidAck = host.createJavascriptEffectExecution({
      effectAdapter: { dispatch: () => 'yes' },
    })
    await expect(invalidAck.dispatch({
      kind: 'kv.put', capability: 'kv.put', namespace: 'users', key: 'last', value: { ok: true },
    })).rejects.toMatchObject({ code: 'PULSE_KV_ACK_INVALID' })
    await invalidAck.close()

    expect(() => host.cloneKvValue({ value: new Date() })).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_VALUE_INVALID',
    }))
  })

  it('enforces exact UTF-8 binding names and bounded portable KV trees', () => {
    expect(() => host.normalizeBindingName('config', '')).toThrowError(expect.objectContaining({
      code: 'PULSE_BINDING_NAME_INVALID',
    }))
    expect(() => host.normalizeBindingName('secret', 'éé', { maxBindingNameBytes: 3 })).toThrowError(expect.objectContaining({
      code: 'PULSE_BINDING_NAME_TOO_LARGE',
    }))
    expect(() => host.normalizeBindingValue('config.get', 'MODE', '12345', { maxBindingValueBytes: 4 })).toThrowError(expect.objectContaining({
      code: 'PULSE_BINDING_VALUE_TOO_LARGE',
    }))
    expect(() => host.normalizeKvNamespace('', {})).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_NAMESPACE_INVALID',
    }))
    expect(() => host.normalizeKvKey('ABCDE', { maxKvKeyBytes: 4 })).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_KEY_TOO_LARGE',
    }))
    expect(() => host.cloneKvValue({ nested: { value: true } }, { maxKvValueDepth: 1 })).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_VALUE_DEPTH_EXCEEDED',
    }))
    expect(() => host.cloneKvValue({ first: 1, second: 2 }, { maxKvValueEntries: 2 })).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_VALUE_ENTRIES_EXCEEDED',
    }))
    expect(() => host.cloneKvValue({ value: '12345' }, { maxKvValueBytes: 4 })).toThrowError(expect.objectContaining({
      code: 'PULSE_KV_VALUE_TOO_LARGE',
    }))
  })

  it('redacts registered secret values from structured values, errors, and stacks', () => {
    const redaction = host.createRedactionState(['top-secret'])
    expect(redaction.redactString('Bearer top-secret')).toBe('Bearer <redacted>')
    expect(redaction.redactValue({ authorization: 'Bearer other', url: 'https://example.test/top-secret' })).toEqual({
      authorization: '<redacted>',
      url: 'https://example.test/<redacted>',
    })
    const failure: any = new Error('request failed for top-secret')
    failure.code = 'UPSTREAM_FAILED'
    failure.detail = { token: 'top-secret', url: 'https://example.test/top-secret' }
    const safe: any = redaction.redactError(failure)
    expect(safe).not.toBe(failure)
    expect(safe.code).toBe('UPSTREAM_FAILED')
    expect(safe.message).toBe('request failed for <redacted>')
    expect(safe.detail).toEqual({ token: '<redacted>', url: 'https://example.test/<redacted>' })
    expect(String(safe.stack)).not.toContain('top-secret')
    expect(redaction.values()).toEqual(['<redacted>'])
  })

  it('redacts nested error causes and camelCase credential fields without invoking accessors', () => {
    const redaction = host.createRedactionState(['nested-secret'])
    const inner: any = new Error('inner nested-secret')
    inner.detail = { accessToken: 'visible-token', endpoint: 'https://example.test/nested-secret' }
    const outer: any = new Error('outer failure', { cause: inner })
    let accessorInvoked = false
    Object.defineProperty(outer, 'passwordHint', {
      enumerable: true,
      get() { accessorInvoked = true; throw new Error('accessor must not run') },
    })

    const safe: any = redaction.redactError(outer)
    expect(safe.message).toBe('outer failure')
    expect(safe.cause).toBeInstanceOf(Error)
    expect(safe.cause.message).toBe('inner <redacted>')
    expect(safe.cause.detail).toEqual({
      accessToken: '<redacted>',
      endpoint: 'https://example.test/<redacted>',
    })
    expect(safe.passwordHint).toBeUndefined()
    expect(String(safe.cause.stack)).not.toContain('nested-secret')

    const hostile: any = new Error()
    Object.defineProperty(hostile, 'message', {
      configurable: true,
      get() { accessorInvoked = true; return 'must-not-run' },
    })
    expect(redaction.redactError(hostile).message).toBe('Pulse runtime failure.')
    expect(accessorInvoked).toBe(false)
  })

  it('rejects values outside the managed application contract', () => {
    expect(() => host.normalizeApplication({})).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_APPLICATION_EXPORT_INVALID',
    }))
    expect(() => host.assertRouterApplication(async () => undefined)).toThrowError(expect.objectContaining({
      code: 'PULSE_RUNTIME_APPLICATION_EXPORT_INVALID',
    }))
  })
})
