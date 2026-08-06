import { defineConfig } from 'pulse'

export default defineConfig({
  entry: './examples/integrated-compiled-app.js',
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
          body: { mode: 'seeded-text-only' },
          json: {
            target: 'schema',
            defaultNamespace: 'app',
            contentTypePolicy: 'accept-json-or-missing',
            maxBytes: 65536,
            schemas: [
              {
                namespace: 'app',
                name: 'CreateUserBody',
                type: 'CreateUserBody',
                source: './examples/schema-types.ts',
                codec: 'json',
                fields: { name: 'string', age: 'i32', active: 'bool' }
              }
            ]
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
