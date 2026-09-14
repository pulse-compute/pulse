import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
export interface Candidate { schemaVersion: number; resourceId: string; title: string }
export interface Verified { title: string; text: string; sha256: string; copiedSha256: string }
export default defineSchemaRegistry({ schemas: {
  'app.Candidate': schema<Candidate>(),
  'app.Verified': schema<Verified>(),
} })
