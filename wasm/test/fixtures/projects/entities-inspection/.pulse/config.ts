import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    defaultProfile: 'node-javascript',
    strict: true,
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-node-javascript',
    dev: {
      config: { MODE: 'inspection' },
      secrets: { TOKEN: 'entities-i8-secret-sentinel' },
      networkFetch: false,
    },
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
        configStore: 'pulse_config',
        secretStore: 'pulse_secrets',
        backends: {},
        dynamicBackends: false,
      },
      build: {
        name: 'pulse-entities-inspection',
        description: 'Entities I8 compile-only Fastly fixture',
        authors: ['Pulse'],
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
        configStore: 'pulse_config',
        secretStore: 'pulse_secrets',
        backends: {},
        dynamicBackends: false,
      },
      build: {
        name: 'pulse-entities-inspection-native',
        description: 'Entities I8 compile-only Fastly Native fixture',
        authors: ['Pulse'],
      },
    },
  },
}))
