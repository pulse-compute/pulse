import type { PulseContext, PulseResult } from '@pulse-compute/runtime';

export default function failureDiagnostics(ctx: PulseContext): PulseResult {
  if (ctx.req.path === '/decode') return ctx.json(ctx.req.json());
  const response = ctx.fetch('https://assets.example.test/archive.bin');
  return ctx.json({ impossible: response.json() });
}
