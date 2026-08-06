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
    outDir: '.pulse-i9-node-javascript',
    dev: {
      config: { MODE: 'conformance' },
      secrets: { TOKEN: 'entities-i9-sensitive-secret' },
      networkFetch: false,
    },
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: '.pulse-i9-node-native',
    dev: { networkFetch: false },
  },
  'fastly-javascript': {
    host: 'fastly',
    target: 'javascript',
    outDir: '.pulse-i9-fastly-javascript',
    dev: { networkFetch: false },
    fastly: {
      bindings: {
        configStore: 'entities_config',
        secretStore: 'entities_secrets',
        backends: {
          'https://directory.example.test': 'directory_backend',
        },
        dynamicBackends: false,
      },
      build: {
        name: 'pulse-entities-i9-fastly-javascript',
        description: 'Entities I9 Fastly JavaScript conformance',
        authors: ['Pulse'],
      },
    },
  },
  'fastly-native': {
    host: 'fastly',
    target: 'native',
    outDir: '.pulse-i9-fastly-native',
    dev: { networkFetch: false },
    fastly: {
      bindings: {
        configStore: 'entities_config',
        secretStore: 'entities_secrets',
        backends: {
          'https://directory.example.test': 'directory_backend',
        },
        dynamicBackends: false,
      },
      build: {
        name: 'pulse-entities-i9-fastly-native',
        description: 'Entities I9 Fastly Native conformance',
        authors: ['Pulse'],
      },
    },
  },
}))
