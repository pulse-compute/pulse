import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { Page } from './types'
export default defineSchemaRegistry({ schemas: { 'pages.Page': schema<Page>() } })
