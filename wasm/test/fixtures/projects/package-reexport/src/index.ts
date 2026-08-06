import { Pulse } from '@pulse-compute/pulse'
import { assets } from './helpers.js'

const app = new Pulse({ auto: true })
assets(app.profile())
app.get('/health', async (ctx) => ctx.text('ok'))
export default app
