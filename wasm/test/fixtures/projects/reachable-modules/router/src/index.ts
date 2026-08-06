import { Pulse } from '@pulse-compute/pulse'
import { auditApi, getUser } from '@app/handlers/index.js'
import api from './routers/api.js'

const app = new Pulse({ auto: true })
app.use('/api', auditApi)
app.get('/users/:id', (getUser satisfies typeof getUser))
app.mount('/api', (api as typeof api))

export default app
