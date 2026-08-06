import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface NestedFlag {
  enabled: boolean
}

export interface LookupInput {
  id: string
  tags: string[]
  nested: NestedFlag
}

export interface LookupOutput {
  id: string
  name: string
  mode: string
  tags: string[]
  nested: NestedFlag
}

export interface EchoInput {
  name: string
  tags: string[]
  nested: NestedFlag
}

export interface EchoOutput {
  name: string
  tags: string[]
  nested: NestedFlag
}

export interface InvalidOutputInput {
  id: string
}

export interface InvalidOutput {
  id: string
  name: string
}

export default defineSchemaRegistry({
  schemas: {
    'entities.EchoInput': schema<EchoInput>(),
    'entities.EchoOutput': schema<EchoOutput>(),
    'entities.InvalidOutput': schema<InvalidOutput>(),
    'entities.InvalidOutputInput': schema<InvalidOutputInput>(),
    'entities.LookupInput': schema<LookupInput>(),
    'entities.LookupOutput': schema<LookupOutput>(),
  },
})
