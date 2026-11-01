import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const host = require('../src/host.js')
const node = require('../../provider-node/src/javascript/runtime-host.js')
const fastly = require('../../provider-fastly/src/javascript/runtime-host.js')
const { executeLiveFetch } = require('../../provider-node/src/runtime/canonical-api-runtime.js')
const url = 'https://deadline.test/data'
const request = () => new Request('https://application.test/')
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const requestClock = { now: () => Date.now(), setTimeout, clearTimeout }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers() })

for (const target of ['node', 'fastly']) describe(`${target} JavaScript fetch deadlines`, () => {
  const execute = (handler: any, fetchImplementation: any, options = {}) => {
    const run = target === 'node' ? node.executeNodeJavascriptApplication : fastly.executeFastlyJavascriptApplication
    return run(handler, request(), { fetchImplementation, bindings: { backends: { 'https://deadline.test': 'origin' } }, ...options })
  }

  it.each([false, true])('clears the member timer at headers before body acquisition; grouped=%s', async grouped => {
    let finish: any, cancelled = 0, signal: any, continued = false
    const running = execute(async (ctx: any) => {
      const operation = ctx.fetch(url, { timeoutMs: 20 }).text()
      const result = grouped ? (await ctx.parallel({ body: operation })).body : await operation
      continued = true
      return ctx.text(result)
    }, async (_url: any, init: any) => {
      signal = init.signal
      return new Response(new ReadableStream({
        start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('payload')); controller.close() } },
        cancel() { cancelled++ }
      }), { headers: { 'content-type': 'text/plain' } })
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(continued).toBe(false)
    expect(signal.aborted).toBe(false)
    expect(cancelled).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    finish()
    expect(await (await running).text()).toBe('payload')
  })

  it('captures timely headers independently of a slower sibling and does not restart at join', async () => {
    const signals: any[] = []
    const running = execute(async (ctx: any) => {
      const result = await ctx.parallel({
        slow: ctx.fetch(url + '/slow', { timeoutMs: 100 }),
        fast: ctx.fetch(url + '/fast', { timeoutMs: 20 })
      })
      return ctx.text(`${result.slow.status}:${result.fast.status}`)
    }, async (input: string, init: any) => {
      signals.push(init.signal)
      await delay(input.endsWith('slow') ? 80 : 10)
      return new Response(null, { status: 202 })
    })
    await vi.advanceTimersByTimeAsync(80)
    expect(await (await running).text()).toBe('202:202')
    expect(signals.every(signal => !signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts collection member timers at flush, not construction', async () => {
    let dispatches = 0
    const running = execute(async (ctx: any) => {
      const effects = ctx.effects({ max: 2 })
      effects.add(ctx.fetch(url, { timeoutMs: 10 }))
      // Deliberately hold the runtime collection before flushing its owned work.
      await delay(100)
      expect(dispatches).toBe(0)
      const result = await ctx.parallel(effects)
      return ctx.text(String(result[0].status))
    }, async () => { dispatches++; await delay(5); return new Response(null, { status: 202 }) })
    await vi.advanceTimersByTimeAsync(105)
    expect(await (await running).text()).toBe('202')
    expect(dispatches).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a member at expiry, disposes late headers, and never retries', async () => {
    let finish: any, cancelled = 0, dispatches = 0
    const running = execute(async (ctx: any) => {
      try { await ctx.fetch(url, { timeoutMs: 20 }) }
      catch (error: any) { return ctx.text(error.code) }
      return ctx.text('unexpected success')
    }, () => { dispatches++; return new Promise(resolve => { finish = resolve }) })
    await vi.advanceTimersByTimeAsync(20)
    expect(await (await running).text()).toBe('PULSE_FETCH_TIMEOUT')
    finish(new Response(new ReadableStream({ cancel() { cancelled++ } })))
    await vi.advanceTimersByTimeAsync(0)
    expect(cancelled).toBe(1)
    expect(dispatches).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('enclosing deadline authority', () => {
  it.each([10, 20])('keeps an earlier or equal request deadline fatal (%sms)', async maxDurationMs => {
    let signal: any, resumed = false
    const running = node.executeNodeJavascriptApplication(async (ctx: any) => {
      try { await ctx.fetch(url, { timeoutMs: 20 }) } catch (_) { /* recovery cannot restore authority */ }
      await ctx.config.get('checkpoint')
      resumed = true
      return ctx.text('late')
    }, request(), { maxDurationMs, requestClock: { ...requestClock, setTimeout, clearTimeout },
      fetchImplementation: (_url: any, init: any) => {
        signal = init.signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      } })
    const rejected = expect(running).rejects.toMatchObject({ code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' })
    await vi.advanceTimersByTimeAsync(maxDurationMs)
    await rejected
    expect(signal.aborted).toBe(true)
    expect(resumed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('fences a stalled body after the header timeout is retired; grouped=%s', async grouped => {
    let cancelled = 0, resumed = false
    const running = node.executeNodeJavascriptApplication(async (ctx: any) => {
      const body = ctx.fetch(url, { timeoutMs: 10 }).text()
      if (grouped) await ctx.parallel({ body })
      else await body
      resumed = true
      return ctx.text('late')
    }, request(), { maxDurationMs: 50, requestClock: { ...requestClock, setTimeout, clearTimeout },
      fetchImplementation: async () => new Response(new ReadableStream({ cancel() { cancelled++ } }),
        { headers: { 'content-type': 'text/plain' } }) })
    const rejected = expect(running).rejects.toMatchObject({ code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' })
    await vi.advanceTimersByTimeAsync(50)
    await rejected
    expect(cancelled).toBe(1)
    expect(resumed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not imply total-deadline support on Fastly JavaScript', async () => {
    await expect(fastly.executeFastlyJavascriptApplication(() => {}, request(), { maxDurationMs: 50 }))
      .rejects.toMatchObject({ code: 'PULSE_REQUEST_DURATION_UNSUPPORTED' })
  })
})

describe('Node Native live transport boundary', () => {
  it.each(['opaque', 'structured'])('preserves the existing %s response lifetime', async responseMode => {
    let cancelled = 0
    const running = executeLiveFetch({ parts: { url }, init: { method: 'GET', timeoutMs: 20 }, responseMode },
      async () => new Response(new ReadableStream({ cancel() { cancelled++ } }),
        { headers: { 'content-type': 'text/plain' } }))
    if (responseMode === 'structured') {
      const rejected = expect(running).rejects.toMatchObject({ code: 'PULSE_FETCH_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(20)
      await rejected
      expect(cancelled).toBe(1)
    } else {
      const result = await running
      await vi.advanceTimersByTimeAsync(100)
      expect(cancelled).toBe(0)
      result.bodyStream.destroy()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves enclosing authority when both deadlines expire', async () => {
    const budget = host.createRequestBudget({ maxDurationMs: 20, requestClock: { ...requestClock, setTimeout, clearTimeout } })
    const running = executeLiveFetch({ parts: { url }, init: { method: 'GET', timeoutMs: 20 }, responseMode: 'structured' },
      async () => new Response(new ReadableStream()), { requestBudget: budget, signal: budget.signal })
    const rejected = expect(running).rejects.toMatchObject({ code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    budget.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})
