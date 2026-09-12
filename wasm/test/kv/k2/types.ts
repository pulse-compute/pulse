import type { PulseContext, PulseKvConditionalResult, PulseKvVersionedResult } from '@pulse-compute/pulse';
async function contract(ctx: PulseContext) {
  const store = ctx.kv<{ count: number }>('catalog');
  const found: PulseKvVersionedResult<{ count: number }> = await store.getVersioned('k');
  const created: PulseKvConditionalResult = await store.insertIfAbsent('k', { count: 1 });
  if (found.status === 'found') await store.compareAndSwap('k', found.generation, { count: found.value.count + 1 });
  await ctx.parallel({ read: store.getVersioned('k'), write: store.insertIfAbsent('other', { count: 2 }) });
  // @ts-expect-error Generations cannot be numbers.
  store.compareAndSwap('k', 9007199254740993, { count: 1 });
  // @ts-expect-error Candidate values obey the namespace's declared value type.
  store.insertIfAbsent('k', { count: 'wrong' });
  // @ts-expect-error A write acknowledgement does not supply a new generation.
  created.generation;
  // @ts-expect-error Missing/failure reads do not always carry a generation.
  found.generation;
}
void contract;
