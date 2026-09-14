export default async function handler(ctx) {
  const input = await ctx.req.json('app.Input')
  if (ctx.req.header('x-mode') === 'missing') {
    return ctx.text(ctx.encodeJson({ title: input.title }, 'app.Candidate'))
  }
  const title = ctx.req.header('x-mode') === 'wrong-type' ? 17 : input.title
  const score = ctx.req.header('x-mode') === 'nonfinite' ? input.score / 0 : input.score
  const candidate = {
    detail: { note: input.note, tags: input.tags, ignored: 'removed' },
    role: input.role, score, title, resourceId: 'resource-1', schemaVersion: 1,
    ignored: 'removed',
  }
  const text = ctx.encodeJson(candidate, 'app.Candidate')
  candidate.resourceId = 'changed-after-encoding'
  const stored = await ctx.fetch('https://objects.invalid/candidate', { method: 'POST', body: text }).text()
  return ctx.text(text)
}
