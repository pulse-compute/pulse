import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'javascript',
    strict: true,
  },
  javascript: {
    host: 'node',
    target: 'javascript',
    mode: scope.config('MODE'),
  },
}))
