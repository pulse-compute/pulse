import type { PulseContext } from '@pulse-compute/pulse'
import { double } from './compute'
import type { Input } from './types'

export default async function handler(ctx: PulseContext) {
  const input = ctx.decodeJson<Input>(ctx.req.header('input') ?? '{"value":2}', 'example.Input')
  const result = ctx.call(double, input, {
    inputSchema: 'example.Input',
    outputSchema: 'example.Output',
  })
  return ctx.json(result, { schema: 'example.Output' })
}
