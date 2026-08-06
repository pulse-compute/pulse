import type { PulseContext, PulseResult } from '@pulse-compute/runtime';

export default function branching(ctx: PulseContext): PulseResult {
  if (ctx.req.path === '/health') return ctx.json({ ok: true });
  if (ctx.req.path === '/dashboard') {
    const dashboard = ctx.fetch('https://dashboard.example.test/current').json<{ title: string }>();
    return ctx.json({ dashboard });
  }
  const response = ctx.fetch(`https://users.example.test${ctx.req.path}`);
  if (response.status === 404) return ctx.json({ found: false });
  return ctx.json({ found: true, user: response.json<{ id: number }>() });
}
