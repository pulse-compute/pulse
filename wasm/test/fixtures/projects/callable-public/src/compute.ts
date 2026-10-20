import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'

import type { Input, Output } from './types'

export function double(ctx: PulseComputationContext, input: PulseReadonly<Input>): Output {
  const cells = ctx.workspace.numbers(1)
  cells[0] = input.value * 2
  return { value: cells[0] }
}
