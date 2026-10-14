export async function sharedLookup(ctx, suffix: string) {
  const token = await ctx.secret.get('HELPER_TOKEN');
  return (token || '') + suffix;
}

export async function packageHandler(ctx) {
  const value = await ctx.config.get('PACKAGE');
  return ctx.text(value || '');
}
