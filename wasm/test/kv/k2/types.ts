import type { PulseContext, PulseKvConditionalResult, PulseKvVersionedResult, PulseKvListResult, PulseKvDeleteResult } from '@pulse-compute/pulse';
async function contract(ctx: PulseContext) {
  const store = ctx.kv<{ count: number }>('catalog');
  const page: PulseKvListResult = await store.list({ limit: 10, prefix: 'user/' });
  const deleted: PulseKvDeleteResult = await store.delete('k');
  await ctx.parallel({ page: store.list({ limit: 1 }), deleted: store.delete('missing') });
  // @ts-expect-error Listing requires an explicit bounded page size.
  store.list({ prefix: 'user/' });
  // @ts-expect-error Cursors remain opaque strings.
  store.list({ limit: 1, cursor: 1 });
  // @ts-expect-error Delete accepts one key, never a bulk array.
  store.delete(['k']);
  void page; void deleted;
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
