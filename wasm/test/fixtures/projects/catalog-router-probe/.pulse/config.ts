import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'node-native', strict: true },
  'node-native': { host: 'node', target: 'native' },
  'node-javascript': { host: 'node', target: 'javascript' },
  'fastly-native': { host: 'fastly', target: 'native' },
  'fastly-javascript': { host: 'fastly', target: 'javascript' },
}))
