export default async function handler(ctx) {
  const mode = ctx.req.header('x-mode')
  if (mode === 'construct') {
    return ctx.text(ctx.encodeJson({ event: 'view', properties: { nested: { array: [null, false, 0, { label: 'é😀' }] } }, context: { source: 'test' } }, 'app.Event'))
  }
  if (mode === 'invalid-encode') {
    const text = ctx.encodeJson({ event: 'view', properties: { invalid: undefined }, context: { source: 'test' } }, 'app.Event')
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', body: text }).text()
    return ctx.text('sent')
  }
  if (mode === 'invalid-outbound') {
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', json: { event: 'view', properties: { invalid: undefined }, context: { source: 'test' } }, schema: 'app.Event' }).text()
    return ctx.text('sent')
  }
  if (mode === 'cyclic-outbound') {
    const properties = {}
    properties.self = properties
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', json: { event: 'view', properties, context: { source: 'test' } }, schema: 'app.Event' }).text()
    return ctx.text('sent')
  }
  if (mode === 'invalid-known-outbound') {
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', json: { event: false, properties: {}, context: { source: 'test' } }, schema: 'app.Event' }).text()
    return ctx.text('sent')
  }
  if (mode === 'invalid-extra-outbound') {
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', json: { event: 'view', properties: {}, context: { source: 'test' }, extra: undefined }, schema: 'app.Event' }).text()
    return ctx.text('sent')
  }
  if (mode === 'invalid-known-response') return ctx.json({ event: 'view', properties: {}, context: { source: false } }, { schema: 'app.Event' })
  if (mode === 'invalid-extra-response') return ctx.json({ event: 'view', properties: {}, context: { source: 'test' }, extra: undefined }, { schema: 'app.Event' })
  if (mode === 'fetched') {
    const fetched = await ctx.fetch('https://sink.invalid/input').json('app.Event')
    return ctx.text(ctx.encodeJson(fetched, 'app.Event'))
  }
  if (mode === 'request') {
    const requested = await ctx.req.json('app.Event')
    return ctx.text(ctx.encodeJson(requested, 'app.Event'))
  }
  const text = await ctx.req.text()
  if (mode === 'empty') return ctx.text(ctx.encodeJson(ctx.decodeJson(text, 'app.Empty'), 'app.Empty'))
  if (mode === 'closed') return ctx.text(ctx.encodeJson(ctx.decodeJson(text, 'app.Closed'), 'app.Closed'))
  if (mode === 'deep') return ctx.text(ctx.encodeJson(ctx.decodeJson(text, 'app.Deep'), 'app.Deep'))
  if (mode === 'small') return ctx.text(ctx.encodeJson(ctx.decodeJson(text, 'app.Small'), 'app.Small'))
  const value = ctx.decodeJson(text, 'app.Event')
  if (mode === 'mutate') {
    value.properties.nested.changed = true
    return ctx.text('mutated')
  }
  if (mode === 'response') return ctx.json(value, { schema: 'app.Event' })
  if (mode === 'edit') return ctx.text(ctx.encodeJson({ ...value, properties: { ...value.properties, edited: { active: true } } }, 'app.Event'))
  if (mode === 'outbound') {
    const headers = { 'x-source': 'test' }
    const sent = await ctx.fetch('https://sink.invalid/events', { method: 'POST', headers, json: value, schema: 'app.Event' }).text()
    if (headers['content-type']) return ctx.text('headers-mutated')
    return ctx.text('sent')
  }
  return ctx.text(ctx.encodeJson(value, 'app.Event'))
}
