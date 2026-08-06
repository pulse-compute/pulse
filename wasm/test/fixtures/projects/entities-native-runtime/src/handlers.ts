type LookupInput = Readonly<{ id: string }>;

export async function lookupCustomer(ctx: any, input: LookupInput) {
  const remote = await ctx.fetch(`https://directory.example.test/${input.id}`).text();
  ctx.log.info('lookup complete', { id: input.id });
  return { id: input.id, name: remote, ignored: 'drop-from-output' };
}

export async function notifySystem(ctx: any, _input: undefined) {
  const token = await ctx.secret.get('TOKEN');
  ctx.log.debug('notification complete', token !== undefined);
}

export async function undeclaredNativeEffect(ctx: any, input: LookupInput) {
  const value = await ctx.config.get('UNREACHABLE_NATIVE_HANDLER');
  return { id: input.id, name: value };
}
