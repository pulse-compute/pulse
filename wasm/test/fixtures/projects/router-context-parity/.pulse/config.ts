import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'native',
    strict: true,
  },
  native: {
    host: 'node',
    target: 'native',
    outDir: 'dist-native',
  },
  javascript: {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-javascript',
  },
}))
