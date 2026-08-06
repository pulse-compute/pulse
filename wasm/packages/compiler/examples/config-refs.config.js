import { defineConfig } from 'pulse'

export default defineConfig({
  entry: './examples/example.js',
  rootRouter: 'app',
  profiles: {
    edge: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        platform: {
          fastly: {
            configStore: 'pulse_config',
            secretStore: 'pulse_secrets'
          }
        },
        timeouts: { defaultMs: 5000, hardMs: 30000, effectDefaultMs: 5000, schedulerResolutionMs: 10 },
        payload: { json: { target: 'generic' }, body: { mode: 'seeded-text-only' } },
        capabilities: {
          backends: {
            usersApi: {
              baseUrl: { $config: 'USERS_API_BASE_URL' },
              allowedMethods: ['GET', 'POST'],
              timeoutMs: 1500,
              headers: {
                Authorization: { $secret: 'USERS_API_TOKEN' }
              }
            }
          },
          assets: {
            mode: 'bucket',
            endpoint: { $config: 'ASSET_ENDPOINT' },
            bucket: { $config: 'ASSET_BUCKET' },
            credentials: {
              key: { $secret: 'ASSET_KEY' },
              secret: { $secret: 'ASSET_SECRET' }
            }
          }
        }
      }
    }
  }
})
