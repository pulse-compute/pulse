import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-javascript',
    strict: true,
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    outDir: '.event-node-javascript',
    dev: { networkFetch: false },
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: '.event-node-native',
    dev: { networkFetch: false },
  },
  'fastly-javascript': {
    host: 'fastly',
    target: 'javascript',
    outDir: '.event-fastly-javascript',
    dev: { networkFetch: false },
    fastly: {
      build: {
        name: 'pulse-events-fastly-javascript',
        description: 'Event-plane eligibility fixture for Fastly JavaScript',
        authors: ['Pulse'],
      },
    },
  },
  'fastly-native': {
    host: 'fastly',
    target: 'native',
    outDir: '.event-fastly-native',
    dev: { networkFetch: false },
    fastly: {
      build: {
        name: 'pulse-events-fastly-native',
        description: 'Event-plane eligibility fixture for Fastly Native',
        authors: ['Pulse'],
      },
    },
  },
  inspection: {
    host: 'none',
    target: 'native',
    outDir: '.event-inspection',
  },
}))
