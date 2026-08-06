import 'typescript'
import type { PulseContext, PulseResult } from '@pulse-compute/runtime'

export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  return ctx.text('node package eligible')
}
