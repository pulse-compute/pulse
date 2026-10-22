import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { Input, Output } from '../src/types'

export default defineSchemaRegistry({ schemas: {
  'example.Input': schema<Input>(),
  'example.Output': schema<Output>(),
} })
