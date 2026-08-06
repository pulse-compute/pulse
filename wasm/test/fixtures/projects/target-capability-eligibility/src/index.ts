import type { PulseContext, PulseResult } from '@pulse-compute/runtime'

export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  const mode = await ctx.config.get('MODE')
  return ctx.text(mode)
}
