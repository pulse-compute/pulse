import { EntityRouter, jsonRpc } from '@pulse-compute/entities'
import { start, search, read, example, explainDiagnostic } from './handlers.js'

const rpc = new EntityRouter({ adapter: jsonRpc({ namedParamsOnly: true }) })
rpc.on(
  'pulse.start',
  {
    input: 'context.StartInput',
    output: 'context.StartOutput',
    metadata: {
      title: 'Start a Pulse project',
      description:
        'Return a Node Native or JavaScript starter plan for this exact snapshot.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  start,
)
rpc.on(
  'pulse.search',
  {
    input: 'context.SearchInput',
    output: 'context.SearchOutput',
    metadata: {
      title: 'Search Pulse context',
      description: 'Search bundled context with ranked excerpts and explicit pagination.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  search,
)
rpc.on(
  'pulse.read',
  {
    input: 'context.ReadInput',
    output: 'context.ReadOutput',
    metadata: {
      title: 'Read a Pulse contract',
      description:
        'Read one cited corpus ID; continue with the returned UTF-16 nextOffset.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  read,
)
rpc.on(
  'pulse.example',
  {
    input: 'context.ExampleInput',
    output: 'context.ExampleOutput',
    metadata: {
      title: 'Retrieve a Pulse example',
      description:
        'Retrieve maintained starter files by exact corpus ID, with pagination.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  example,
)
rpc.on(
  'pulse.explain_diagnostic',
  {
    input: 'context.DiagnosticInput',
    output: 'context.DiagnosticOutput',
    metadata: {
      title: 'Explain a Pulse diagnostic',
      description:
        'Explain an exact diagnostic with citations and suggested local checks.',
      mcp: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
  },
  explainDiagnostic,
)

export default function handler(ctx: unknown) {
  return rpc.handle(ctx as never)
}
