type NestedFlag = Readonly<{ enabled: boolean }>

type LookupInput = Readonly<{
  id: string
  tags: readonly string[]
  nested: NestedFlag
}>

type EchoInput = Readonly<{
  name: string
  tags: readonly string[]
  nested: NestedFlag
}>

export async function lookupCustomer(ctx: any, input: LookupInput) {
  const mode = await ctx.config.get('MODE')
  const remote = await ctx.fetch(`https://directory.example.test/${input.id}`).text()
  ctx.log.info('entity lookup complete', { id: input.id, mode })
  return {
    id: input.id,
    name: remote,
    mode,
    tags: input.tags,
    nested: input.nested,
    ignored: 'filtered-output-sentinel',
  }
}

export async function echoUnicode(_ctx: any, input: EchoInput) {
  return {
    name: input.name,
    tags: input.tags,
    nested: input.nested,
    ignored: 'filtered-unicode-sentinel',
  }
}

export async function notifySystem(ctx: any, _input: undefined) {
  const token = await ctx.secret.get('TOKEN')
  ctx.log.debug('entity notification complete', token !== undefined)
}

export async function invalidOutput(_ctx: any, input: Readonly<{ id: string }>) {
  return { id: input.id, name: 7 }
}
