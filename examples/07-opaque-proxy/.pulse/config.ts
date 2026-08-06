import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'fastly',
    target: 'native',
    outDir: 'dist',
    dev: {
      fetches: {
        'https://assets.example.com/archive.bin': {
          opaque: true,
          status: 206,
          headers: [
            ['content-type', 'application/octet-stream'],
            ['x-part', 'one'],
            ['x-part', 'two'],
          ],
          chunks: ['opaque-example'],
        },
      },
    },
    fastly: {
      bindings: {
        backends: {
          'https://assets.example.com': 'assets_backend',
        },
        dynamicBackends: false,
      },
      build: { name: 'pulse-opaque-proxy-example' },
    },
  },
}))
