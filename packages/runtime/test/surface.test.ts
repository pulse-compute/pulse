import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const runtime = require('../src/index.js') as Record<string, unknown>

describe('@pulse-compute/runtime public surface', () => {
  it('exports only the canonical runtime markers and Router value', () => {
    expect(runtime.RUNTIME_API_VERSION).toBe('pulse.runtime-authoring.v4')
    expect(runtime.ROUTER_API_VERSION).toBe('pulse.router-authoring.v2')
    expect(typeof runtime.Router).toBe('function')
    expect(runtime).not.toHaveProperty('defineHandler')
    expect(runtime).not.toHaveProperty('PulseRuntime')
    expect(runtime).not.toHaveProperty('Pulse')
    const Router = runtime.Router as new () => Record<string, unknown>
    const router = new Router()
    expect(router).not.toHaveProperty('on')
    expect(router).not.toHaveProperty('emit')
  })
})
