import { Router } from '@pulse-compute/runtime'

const app = new Router()
const shared = async (ctx) => ctx.text('shared handler')

app.get('/shared-a', shared)
app.get('/shared-b', shared)
app.get('/duplicate-a', async (ctx) => ctx.text('identical body'))
app.get('/duplicate-b', async (ctx) => ctx.text('identical body'))
app.get('/distinct', async (ctx) => ctx.text('different body', { status: 201 }))

export default app
