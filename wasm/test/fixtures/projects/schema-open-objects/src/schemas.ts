import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { JsonValue, JsonObject, OpenObject } from '@pulse-compute/pulse/schema'

type Context = OpenObject<{ source: string; note?: string | null }>
type Filter = OpenObject<{ field: string; op: 'eq' | 'in' }>
export type Event = OpenObject<{
  event: string
  properties: JsonObject
  context: Context
  optionalContext?: Context | null
  data?: JsonValue
  samples?: JsonValue[]
  filters?: Filter[]
  closed?: { known: string }
}>

export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>(),
  'app.Deep': schema<Event>({ json: { maxDepth: 128 } }),
  'app.Small': schema<OpenObject<{ data: JsonValue }>>({ json: {
    maxTextBytes: 512, maxDepth: 4, maxNodes: 12, maxObjectMembers: 3,
    maxArrayItems: 4, maxKeyLength: 8, maxStringLength: 16, maxJsonBytes: 256,
  } }),
  'app.Empty': schema<OpenObject<{}>>(),
  'app.Closed': schema<{ context: Context }>({ json: { maxNodes: 12 } }),
} })
