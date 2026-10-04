export default async function handler(ctx) {
  const mode = ctx.req.header('x-mode')
  if (mode === 'construct') {
    return ctx.text(ctx.encodeJson({ event: 'view', properties: { score: 2.5, active: false, label: '', empty: null }, context: { source: 'test' } }, 'app.Event'))
  }
  if (mode === 'invalid-encode') {
    const text = ctx.encodeJson({ event: 'view', properties: { nested: [1] }, context: { source: 'test' } }, 'app.Event')
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', body: text }).text()
    return ctx.text('sent')
  }
  if (mode === 'fetched') {
    const fetched = await ctx.fetch('https://sink.invalid/input').json('app.Event')
    return ctx.text(ctx.encodeJson(fetched, 'app.Event'))
  }
  if (mode === 'request') {
    const requested = await ctx.req.json('app.Event')
    return ctx.text(ctx.encodeJson(requested, 'app.Event'))
  }
  const text = await ctx.req.text()
  const value = ctx.decodeJson(text, 'app.Event')
  if (mode === 'response') return ctx.json(value, { schema: 'app.Event' })
  if (mode === 'edit') return ctx.text(ctx.encodeJson({ ...value, properties: { ...value.properties, edited: true } }, 'app.Event'))
  if (mode === 'outbound') {
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', json: value, schema: 'app.Event' }).text()
    return ctx.text('sent')
  }
  return ctx.text(ctx.encodeJson(value, 'app.Event'))
}
