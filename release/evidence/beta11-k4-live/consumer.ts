import type { PulseContext } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) {
  if (ctx.req.header('x-pulse-k4-auth') !== '7642ec3ff4fe8904f1067a7a91029a6a13737c39361d323959b1d76e7ffcd2e2') return ctx.text('unauthorized', { status: 401 });
  const command = await ctx.req.json<{ operation: string; key: string; generation: string; value: unknown }>();
  const store = ctx.kv('catalog');
  if (command.operation === 'get') {
    const result = await store.getVersioned(command.key);
    return ctx.json(result);
  }
  if (command.operation === 'create') {
    const result = await store.insertIfAbsent(command.key, command.value);
    return ctx.json(result);
  }
  if (command.operation === 'cas') {
    const result = await store.compareAndSwap(command.key, command.generation, command.value);
    return ctx.json(result);
  }
  if (command.operation === 'create-race') {
    const result = await ctx.parallel({
      first: ctx.kv('catalog').insertIfAbsent(command.key, { writer: 1 }),
      second: ctx.kv('catalog').insertIfAbsent(command.key, { writer: 2 }),
      third: ctx.kv('catalog').insertIfAbsent(command.key, { writer: 3 })
    });
    return ctx.json(result);
  }
  if (command.operation === 'cas-race') {
    const result = await ctx.parallel({
      first: store.compareAndSwap(command.key, command.generation, { writer: 1 }),
      second: store.compareAndSwap(command.key, command.generation, { writer: 2 }),
      third: store.compareAndSwap(command.key, command.generation, { writer: 3 })
    });
    return ctx.json(result);
  }
  if (command.operation === 'round-trip') {
    const before = await store.getVersioned(command.key);
    if (before.status === 'found') {
      const result = await store.compareAndSwap(command.key, before.generation, command.value);
      return ctx.json({ before, result });
    }
    return ctx.json(before);
  }
  return ctx.text('invalid operation', { status: 400 });
}
