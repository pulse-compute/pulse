export async function onInput(ctx) {
  await ctx.emit('output.accepted', {
    schema: 'events.Output',
    payload: { accepted: true, sequence: 7 },
  })
}

export async function health(ctx) {
  return ctx.text('ok')
}
