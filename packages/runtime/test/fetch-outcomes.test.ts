import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const node = require('../../provider-node/src/javascript/runtime-host.js')
const fastly = require('../../provider-fastly/src/javascript/runtime-host.js')
const url = 'https://outcomes.test/data'
const fulfilled = (value: unknown) => ({ status: 'fulfilled', value })
const rejected = (code: string) => ({ status: 'rejected', error: { code } })
afterEach(() => vi.useRealTimers())
for (const target of ['node', 'fastly']) describe(`${target} collected fetch outcomes`, () => {
  const execute = (handler: any, fetchImplementation: any, options = {}) => {
    const run = target === 'node' ? node.executeNodeJavascriptApplication : fastly.executeFastlyJavascriptApplication
    return run(handler, new Request('https://application.test/'), {
      fetchImplementation, bindings: { backends: { 'https://outcomes.test': 'origin' } }, ...options
    })
  }
  it.each(['direct', 'keyed', 'collection'])('settles the selected payload before wrapping: %s', async shape => {
    let calls = 0
    const response = await execute(async (ctx: any) => {
      const first = ctx.fetch(url, { errors: 'collect' }).json()
      let result
      if (shape === 'direct') result = await first
      else if (shape === 'keyed') result = await ctx.parallel({ first, second: ctx.fetch(url + '/bad', { errors: 'collect' }).text() })
      else {
        const effects = ctx.effects({ max: 2 })
        effects.add(first)
        effects.add(ctx.fetch(url + '/bad', { errors: 'collect' }).text())
        result = await ctx.parallel(effects)
      }
      return ctx.json(result)
    }, async (input: string) => {
      calls++
      if (input.endsWith('bad')) throw new Error('secret https://credentials.test/token')
      return new Response('{"ok":true}', { status: 503, headers: { 'content-type': 'application/json' } })
    })
    const first = fulfilled({ ok: true }), second = rejected('PULSE_FETCH_NETWORK')
    expect(await response.json()).toEqual(shape === 'direct' ? first : shape === 'keyed' ? { first, second } : [first, second])
    expect(calls).toBe(shape === 'direct' ? 1 : 2)
  })
  it('preserves opaque ownership and repeated headers without reading the body', async () => {
    let pulls = 0
    const response = await execute(async (ctx: any) => {
      const result = await ctx.fetch(url, { errors: 'collect' })
      expect(result.status).toBe('fulfilled')
      expect(result.value.headersAll('set-cookie')).toEqual(['a=1', 'b=2'])
      expect(pulls).toBe(0)
      return result.value
    }, async () => new Response(new ReadableStream({ pull(controller) { pulls++; controller.close() } }, { highWaterMark: 0 }), {
      headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']]
    }))
    await response.text()
  })
  it('collects a body transport failure and returns only the stable code', async () => {
    const response = await execute(async (ctx: any) => {
      const result = await ctx.fetch(url, { errors: 'collect' }).text()
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.error)).toBe(true)
      return ctx.json(result)
    }, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private transport detail')) } })))
    expect(await response.json()).toEqual(rejected('PULSE_FETCH_NETWORK'))
  })
  it.each(['json', 'bounds', 'invalid-init', 'mixed'])('keeps %s failures fatal', async failure => {
    let continued = false
    const running = execute(async (ctx: any) => {
      if (failure === 'mixed') await ctx.parallel({ a: ctx.fetch(url, { errors: 'collect' }), b: ctx.fetch(url + '/bad') })
      else if (failure === 'invalid-init') await ctx.fetch(url, { errors: 'collect', timeoutMs: -1 })
      else if (failure === 'json') await ctx.fetch(url, { errors: 'collect' }).json()
      else await ctx.fetch(url, { errors: 'collect' }).text()
      continued = true
      return ctx.text('unreachable')
    }, async (input: string) => {
      if (input.endsWith('bad')) throw new Error('network')
      return new Response('invalid json and oversized body', { headers: { 'content-type': 'application/json' } })
    }, failure === 'bounds' ? { maxFetchBodyBytes: 2 } : {})
    expect((await running).status).toBe(500)
    expect(continued).toBe(false)
  })
  it('collects member timeout without retrying or changing successful siblings', async () => {
    vi.useFakeTimers()
    let calls = 0
    const running = execute(async (ctx: any) => ctx.json(await ctx.parallel({
      first: ctx.fetch(url, { errors: 'collect', timeoutMs: 10 }).text(),
      second: ctx.fetch(url + '/fast', { errors: 'collect' }).text()
    })), (input: string) => { calls++; return input.endsWith('fast') ? Promise.resolve(new Response('ok')) : new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(10)
    expect(await (await running).json()).toEqual({ first: rejected('PULSE_FETCH_TIMEOUT'), second: fulfilled('ok') })
    expect(calls).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves enclosing cancellation during a stalled projection', async () => {
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const running = execute(async (ctx: any) => ctx.json(await ctx.fetch(url, { errors: 'collect' }).text()),
      async () => { started(); return new Response(new ReadableStream()) }, { signal: controller.signal })
    const failed = expect(running).rejects.toBeDefined()
    await ready
    controller.abort(new Error('request cancelled'))
    await failed
  })
})
it('keeps an equal enclosing deadline authoritative', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const running = node.executeNodeJavascriptApplication(async (ctx: any) => ctx.json(await ctx.fetch(url, { errors: 'collect', timeoutMs: 10 })),
    new Request('https://application.test/'), { maxDurationMs: 10, requestClock: { now: () => Date.now(), setTimeout, clearTimeout }, fetchImplementation: () => new Promise(() => {}) })
  const failed = expect(running).rejects.toMatchObject({ code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' })
  await vi.advanceTimersByTimeAsync(10); await failed
})
