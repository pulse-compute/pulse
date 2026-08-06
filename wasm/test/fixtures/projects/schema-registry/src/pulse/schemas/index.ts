import {
  defineSchemaRegistry,
  response,
  schema,
} from '@pulse-compute/pulse/schema'
import type { CreateUserInput, User, ApiError } from './models.js'

export default defineSchemaRegistry({
  schemas: {
    'app.createInput': schema<CreateUserInput>(),
    'app.user': schema<User>(),
    'app.error': schema<ApiError>(),
  },
  responses: {
    'user.created': response(201, 'app.user'),
    'user.success': response(200, 'app.user'),
    'user.failure': response(200, 'app.error'),
  },
})
