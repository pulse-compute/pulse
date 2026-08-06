import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'reality',
    strict: true,
  },
  reality: {
    host: 'fastly',
    target: 'native',
    crypto: ['HS256'],
    outDir: 'dist',
    apiBase: scope.config('API_BASE'),
    apiToken: scope.secret('API_TOKEN'),
    schemas: {
      contentTypePolicy: 'require-json',
      maxBytes: 1024,
    },
    dev: {
      networkFetch: false,
      config: { API_BASE: '__PULSE_REALITY_ORIGIN__' },
      secrets: { API_TOKEN: 'local-reality-secret' },
      kv: { state: {} },
      fetches: {
        '__PULSE_REALITY_ORIGIN__/origin/user': {
          status: 200,
          headers: { 'content-type': 'application/json' },
          value: { id: 7, authSeen: true },
        },
        '__PULSE_REALITY_ORIGIN__/binary': {
          opaque: true,
          status: 200,
          headers: [
            ['content-type', 'application/octet-stream'],
            ['x-binary-repeat', 'one'],
            ['x-binary-repeat', 'two'],
          ],
          chunks: [[0, 255, 1, 2, 3]],
        },
      },
    },
    fastly: {
      bindings: {
        configStore: 'reality_config',
        secretStore: 'reality_secrets',
        kv: { state: 'reality_state' },
        backends: { '__PULSE_REALITY_ORIGIN__': 'reality_origin' },
        grip: {
          directHold: true,
          publishUrl: '__PULSE_REALITY_ORIGIN__/grip/publish',
          publishBackend: 'reality_origin',
        },
        dynamicBackends: false,
      },
      build: {
        name: 'pulse-fastly-compute-reality',
        description: 'Compiled Pulse Fastly Compute reality fixture',
      },
    },
  },
}))
