import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface EventInput {
  sequence: number
}

export interface EventOutput {
  accepted: boolean
  sequence: number
}

export default defineSchemaRegistry({
  schemas: {
    'events.Input': schema<EventInput>(),
    'events.Output': schema<EventOutput>(),
  },
})
