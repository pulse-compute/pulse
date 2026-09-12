import type { K1Context, PulseKvConditionalResult, PulseKvVersionedResult } from './api.js';
import type { PulseKvNamespace } from '@pulse-compute/runtime';

declare const ctx: K1Context;
interface Value { revision: number; text: string }

async function consumer() {
  const current = await ctx.kv<Value>('state').getVersioned('key');
  if (current.status === 'found') {
    const token: string = current.generation;
    const result = await ctx.kv<Value>('state').compareAndSwap('key', token, current.value);
    if (result.status === 'unknown') { const reason: string = result.reason; void reason; }
  }
  await ctx.parallel({
    left: ctx.kv<Value>('state').insertIfAbsent('left', { revision: 1, text: 'a' }),
    right: ctx.kv<Value>('state').insertIfAbsent('right', { revision: 1, text: 'b' }),
  });
  // Existing intentionally unconditional operations remain available.
  const legacy: PulseKvNamespace<Value> = ctx.kv<Value>('state');
  await legacy.put('legacy', { revision: 0, text: '' });
  // @ts-expect-error A number cannot be a generation.
  ctx.kv<Value>('state').compareAndSwap('key', 9007199254740992, { revision: 1, text: '' });
  // @ts-expect-error BigInt is not the portable token representation.
  ctx.kv<Value>('state').compareAndSwap('key', 1n, { revision: 1, text: '' });
  // @ts-expect-error Generation and replacement value are mandatory.
  ctx.kv<Value>('state').compareAndSwap('key');
}
declare const read: PulseKvVersionedResult<Value>;
if (read.status === 'not-found') {
  // @ts-expect-error Missing data does not supply a token.
  read.generation;
}
declare const write: PulseKvConditionalResult;
if (write.status === 'stored' || write.status === 'conflict') {
  // @ts-expect-error An acknowledgement does not manufacture a generation.
  write.generation;
}
void consumer;
