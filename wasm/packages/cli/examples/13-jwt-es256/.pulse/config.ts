import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-native',
    strict: true,
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    crypto: {
      ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' },
    },
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
}))
