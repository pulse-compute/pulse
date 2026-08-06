import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface CreateUserInput {
  name: string
  active: boolean
}

export interface CreateUserOutput {
  id: number
  name: string
  active: boolean
  sameReference: boolean
}

export default defineSchemaRegistry({
  schemas: {
    'app.CreateUserInput': schema<CreateUserInput>(),
    'app.CreateUserOutput': schema<CreateUserOutput>(),
  },
})
