import { Pulse } from '@pulse-compute/pulse'
import type { CreateUserInput, CreateUserOutput } from './schemas.js'

const app = new Pulse({ auto: true })

app.post('/users', async (ctx) => {
  const first = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const second = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const output: CreateUserOutput = {
    id: 7,
    name: first.name,
    active: first.active,
    sameReference: first === second,
  }
  return ctx.json(output, { status: 201, schema: 'app.CreateUserOutput' })
})

export default app
