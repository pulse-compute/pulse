import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { ScalarRecord } from '@pulse-compute/pulse/schema'

export interface Event {
  event: string
  properties: ScalarRecord
  context: { source: string }
  samples?: ScalarRecord[]
  extra?: ScalarRecord | null
}

export interface RequiredEvent {
  event: string
  properties: ScalarRecord
  context: { source: string }
}

export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>(),
  'app.RequiredEvent': schema<RequiredEvent>(),
} })
