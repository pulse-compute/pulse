import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'javascript',
    strict: true,
  },
  javascript: {
    host: 'node',
    target: 'javascript',
    assets: {
      store: 'public',
    },
  },
}))
