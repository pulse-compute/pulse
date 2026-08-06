import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-native',
    strict: true,
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-node-javascript',
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
}))

