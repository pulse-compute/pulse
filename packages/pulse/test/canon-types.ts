import {
  Pulse,
  defineConfig,
  type Handler,
  type PulseContext,
  type PulseEffect,
  type PulseEmitEvent,
  type PulseEventContext,
  type PulseEventDeclaration,
  type PulseEventHandler,
  type PulseExecutionContext,
  type PulseHandler,
  type PulseProfileToken,
  type PulseResult,
  type RouterNext,
} from '../src/index.js'
import { Router, type Handler as RuntimeHandler } from '@pulse-compute/runtime'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

type ReExportedHandler = Assert<Equal<Handler, RuntimeHandler>>
type PulseHandlerAlias = Assert<Equal<PulseHandler, RuntimeHandler>>
type PulseGet = Assert<Equal<Parameters<Pulse['get']>, Parameters<Router['get']>>>
type PulseUse = Assert<Equal<Parameters<Pulse['use']>, Parameters<Router['use']>>>
void (0 as unknown as ReExportedHandler)
void (0 as unknown as PulseHandlerAlias)
void (0 as unknown as PulseGet)
void (0 as unknown as PulseUse)

const config = defineConfig((scope) => ({
  pulse: { defaultProfile: 'local' },
  local: { host: 'node', target: 'native', token: scope.secret('TOKEN') },
}))
const app = new Pulse(config)
const profile: PulseProfileToken = app.profile()
void profile

const handler: Handler = async (ctx: PulseContext): Promise<PulseResult> => ctx.json({ ok: true })
app.get('/health', handler)

const eventDeclaration: PulseEventDeclaration = { schema: 'events.DeviceButton' }
const eventHandler: PulseEventHandler<{ readonly enabled: boolean }> = async (ctx: PulseEventContext<{ readonly enabled: boolean }>) => {
  const shared: PulseExecutionContext = ctx
  shared.state.set('enabled', String(ctx.event.payload.enabled))
  const outbound: PulseEmitEvent<{ readonly enabled: boolean }> = { schema: 'events.DeviceLedSet', payload: { enabled: true } }
  await shared.emit('device.led.set', outbound)
}
app.on<{ readonly enabled: boolean }>('device.button', eventDeclaration, eventHandler)
app.on('system.tick', { schema: null }, async (ctx) => {
  const payload: null = ctx.event.payload
  void payload
})

const effect = null as unknown as PulseEffect<string>
void effect
const next = null as unknown as RouterNext
void next
