import {
  Router,
  type Handler,
  type HandlerResult,
  type PulseContext,
  type PulseEventContext,
  type PulseEmitEvent,
  type PulseEventHandler,
  type PulseExecutionContext,
  type PulseErrorHandler,
  type PulseHandler,
  type PulseHandlerResult,
  type PulseMiddleware,
  type PulseRouteHandler,
  type RouteHandler,
  type RouterErrorHandler,
  type RouterMiddleware,
} from '../src/index.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

type HandlerAlias = Assert<Equal<PulseHandler, Handler>>
type ResultAlias = Assert<Equal<PulseHandlerResult, HandlerResult>>
type RouteAlias = Assert<Equal<PulseRouteHandler, RouteHandler>>
type MiddlewareAlias = Assert<Equal<PulseMiddleware, RouterMiddleware>>
type ErrorAlias = Assert<Equal<PulseErrorHandler, RouterErrorHandler>>
void (0 as unknown as HandlerAlias)
void (0 as unknown as ResultAlias)
void (0 as unknown as RouteAlias)
void (0 as unknown as MiddlewareAlias)
void (0 as unknown as ErrorAlias)

const router = new Router()
router.use(async (ctx, next) => {
  ctx.state.set('request-id', 'r1')
  return next()
})
router.get('/health', async (ctx) => ctx.json({ ok: true }))
router.put('/items/:id', async (ctx) => ctx.json({ id: ctx.param('id') }))
  .patch('/items/:id', async (ctx, next) => ctx.param('id') ? ctx.text('patched') : next())
  .delete('/items/:id', async (ctx) => ctx.text('', { status: 204 }))

const handler: PulseHandler = async (ctx: PulseContext) => ctx.text('ok')
void handler

const eventHandler: PulseEventHandler<{ readonly enabled: boolean }> = async (ctx: PulseEventContext<{ readonly enabled: boolean }>) => {
  const shared: PulseExecutionContext = ctx
  const decoded = shared.decodeJson<{ enabled: boolean }>('{"enabled":true}', 'events.Input')
  const enabled: boolean = decoded.enabled
  void enabled
  shared.state.set('enabled', String(ctx.event.payload.enabled))
  shared.log.info(ctx.event.type)
  await shared.config.get('MODE')
  await shared.emit('device.led.set', { schema: 'events.DeviceLedSet', payload: { enabled: true } })
}
void eventHandler


const parallelHandler: PulseHandler = async (ctx: PulseContext) => {
  const outbound: PulseEmitEvent<{ readonly source: string }> = {
    schema: 'events.Audit',
    payload: { source: 'http' },
  }
  const result = await ctx.parallel({
    profile: ctx.fetch('https://origin.test/profile').json<{ id: string }>(),
    mode: ctx.config.get('MODE'),
    stored: ctx.kv<number>('counts').get('current'),
    emitted: ctx.emit('audit.recorded', outbound),
  })
  const profileId: string = result.profile.id
  const mode: string | undefined = result.mode
  const stored: number | undefined = result.stored
  const emitted: void = result.emitted
  void emitted
  return ctx.json({ profileId, mode, stored })
}
void parallelHandler

const fetchBodyHandler: PulseHandler = async (ctx: PulseContext) => {
  const created = await ctx.fetch('https://origin.test/users', {
    method: 'POST',
    json: { name: 'Ada' },
    timeoutMs: 250,
  }).json<{ id: string }>()
  const echoed = await ctx.fetch('https://origin.test/echo', {
    method: 'POST',
    body: JSON.stringify(created),
    headers: [['content-type', 'application/json']],
  }).text()
  return ctx.text(echoed)
}
void fetchBodyHandler

const timeHandler: import('../src/index.js').Handler = async ctx => {
  const result = await ctx.time.now();
  if (result.status === 'failed') return ctx.text(result.reason, { status: 503 });
  const ms: number = result.unixEpochMs;
  const iso: string = result.iso8601;
  // @ts-expect-error clock reads take no caller-supplied time
  ctx.time.now(ms);
  return ctx.text(iso);
};
void timeHandler;
