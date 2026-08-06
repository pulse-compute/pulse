import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'test',
    strict: true,
  },
  test: {
    host: 'node',
    target: 'native',
    assets: {
      store: 'public',
    },
  },
}))
