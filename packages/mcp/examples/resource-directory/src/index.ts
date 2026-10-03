import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { search, retrieve, proposeUpdate } from './handlers.js'
const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on('directory.search', { input: 'directory.SearchInput', output: 'directory.SearchOutput', metadata: {
  title: 'Search resources', description: 'Search a bounded resource directory by title.', mcp: { readOnlyHint: true },
} }, search)
rpc.on('directory.retrieve', { input: 'directory.RetrieveInput', output: 'directory.RetrieveOutput', metadata: {
  title: 'Retrieve resource', description: 'Retrieve one resource by identifier.', mcp: { readOnlyHint: true },
} }, retrieve)
rpc.on('directory.propose-update', { input: 'directory.ProposalInput', output: 'directory.ProposalOutput', metadata: {
  title: 'Propose an update', description: 'Submit a title change for human review. Does not change the resource.', mcp: { readOnlyHint: false, destructiveHint: false },
} }, proposeUpdate)
export default async function handler(ctx: unknown) { return rpc.handle(ctx as never) }
