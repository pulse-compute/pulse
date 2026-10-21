import type { PulseContext, PulseKvListOptions } from '@pulse-compute/runtime';

export default async function handler(ctx: PulseContext) {
  const command = await ctx.req.json<{ operation: string; key: string; options: PulseKvListOptions; value: unknown }>();
  const store = ctx.kv('catalog');
  if (command.operation === 'delete') {
    const result = await store.delete(command.key);
    return ctx.json(result);
  }
  if (command.operation === 'list') {
    const result = await store.list(command.options);
    return ctx.json(result);
  }
  if (command.operation === 'parallel') {
    const result = await ctx.parallel({ first: store.delete(command.key), second: store.delete(command.key), page: store.list(command.options) });
    return ctx.json(result);
  }
  if (command.operation === 'put') {
    const result = await store.put(command.key, command.value);
    return ctx.json({ stored: result });
  }
  if (command.operation === 'get') {
    const result = await store.getVersioned(command.key);
    return ctx.json(result);
  }
  return ctx.text('invalid operation', { status: 400 });
}
