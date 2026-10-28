export async function onInput(ctx) {
  await ctx.emit('output.accepted', {
    schema: 'events.Output',
    payload: { accepted: true, sequence: 7 },
  })
  return { accepted: true, sequence: ctx.event.payload.sequence }
}

export async function health(ctx) {
  return ctx.text('ok')
}
