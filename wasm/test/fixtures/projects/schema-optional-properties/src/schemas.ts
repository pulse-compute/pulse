import {defineSchemaRegistry, schema} from '@pulse-compute/pulse/schema'
import type {Int32, Uint32} from '@pulse-compute/pulse/schema'

export interface Resource {
  id: string
  notes?: string
  owner: {type: string; id?: string; label: string}
  locations: {id: string; kind: string; label?: string; url?: string; instructions?: string; primary: boolean}[]
  flags?: {active?: boolean; score?: number; values?: string[]; child?: {text?: string}}
  nullable?: string | null
  signed?: Int32
  unsigned?: Uint32
  role?: 'author' | 'reviewer'
}
export default defineSchemaRegistry({schemas:{'app.Resource':schema<Resource>()}})
