import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'
import { crypto } from '@pulse-compute/crypto'
import type { Page } from './types'

const app = new Pulse({ auto: true })

app.get('/pages', async (ctx) => {
  const mode = ctx.req.header('x-mode') || ''
  if (mode === 'alias') {
    const first = { value: 1 }
    const alias = first
    const distinct = { value: 1 }
    alias.value += 1
    return ctx.text((first === alias) + ':' + (first === distinct) + ':' + first.value + ':' + distinct.value)
  }
  let key = ctx.req.header('x-start') || ''
  let last = -1
  const state = { visits: 0 }
  const alias = state
  for (let index = 0; index < 64 && key !== ''; index++) {
    const stored = await s3.getText(ctx, 'objects', key)
    if (stored.status !== 'found') return ctx.text('unavailable', { status: 503 })
    const digest = await crypto.digestText(ctx, stored.text)
    if (digest.status !== 'ok' || digest.sha256 !== stored.sha256) return ctx.text('invalid', { status: 503 })
    const page = ctx.decodeJson<Page>(stored.text, 'efficiency.Page')
    if (page.index !== index || page.payload.length === 0) return ctx.text('invalid', { status: 503 })
    alias.visits += 1
    last = page.index
    key = page.next
  }
  if (key !== '') return ctx.text('incomplete', { status: 409 })
  return ctx.text(state.visits + ':' + last)
})

export default app
