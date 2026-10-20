import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    defaultProfile: 'node-native',
    strict: true,
    binaryResources: {
      manifest: '__CONTEXT_RESOURCE_MANIFEST__',
      bindings: {
        'context.vector': '/vector.bin',
        'context.text': '/text.bin',
        'context.metadata': '/metadata.bin',
      },
      budgets: {
        files: 3, bindings: 3, fileBytes: 5242880,
        totalBytes: 8388608, serializedBytes: 16777216,
      },
    },
  },
  'node-javascript': {
    host: 'node', target: 'javascript', outDir: 'dist-node-javascript',
    schemas: { maxBytes: 65536 },
    dev: { host: '127.0.0.1', networkFetch: false },
    node: { maxDurationMs: 5000 },
  },
  'node-native': {
    host: 'node', target: 'native', outDir: 'dist-node-native',
    schemas: { maxBytes: 65536 },
    dev: { host: '127.0.0.1', networkFetch: false },
    node: { maxDurationMs: 5000 },
  },
  'fastly-native': {
    host: 'fastly', target: 'native', outDir: 'dist-fastly-native',
    schemas: { maxBytes: 65536 },
    dev: { networkFetch: false },
    fastly: { maxDurationMs: 5000, bindings: { dynamicBackends: false } },
  },
}))
