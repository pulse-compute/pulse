export default defineConfig((env) => ({
  entry: './app.js',
  rootRouter: 'app',
  profiles: {
    local: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        timeouts: { defaultMs: 5000, hardMs: 30000, effectDefaultMs: 1500, schedulerResolutionMs: 10 },
        payload: {
          body: { mode: 'seeded-text-only' },
          json: {
            target: 'parser',
            parser: 'as-json',
            contentTypePolicy: 'accept-json-or-missing',
            maxBytes: 65536,
            defaultNamespace: 'app',
            schemas: [
              { namespace: 'app', name: 'CreateUserRequest', type: 'CreateUserRequest', source: './schema-types.ts', codec: 'json', fields: { id: 'string', name: 'string', active: 'bool' } },
              { namespace: 'upstream', name: 'CreateUserRequest', type: 'UpstreamCreateUserRequest', source: './schema-types.ts', codec: 'json', fields: { id: 'string', name: 'string', active: 'bool' } },
              { namespace: 'app', name: 'CreateUserResponse', type: 'CreateUserResponse', source: './schema-types.ts', codec: 'json', fields: { id: 'string', name: 'string', active: 'bool' } },
              { namespace: 'app', name: 'UserResponse', type: 'UserResponse', source: './schema-types.ts', codec: 'json', fields: { id: 'string', name: 'string', active: 'bool' } }
            ]
          }
        },
        capabilities: {
          backends: {
            users: {
              baseUrl: env('USERS_ORIGIN_BASE_URL', 'http://127.0.0.1:0'),
              allowedMethods: ['GET', 'HEAD', 'POST'],
              timeoutMs: 1500,
              responseBody: ['json', 'text'],
              requestBody: ['none', 'json']
            }
          }
        }
      }
    }
  }
}))
