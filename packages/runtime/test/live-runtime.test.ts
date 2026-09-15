import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { Router } = require('../src/index.js') as { Router: new () => any }
const runtime = require('../src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>
  PulseUnhandledError: new (...args: any[]) => Error
  routerEntries(router: object): readonly unknown[]
}

describe('@pulse-compute/runtime live JavaScript core', () => {
  it.each(['put', 'patch', 'delete'] as const)('dispatches %s through mounted routes with terminal fallthrough and request bodies', async (verb) => {
    const app = new Router()
    const child = new Router()
    const seen: string[] = []
    child.get('/items/:id', async (ctx: any) => ctx.text('wrong method'))
    child[verb]('/items/:id', async (_ctx: any, next: any) => {
      seen.push('first')
      return next()
    })
    expect(child[verb]('/items/:id', async (ctx: any) => {
      seen.push('second')
      const input = await ctx.req.json()
      return ctx.json({ method: ctx.req.method, id: ctx.param('id'), input })
    })).toBe(child)
    app.mount('/api', child)

    const response = await runtime.executeRouter(app, new Request('https://example.test/api/items/7', {
      method: verb.toUpperCase(),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ method: verb.toUpperCase(), id: '7', input: { name: 'Ada' } })
    expect(seen).toEqual(['first', 'second'])

    const missing = await runtime.executeRouter(app, new Request('https://example.test/api/items/7', { method: 'OPTIONS' }))
    expect(missing.status).toBe(404)
    expect(seen).toEqual(['first', 'second'])
    expect(() => new Router()[verb]('/items', null)).toThrow(TypeError)
  })

  it('preserves route order, scoped middleware, mounts, params, and request-local state', async () => {
    const app = new Router()
    const child = new Router()
    const seen: string[] = []

    app.use('/api/:tenant', async (ctx: any, next: any) => {
      ctx.state.set('tenant', 'acme')
      seen.push('root-middleware')
      return next()
    })
    child.use(async (ctx: any, next: any) => {
      seen.push('child-middleware')
      return next()
    })
    child.get('/users/:id', async (ctx: any) => {
      seen.push('child-route')
      return ctx.text(`${ctx.state.get('tenant')}:${ctx.param('id')}`)
    })
    app.mount('/api/:tenant', child)

    const response = await runtime.executeRouter(app, new Request('https://example.test/api/acme/users/7'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('acme:7')
    expect(seen).toEqual(['root-middleware', 'child-middleware', 'child-route'])
    expect(runtime.routerEntries(app)).toHaveLength(2)
  })

  it('uses terminal forward transfers and explicit error recovery', async () => {
    const app = new Router()
    const seen: string[] = []

    app.use(async (_ctx: any, next: any) => {
      seen.push('before-error')
      return next(new Error('recoverable'))
    })
    app.error(async (error: Error, ctx: any, next: any) => {
      seen.push(`error:${error.message}`)
      ctx.state.set('recovered', 'yes')
      return next()
    })
    app.use(async (_ctx: any, next: any) => {
      seen.push('after-recovery')
      return next()
    })
    app.get('/ok', async (ctx: any) => ctx.text(ctx.state.get('recovered') || 'no'))

    const response = await runtime.executeRouter(app, new Request('https://example.test/ok'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('yes')
    expect(seen).toEqual(['before-error', 'error:recoverable', 'after-recovery'])
  })

  it('contains unexpected thrown or rejected failures at the managed boundary', async () => {
    const app = new Router()
    app.use(async () => {
      throw new Error('dependency exploded')
    })
    app.error(async (error: Error, ctx: any) => {
      expect(error).toBeInstanceOf(runtime.PulseUnhandledError)
      expect((error as any).cause).toBeInstanceOf(Error)
      return ctx.text('contained', { status: 503 })
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/'))
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('contained')
  })

  it('rejects non-terminal next usage into the error lane', async () => {
    const app = new Router()
    app.use(async (ctx: any, next: any) => {
      next()
      return ctx.text('invalid')
    })
    app.error(async (error: Error, ctx: any) => {
      expect((error as any).code).toBe('PULSE_RUNTIME_UNHANDLED_ERROR')
      expect((error as any).cause?.code).toBe('PULSE_RUNTIME_NEXT_NOT_TERMINAL')
      return ctx.text('rejected', { status: 500 })
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/'))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('rejected')
  })

  it('owns 404 and 500 responses and isolates state between requests', async () => {
    const app = new Router()
    app.get('/state', async (ctx: any) => {
      const before = ctx.state.get('value') || 'missing'
      ctx.state.set('value', '')
      return ctx.json({ before, after: ctx.state.get('value') })
    })
    app.get('/boom', async () => {
      throw new Error('boom')
    })

    const first = await runtime.executeRouter(app, new Request('https://example.test/state'))
    const second = await runtime.executeRouter(app, new Request('https://example.test/state'))
    expect(first.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(second.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await first.json()).toEqual({ before: 'missing', after: '' })
    expect(await second.json()).toEqual({ before: 'missing', after: '' })

    const missing = await runtime.executeRouter(app, new Request('https://example.test/missing'))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await missing.text()).toBe('Not Found')

    const failed = await runtime.executeRouter(app, new Request('https://example.test/boom'))
    expect(failed.status).toBe(500)
    expect(failed.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await failed.text()).toBe('Internal Server Error')
  })

  it('distinguishes a missing binding adapter from a present adapter returning a missing key', async () => {
    const unavailable = new Router()
    unavailable.get('/config', async (ctx: any) => ctx.json({ value: await ctx.config.get('MISSING') }))
    unavailable.error(async (error: Error, ctx: any) => {
      expect((error as any).code).toBe('PULSE_RUNTIME_UNHANDLED_ERROR')
      expect((error as any).cause?.code).toBe('PULSE_RUNTIME_CAPABILITY_UNAVAILABLE')
      expect((error as any).cause?.message).toContain('config.get')
      return ctx.text('unavailable', { status: 503 })
    })

    const unavailableResponse = await runtime.executeRouter(unavailable, new Request('https://example.test/config'))
    expect(unavailableResponse.status).toBe(503)
    expect(await unavailableResponse.text()).toBe('unavailable')

    const available = new Router()
    available.get('/bindings', async (ctx: any) => ctx.json({
      config: await ctx.config.get('MISSING'),
      secret: await ctx.secret.get('MISSING'),
    }))
    const missingKeyResponse = await runtime.executeRouter(
      available,
      new Request('https://example.test/bindings'),
      { capabilities: { config: async () => undefined, secret: async () => undefined } },
    )
    expect(missingKeyResponse.status).toBe(200)
    expect(await missingKeyResponse.json()).toEqual({})
  })

  it('implements request, response, and provider-owned capability adapters', async () => {
    const app = new Router()
    const kv = new Map<string, unknown>()
    app.post('/effects/:id', async (ctx: any) => {
      const input = await ctx.req.json()
      const projected = await ctx.fetch(`https://origin.test/${ctx.param('id')}`).json()
      const config = await ctx.config.get('MODE')
      const secret = await ctx.secret.get('TOKEN')
      const users = ctx.kv('users')
      await users.put('last', projected)
      return ctx.json({ input, projected, config, secret, stored: await users.get('last') }, {
        headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']]
      })
    })

    const response = await runtime.executeRouter(
      app,
      new Request('https://example.test/effects/9', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' })
      }),
      {
        capabilities: {
          fetch: async (url: string) => new Response(JSON.stringify({ url }), {
            headers: { 'content-type': 'application/json' }
          }),
          config: async (name: string) => name === 'MODE' ? 'test' : undefined,
          secret: async (name: string) => name === 'TOKEN' ? 'redacted-fixture' : undefined,
          kv: () => ({
            get: async (key: string) => kv.get(key),
            put: async (key: string, value: unknown) => { kv.set(key, value); return true }
          })
        }
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      input: { hello: 'world' },
      projected: { url: 'https://origin.test/9' },
      config: 'test',
      secret: 'redacted-fixture',
      stored: { url: 'https://origin.test/9' }
    })
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    if (typeof getSetCookie === 'function') expect(getSetCookie.call(response.headers)).toEqual(['a=1', 'b=2'])
  })

  it('strips response bodies for HEAD and bodyless statuses without changing headers or status', async () => {
    const app = new Router()
    app.head('/health', async (ctx: any) => ctx.text('hidden', {
      headers: { 'x-pulse': 'runtime' }
    }))
    app.get('/empty', async (ctx: any) => ctx.response({
      status: 204,
      headers: { 'x-empty': 'runtime' },
      body: 'hidden',
    }))
    app.get('/reset', async (ctx: any) => ctx.response({
      status: 205,
      headers: { 'x-reset': 'runtime' },
      body: 'hidden',
    }))
    app.get('/cached', async (ctx: any) => ctx.response({
      status: 304,
      headers: { 'x-cached': 'runtime' },
      body: 'hidden',
    }))

    const head = await runtime.executeRouter(app, new Request('https://example.test/health', { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('x-pulse')).toBe('runtime')
    expect(await head.text()).toBe('')

    const empty = await runtime.executeRouter(app, new Request('https://example.test/empty'))
    expect(empty.status).toBe(204)
    expect(empty.headers.get('x-empty')).toBe('runtime')
    expect(await empty.text()).toBe('')

    const reset = await runtime.executeRouter(app, new Request('https://example.test/reset'))
    expect(reset.status).toBe(205)
    expect(reset.headers.get('x-reset')).toBe('runtime')
    expect(await reset.text()).toBe('')

    const cached = await runtime.executeRouter(app, new Request('https://example.test/cached'))
    expect(cached.status).toBe(304)
    expect(cached.headers.get('x-cached')).toBe('runtime')
    expect(await cached.text()).toBe('')
  })

  it('dispatches ctx.parallel effects together and reconstructs keyed results in source order', async () => {
    const app = new Router()
    const started: string[] = []
    const completed: string[] = []
    let summary: any
    app.get('/parallel', async (ctx: any) => {
      const { profile, flags } = await ctx.parallel({
        profile: ctx.fetch('https://origin.test/profile').json(),
        flags: ctx.fetch('https://origin.test/flags').json(),
      })
      return ctx.json({ profile, flags })
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/parallel'), {
      effectAdapter: {
        id: 'test.parallel',
        dispatch: async (effect: any) => {
          started.push(effect.id)
          const delay = effect.url.endsWith('/profile') ? 25 : 1
          await new Promise((resolve) => setTimeout(resolve, delay))
          completed.push(effect.id)
          return new Response(JSON.stringify({ id: effect.id, url: effect.url }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      },
      onEffectSummary: (value: any) => { summary = value },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      profile: { id: 'fetch-1', url: 'https://origin.test/profile' },
      flags: { id: 'fetch-2', url: 'https://origin.test/flags' },
    })
    expect(started).toEqual(['fetch-1', 'fetch-2'])
    expect(completed).toEqual(['fetch-2', 'fetch-1'])
    expect(summary.effectCount).toBe(2)
    expect(summary.parallelCount).toBe(1)
    expect(summary.resolutionOrder).toEqual(['fetch-2', 'fetch-1'])
    expect(summary.groups).toEqual([{
      id: 'parallel-1',
      keys: ['profile', 'flags'],
      effectIds: ['fetch-1', 'fetch-2'],
    }])
  })

  it('settles every ctx.parallel member and selects the primary failure by property order', async () => {
    const app = new Router()
    const completed: string[] = []
    let captured: any
    app.get('/parallel-failure', async (ctx: any) => {
      await ctx.parallel({
        first: ctx.fetch('https://origin.test/first').text(),
        second: ctx.fetch('https://origin.test/second').text(),
      })
      return ctx.text('unreachable')
    })
    app.error(async (error: any, ctx: any) => {
      captured = error.cause
      return ctx.text('contained', { status: 502 })
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/parallel-failure'), {
      effectAdapter: {
        id: 'test.parallel-failure',
        dispatch: async (effect: any) => {
          const delay = effect.url.endsWith('/first') ? 20 : 1
          await new Promise((resolve) => setTimeout(resolve, delay))
          completed.push(effect.id)
          const error = new Error(effect.id)
          ;(error as any).code = effect.id === 'fetch-1' ? 'FIRST_FAILED' : 'SECOND_FAILED'
          throw error
        },
      },
    })

    expect(response.status).toBe(502)
    expect(completed).toEqual(['fetch-2', 'fetch-1'])
    expect(captured.code).toBe('FIRST_FAILED')
    expect(captured.effectFailures).toEqual([
      { key: 'first', index: 0, effectId: 'fetch-1', kind: 'fetch', name: 'Error', code: 'FIRST_FAILED' },
      { key: 'second', index: 1, effectId: 'fetch-2', kind: 'fetch', name: 'Error', code: 'SECOND_FAILED' },
    ])
  })

  it('rejects non-Pulse values and effects owned by another request', async () => {
    const invalid = new Router()
    invalid.get('/invalid', async (ctx: any) => {
      await ctx.parallel({ ordinary: Promise.resolve('not-owned') })
      return ctx.text('unreachable')
    })
    invalid.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const invalidResponse = await runtime.executeRouter(invalid, new Request('https://example.test/invalid'))
    expect(invalidResponse.status).toBe(400)
    expect(await invalidResponse.text()).toBe('PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED')

    let foreign: any
    const first = new Router()
    first.get('/first', async (ctx: any) => {
      foreign = ctx.config.get('MODE')
      await foreign
      return ctx.text('first')
    })
    await runtime.executeRouter(first, new Request('https://example.test/first'), {
      capabilities: { config: async () => 'test' },
    })

    const second = new Router()
    second.get('/second', async (ctx: any) => {
      await ctx.parallel({ foreign })
      return ctx.text('unreachable')
    })
    second.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const secondResponse = await runtime.executeRouter(second, new Request('https://example.test/second'))
    expect(secondResponse.status).toBe(400)
    expect(await secondResponse.text()).toBe('PULSE_RUNTIME_PARALLEL_EFFECT_OWNERSHIP')
  })

  it('keeps effect observations bounded and redacts secret and KV values', async () => {
    const app = new Router()
    const observations: any[] = []
    app.get('/redaction', async (ctx: any) => {
      await ctx.parallel({
        token: ctx.secret.get('TOKEN'),
        write: ctx.kv('private').put('last', { token: 'do-not-record' }),
      })
      return ctx.text('ok')
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/redaction'), {
      capabilities: {
        secret: async () => 'super-secret-value',
        kv: () => ({ get: async () => undefined, put: async () => true }),
      },
      onEffectObservation: (entry: any) => observations.push(entry),
    })

    expect(response.status).toBe(200)
    const serialized = JSON.stringify(observations)
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('do-not-record')
    expect(serialized).toContain('TOKEN')
    expect(serialized).toContain('<redacted>')
  })

  it('re-redacts parallel failures after a sibling secret effect resolves', async () => {
    const secretValue = 'parallel-runtime-secret-4c'
    let captured: any
    const app = new Router()
    app.get('/parallel-redaction', async (ctx: any) => {
      try {
        await ctx.parallel({
          token: ctx.secret.get('TOKEN'),
          upstream: ctx.fetch('https://origin.test/failure').text(),
        })
      } catch (error) {
        captured = error
        return ctx.text('contained', { status: 502 })
      }
      return ctx.text('unreachable')
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/parallel-redaction'), {
      capabilities: {
        secret: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15))
          return secretValue
        },
        fetch: async () => {
          const failure: any = new Error(`upstream exposed ${secretValue}`)
          failure.code = 'UPSTREAM_FAILED'
          failure.detail = { accessToken: secretValue, endpoint: `https://origin.test/${secretValue}` }
          throw failure
        },
      },
    })

    expect(response.status).toBe(502)
    expect(captured.code).toBe('UPSTREAM_FAILED')
    expect(captured.message).toBe('upstream exposed <redacted>')
    expect(captured.detail).toEqual({
      accessToken: '<redacted>',
      endpoint: 'https://origin.test/<redacted>',
    })
    expect(captured.effectFailures).toEqual([
      { key: 'upstream', index: 1, effectId: 'fetch-1', kind: 'fetch', name: 'Error', code: 'UPSTREAM_FAILED' },
    ])
    expect(JSON.stringify(captured)).not.toContain(secretValue)
    expect(String(captured.stack)).not.toContain(secretValue)
  })

  it('redacts secrets from later effect observations, provider failures, and handler errors', async () => {
    const secretValue = 'runtime-secret-4c'
    const observations: any[] = []
    let providerFailure: any
    const app = new Router()
    app.get('/provider', async (ctx: any) => {
      const token = await ctx.secret.get('TOKEN')
      return ctx.fetch(`https://origin.test/${token}`).text()
    })
    app.get('/handler', async (ctx: any) => {
      const token = await ctx.secret.get('TOKEN')
      const failure: any = new Error(`handler leaked ${token}`)
      failure.detail = { token, url: `https://origin.test/${token}` }
      throw failure
    })
    app.error(async (error: any, ctx: any) => {
      providerFailure = error.cause
      return ctx.text('contained', { status: 502 })
    })

    const provider = await runtime.executeRouter(app, new Request('https://example.test/provider'), {
      capabilities: {
        secret: async () => secretValue,
        fetch: async (url: string) => {
          const failure: any = new Error(`upstream failed for ${url}`)
          failure.code = 'UPSTREAM_FAILED'
          failure.detail = { authorization: `Bearer ${secretValue}`, url }
          throw failure
        },
      },
      onEffectObservation: (entry: any) => observations.push(entry),
    })
    expect(provider.status).toBe(502)
    expect(providerFailure.code).toBe('UPSTREAM_FAILED')
    expect(providerFailure.message).toContain('<redacted>')
    expect(providerFailure.detail).toEqual({ authorization: '<redacted>', url: 'https://origin.test/<redacted>' })
    expect(JSON.stringify(observations)).not.toContain(secretValue)
    expect(JSON.stringify(observations)).toContain('<redacted>')

    const handler = await runtime.executeRouter(app, new Request('https://example.test/handler'), {
      capabilities: { secret: async () => secretValue },
    })
    expect(handler.status).toBe(502)
    expect(providerFailure.message).toBe('handler leaked <redacted>')
    expect(providerFailure.detail).toEqual({ token: '<redacted>', url: 'https://origin.test/<redacted>' })
    expect(String(providerFailure.stack)).not.toContain(secretValue)
  })

  it('contains request-owned effects that are returned before settlement', async () => {
    const app = new Router()
    app.get('/pending', async (ctx: any) => {
      ctx.config.get('MODE')
      return ctx.text('premature')
    })
    app.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 500 }))

    const response = await runtime.executeRouter(app, new Request('https://example.test/pending'), {
      capabilities: {
        config: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return 'test'
        },
      },
    })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('PULSE_RUNTIME_EFFECT_PENDING_AT_HANDLER_RETURN')
  })

  it('owns one bounded request-body snapshot across repeated text and JSON projections', async () => {
    const app = new Router()
    let summary: any
    app.post('/body', async (ctx: any) => {
      const firstText = await ctx.req.text()
      const secondText = await ctx.req.text()
      const firstJson = await ctx.req.json()
      const secondJson = await ctx.req.json()
      return ctx.json({
        firstText,
        secondText,
        sameJsonReference: firstJson === secondJson,
        frozen: Object.isFrozen(firstJson),
        firstJson,
      })
    })

    const response = await runtime.executeRouter(app, new Request('https://example.test/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    }), {
      onEffectSummary: (value: any) => { summary = value },
    })

    expect(await response.json()).toEqual({
      firstText: '{"hello":"world"}',
      secondText: '{"hello":"world"}',
      sameJsonReference: true,
      frozen: true,
      firstJson: { hello: 'world' },
    })
    expect(summary).toMatchObject({ effectCount: 0, localEffectCount: 2, ownedEffectCount: 2 })
  })

  it('fails request-body decoding, bounds, and parallel misuse with canonical diagnostics', async () => {
    const invalidJson = new Router()
    invalidJson.post('/invalid', async (ctx: any) => ctx.json(await ctx.req.json()))
    invalidJson.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const invalid = await runtime.executeRouter(invalidJson, new Request('https://example.test/invalid', {
      method: 'POST', body: '{bad json', headers: { 'content-type': 'application/json' },
    }))
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).toBe('PULSE_BODY_DECODE')

    const tooLarge = new Router()
    tooLarge.post('/large', async (ctx: any) => ctx.text(await ctx.req.text()))
    tooLarge.error(async (error: any, ctx: any) => ctx.text(error.code, { status: 413 }))
    const large = await runtime.executeRouter(tooLarge, new Request('https://example.test/large', {
      method: 'POST', body: '123456789', headers: { 'content-type': 'text/plain' },
    }), { maxRequestBodyBytes: 8 })
    expect(large.status).toBe(413)
    expect(await large.text()).toBe('PULSE_BODY_TOO_LARGE')

    const opaqueBody = new Router()
    opaqueBody.post('/opaque', async (ctx: any) => ctx.text(await ctx.req.text()))
    opaqueBody.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const opaque = await runtime.executeRouter(opaqueBody, new Request('https://example.test/opaque', {
      method: 'POST', body: new Uint8Array([0, 1]), headers: { 'content-type': 'application/octet-stream' },
    }))
    expect(await opaque.text()).toBe('PULSE_OPAQUE_BODY_INSPECTION')

    const unavailableBody = new Router()
    unavailableBody.post('/unavailable', async (ctx: any) => ctx.text(await ctx.req.text()))
    unavailableBody.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const consumedRequest = new Request('https://example.test/unavailable', {
      method: 'POST', body: 'consumed', headers: { 'content-type': 'text/plain' },
    })
    await consumedRequest.text()
    const unavailable = await runtime.executeRouter(unavailableBody, consumedRequest)
    expect(await unavailable.text()).toBe('PULSE_BODY_UNAVAILABLE')

    const abortedBody = new Router()
    abortedBody.post('/aborted', async (ctx: any) => ctx.text(await ctx.req.text()))
    let abortHandlerCalls = 0
    abortedBody.error(async (_error: any, ctx: any) => { abortHandlerCalls += 1; return ctx.text('invalid recovery') })
    const abortController = new AbortController()
    const abortRequest = new Request('https://example.test/aborted', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }),
      headers: { 'content-type': 'text/plain' },
      duplex: 'half',
    } as any)
    const abortResponsePromise = runtime.executeRouter(abortedBody, abortRequest, { signal: abortController.signal })
    abortController.abort(new Error('test abort'))
    await expect(abortResponsePromise).rejects.toThrow('test abort')
    expect(abortHandlerCalls).toBe(0)

    const parallel = new Router()
    parallel.post('/parallel', async (ctx: any) => {
      await ctx.parallel({ body: ctx.req.text() })
      return ctx.text('unreachable')
    })
    parallel.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const rejected = await runtime.executeRouter(parallel, new Request('https://example.test/parallel', {
      method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' },
    }))
    expect(rejected.status).toBe(400)
    expect(await rejected.text()).toBe('PULSE_RUNTIME_PARALLEL_EFFECT_REQUIRED')
  })

  it('normalizes outbound fetch bodies and rejects ambiguous or nonportable inputs before dispatch', async () => {
    const captured: any[] = []
    const app = new Router()
    app.post('/fetch', async (ctx: any) => {
      const created = await ctx.fetch('https://origin.test/users', {
        method: 'POST',
        headers: [['x-request-id', 'r1']],
        json: { name: 'Ada' },
        timeoutMs: 50,
      }).json()
      return ctx.json(created)
    })
    const response = await runtime.executeRouter(app, new Request('https://example.test/fetch', { method: 'POST' }), {
      effectAdapter: {
        id: 'test.fetch-normalization',
        dispatch: (effect: any) => {
          captured.push(effect)
          return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
        },
      },
    })
    expect(await response.json()).toEqual({ ok: true })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      url: 'https://origin.test/users',
      init: {
        method: 'POST',
        body: '{"name":"Ada"}',
        bodyMode: 'json',
        timeoutMs: 50,
      },
    })
    expect(captured[0].init.headers).toEqual([
      ['x-request-id', 'r1'],
      ['content-type', 'application/json; charset=utf-8'],
    ])

    const invalid = new Router()
    invalid.post('/invalid', async (ctx: any) => {
      await ctx.fetch('https://origin.test/users', { method: 'POST', body: 'x', json: { x: true } }).text()
      return ctx.text('unreachable')
    })
    invalid.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))
    const invalidResponse = await runtime.executeRouter(invalid, new Request('https://example.test/invalid', { method: 'POST' }))
    expect(await invalidResponse.text()).toBe('PULSE_FETCH_BODY_AMBIGUOUS')
  })

  it('propagates fetch timeouts through the request-owned effect signal', async () => {
    const app = new Router()
    let adapterSawAbort = false
    app.get('/timeout', async (ctx: any) => ctx.text(await ctx.fetch('https://origin.test/slow', { timeoutMs: 5 }).text()))
    app.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 504 }))
    const response = await runtime.executeRouter(app, new Request('https://example.test/timeout'), {
      effectAdapter: {
        id: 'test.fetch-timeout',
        dispatch: (_effect: any, execution: any) => new Promise((_resolve, reject) => {
          execution.signal.addEventListener('abort', () => {
            adapterSawAbort = true
            reject(execution.signal.reason)
          }, { once: true })
        }),
      },
    })
    expect(response.status).toBe(504)
    expect(await response.text()).toBe('PULSE_FETCH_TIMEOUT')
    expect(adapterSawAbort).toBe(true)
  })

  it('caches structured fetch projections while preserving direct and opaque response pass-through', async () => {
    const app = new Router()
    app.get('/structured', async (ctx: any) => {
      const operation = ctx.fetch('https://origin.test/data')
      const first = await operation.json()
      const second = await operation.json()
      return ctx.json({ sameReference: first === second, frozen: Object.isFrozen(first), first, text: await operation.text() })
    })
    app.get('/direct', async (ctx: any) => ctx.fetch('https://origin.test/direct'))
    app.get('/opaque', async (ctx: any) => ctx.fetch('https://origin.test/archive'))
    app.get('/project-binary', async (ctx: any) => ctx.text(await ctx.fetch('https://origin.test/binary-text').text()))
    app.get('/mixed-ownership', async (ctx: any) => {
      const operation = ctx.fetch('https://origin.test/mixed')
      await operation.text()
      return operation
    })
    app.get('/inspect-opaque', async (ctx: any) => {
      const response = await ctx.fetch('https://origin.test/archive')
      return ctx.text(response.text())
    })
    app.error(async (error: any, ctx: any) => ctx.text(error.cause.code, { status: 400 }))

    const providerResponses = new Map<string, Response>()
    const fetchCapability = async (url: string) => {
      let response: Response
      if (url.endsWith('/archive')) {
        response = new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0, 1, 2, 3]))
            controller.close()
          },
        }), { status: 206, headers: { 'content-type': 'application/octet-stream', 'x-source': 'opaque' } })
      } else if (url.endsWith('/binary-text')) {
        response = new Response(new Uint8Array([65, 66]), {
          headers: { 'content-type': 'application/octet-stream' },
        })
      } else {
        response = new Response(JSON.stringify({ url }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'x-source': 'structured' },
        })
      }
      providerResponses.set(url, response)
      return response
    }

    const structured = await runtime.executeRouter(app, new Request('https://example.test/structured'), {
      capabilities: { fetch: fetchCapability },
    })
    expect(await structured.json()).toEqual({
      sameReference: true,
      frozen: true,
      first: { url: 'https://origin.test/data' },
      text: '{"url":"https://origin.test/data"}',
    })
    expect(providerResponses.get('https://origin.test/data')?.bodyUsed).toBe(true)

    await expect(runtime.executeRouter(app, new Request('https://example.test/mixed-ownership'), {
      capabilities: { fetch: fetchCapability },
    })).rejects.toMatchObject({ code: 'PULSE_FETCH_RESPONSE_OWNERSHIP_CONFLICT' })

    const direct = await runtime.executeRouter(app, new Request('https://example.test/direct'), {
      capabilities: { fetch: fetchCapability },
    })
    expect(direct.status).toBe(201)
    expect(direct.headers.get('x-source')).toBe('structured')
    expect(await direct.json()).toEqual({ url: 'https://origin.test/direct' })

    const opaque = await runtime.executeRouter(app, new Request('https://example.test/opaque'), {
      capabilities: { fetch: fetchCapability },
    })
    expect(opaque.status).toBe(206)
    expect(opaque.headers.get('x-source')).toBe('opaque')
    expect(Array.from(new Uint8Array(await opaque.arrayBuffer()))).toEqual([0, 1, 2, 3])

    const projectedBinary = await runtime.executeRouter(app, new Request('https://example.test/project-binary'), {
      capabilities: { fetch: fetchCapability },
    })
    expect(projectedBinary.status).toBe(200)
    expect(await projectedBinary.text()).toBe('AB')

    const inspected = await runtime.executeRouter(app, new Request('https://example.test/inspect-opaque'), {
      capabilities: { fetch: fetchCapability },
    })
    expect(inspected.status).toBe(400)
    expect(await inspected.text()).toBe('PULSE_OPAQUE_BODY_INSPECTION')
  })

})
