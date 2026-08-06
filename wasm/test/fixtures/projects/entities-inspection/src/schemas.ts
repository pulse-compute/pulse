import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface LookupInput {
  name: string
  active: boolean
}

export interface LookupOutput {
  label: string
  mode: string
}

export default defineSchemaRegistry({
  schemas: {
    'tools.LookupInput': schema<LookupInput>(),
    'tools.LookupOutput': schema<LookupOutput>(),
  },
})
