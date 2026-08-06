import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  javascript: {
    host: 'node',
    target: 'javascript',
  },
  local: {
    host: 'node',
    target: 'native',
    apiBase: scope.config('API_BASE'),
    token: scope.secret('API_TOKEN'),
  },
}))
