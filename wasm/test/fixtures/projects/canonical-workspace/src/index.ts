import type { PulseContext, PulseResult } from '@pulse-compute/runtime'

export default async function handler(ctx: PulseContext): Promise<PulseResult> {
  if (ctx.req.path === '/health') return ctx.json({ ok: true })
  return ctx.text('not found', { status: 404 })
}
