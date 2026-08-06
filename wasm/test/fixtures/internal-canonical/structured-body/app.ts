import type { PulseContext, PulseResult } from '@pulse-compute/runtime';

export default function structuredBody(ctx: PulseContext): PulseResult {
  if (ctx.req.method === 'GET') return ctx.text('ready', { status: 200 });
  if (ctx.req.path === '/empty') return ctx.response({ status: 204 });
  const first = ctx.req.json<{ id: number }>();
  const second = ctx.req.json<{ id: number }>();
  return ctx.json({ id: first.id, sameReference: first === second, requestId: ctx.req.header('x-request-id') });
}
