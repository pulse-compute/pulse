import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
export interface SearchInput { query: string }
export interface RetrieveInput { id: string }
export interface ProposalInput { id: string; title: string; reason: string }
export interface Resource { id: string; title: string; url: string }
export interface SearchOutput { resources: Resource[] }
export interface RetrieveOutput { found: boolean; resource: Resource }
export interface ProposalOutput { accepted: boolean; proposalId: string }
export default defineSchemaRegistry({ schemas: {
  'directory.SearchInput': schema<SearchInput>(),
  'directory.RetrieveInput': schema<RetrieveInput>(),
  'directory.ProposalInput': schema<ProposalInput>(),
  'directory.SearchOutput': schema<SearchOutput>(),
  'directory.RetrieveOutput': schema<RetrieveOutput>(),
  'directory.ProposalOutput': schema<ProposalOutput>(),
} })
