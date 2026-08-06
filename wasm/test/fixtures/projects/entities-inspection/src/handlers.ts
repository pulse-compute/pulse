type LookupInput = Readonly<{
  name: string
  active: boolean
}>

export async function lookupCustomer(ctx: any, input: LookupInput) {
  const mode = await ctx.config.get('MODE')
  ctx.log.info('entity lookup', { name: input.name, active: input.active })
  return { label: `${mode}:${input.name}`, mode }
}

export async function notifySystem(ctx: any, _input: undefined) {
  ctx.log.debug('entity notification')
}
