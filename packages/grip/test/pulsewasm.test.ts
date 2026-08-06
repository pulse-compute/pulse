import { describe, expect, it } from 'vitest'
import { channel, hold, publish, PulseWasmGripLoweringError } from '../src/pulsewasm.js'

describe('@pulse-compute/grip/pulsewasm', () => {
  it('remains a compiler-only facade in direct JavaScript execution', () => {
    expect(() => channel('events')).toThrow(PulseWasmGripLoweringError)
    expect(() => hold('stream')).toThrow(PulseWasmGripLoweringError)
    expect(() => publish('events', 'hello')).toThrow(PulseWasmGripLoweringError)
  })
})
