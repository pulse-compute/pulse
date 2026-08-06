import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface CustomerLookupInput {
  email: string
}

export interface CustomerLookupOutput {
  email: string
  displayName: string
}

export default defineSchemaRegistry({
  schemas: {
    'tools.CustomerLookupInput': schema<CustomerLookupInput>(),
    'tools.CustomerLookupOutput': schema<CustomerLookupOutput>(),
  },
})

