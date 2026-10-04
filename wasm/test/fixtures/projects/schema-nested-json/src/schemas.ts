import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { JsonValue as Json, JsonObject } from '@pulse-compute/pulse/schema'

type Properties = JsonObject
export interface Event {
  event: string
  properties: Properties
  context: { source: string }
  data?: Json
  samples?: Json[]
}

export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>(),
  'app.Deep': schema<Event>({ json: { maxDepth: 128 } }),
  'app.Small': schema<{ data: Json }>({ json: {
    maxTextBytes: 512, maxDepth: 4, maxNodes: 12, maxObjectMembers: 3,
    maxArrayItems: 4, maxKeyLength: 8, maxStringLength: 16, maxJsonBytes: 256,
  } }),
} })
