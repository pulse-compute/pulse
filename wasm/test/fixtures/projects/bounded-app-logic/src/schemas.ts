import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface Input {
  title: string
  target: string
  command: string
  items: { id: string; version: number }[]
  grants: { target: string; members: string[] }[]
  receipts: { command: string; result: string }[]
}
export interface Output {
  title: string
  selected: { id: string; version: number }[]
  visits: number
  member: boolean
  replay: string
}
export default defineSchemaRegistry({ schemas: { 'app.Input': schema<Input>(), 'app.Output': schema<Output>() } })
