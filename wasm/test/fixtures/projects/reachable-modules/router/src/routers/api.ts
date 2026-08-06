import { Router } from '@pulse-compute/runtime'
import { listUsers } from '../handlers/index.js'

const api = new Router()
api.get('/users', listUsers)

export default api
