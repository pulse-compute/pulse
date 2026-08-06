import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: {
      fetches: {
        'POST https://mcp.example.test/rpc': {
          opaque: true,
          status: 200,
          headers: [['content-type', 'application/json']],
          chunks: ['{"jsonrpc":"2.0","result":{},"id":1}'],
        },
      },
    },
  },
}))
