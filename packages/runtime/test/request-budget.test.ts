import { createRequire } from 'node:module'
import { PassThrough, Writable } from 'node:stream'
import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const host = require('../src/host.js')
const nodeHost = require('../../provider-node/src/javascript/runtime-host.js')
const { createNodeJavascriptHandler, writeWebResponseToNode } = require('../../provider-node/src/javascript/node-adapter.js')
const { statusForError } = require('../../provider-node/src/javascript/lifecycle.js')
function clock() {
  let now = 0
  const timers = new Map<any, any>()
  return { now: () => now, setTimeout(fn: any, ms: number) { const id = {}; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeout(id: any) { timers.delete(id) }, advance(ms: number, fire = true) { now += ms; if (fire) for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn() } }, pending: () => timers.size }
}
const exceeded = { code: 'PULSE_REQUEST_DEADLINE_EXCEEDED' }
describe('provider-owned request budget', () => {
  it('validates configuration and accepts only an authentic inherited budget', () => {
    for (const value of [0, -1, 1.5, 30001, NaN, Infinity, '10', null]) expect(() => host.createRequestBudget({ maxDurationMs: value })).toThrow()
    expect(() => host.createRequestBudget({ requestBudget: { check() {} } })).toThrow()
    const c = clock(), budget = host.createRequestBudget({ maxDurationMs: 10000, requestClock: c })
    c.advance(6000)
    expect(host.createRequestBudget({ requestBudget: budget, maxDurationMs: 10000 })).toBe(budget)
    expect(budget.remainingMs()).toBe(4000)
    budget.close(); expect(c.pending()).toBe(0)
  })
  it('checks monotonic time even without a timer callback and fails closed on clock regression', () => {
    const c = clock(), b = host.createRequestBudget({ maxDurationMs: 10, requestClock: c })
    c.advance(10, false); expect(() => b.check()).toThrow(expect.objectContaining(exceeded)); b.close()
    const d = clock(), b2 = host.createRequestBudget({ maxDurationMs: 10, requestClock: d })
    d.advance(-1, false); expect(() => b2.check()).toThrow(expect.objectContaining({ code: 'PULSE_REQUEST_CLOCK_INVALID' })); b2.close()
  })
  it('shares one budget across effects and prevents a later write after expiry', async () => {
    const c = clock(); let calls = 0, writes = 0
    const app = async (ctx: any) => {
      await ctx.config.get('one'); await ctx.config.get('two');
      await ctx.kv('jobs').put('checkpoint', 1); return ctx.text('done')
    }
    const run = nodeHost.executeNodeJavascriptApplication(app, new Request('http://deadline.test'), { maxDurationMs: 10000, requestClock: c,
      effectAdapter: { id: 'deadline-test', dispatch(effect: any) { if (effect.kind === 'kv.put') { writes++; return true }; calls++; c.advance(6000, false); return 'value' } } })
    await expect(run).rejects.toMatchObject(exceeded)
    expect(calls).toBe(2); expect(writes).toBe(0); expect(c.pending()).toBe(0)
  })
  it('revokes a dispatched write without treating a late acknowledgement as rollback or resuming the handler', async () => {
    const c = clock(); let finish: any, admitted: any, continued = false
    const ready = new Promise(r => { admitted = r })
    const run = nodeHost.executeNodeJavascriptApplication(async (ctx: any) => { await ctx.kv('jobs').put('checkpoint', 1); continued = true; return ctx.text('done') }, new Request('http://deadline.test'), {
      maxDurationMs: 10, requestClock: c, effectAdapter: { id: 'late-write', dispatch(_effect: any, execution: any) { admitted(execution.signal); return new Promise(r => { finish = r }) } }
    })
    const rejection = expect(run).rejects.toMatchObject(exceeded)
    const signal: any = await ready; c.advance(10); await rejection
    expect(signal.aborted).toBe(true); finish(true); await Promise.resolve(); await Promise.resolve()
    expect(continued).toBe(false); expect(c.pending()).toBe(0)
  })
  it('starts at body admission, cancels buffering, and never begins binding lookup', async () => {
    const c = clock(), request: any = new PassThrough(); request.method = 'POST'; request.url = '/'; request.headers = {host: 'deadline.test'}
    let lookups = 0
    const handler = createNodeJavascriptHandler(async (ctx: any) => ctx.text('ok'), { maxDurationMs: 10, requestClock: c, config: () => { lookups++; return {} } })
    const run = handler(request, {}); const rejection = expect(run).rejects.toMatchObject(exceeded)
    request.write('partial'); c.advance(10); await rejection
    expect(lookups).toBe(0); expect(request.listenerCount('data')).toBe(0); request.end()
    expect(statusForError(exceeded)).toBe(504)
  })
  it('covers asynchronous binding resolution before the application starts', async () => {
    const c = clock(), request: any = new PassThrough(); request.method = 'GET'; request.url = '/'; request.headers = {host: 'deadline.test'}
    let started: any, secretReads = 0, calls = 0
    const ready = new Promise(r => { started = r })
    const handler = createNodeJavascriptHandler(async (ctx: any) => { calls++; return ctx.text('ok') }, {
      maxDurationMs: 10, requestClock: c, config: () => { started(); return new Promise(() => {}) }, secrets: () => { secretReads++; return {} }
    })
    const run = handler(request, {}); const rejection = expect(run).rejects.toMatchObject(exceeded)
    await ready; c.advance(10); await rejection; expect(secretReads).toBe(0); expect(calls).toBe(0); request.end()
  })
  it('cancels a pending fetched response body and observes a late rejection', async () => {
    const c = clock(); let started: any, cancelled = false
    const ready = new Promise(r => { started = r })
    const run = nodeHost.executeNodeJavascriptApplication(async (ctx: any) => { const text = await ctx.fetch('https://origin.test').text(); return ctx.text(text) }, new Request('http://deadline.test'), {
      maxDurationMs: 10, requestClock: c, fetchImplementation: async () => new Response(new ReadableStream({
        pull() { started(); return new Promise(() => {}) }, cancel() { cancelled = true }
      }), { headers: { 'content-type': 'text/plain' } })
    })
    const rejected = expect(run).rejects.toMatchObject(exceeded)
    await ready; c.advance(10); await rejected; expect(cancelled).toBe(true)
  })

  it('releases consumed fetch cancellation roots while an inherited budget stays open', async () => {
    const b = host.createRequestBudget(); let calls = 0
    const seen: Array<{ text: string, listeners: number }> = []
    const response = await nodeHost.executeNodeJavascriptApplication(async (ctx: any) => {
      for (let i = 0; i < 8; i++) {
        const fetched = ctx.fetch('https://origin.test/' + i)
        const text = await fetched.text()
        const again = await fetched.text()
        seen.push({text: text + ':' + again, listeners: getEventListeners(b.signal, 'abort').length})
      }
      return ctx.text('done')
    }, new Request('http://deadline.test'), {requestBudget: b, effectAdapter: {
      id: 'consumed-fetch-root', dispatch() { return new Response('body-' + calls++, {headers: {'content-type': 'text/plain'}}) }
    }})
    expect(await response.text()).toBe('done')
    expect(seen.map(row => row.text)).toEqual(Array.from({length: 8}, (_, i) => `body-${i}:body-${i}`))
    expect(seen.map(row => row.listeners)).toEqual(Array(8).fill(seen[0].listeners))
    b.close()
  })

  it('retains cancellation for unread pass-through and releases failed consumed reads', async () => {
    const b = host.createRequestBudget(); let cancelled = 0
    const passed = await nodeHost.executeNodeJavascriptApplication(async (ctx: any) => ctx.fetch('https://origin.test/'),
      new Request('http://deadline.test'), {requestBudget: b, effectAdapter: {id: 'unread-fetch-root', dispatch() {
        return new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('stream')); controller.close() },
          cancel() { cancelled++ }}), {headers: {'content-type': 'application/octet-stream'}})
      }}})
    const beforeClose = getEventListeners(b.signal, 'abort').length
    b.close()
    expect(getEventListeners(b.signal, 'abort').length).toBe(beforeClose - 1)
    expect(await passed.text()).toBe('stream')
    expect(cancelled).toBe(0)

    const failedBudget = host.createRequestBudget(); const failedListeners: number[] = []
    const failed = await nodeHost.executeNodeJavascriptApplication(async (ctx: any) => {
      for (let i = 0; i < 4; i++) {
        try { await ctx.fetch('https://origin.test/').text() }
        catch (error: any) { expect(error.code).toBe('PULSE_BODY_TOO_LARGE') }
        failedListeners.push(getEventListeners(failedBudget.signal, 'abort').length)
      }
      return ctx.text('handled')
    }, new Request('http://deadline.test'), {requestBudget: failedBudget, maxFetchBodyBytes: 4,
      effectAdapter: {id: 'failed-fetch-root', dispatch() { return new Response('more than four bytes') }}})
    expect(await failed.text()).toBe('handled')
    expect(failedListeners).toEqual(Array(4).fill(failedListeners[0]))
    failedBudget.close()

    const source = new AbortController(), unreadBudget = host.createRequestBudget({signal: source.signal}); let unreadCancelled = 0
    const rejectedBeforeRead = await nodeHost.executeNodeJavascriptApplication(async (ctx: any) => {
      try { await ctx.fetch('https://origin.test/').text() }
      catch (error: any) { expect(error.code).toBe('PULSE_BODY_TOO_LARGE') }
      return ctx.text('admission rejected')
    }, new Request('http://deadline.test'), {requestBudget: unreadBudget, maxFetchBodyBytes: 4,
      effectAdapter: {id: 'unread-after-admission', dispatch() { return new Response(new ReadableStream({
        cancel() { unreadCancelled++ }
      }), {headers: {'content-type': 'text/plain', 'content-length': '100'}}) }}})
    expect(await rejectedBeforeRead.text()).toBe('admission rejected')
    source.abort()
    await Promise.resolve()
    expect(unreadCancelled).toBe(1)
    unreadBudget.close()
  })

  it('removes onAbort hooks at normal close without cancelling transferred bodies', async () => {
    const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let cancelled = 0
    const remove = b.onAbort(() => { cancelled++ })
    expect(getEventListeners(b.signal, 'abort').length).toBe(1)
    remove(); expect(getEventListeners(b.signal, 'abort').length).toBe(0)
    b.onAbort(() => { cancelled++ }); b.close(); b.close(); c.advance(10)
    expect(cancelled).toBe(0); expect(getEventListeners(b.signal, 'abort').length).toBe(0); expect(c.pending()).toBe(0)
    let disposed = false
    const result = await nodeHost.executeNodeJavascriptApplication(async (ctx: any) => ctx.fetch('https://origin.test'), new Request('http://deadline.test'), {
      maxDurationMs: 10, requestClock: clock(), fetchImplementation: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('body')); controller.close() }, cancel() { disposed = true }
      }), {headers: {'content-type': 'application/octet-stream'}})
    })
    expect(await result.text()).toBe('body'); expect(disposed).toBe(false)
  })
  it('disposes a fetched response that settles after expiry without resuming work', async () => {
    const c = clock(); let resolve: any, started: any, disposed = false, continued = false
    const ready = new Promise(r => { started = r })
    const pending = nodeHost.executeNodeJavascriptApplication(async (ctx: any) => { await ctx.fetch('https://origin.test'); continued = true; return ctx.text('late') }, new Request('http://deadline.test'), {
      maxDurationMs: 10, requestClock: c, fetchImplementation: () => { started(); return new Promise(r => { resolve = r }) }
    })
    const rejected = expect(pending).rejects.toMatchObject(exceeded)
    await ready; c.advance(10); await rejected
    resolve(new Response(new ReadableStream({cancel() { disposed = true }})))
    await new Promise(r => setImmediate(r))
    expect(disposed).toBe(true); expect(continued).toBe(false)
  })
  it('checks buffered Node response handoff after materialization and header work', async () => {
    const {writeNodeHttpResponse} = require('../../../wasm/packages/cli/src/internal/node-http.js')
    for (const mode of ['native', 'javascript']) {
      const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let ends = 0
      const response = {setHeader() { c.advance(10, false) }, end() { ends++ }}
      if (mode === 'native') expect(() => writeNodeHttpResponse(response, {status: 200, headers: [['x-fixture', '1']], body: 'ok'}, {requestBudget: b})).toThrow(expect.objectContaining(exceeded))
      else await expect(writeWebResponseToNode(new Response(null, {headers: {'x-fixture': '1'}}), response, {requestBudget: b, signal: b.signal})).rejects.toMatchObject(exceeded)
      expect(ends).toBe(0); b.close()
    }
  })
  it('keeps the JavaScript response writer in budget until it settles', async () => {
    const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let started: any
    const ready = new Promise(r => { started = r })
    const response: any = new Writable({write(_chunk, _encoding, _callback) { started() }})
    response.setHeader = () => {}
    const writing = writeWebResponseToNode(new Response('buffered'), response, {requestBudget: b, signal: b.signal})
    const rejected = expect(writing).rejects.toMatchObject(exceeded)
    await ready; c.advance(10); await rejected
    expect(response.destroyed).toBe(true); b.close(); expect(c.pending()).toBe(0)
  })
  it('does not withdraw a Native buffered handoff completed inside a noninterruptible call', () => {
    const {writeNodeHttpResponse} = require('../../../wasm/packages/cli/src/internal/node-http.js')
    const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let ends = 0
    writeNodeHttpResponse({end() { ends++; c.advance(11, false) }}, {body: 'ok'}, {requestBudget: b})
    b.close(); expect(ends).toBe(1); expect(c.pending()).toBe(0)
  })
  it('keeps concurrent request budgets independent', async () => {
    const c = clock(), a = host.createRequestBudget({maxDurationMs: 10, requestClock: c})
    c.advance(5); const b = host.createRequestBudget({maxDurationMs: 10, requestClock: c})
    c.advance(5); expect(() => a.check()).toThrow(expect.objectContaining(exceeded)); expect(b.remainingMs()).toBe(5)
    a.close(); b.close()
  })

  it('cancels an owned Native opaque fetch on expiry but preserves normal handoff', async () => {
    const {executeLiveFetch} = require('../../provider-node/src/runtime/canonical-api-runtime.js')
    for (const expire of [false, true]) {
      const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let disposed = false
      const fetched = await executeLiveFetch({parts: {url: 'https://origin.test'}, init: {method: 'GET'}, responseMode: 'opaque'},
        async () => new Response(new ReadableStream({cancel() { disposed = true }})), {requestBudget: b, signal: b.signal})
      if (expire) { c.advance(10); await new Promise(r => setImmediate(r)); expect(disposed).toBe(true) }
      else { b.close(); expect(fetched.bodyStream.destroyed).toBe(false); fetched.bodyStream.destroy() }
      b.close()
    }
  })
  it('rechecks the request budget during S3 credentials even before the timer fires', async () => {
    const {createNodeJavascriptS3} = require('../../provider-node/src/javascript/s3.js')
    const c = clock(), b = host.createRequestBudget({maxDurationMs: 10, requestClock: c}); let sends = 0
    const s3 = createNodeJavascriptS3({s3: {objects: {endpoint: 'https://objects.test', bucket: 'fixture', region: 'us-east-1', accessKeyIdSecret: 'key', secretAccessKeySecret: 'secret'}},
      fetchImplementation: () => { sends++; throw Error('must not send') }}, async () => { c.advance(10, false); return 'fixture' })
    await expect(s3({kind:'s3.putText',operation:'putText',capability:'s3.putText',package:'@pulse-compute/s3',contractId:'pulse.s3',providerKind:'s3',payload:{binding:'objects',key:'key',text:'value'}},
      {requestBudget:b,signal:b.signal})).rejects.toMatchObject(exceeded)
    expect(sends).toBe(0); b.close()
  })

})
