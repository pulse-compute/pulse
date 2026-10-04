// SDK proof uses the ordinary Entities application with a deterministic handler.
// Invocation still belongs to Pulse dev and its emitted application/schema graph.
export async function systemStatus(_ctx: unknown, _input: undefined) {
  return undefined
}

export async function lookupCustomer(_ctx: unknown, input: Readonly<{ email: string }>) {
  return { email: input.email, displayName: 'Governed Alice' }
}
