'use strict'

const http = require('node:http')
const { createNodeLauncher } = require('@pulse-compute/provider-node/server')
const { createMcpNodeHandler } = require('@pulse-compute/mcp/node')
const { loadHostBuild } = require('./artifacts.cjs')
const LIMITS = Object.freeze({
  maxRequestBytes: 32768,
  maxResponseBytes: 131072,
  maxDepth: 32,
  deadlineMs: 5000,
})

function createContextHost(options) {
  if (
    !options ||
    Object.keys(options).some(
      (key) =>
        ![
          'buildDir',
          'port',
          'legacyProtocol',
          'deadlineMs',
          'shutdownTimeoutMs',
        ].includes(key),
    ) ||
    typeof options.buildDir !== 'string'
  )
    throw new TypeError('Invalid Pulse context host options.')
  const port = options.port ?? 8788,
    deadlineMs = options.deadlineMs ?? LIMITS.deadlineMs,
    shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1000
  if (
    ![port, deadlineMs, shutdownTimeoutMs].every(Number.isInteger) ||
    port < 0 ||
    port > 65535 ||
    deadlineMs < 1 ||
    deadlineMs > LIMITS.deadlineMs ||
    shutdownTimeoutMs < 1 ||
    shutdownTimeoutMs > 1000 ||
    (options.legacyProtocol !== undefined && options.legacyProtocol !== '2025-06-18')
  )
    throw new TypeError('Invalid Pulse context host limits.')
  const build = loadHostBuild(options.buildDir)
  const backend = createNodeLauncher({
    buildDir: build.root,
    target: 'javascript',
    host: '127.0.0.1',
    port: 0,
    networkFetch: false,
    strict: true,
    maxDurationMs: deadlineMs,
    shutdownTimeoutMs,
    headersTimeoutMs: 5000,
    keepAliveTimeoutMs: 1000,
    maxRequestBodyBytes: 65536,
    maxFetchBodyBytes: 65536,
    maxEffects: 1,
    maxConcurrentRequests: 16,
    maxConnections: 64,
  })
  let state = 'created',
    server,
    endpoint,
    starting,
    stopping,
    stopRequested = false,
    failed = false
  const sockets = new Set(),
    active = new Set(),
    startupAbort = new AbortController()
  let idle, finish
  const finished = new Promise((resolve) => {
    finish = resolve
  })
  function status() {
    return {
      state,
      endpoint: state === 'ready' ? endpoint : null,
      buildId: build.buildId,
      identity: build.manifest.identity,
      corpus: { ...build.manifest.corpus },
      activeRequests: active.size,
      backend: backend.status(),
    }
  }
  async function shutdown() {
    state = 'draining'
    let forced = false
    if (server?.listening)
      await new Promise((resolve) => {
        let closed = false
        const done = () => {
          if (closed && active.size === 0) {
            clearTimeout(timer)
            idle = undefined
            resolve()
          }
        }
        const timer = setTimeout(() => {
          forced = true
          idle = undefined
          for (const socket of sockets) socket.destroy()
          resolve()
        }, shutdownTimeoutMs)
        idle = done
        server.close(() => {
          closed = true
          done()
        })
        server.closeIdleConnections()
      })
    const result = await backend.close()
    state = 'stopped'
    const outcome = { forced: forced || result.forced, failed }
    finish(outcome)
    return outcome
  }
  async function verifyBackend(url) {
    const signal = AbortSignal.any([startupAbort.signal, AbortSignal.timeout(deadlineMs)])
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'context-ready',
        method: 'pulse.search',
        params: {
          version: build.manifest.corpus.pulseVersion,
          query: 'schema',
          limit: 1,
        },
      }),
    })
    if (response.status !== 200)
      throw new Error('Pulse context backend readiness failed.')
    const reader = response.body.getReader()
    let bytes = 0,
      chunks = []
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        bytes += item.value.length
        if (bytes > 32768)
          throw new Error('Pulse context readiness reply exceeded its limit.')
        chunks.push(item.value)
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    const reply = JSON.parse(Buffer.concat(chunks).toString('utf8')),
      corpus = build.manifest.corpus
    if (
      reply.jsonrpc !== '2.0' ||
      reply.id !== 'context-ready' ||
      reply.result?.status !== 'ok' ||
      reply.result.meta?.corpusHash !== corpus.corpusHash ||
      reply.result.meta.pulseVersion !== corpus.pulseVersion ||
      reply.result.meta.corpusSchemaVersion !== corpus.schemaVersion ||
      reply.result.meta.snapshotStatus !== corpus.snapshotStatus ||
      reply.result.meta.applicationVersion !== 'pulse.context-application.v1'
    )
      throw new Error('Pulse context backend build identity mismatch.')
  }
  function start() {
    if (state === 'ready') return Promise.resolve(status())
    if (state === 'starting') return starting
    if (state !== 'created' || stopRequested)
      return Promise.reject(
        new Error('Pulse context host is stopped; create a new process.'),
      )
    state = 'starting'
    starting = (async () => {
      try {
        const started = await backend.start()
        if (stopRequested || started.buildId !== build.buildId)
          throw new Error('Pulse context startup interrupted or mismatched.')
        const url = `http://127.0.0.1:${started.address.port}/`
        await verifyBackend(url)
        if (stopRequested) throw new Error('Pulse context startup interrupted.')
        const handler = createMcpNodeHandler({
          path: '/mcp',
          serverInfo: {
            name: 'pulse-context',
            version: build.manifest.corpus.pulseVersion,
          },
          allowedOrigins: [],
          legacyProtocol: options.legacyProtocol,
          limits: { ...LIMITS, deadlineMs },
          tools: {
            catalog: build.catalog,
            schemas: build.schemas,
            routerId: build.catalog.routers[0].id,
            target: 'node-javascript',
            endpoint: url,
          },
        })
        server = http.createServer(
          {
            maxHeaderSize: 16384,
            headersTimeout: 5000,
            requestTimeout: 5000,
            keepAliveTimeout: 1000,
          },
          (req, res) => {
            const reject = (code) => {
              res
                .writeHead(code, { 'cache-control': 'no-store', connection: 'close' })
                .end()
            }
            if ((req.url || '').split('?')[0] === '/_pulse/ready') {
              if (!['GET', 'HEAD'].includes(req.method)) {
                res.setHeader('allow', 'GET, HEAD')
                reject(405)
                return
              }
              if (state !== 'ready' || backend.status().state !== 'ready') {
                reject(503)
                return
              }
              res.writeHead(200, {
                'content-type': 'application/json',
                'cache-control': 'no-store',
                connection: 'close',
              })
              res.end(
                req.method === 'HEAD'
                  ? undefined
                  : JSON.stringify({
                      status: 'ready',
                      buildId: build.buildId,
                      identity: build.manifest.identity,
                      corpus: build.manifest.corpus,
                    }),
              )
              return
            }
            if (state !== 'ready' || active.size >= 16) {
              reject(503)
              return
            }
            const call = handler(req, res)
            active.add(call)
            call
              .catch(() => {
                if (!res.destroyed) res.destroy()
              })
              .finally(() => {
                active.delete(call)
                idle?.()
              })
          },
        )
        server.maxConnections = 64
        server.on('connection', (socket) => {
          sockets.add(socket)
          socket.once('close', () => sockets.delete(socket))
        })
        server.on('error', () => {
          if (state === 'ready') {
            failed = true
            void close()
          }
        })
        await new Promise((resolve, reject) => {
          const error = () => {
            server.removeListener('listening', ready)
            reject(new Error('Pulse context MCP listener could not bind.'))
          }
          const ready = () => {
            server.removeListener('error', error)
            resolve()
          }
          server.once('error', error)
          server.once('listening', ready)
          server.listen(port, '127.0.0.1')
        })
        if (stopRequested) throw new Error('Pulse context startup interrupted.')
        endpoint = `http://127.0.0.1:${server.address().port}/mcp`
        state = 'ready'
        return status()
      } catch (error) {
        failed = true
        await shutdown()
        throw error
      }
    })()
    return starting
  }
  function close() {
    stopRequested = true
    startupAbort.abort()
    if (stopping) return stopping
    stopping =
      state === 'starting'
        ? starting.then(
            () => shutdown(),
            () => finished,
          )
        : state === 'stopped'
          ? finished
          : shutdown()
    return stopping
  }
  return Object.freeze({ start, close, status, finished })
}

module.exports = { createContextHost, LIMITS }
