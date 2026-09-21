import { Pulse } from '@pulse-compute/pulse'
import { s3 } from '@pulse-compute/s3'
import { crypto } from '@pulse-compute/crypto'
import type { Page } from './types'

const app = new Pulse({ auto: true })
app.get('/pages', async (ctx) => {
  let key = ctx.req.header('x-start') || ''
  const stopBefore = ctx.req.header('x-stop-before') || ''
  const state = { visits: 0, sum: 0 }
  const alias = state
  const i = 99
  for (let i = 0; i < 64 && key !== ''; i++) {
    if (key === stopBefore) break
    const stored = await s3.getText(ctx, 'objects', key)
    if (stored.status !== 'found') return ctx.text('unavailable', { status: 503 })
    const digest = await crypto.digestText(ctx, stored.text)
    if (digest.status !== 'ok' || digest.sha256 !== stored.sha256) return ctx.text('invalid', { status: 503 })
    const page = ctx.decodeJson<Page>(stored.text, 'pages.Page')
    alias.visits += 1
    for (let j = 0; j < 4 && j < page.values.length; j++) {
      if (page.values[j] < 0) continue
      if (page.values[j] === 99) break
      state.sum += page.values[j]
    }
    key = page.next
    if (page.action === 'continue') continue
    if (page.action === 'break') break
    if (page.action === 'return') return ctx.text('found:' + i + ':' + state.sum)
    state.sum += 100
  }
  return ctx.text(state.visits + ':' + state.sum + ':' + key + ':' + i)
})
export default app
