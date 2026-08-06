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
        'https://users.example.test/users/123': {
          value: { id: 123, name: 'Ada' },
          delayMs: 15,
        },
        'https://stats.example.test/users/123': {
          value: { score: 42 },
          delayMs: 5,
        },
        'https://flags.example.test/users/123': {
          value: { enabled: true },
          delayMs: 1,
        },
      },
    },
  },
}))
