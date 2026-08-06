export default defineConfig((env) => ({
  entry: './examples/integrated-compiled-app.js',
  rootRouter: 'app',
  profiles: {
    edge: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        provider: {
          kind: 'fastly',
          configStore: 'pulse_config',
          secretStore: 'pulse_secrets',
          kv: {
            sessions: 'sessions',
            cache: 'cache'
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
              { namespace: 'app', name: 'CreateUserBody', type: 'CreateUserBody', source: './examples/schema-types.ts', codec: 'json', fields: { name: 'string', age: 'i32', active: 'bool' } }
            ]
          }
        },
        capabilities: {
          backends: {
            usersApi: {
              baseUrl: { $config: 'USERS_API_BASE_URL' },
              allowedMethods: ['GET', 'POST'],
              timeoutMs: 1500,
              headers: { Authorization: { $secret: 'USERS_API_TOKEN' } }
            }
          }
        }
      }
    }
  }
}))
