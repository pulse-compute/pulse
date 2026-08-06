import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssets } from '../src/index.js'

const require = createRequire(import.meta.url)
const { Router } = require('../../runtime/src/index.js') as { Router: new () => any }
const runtime = require('../../runtime/src/internal/index.js') as {
  executeRouter(router: object, request: Request, options?: Record<string, unknown>): Promise<Response>
}
const { createNodeJavascriptHandler } = require('../../provider-node/src/javascript/node-adapter.js') as {
  createNodeJavascriptHandler(application: object, options?: Record<string, unknown>): (request: unknown, response: unknown) => Promise<Response>
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

function streamFrom(chunks: string[], onCancel?: (reason: unknown) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
    cancel(reason) {
      onCancel?.(reason)
    },
  })
}

function setCookieValues(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof extended.getSetCookie === 'function') return extended.getSetCookie()
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP server address')
  return address.port
}

describe('@pulse-compute/assets JavaScript Pulse realization', () => {
  it('uses the scoped Pulse path and adopts hosted response streams without a byte copy', async () => {
    const app = new Router()
    const upstreamBody = streamFrom(['chunk-one', 'chunk-two'])
    const fetchSpy = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://cdn.example.test/static/js/app.js?v=1')
      expect(request.method).toBe('GET')
      expect(request.headers.get('range')).toBe('bytes=0-15')
      const headers = new Headers([
        ['content-type', 'application/javascript'],
        ['content-range', 'bytes 0-15/32'],
        ['set-cookie', 'asset-a=1; Path=/'],
        ['set-cookie', 'asset-b=2; Path=/'],
        ['x-upstream', 'hosted'],
      ])
      return new Response(upstreamBody, { status: 206, headers })
    })

    app.use('/assets', createAssets({
      mode: 'hosted',
      origin: 'https://cdn.example.test',
      prefix: 'static',
      ttl: 60,
      fetch: fetchSpy as unknown as typeof fetch,
    }))

    const response = await runtime.executeRouter(
      app,
      new Request('https://app.example.test/assets/js/app.js?v=1', {
        headers: { range: 'bytes=0-15' },
      }),
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(206)
    expect(response.body).toBe(upstreamBody)
    expect(response.headers.get('content-range')).toBe('bytes 0-15/32')
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('x-upstream')).toBe('hosted')
    expect(setCookieValues(response.headers)).toEqual(['asset-a=1; Path=/', 'asset-b=2; Path=/'])
    expect(await response.text()).toBe('chunk-onechunk-two')
  })

  it('cancels discarded 404 and HEAD bodies before routing or completing', async () => {
    const passThroughApp = new Router()
    let missingCancelled = 0
    passThroughApp.use('/assets', createAssets({
      mode: 'hosted',
      origin: 'https://cdn.example.test',
      fetch: (async () => new Response(streamFrom(['missing'], () => { missingCancelled += 1 }), { status: 404 })) as typeof fetch,
    }))
    passThroughApp.get('/assets/:name', async (ctx: any) => ctx.text(`fallback:${ctx.param('name')}`))

    const missing = await runtime.executeRouter(
      passThroughApp,
      new Request('https://app.example.test/assets/missing.js'),
    )
    expect(missing.status).toBe(200)
    expect(await missing.text()).toBe('fallback:missing.js')
    expect(missingCancelled).toBe(1)

    const headApp = new Router()
    let headCancelled = 0
    let upstreamMethod = ''
    headApp.use('/assets', createAssets({
      mode: 'hosted',
      origin: 'https://cdn.example.test',
      fetch: (async (request: Request) => {
        upstreamMethod = request.method
        return new Response(streamFrom(['must-not-leak'], () => { headCancelled += 1 }), {
          status: 200,
          headers: { 'x-head': 'preserved' },
        })
      }) as typeof fetch,
    }))

    const head = await runtime.executeRouter(
      headApp,
      new Request('https://app.example.test/assets/app.js', { method: 'HEAD' }),
    )
    expect(upstreamMethod).toBe('HEAD')
    expect(head.status).toBe(200)
    expect(head.headers.get('x-head')).toBe('preserved')
    expect(head.body).toBeNull()
    expect(await head.text()).toBe('')
    expect(headCancelled).toBe(1)
  })

  it('serves local files through the same package-root middleware', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulse-assets-'))
    cleanup.push(async () => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'app.js'), 'console.log("pulse")')

    const app = new Router()
    app.use('/static', createAssets({ mode: 'local', dir: directory, ttl: false }))

    const response = await runtime.executeRouter(
      app,
      new Request('https://app.example.test/static/app.js'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.has('cache-control')).toBe(false)
    expect(await response.text()).toBe('console.log("pulse")')
  })

  it('streams package-root asset responses through the Node JavaScript provider boundary', async () => {
    const app = new Router()
    const requestEvents: unknown[] = []
    app.use('/assets', createAssets({
      mode: 'hosted',
      origin: 'https://cdn.example.test',
      fetch: (async () => {
        const headers = new Headers([
          ['content-type', 'application/octet-stream'],
          ['set-cookie', 'one=1; Path=/'],
          ['set-cookie', 'two=2; Path=/'],
          ['x-provider-stream', 'yes'],
        ])
        return new Response(streamFrom(['alpha', '-', 'omega']), { status: 206, headers })
      }) as typeof fetch,
    }))

    const handler = createNodeJavascriptHandler(app, {
      onRequest: (event: unknown) => requestEvents.push(event),
    })
    const server = createServer((request, response) => {
      void handler(request, response).catch((error) => {
        response.statusCode = 500
        response.end(String(error?.stack || error))
      })
    })
    const port = await listen(server)

    const response = await fetch(`http://127.0.0.1:${port}/assets/blob.bin`)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('x-provider-stream')).toBe('yes')
    expect(setCookieValues(response.headers)).toEqual(['one=1; Path=/', 'two=2; Path=/'])
    expect(await response.text()).toBe('alpha-omega')
    expect(requestEvents).toHaveLength(1)
    expect(requestEvents[0]).toMatchObject({ method: 'GET', path: '/assets/blob.bin', status: 206 })
  })
})
