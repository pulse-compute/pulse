import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'test',
    strict: true,
  },
  test: {
    host: 'fastly',
    target: 'native',
    outDir: 'dist',
    name: 'reachable-packages',
    backends: {
      'https://publisher.example.com': 'publisher_backend',
    },
    grip: {
      directHold: true,
      publishUrl: 'https://publisher.example.com/publish',
      publishBackend: 'publisher_backend',
    },
    dynamicBackends: false,
  },
}))
