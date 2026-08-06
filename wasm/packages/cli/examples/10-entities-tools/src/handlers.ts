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

