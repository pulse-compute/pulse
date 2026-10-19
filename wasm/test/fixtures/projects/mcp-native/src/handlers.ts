type CustomerLookupInput = Readonly<{
  email: string
}>

export async function systemStatus(_ctx: unknown, _input: undefined) {
  return undefined
}

export async function lookupCustomer(ctx: any, input: CustomerLookupInput) {
  const displayName = await ctx.fetch(
    `https://directory.example.test/customers/${input.email}`,
  ).text()
  return { email: input.email, displayName }
}


export async function echo(_ctx: unknown, input: CustomerLookupInput) { return { email: input.email } }
export async function invalidOutput(_ctx: unknown, _input: undefined) { return { email: 'valid', displayName: 42 } }
export async function localResult(_ctx: unknown, _input: undefined) { return { email: 'ok', displayName: 'local' } }
export async function unreachable(_ctx: unknown, _input: undefined) { return 'not-selected' }
