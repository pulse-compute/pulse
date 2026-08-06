import { Pulse } from '@pulse-compute/pulse'
import { assets } from '@pulse-compute/assets'

const app = new Pulse({ auto: true })
assets(app.profile())
app.get('/health', async (ctx) => ctx.text('ok'))
export default app
