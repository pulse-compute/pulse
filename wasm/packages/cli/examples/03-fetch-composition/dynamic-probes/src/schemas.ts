import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
export interface ProbeInput { endpoints: string[] }
export interface ProbeResult { ok: boolean }
export interface ProbeOutput { results: ProbeResult[] }
export default defineSchemaRegistry({ schemas: {
  'probe.Input': schema<ProbeInput>({ json: { maxArrayItems: 32, maxStringLength: 2048, maxTextBytes: 65536 } }),
  'probe.Result': schema<ProbeResult>(),
  'probe.Output': schema<ProbeOutput>({ json: { maxArrayItems: 32 } })
} })
