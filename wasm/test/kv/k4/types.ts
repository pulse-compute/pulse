import type { PulseContext, PulseKvGeneration, PulseKvConditionalResult, PulseKvVersionedResult } from '@pulse-compute/runtime';
export async function types(ctx: PulseContext) {
  const kv = ctx.kv<{ revision: number }>('catalog');
  const before: PulseKvVersionedResult<{ revision: number }> = await kv.getVersioned('key');
  if (before.status === 'found') {
    const generation: PulseKvGeneration = before.generation;
    const ack: PulseKvConditionalResult = await kv.compareAndSwap('key', generation, { revision: before.value.revision + 1 });
    if (ack.status === 'unknown') { const reason: 'transport' | 'timeout' | 'unavailable' | 'protocol' = ack.reason; void reason; }
    // @ts-expect-error a write acknowledgement does not invent a generation
    ack.generation;
  }
  // @ts-expect-error generations must remain opaque strings
  await kv.compareAndSwap('key', 42, { revision: 1 });
  // @ts-expect-error candidate must satisfy the selected value type
  await kv.insertIfAbsent('key', { revision: 'one' });
  const group = await ctx.parallel({ read: kv.getVersioned('key'), create: kv.insertIfAbsent('other', { revision: 0 }) });
  const read: PulseKvVersionedResult<{ revision: number }> = group.read;
  const create: PulseKvConditionalResult = group.create;
  return { read, create };
}
