import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { Int32 } from '@pulse-compute/pulse/schema'

export interface VersionInput {
  version: string
}
export interface Selection {
  provider?: string
  target?: string
}
export interface StartInput {
  version: string
  goal: string
  provider: string
  target: string
}
export interface SearchInput {
  version: string
  provider?: string
  target?: string
  query: string
  category?: string
  limit?: Int32
  offset?: Int32
}
export interface ReadInput {
  version: string
  provider?: string
  target?: string
  id: string
  offset?: Int32
}
export interface ExampleInput {
  version: string
  provider?: string
  target?: string
  id: string
  files?: string[]
  offset?: Int32
}
export interface DiagnosticInput {
  version: string
  code: string
}

export interface Applicability {
  provider: string
  target: string
}
export interface Source {
  path: string
  selection: string
  url: string
  sha256: string
  startLine?: Int32
  endLine?: Int32
}
export interface RecordSummary {
  id: string
  title: string
  category: string
  tags: string[]
  applicability: Applicability[]
  source: Source
  contentSha256: string
}
export interface RecordContent {
  id: string
  title: string
  category: string
  tags: string[]
  applicability: Applicability[]
  source: Source
  contentSha256: string
  content: string
  offset: Int32
  totalBytes: Int32
  truncated: boolean
  nextOffset?: Int32
}
export interface SearchHit {
  id: string
  title: string
  category: string
  tags: string[]
  applicability: Applicability[]
  source: Source
  contentSha256: string
  excerpt: string
  excerptTruncated: boolean
  score: Int32
}
export interface Metadata {
  pulseVersion: string
  corpusSchemaVersion: string
  corpusHash: string
  snapshotStatus: string
  applicationVersion: string
  requestedVersion?: string
  maxReplyBytes: Int32
}
export interface Failure {
  code: string
  message: string
}
export type Status =
  | 'ok'
  | 'version-mismatch'
  | 'invalid-input'
  | 'unsupported-selection'
  | 'unknown-id'
  | 'unknown-code'
  | 'unknown-goal'
  | 'unknown-example'
  | 'response-too-large'
export interface BaseOutput {
  meta: Metadata
  status: Status
  error?: Failure
}
export interface CommandStep {
  command: string
  purpose: string
  sourceId: string
}
export interface Dependency {
  name: string
  version: string
  kind: string
}
export interface Configuration {
  path: string
  content: string
  sourceId: string
  changedFields: string[]
}
export interface StarterPlan {
  goal: string
  provider: string
  target: string
  imports: string[]
  dependencies: Dependency[]
  configuration: Configuration
  contracts: RecordSummary[]
  exampleId: string
  exampleApplicability: Applicability[]
  commands: CommandStep[]
  unresolvedChoices: string[]
}
// Schema extraction supports closed interfaces, not interface inheritance.
export interface StartOutput {
  meta: Metadata
  status: Status
  error?: Failure
  plan?: StarterPlan
  supportedGoals: string[]
  supportedSelections: Applicability[]
}
export interface SearchOutput {
  meta: Metadata
  status: Status
  error?: Failure
  results: SearchHit[]
  totalMatches: Int32
  truncated: boolean
  nextOffset?: Int32
}
export interface ReadOutput {
  meta: Metadata
  status: Status
  error?: Failure
  record?: RecordContent
  truncated: boolean
  nextOffset?: Int32
}
export interface ExampleOutput {
  meta: Metadata
  status: Status
  error?: Failure
  availableIds: string[]
  records: RecordContent[]
  totalRecords: Int32
  truncated: boolean
  nextOffset?: Int32
}
export interface DiagnosticExplanation {
  code: string
  summary: string
  summaryAvailable: boolean
  remediation: string[]
  diagnostic: RecordContent
  contracts: RecordSummary[]
  nextLocalChecks: CommandStep[]
}
export interface DiagnosticOutput {
  meta: Metadata
  status: Status
  error?: Failure
  explanation?: DiagnosticExplanation
}

export default defineSchemaRegistry({
  schemas: {
    'context.StartInput': schema<StartInput>(),
    'context.StartOutput': schema<StartOutput>(),
    'context.SearchInput': schema<SearchInput>(),
    'context.SearchOutput': schema<SearchOutput>(),
    'context.ReadInput': schema<ReadInput>(),
    'context.ReadOutput': schema<ReadOutput>(),
    'context.ExampleInput': schema<ExampleInput>(),
    'context.ExampleOutput': schema<ExampleOutput>(),
    'context.DiagnosticInput': schema<DiagnosticInput>(),
    'context.DiagnosticOutput': schema<DiagnosticOutput>(),
  },
})
