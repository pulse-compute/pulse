import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    defaultProfile: 'native',
    strict: true,
  },
  native: {
    host: 'node',
    target: 'native',
    outDir: 'dist-native',
    assets: { store: 'public' },
  },
  javascript: {
    host: 'node',
    target: 'javascript',
    outDir: 'dist-javascript',
    assets: { store: 'public' },
  },
}))
