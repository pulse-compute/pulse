import type { PulseContext, PulseResult } from '@pulse-compute/runtime';

export default function continuationChain(ctx: PulseContext): PulseResult {
  const user = ctx.fetch('https://users.example.test/users/123').json<{ id: number }>();
  const details = ctx.fetch(`https://details.example.test/users/${user.id}`).json<{ city: string }>();
  return ctx.json({ id: user.id, city: details.city });
}
