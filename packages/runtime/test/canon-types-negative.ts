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
// @ts-expect-error ingress PUT does not widen outgoing fetch methods
ctx.fetch('https://origin.test/items', { method: 'PUT' })
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
