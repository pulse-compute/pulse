import type { PulseContext } from '@pulse-compute/pulse'
import type { SearchInput, RetrieveInput, ProposalInput, SearchOutput, RetrieveOutput, ProposalOutput } from './schemas.js'

export async function search(ctx: PulseContext, input: SearchInput) {
  const origin = await ctx.config.get('DIRECTORY_ORIGIN')
  const result = await ctx.fetch(`${origin}/search`, { method: 'POST', json: input, schema: 'directory.SearchInput' }).json<SearchOutput>('directory.SearchOutput')
  return { resources: result.resources }
}
export async function retrieve(ctx: PulseContext, input: RetrieveInput) {
  const origin = await ctx.config.get('DIRECTORY_ORIGIN')
  const result = await ctx.fetch(`${origin}/retrieve`, { method: 'POST', json: input, schema: 'directory.RetrieveInput' }).json<RetrieveOutput>('directory.RetrieveOutput')
  return { found: result.found, resource: result.resource }
}
export async function proposeUpdate(ctx: PulseContext, input: ProposalInput) {
  const origin = await ctx.config.get('DIRECTORY_ORIGIN')
  const result = await ctx.fetch(`${origin}/proposals`, { method: 'POST', json: input, schema: 'directory.ProposalInput' }).json<ProposalOutput>('directory.ProposalOutput')
  return { accepted: result.accepted, proposalId: result.proposalId }
}
