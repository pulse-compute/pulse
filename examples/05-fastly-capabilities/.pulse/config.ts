import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((scope) => ({
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
    apiBase: scope.config('API_BASE'),
    apiToken: scope.secret('API_TOKEN'),
    dev: {
      config: { API_BASE: 'https://api.example.com' },
      secrets: {
        API_TOKEN: 'local-example-secret',
        GRIP_TOKEN: 'local-grip-secret',
      },
      kv: {
        sessions: { 'session:123': { userId: 123 } },
      },
      fetches: {
        'https://api.example.com/users/7': {
          value: { id: 7, name: 'Ada' },
        },
        'POST https://publisher.example.com/publish': {
          status: 202,
          value: { accepted: true, messageId: 'message-1' },
        },
      },
    },
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: { sessions: 'app_sessions' },
        backends: {
          'https://api.example.com': 'api_backend',
          'https://publisher.example.com': 'publisher_backend',
        },
        dynamicBackends: false,
        grip: {
          publishEndpoint: 'https://publisher.example.com/publish',
          publishBackend: 'publisher_backend',
          authentication: {
            scheme: 'bearer',
            secretRef: 'GRIP_TOKEN',
          },
        },
      },
      build: { name: 'pulse-fastly-capabilities-example' },
    },
  },
}))
