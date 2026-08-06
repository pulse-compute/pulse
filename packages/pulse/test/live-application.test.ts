import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pulse = require('../src/index.js') as Record<string, any>
const pulseInternal = require('../src/internal/index.js') as Record<string, any>
const pulseEventInternal = require('../src/internal/event-registration.js') as Record<string, any>
const runtimeInternal = require('../../runtime/src/internal/index.js') as Record<string, any>
const eventContracts = require('@pulse-compute/wasm-contracts/events') as Record<string, any>

describe('@pulse-compute/pulse live application root', () => {
  it('shares the live Router implementation and preserves explicit application modes', async () => {
    const app = new pulse.Pulse({ auto: true })
    app.get('/health', async (ctx: any) => ctx.json({ ok: true }))

    const response = await runtimeInternal.executeRouter(app, new Request('https://example.test/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(pulseInternal.applicationState(app)).toMatchObject({ mode: 'auto' })
  })

  it('keeps one stable opaque profile token owned by its application', () => {
    const app = new pulse.Pulse({ auto: true })
    const first = app.profile()
    const second = app.profile()
    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.keys(first)).toEqual([])
    expect(pulseInternal.profileTokenOwner(first)).toBe(app)
  })

  it('preserves the deferred factory without evaluating or exposing profile values', () => {
    let calls = 0
    const factory = pulse.defineConfig((scope: any) => {
      calls += 1
      return {
        pulse: { defaultProfile: 'local' },
        local: { host: 'node', target: 'native', token: scope.secret('TOKEN') }
      }
    })
    const app = new pulse.Pulse(factory)
    expect(calls).toBe(0)
    expect(pulseInternal.applicationState(app)).toMatchObject({ mode: 'explicit', options: factory })
    expect(app).not.toHaveProperty('config')
    expect(app).not.toHaveProperty('env')
    expect(app).not.toHaveProperty('listen')
    expect(app).not.toHaveProperty('serve')
    expect(app).not.toHaveProperty('handle')
  })

  it('owns one exact immutable event registration table without executing handlers', async () => {
    const app = new pulse.Pulse({ auto: true })
    let eventHandlerCalls = 0
    const handler = async () => { eventHandlerCalls += 1 }
    const declaration: any = { schema: 'events.DeviceButton' }

    expect(app.on('device.button', declaration, handler)).toBe(app)
    expect(app.on('system.tick', { schema: null }, handler)).toBe(app)
    declaration.schema = 'events.Mutated'

    const registrations = pulseInternal.eventRegistrations(app)
    const readerDescriptor = Object.getOwnPropertyDescriptor(
      app,
      Symbol.for('pulse.runtime.event-registration-reader.v1'),
    )
    expect(readerDescriptor).toMatchObject({ enumerable: false, configurable: false, writable: false })
    expect(typeof readerDescriptor?.value).toBe('function')
    expect(Object.keys(app)).not.toContain('eventRegistrations')
    expect(Object.isFrozen(registrations)).toBe(true)
    expect(registrations).toHaveLength(2)
    expect(registrations[0]).toMatchObject({
      version: 'pulse.event-registration.v1',
      type: 'device.button',
      declaration: { version: 'pulse.event-declaration.v1', schemaId: 'events.DeviceButton' },
      handler,
    })
    expect(Object.isFrozen(registrations[0])).toBe(true)
    expect(Object.isFrozen(registrations[0].declaration)).toBe(true)
    expect(registrations[1].declaration.schemaId).toBeNull()

    app.get('/health', async (ctx: any) => ctx.text('ok'))
    const response = await runtimeInternal.executeRouter(app, new Request('https://example.test/health'))
    expect(await response.text()).toBe('ok')
    expect(eventHandlerCalls).toBe(0)
  })

  it('fails closed on invalid, duplicate, accessor, and non-handler registrations', () => {
    const app = new pulse.Pulse({ auto: true })
    const handler = async () => undefined
    const expectCode = (callback: () => unknown, code: string) => {
      expect(callback).toThrowError(expect.objectContaining({ name: 'PulseEventRegistrationError', code }))
    }

    expectCode(() => app.on('', { schema: null }, handler), 'PULSEWASM_EVENTS_TYPE_INVALID')
    expectCode(() => app.on('x'.repeat(129), { schema: null }, handler), 'PULSEWASM_EVENTS_TYPE_INVALID')
    expectCode(() => app.on('event.missing', {}, handler), 'PULSEWASM_EVENTS_DECLARATION_INVALID')
    expectCode(() => app.on('event.extra', { schema: null, extra: true }, handler), 'PULSEWASM_EVENTS_DECLARATION_INVALID')
    expectCode(() => app.on('event.schema', { schema: 'not-dotted' }, handler), 'PULSEWASM_EVENTS_SCHEMA_ID_INVALID')
    expectCode(() => app.on('event.handler', { schema: null }, null), 'PULSEWASM_EVENTS_HANDLER_INVALID')

    let getterCalls = 0
    const accessor: any = {}
    Object.defineProperty(accessor, 'schema', { enumerable: true, get() { getterCalls += 1; return null } })
    expectCode(() => app.on('event.accessor', accessor, handler), 'PULSEWASM_EVENTS_DECLARATION_INVALID')
    expect(getterCalls).toBe(0)

    app.on('case.event', { schema: null }, handler)
    app.on('Case.Event', { schema: null }, handler)
    expectCode(() => app.on('case.event', { schema: null }, async () => undefined), 'PULSEWASM_EVENTS_TYPE_DUPLICATE')
    expect(pulseInternal.eventRegistrations(app).map((entry: any) => entry.type)).toEqual(['case.event', 'Case.Event'])
  })

  it('keeps live type and declaration normalization aligned with the EV0 contract', () => {
    for (const type of ['system.tick', 'Device.Button', 'x'.repeat(128), 'event.😀']) {
      expect(pulseEventInternal.normalizeEventType(type)).toBe(eventContracts.normalizeEventType(type))
    }
    for (const declaration of [{ schema: null }, { schema: 'events.DeviceButton' }]) {
      expect(pulseEventInternal.normalizeEventDeclaration(declaration)).toEqual(eventContracts.normalizeEventDeclaration(declaration))
    }
    for (const type of ['', '😀'.repeat(33)]) {
      let liveError: any
      let contractError: any
      try { pulseEventInternal.normalizeEventType(type) } catch (error) { liveError = error }
      try { eventContracts.normalizeEventType(type) } catch (error) { contractError = error }
      expect(liveError?.code).toBe(contractError?.code)
    }
    for (const declaration of [{}, { schema: 'not-dotted' }, { schema: null, extra: true }]) {
      let liveError: any
      let contractError: any
      try { pulseEventInternal.normalizeEventDeclaration(declaration) } catch (error) { liveError = error }
      try { eventContracts.normalizeEventDeclaration(declaration) } catch (error) { contractError = error }
      expect(liveError?.code).toBe(contractError?.code)
    }
  })
})
