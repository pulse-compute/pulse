import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'test', strict: true },
  test: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: { config: { APP_VERSION: '2.0.0' } },
  },
}))
