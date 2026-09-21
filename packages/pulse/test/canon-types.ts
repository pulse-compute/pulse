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
import { schema, type ScalarRecord, type JsonObject, type JsonValue, type OpenObject } from '../src/schema.js'

const attributes: ScalarRecord = { page: 'overview', duration: 2.5, enabled: false, empty: null }
void attributes
const open: OpenObject<{ source: string; note?: string | null }> = { source: 'test', extra: [{ active: true }] }
const openSource: string = open.source
const openNote: string | null | undefined = open.note
const openExtra: JsonValue = open.extra
const openSchema = schema<OpenObject<{ source: string }>>()
void [openSource, openNote, openExtra, openSchema]
const properties: JsonObject = { nested: { values: [null, false, 0, 'é😀'] } }
const dynamic: JsonValue = [properties, null]
const nestedSchema = schema<{ properties: JsonObject; data?: JsonValue }>({ json: { maxDepth: 64, maxNodes: 8192 } })
void dynamic
void nestedSchema

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
const mutationApp: Pulse = app.put('/items/:id', handler)
  .patch('/items/:id', async (ctx) => ctx.text(ctx.param('id') ?? 'missing'))
  .delete('/items/:id', handler)
void mutationApp

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
