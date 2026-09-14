import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface Candidate {
  title: string
  score: number
  role: 'author' | 'reviewer'
  detail: { tags: string[]; note: string | null }
}
export interface Decoded {
  value: Candidate
  original: string
  sameReference: boolean
}
export default defineSchemaRegistry({ schemas: {
  'app.Candidate': schema<Candidate>(),
  'app.Decoded': schema<Decoded>(),
} })
