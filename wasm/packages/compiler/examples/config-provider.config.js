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
        payload: {
          json: {
            target: 'schema'
          }
        },
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
            endpoint: { $config: 'ASSET_ENDPOINT' },
            bucket: { $config: 'ASSET_BUCKET' },
            key: { $secret: 'ASSET_KEY' }
          }
        }
      }
    }
  }
})
