import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface Input {
  title: string
  score: number
  role: string
  tags: string[]
  note: string | null
}
export interface Candidate {
  schemaVersion: number
  resourceId: string
  title: string
  score: number
  role: 'author' | 'reviewer'
  detail: { tags: string[]; note: string | null }
}
export default defineSchemaRegistry({ schemas: {
  'app.Input': schema<Input>(),
  'app.Candidate': schema<Candidate>(),
} })
