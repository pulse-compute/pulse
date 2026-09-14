import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
interface Input { title: string }
interface Candidate { schemaVersion: number; resourceId: string; title: string }
interface Stored { text: string; byteLength: number; sha256: string }
export default defineSchemaRegistry({ schemas: {
  'app.Input': schema<Input>(),
  'app.Candidate': schema<Candidate>(),
  'app.Stored': schema<Stored>(),
} })
