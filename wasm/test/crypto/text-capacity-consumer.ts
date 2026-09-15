import { Pulse } from '@pulse-compute/pulse'
import { crypto } from '@pulse-compute/crypto'
import { s3 } from '@pulse-compute/s3'

const app = new Pulse({ auto: true })
app.post('/encoded', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const text = ctx.encodeJson(input, 'app.Text')
  const before = await crypto.digestText(ctx, text)
  const written = await s3.putText(ctx, 'objects', 'capacity', text)
  const read = await s3.getText(ctx, 'objects', 'capacity')
  if (read.status !== 'found') return ctx.json(read)
  const after = await crypto.digestText(ctx, read.text)
  return ctx.json({ before, written, after })
})
app.post('/scan', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  let points = input.text.length
  let valid = true
  for (let i = 0; i < 1024 && i + 0 < input.text.length; i++) {
    const pos = i + 0
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 1024 < input.text.length; i++) {
    const pos = i + 1024
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 2048 < input.text.length; i++) {
    const pos = i + 2048
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 3072 < input.text.length; i++) {
    const pos = i + 3072
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 4096 < input.text.length; i++) {
    const pos = i + 4096
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 5120 < input.text.length; i++) {
    const pos = i + 5120
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 6144 < input.text.length; i++) {
    const pos = i + 6144
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 7168 < input.text.length; i++) {
    const pos = i + 7168
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 8192 < input.text.length; i++) {
    const pos = i + 8192
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 9216 < input.text.length; i++) {
    const pos = i + 9216
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 10240 < input.text.length; i++) {
    const pos = i + 10240
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 11264 < input.text.length; i++) {
    const pos = i + 11264
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 12288 < input.text.length; i++) {
    const pos = i + 12288
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 13312 < input.text.length; i++) {
    const pos = i + 13312
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 14336 < input.text.length; i++) {
    const pos = i + 14336
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  for (let i = 0; i < 1024 && i + 15360 < input.text.length; i++) {
    const pos = i + 15360
    const ch = input.text[pos]
    if (ch >= '\ud800' && ch <= '\udbff') {
      if (pos + 1 >= input.text.length || input.text[pos + 1] < '\udc00' || input.text[pos + 1] > '\udfff') valid = false
    }
    if (ch >= '\udc00' && ch <= '\udfff') {
      points -= 1
      if (pos === 0 || input.text[pos - 1] < '\ud800' || input.text[pos - 1] > '\udbff') valid = false
    }
  }
  return ctx.json({ valid, points })
})
app.post('/response', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  return ctx.text(ctx.encodeJson(input, 'app.Text'))
})
app.post('/encode-over', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const text = ctx.encodeJson({ text: input.text + input.text }, 'app.Text')
  const written = await s3.putText(ctx, 'objects', 'capacity', text)
  return ctx.json(written)
})
app.post('/small', async ctx => {
  const input = await ctx.req.json<{ text: string }>()
  const written = await s3.putText(ctx, 'small', 'capacity', input.text)
  return ctx.json(written)
})
app.get('/get', async ctx => {
  const read = await s3.getText(ctx, 'objects', 'capacity')
  if (read.status !== 'found') return ctx.json(read)
  const digest = await crypto.digestText(ctx, read.text)
  return ctx.json(digest)
})
app.get('/get-small', async ctx => {
  const read = await s3.getText(ctx, 'small', 'capacity')
  return ctx.json(read)
})
export default app
