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
    outDir: 'dist-node-javascript',
    dev: { networkFetch: false },
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    dev: { networkFetch: false },
  },
  'fastly-javascript': {
    host: 'fastly',
    target: 'javascript',
    outDir: 'dist-fastly-javascript',
    dev: { networkFetch: false },
    fastly: {
      bindings: {
        backends: { 'https://directory.example.test': 'directory_backend' },
        dynamicBackends: false,
      },
    },
  },
  'fastly-native': {
    host: 'fastly',
    target: 'native',
    outDir: 'dist-fastly-native',
    dev: { networkFetch: false },
    fastly: {
      bindings: {
        backends: { 'https://directory.example.test': 'directory_backend' },
        dynamicBackends: false,
      },
    },
  },
}))
