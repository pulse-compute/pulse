import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface Payload {
  value: string
}

export interface CreateUserInput {
  name: string
  active: boolean
}

export interface OriginRequest {
  name: string
}

export interface OriginUser {
  id: number
  score: number
}

export interface UserResponse {
  id: string
  name: string
  active: boolean
  middleware: string
  mode: string
  sessionId: string
  stored: boolean
  upstreamId: number
  score: number
  acknowledged: boolean
  authenticated: boolean
}

export default defineSchemaRegistry({
  schemas: {
    'app.CreateUserInput': schema<CreateUserInput>(),
    'app.OriginRequest': schema<OriginRequest>(),
    'app.OriginUser': schema<OriginUser>(),
    'app.Payload': schema<Payload>(),
    'app.UserResponse': schema<UserResponse>(),
  },
})
