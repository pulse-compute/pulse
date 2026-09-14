export default async function handler(ctx) {
  const original = await ctx.req.text()
  const mode = ctx.req.header('x-mode')
  const text = mode === 'oversized' ? original + original : original
  const value = ctx.decodeJson(mode === 'wrong-type' ? 17 : text, 'app.Candidate')
  const second = ctx.decodeJson(text, 'app.Candidate')
  if (mode === 'mutate-object') value.title = 'changed'
  if (mode === 'mutate-array') value.detail.tags[0] = 'changed'
  const stored = await ctx.fetch('https://objects.invalid/candidate', { method: 'POST', body: text }).text()
  return ctx.json({ value, original: text, sameReference: value === second }, { schema: 'app.Decoded' })
}
