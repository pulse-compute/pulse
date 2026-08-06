import { defineConfig } from 'pulse'

export default defineConfig((env) => ({
  entry: './examples/example.js',
  rootRouter: 'app',
  env: env.define(['PULSE_PROFILE', 'ASSET_ENDPOINT', 'ASSET_BUCKET', 'ASSET_KEY', 'ASSET_SECRET', 'USERS_API_BASE_URL', 'USERS_API_TOKEN']),
  profiles: {
    local: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'host-imports',
        timeouts: { defaultMs: 5000, hardMs: 30000, effectDefaultMs: 5000, schedulerResolutionMs: 10 },
        payload: { json: { target: 'generic' }, body: { mode: 'seeded-text-only' } },
        capabilities: {
          assets: { mode: 'local', dir: './public' }
        }
      }
    },
    edge: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        timeouts: { defaultMs: 5000, hardMs: 30000, effectDefaultMs: 5000, schedulerResolutionMs: 10 },
        payload: { json: { target: 'generic' }, body: { mode: 'seeded-text-only' } },
        capabilities: {
          backends: {
            usersApi: {
              baseUrl: env('USERS_API_BASE_URL', 'https://users.example.test'),
              allowedMethods: ['GET', 'POST'],
              timeoutMs: 1500,
              headers: { Authorization: { fromEnv: 'USERS_API_TOKEN' } }
            }
          },
          assets: {
            mode: 'bucket',
            endpoint: env('ASSET_ENDPOINT', 'https://assets.example.test'),
            bucket: env('ASSET_BUCKET', 'pulse-assets'),
            credentials: { key: env('ASSET_KEY'), secret: env('ASSET_SECRET') },
            ttl: 3600,
            immutable: true
          }
        }
      }
    }
  }
}))
