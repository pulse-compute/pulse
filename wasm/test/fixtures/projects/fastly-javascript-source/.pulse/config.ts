import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'edge',
    reporting: 'info',
    strict: true,
  },
  edge: {
    host: 'fastly',
    target: 'javascript',
    reporting: 'debug',
    dev: {
      host: '127.0.0.1',
      port: 8787,
      watch: false,
      networkFetch: false,
      config: { MODE: 'edge' },
      secrets: {
        TOKEN: 'local-user-token',
        GRIP_TOKEN: 'local-grip-token',
      },
      kv: {
        sessions: {
          'session:1': { id: 'session-1' },
        },
        public: {
          'app.js': 'console.log("pulse-fastly")',
        },
      },
      fetches: {
        'POST https://api.example.test/user': {
          status: 200,
          headers: { 'content-type': 'application/json' },
          value: { id: 7, score: 98.5 },
        },
        'POST https://publisher.example.test/publish': {
          status: 202,
          headers: { 'content-type': 'application/json' },
          value: { accepted: true, messageId: 'dev-message-1' },
        },
      },
    },
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: {
          sessions: 'session_store',
          public: 'asset_store',
        },
        backends: {
          'https://api.example.test': 'api_backend',
          'https://publisher.example.test': 'publisher_backend',
        },
        dynamicBackends: false,
        grip: {
          publishEndpoint: 'https://publisher.example.test/publish',
          publishBackend: 'publisher_backend',
          authentication: {
            scheme: 'bearer',
            secretRef: 'GRIP_TOKEN',
          },
        },
      },
      build: {
        name: 'pulse-fastly-source',
        description: 'Focused Fastly JavaScript source package fixture',
        authors: ['Pulse'],
      },
    },
  },
  'node-native': {
    host: 'node',
    target: 'native',
    reporting: 'warn',
    outDir: '.four-mode-node-native',
  },
  'node-javascript': {
    host: 'node',
    target: 'javascript',
    reporting: 'warn',
    outDir: '.four-mode-node-javascript',
  },
  'fastly-native': {
    host: 'fastly',
    target: 'native',
    reporting: 'warn',
    outDir: '.four-mode-fastly-native',
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: {
          sessions: 'session_store',
          public: 'asset_store',
        },
        backends: {
          'https://api.example.test': 'api_backend',
          'https://publisher.example.test': 'publisher_backend',
        },
        dynamicBackends: false,
        grip: {
          publishEndpoint: 'https://publisher.example.test/publish',
          publishBackend: 'publisher_backend',
          authentication: {
            scheme: 'bearer',
            secretRef: 'GRIP_TOKEN',
          },
        },
      },
      build: {
        name: 'pulse-four-mode-fastly-native',
        description: 'Sprint 6D representative Fastly Native fixture',
        authors: ['Pulse'],
      },
    },
  },
  'fastly-javascript': {
    host: 'fastly',
    target: 'javascript',
    reporting: 'warn',
    outDir: '.four-mode-fastly-javascript',
    fastly: {
      bindings: {
        configStore: 'app_config',
        secretStore: 'app_secrets',
        kv: {
          sessions: 'session_store',
          public: 'asset_store',
        },
        backends: {
          'https://api.example.test': 'api_backend',
          'https://publisher.example.test': 'publisher_backend',
        },
        dynamicBackends: false,
        grip: {
          publishEndpoint: 'https://publisher.example.test/publish',
          publishBackend: 'publisher_backend',
          authentication: {
            scheme: 'bearer',
            secretRef: 'GRIP_TOKEN',
          },
        },
      },
      build: {
        name: 'pulse-four-mode-fastly-javascript',
        description: 'Sprint 6D representative Fastly JavaScript fixture',
        authors: ['Pulse'],
      },
    },
  },
}))
