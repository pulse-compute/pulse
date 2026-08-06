import { Router, type Handler, type PulseContext } from '../src/index.js'

// @ts-expect-error managed handlers are async-shaped and must return Promise<HandlerResult>
const synchronousHandler: Handler = (ctx: PulseContext) => ctx.text('invalid')
void synchronousHandler

const router = new Router()
// @ts-expect-error route handlers must be async-shaped
router.get('/sync', (ctx) => ctx.text('invalid'))
// @ts-expect-error middleware must be async-shaped
router.use((ctx) => ctx.text('invalid'))
// @ts-expect-error error handlers must be async-shaped
router.error((error, ctx) => ctx.json({ error }))

// @ts-expect-error logging is string-only
router.get('/invalid-log', async (ctx) => { ctx.log.info({ invalid: true }); return ctx.text('invalid') })
