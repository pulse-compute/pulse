import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const node = require('../../provider-node/src/javascript/runtime-host.js')
const fastly = require('../../provider-fastly/src/javascript/runtime-host.js')
const { createFetchTiming } = require('../src/host.js')
const url = 'https://timing.test/data'
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
for (const target of ['node', 'fastly']) describe(`${target} transport timing`, () => {
  const run = (handler: any, fetchImplementation: any, fetchClock: any) =>
    (target === 'node' ? node.executeNodeJavascriptApplication : fastly.executeFastlyJavascriptApplication)(handler,
      new Request('https://app.test/'), { fetchImplementation, fetchClock, bindings: { backends: { 'https://timing.test': 'origin' } } })
  it.each([undefined, false, true])('preserves option combinations, timing=%s', async timing => {
    for (const collect of [false, true]) {
      let t = 10, samples = 0
      const r = await run(async (ctx: any) => ctx.json(await ctx.fetch(url, { timing, ...(collect ? { errors: 'collect' } : {}) }).text()),
        async () => { t = 14; return new Response('ok') }, { now: () => { samples++; return t } })
      expect(await r.json()).toEqual(timing ? { status: 'fulfilled', value: 'ok', elapsedMs: 4 } : collect ? { status: 'fulfilled', value: 'ok' } : 'ok')
      if (!timing) expect(samples).toBe(0)
    }
  })
  it('does not acquire an opaque body for timing', async () => {
    let t = 0, pulls = 0
    const r = await run(async (ctx: any) => {
      const result = await ctx.fetch(url, { timing: true })
      expect(result.elapsedMs).toBe(7)
      expect(pulls).toBe(0)
      return ctx.json({ status: result.value.status, elapsedMs: result.elapsedMs })
    }, async () => { t = 7; return new Response(new ReadableStream({ pull() { pulls++ } }, { highWaterMark: 0 }), { status: 503 }) }, { now: () => t })
    expect(await r.json()).toEqual({ status: 503, elapsedMs: 7 })
  })
  it('stops at the last payload byte before EOF, decoding, parsing and caller work', async () => {
    let t = 0, reads = 0
    const decode = TextDecoder.prototype.decode
    vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (this: TextDecoder, ...args: any[]) { t += 100; return decode.apply(this, args as any) })
    const r = await run(async (ctx: any) => {
      const result = await ctx.fetch(url, { timing: true }).json()
      t += 1000
      return ctx.json(result)
    }, async () => {
      t = 5
      return new Response(new ReadableStream({ pull(c) {
        if (reads++ === 0) { t = 12; c.enqueue(new TextEncoder().encode('{"ok":true}')) }
        else { t = 80; c.close() }
      } }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json' } })
    }, { now: () => t })
    expect(await r.json()).toEqual({ status: 'fulfilled', value: { ok: true }, elapsedMs: 12 })
  })
  it('captures each projected member before a reversed join', async () => {
    vi.useFakeTimers()
    const r = run(async (ctx: any) => ctx.json(await ctx.parallel({
      slow: ctx.fetch(url + '/slow', { timing: true }).text(), fast: ctx.fetch(url + '/fast', { timing: true }).text()
    })), async (input: string) => new Response(new ReadableStream({ start(c) {
      setTimeout(() => { c.enqueue(new TextEncoder().encode(input.endsWith('slow') ? 'slow' : 'fast')); c.close() }, input.endsWith('slow') ? 80 : 10)
    } })), { now: () => performance.now() })
    await vi.advanceTimersByTimeAsync(80)
    const value = await (await r).json()
    expect(value.slow.elapsedMs).toBe(80); expect(value.fast.elapsedMs).toBe(10)
  })
  it('collects measured network failure; timing alone still fails', async () => {
    for (const collect of [false, true]) {
      let t = 0
      const r = await run(async (ctx: any) => ctx.json(await ctx.fetch(url, { timing: true, ...(collect ? { errors: 'collect' } : {}) })),
        async () => { t = 9; throw new Error('private origin') }, { now: () => t })
      if (collect) expect(await r.json()).toEqual({ status: 'rejected', error: { code: 'PULSE_FETCH_NETWORK' }, elapsedMs: 9 })
      else expect(r.status).toBe(500)
    }
  })
  it('keeps invalid JSON fatal', async () => {
    const r = await run(async (ctx: any) => ctx.json(await ctx.fetch(url, { timing: true, errors: 'collect' }).json()),
      async () => new Response('{bad'), { now: () => 0 })
    expect(r.status).toBe(500)
  })
})
describe('monotonic observation validity', () => {
  it.each([[0, 0, 0], [1, 1.25, .25], [2, 1, null], [0, NaN, null], [NaN, 4, null], [0, Infinity, null], [0, Number.MAX_SAFE_INTEGER + 1, null]])('samples %s → %s', (a, b, expected) => {
    let t = a
    const record = createFetchTiming({ now: () => t }); record.begin(); t = b; record.headers()
    expect(record.elapsed()).toBe(expected)
  })
  it('reports missing provider observations explicitly; pre-dispatch failure has no duration', () => {
    const record = createFetchTiming({ now: () => 0 }); record.fail()
    expect(record.elapsed('response', true)).toBeNull()
    expect(() => record.elapsed()).toThrow(expect.objectContaining({ code: 'PULSE_FETCH_TIMING_UNSUPPORTED' }))
  })
  it('never falls back to wall time', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('wall clock forbidden') })
    const record = createFetchTiming({ now: () => { throw Error('sample unavailable') } })
    record.begin(); record.headers(); expect(record.elapsed()).toBeNull()
  })
})
it('real Node transport reports independent raw/body durations across repeated requests', async () => {
  const http = await import('node:http'), { once } = await import('node:events')
  let calls = 0
  const server = http.createServer((_req, res) => {
    calls++; res.writeHead(200, { 'content-type': 'text/plain' }); res.flushHeaders()
    setTimeout(() => res.end('payload'), 40)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  try {
    for (let i = 0; i < 2; i++) {
      const r = await node.executeNodeJavascriptApplication(async (ctx: any) => {
        const result = await ctx.parallel({ raw: ctx.fetch(origin, { timing: true }), body: ctx.fetch(origin, { timing: true }).text() })
        return ctx.json({ raw: result.raw.elapsedMs, body: result.body.elapsedMs, value: result.body.value })
      }, new Request('https://app.test/'), { fetchImplementation: fetch })
      const result = await r.json()
      expect(result.value).toBe('payload')
      expect(result.raw).toBeGreaterThanOrEqual(0)
      expect(result.body).toBeGreaterThanOrEqual(25)
      expect(result.body).toBeLessThan(2000)
      expect(result.raw).toBeLessThan(result.body)
    }
    expect(calls).toBe(4)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
it('timing does not recover an expired enclosing request', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0)
  const running = node.executeNodeJavascriptApplication(async (ctx: any) => ctx.json(await ctx.fetch(url, { timing: true, errors: 'collect', timeoutMs: 10 })),
    new Request('https://app.test/'), { maxDurationMs: 10, requestClock: { now: () => Date.now(), setTimeout, clearTimeout }, fetchImplementation: () => new Promise(() => {}) })
  const failure = expect(running).rejects.toMatchObject({ code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' })
  await vi.advanceTimersByTimeAsync(10); await failure
})
