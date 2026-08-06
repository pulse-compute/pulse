import { Pulse } from '@pulse-compute/pulse'

const app = new Pulse({ auto: true })

app.post('/mcp', async (ctx) => {
  const body = await ctx.req.text()
  return ctx.fetch('https://mcp.example.test/rpc', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body,
  })
})

export default app
