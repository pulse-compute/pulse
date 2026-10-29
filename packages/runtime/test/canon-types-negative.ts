import { Router, type PulseContext, type PulseEventContext, type PulseEventHandler } from '../src/index.js'

declare const ctx: PulseContext
// @ts-expect-error historical ctx.request is superseded by ctx.req
ctx.request
// @ts-expect-error raw host access remains outside the portable runtime contract
ctx.raw
// @ts-expect-error dynamic context decoration is not part of the canonical context
ctx.decorate
// @ts-expect-error HTTP contexts do not expose event input
ctx.event
ctx.emit('event.outbound', { schema: null })
// @ts-expect-error schema-bound emissions require payload
ctx.emit('event.invalid', { schema: 'events.Payload' })
// @ts-expect-error no-payload emissions must omit payload
ctx.emit('event.invalid', { schema: null, payload: {} })
// @ts-expect-error event schemas are string or null
ctx.emit('event.invalid', { schema: 42, payload: {} })

declare const eventCtx: PulseEventContext<{ readonly id: string }>
eventCtx.event.payload.id
// @ts-expect-error event contexts do not expose HTTP requests
eventCtx.req
// @ts-expect-error event contexts do not construct HTTP JSON responses
eventCtx.json({ ok: true })
// @ts-expect-error event contexts do not construct HTTP text responses
eventCtx.text('invalid')
// @ts-expect-error event contexts do not construct HTTP responses
eventCtx.response()
// @ts-expect-error event contexts do not have route parameters
eventCtx.param('id')
eventCtx.emit('event.outbound', { schema: null })

// @ts-expect-error event handlers are async-shaped
const syncEventHandler: PulseEventHandler = () => undefined
void syncEventHandler

// @ts-expect-error event handlers complete with void, not an HTTP result
const resultEventHandler: PulseEventHandler = async (_eventCtx) => ({ status: 200 })
void resultEventHandler

const router = new Router()
// @ts-expect-error OPTIONS registration is outside the supported Router subset
router.options('/items', async (ctx) => ctx.text('unsupported'))
// @ts-expect-error PUT retains the async route handler contract
router.put('/items', (routeCtx) => routeCtx.text('sync'))
// @ts-expect-error PATCH requires a route path
router.patch(async (routeCtx: PulseContext) => routeCtx.text('missing path'))
// @ts-expect-error DELETE requires a callable route handler
router.delete('/items', 'invalid')
// @ts-expect-error DELETE is outside the supported outgoing fetch methods
ctx.fetch('https://origin.test/items', { method: 'DELETE' })
// @ts-expect-error lifecycle methods are provider-owned
router.bind()
// @ts-expect-error lifecycle methods are provider-owned
router.listen()
// @ts-expect-error lifecycle registration remains deferred
router.on('connect', async () => {})
// @ts-expect-error channel registration remains package/event-contract work
router.channel('updates')

// @ts-expect-error ctx.parallel requires a keyed object, not an array
ctx.parallel([ctx.config.get('MODE')])
// @ts-expect-error arbitrary promises are not Pulse effects
ctx.parallel({ ordinary: Promise.resolve('value') })
// @ts-expect-error non-effect values are not accepted
ctx.parallel({ value: 'not-an-effect' })

// @ts-expect-error body and json are mutually exclusive in the portable fetch contract
ctx.fetch('https://origin.test/users', { method: 'POST', body: 'x', json: { x: true } })
// @ts-expect-error binary outbound request bodies are outside the supported request contract
ctx.fetch('https://origin.test/users', { method: 'POST', body: new Uint8Array([1]) })

import type { PulseComputationContext, PulseReadonly } from '../src/index.js'
declare const computationContext: PulseComputationContext
declare const borrowed: PulseReadonly<{ nested: { values: number[] } }>
// @ts-expect-error borrowed fields are recursively readonly
borrowed.nested.values = []
// @ts-expect-error borrowed array cells are readonly
borrowed.nested.values[0] = 1
// @ts-expect-error borrowed arrays have no mutation methods
borrowed.nested.values.push(1)
// @ts-expect-error a computation cannot access HTTP
computationContext.req
// @ts-expect-error a computation cannot dispatch effects
computationContext.fetch('https://invalid.test')
// @ts-expect-error a computation cannot access state
computationContext.state
// @ts-expect-error codecs belong to the call boundary
computationContext.decodeJson('{}', 'app.Input')
// @ts-expect-error nested calls are not part of the computation context
computationContext.call
// @ts-expect-error events have no computation call surface
eventCtx.call
const normal = (_ctx: PulseComputationContext, input: PulseReadonly<{ value: number }>) => ({ value: input.value })
// @ts-expect-error input shape must match the target
ctx.call(normal, { value: 'wrong' }, { inputSchema: 'app.Input', outputSchema: 'app.Output' })
// @ts-expect-error both schema IDs are required
ctx.call(normal, { value: 1 }, { inputSchema: 'app.Input' })
// @ts-expect-error computation targets return synchronously
ctx.call(async (_ctx: PulseComputationContext, input: PulseReadonly<{ value: number }>) => ({ value: input.value }), { value: 1 }, { inputSchema: 'app.Input', outputSchema: 'app.Output' })
// @ts-expect-error HTTP handlers require authority unavailable to a computation
ctx.call((http: PulseContext, input: { value: number }) => ({ value: http.req.path.length + input.value }), { value: 1 }, { inputSchema: 'app.Input', outputSchema: 'app.Output' })
