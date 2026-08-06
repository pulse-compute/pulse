import { assets } from '@pulse-compute/assets';

type LookupInput = Readonly<{
  id: string;
}>;

export async function lookupCustomer(ctx: any, input: LookupInput) {
  const users = ctx.kv('users');
  const { mode, current } = await ctx.parallel({
    mode: ctx.config.get('MODE'),
    current: users.get(input.id),
  });
  const remote = await ctx.fetch(`https://users.example.test/${input.id}`).json('tools.LookupOutput');
  await ctx.kv('users').put(input.id, { current, remote });
  const asset = await assets.lookup(ctx, 'public', '/app.js', { method: 'HEAD' });
  ctx.log.info('managed lookup complete', { id: input.id, assetStatus: asset.status });
  return {
    id: input.id,
    mode,
    current,
    remote,
    assetStatus: asset.status,
  };
}

export async function notifySystem(ctx: any, _input: undefined) {
  const token = await ctx.secret.get('TOKEN');
  ctx.log.debug('managed notification', token !== undefined);
}

export async function undeclaredEffect(ctx: any, _input: LookupInput) {
  const ignored = await ctx.config.get('UNREACHABLE_CONFIG');
  const asset = await assets.lookup(ctx, 'private', '/unreachable.js');
  return { ignored, asset };
}

export function recursiveManagedCall(ctx: any, input: LookupInput) {
  return recursiveManagedCall(ctx, input);
}

export function directManagedCall(ctx: any, input: LookupInput) {
  return lookupCustomer(ctx, input);
}

export async function dynamicPromise(_ctx: any, input: LookupInput) {
  await new Promise((resolve) => resolve(input));
  return input;
}

export function unsupportedTypeScript(_ctx: any, input: LookupInput) {
  for (const value of [input]) {
    return value;
  }
  return input;
}
