import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'

// Exercises the public CLI storage path using offline fixtures.
const app = new Pulse({ auto: true })

app.post('/conditional-kv', async (ctx) => {
  const store = ctx.kv<{ value: string }>('authority')
  const created = await store.insertIfAbsent('test/probe', { value: 'initial' })
  const duplicate = await store.insertIfAbsent('test/probe', { value: 'duplicate' })
  const before = await store.getVersioned('test/probe')
  if (before.status === 'found') {
    const updated = await store.compareAndSwap('test/probe', before.generation, { value: 'updated' })
    const stale = await store.compareAndSwap('test/probe', before.generation, { value: 'stale' })
    const after = await store.getVersioned('test/probe')
    if (after.status === 'found') {
      return ctx.json({ created: created.status, duplicate: duplicate.status,
        read: before.status, updated: updated.status, stale: stale.status,
        value: after.value.value, generationChanged: before.generation !== after.generation })
    }
  }
  return ctx.json({ error: 'conditional read did not find the inserted value' }, { status: 500 })
})

app.post('/objects', async (ctx) => {
  const written = await s3.putText(ctx, 'objects', 'test/candidate.json', 'storage!')
  const metadata = await s3.head(ctx, 'objects', 'test/candidate.json')
  const object = await s3.getText(ctx, 'objects', 'test/candidate.json')
  return ctx.json({ written, metadata, object })
})

app.post('/invalid-object-key', async (ctx) => {
  const result = await s3.putText(ctx, 'objects', '../outside', 'storage!')
  return ctx.json(result)
})

export default app
