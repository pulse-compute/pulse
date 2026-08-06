import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const pulse = require('../src/index.js') as Record<string, unknown>
const runtime = require('@pulse-compute/wasm-contracts/project/config-runtime') as Record<string, unknown>

describe('@pulse-compute/pulse project surface', () => {
  it('exports the project factory and Pulse application root without a second Router API', () => {
    expect(Object.keys(pulse)).toEqual(['defineConfig', 'Pulse', 'PULSE_APPLICATION_API_VERSION'])
    expect(typeof pulse.defineConfig).toBe('function')
    expect(typeof pulse.Pulse).toBe('function')
    expect(pulse.PULSE_APPLICATION_API_VERSION).toBe('pulse.application-authoring.v3')
    expect(pulse).not.toHaveProperty('Router')
  })

  it('brands the deferred factory without evaluating it', () => {
    let calls = 0
    const factory = (pulse.defineConfig as Function)((scope: any) => {
      calls += 1
      return {
        pulse: { defaultProfile: 'dev' },
        dev: { host: 'node', target: 'native', token: scope.secret('TOKEN') },
      }
    })
    expect(calls).toBe(0)
    expect((runtime.isConfigFactory as Function)(factory)).toBe(true)
  })

  it('requires an explicit construction mode and returns an opaque profile token', () => {
    const Pulse = pulse.Pulse as new (value: unknown) => { profile(): object; get(path: string, handler: Function): unknown; on(type: string, declaration: object, handler: Function): unknown }
    expect(() => new Pulse(undefined)).toThrow(/requires new Pulse/)
    const app = new Pulse({ auto: true })
    expect(app.get('/health', () => undefined)).toBe(app)
    expect(app.on('system.tick', { schema: null }, async () => undefined)).toBe(app)
    expect(app).not.toHaveProperty('emit')
    expect(app).not.toHaveProperty('listen')
    expect(app).not.toHaveProperty('serve')
    expect(app).not.toHaveProperty('handle')
    expect(app).not.toHaveProperty('dispatch')
    const token = app.profile()
    expect(Object.isFrozen(token)).toBe(true)
    expect(Object.keys(token)).toEqual([])
  })
})
