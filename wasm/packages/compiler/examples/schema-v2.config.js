export default defineConfig((env) => ({
  entry: './examples/compiled-handlers.js',
  rootRouter: 'app',
  profiles: {
    edge: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        timeouts: { defaultMs: 5000, hardMs: 30000, effectDefaultMs: 5000, schedulerResolutionMs: 10 },
        payload: {
          body: { mode: 'seeded-text-only' },
          json: {
            target: 'schema',
            schemaVersion: 'v2',
            defaultNamespace: 'app',
            contentTypePolicy: 'accept-json-or-missing',
            maxBytes: 65536,
            schemas: [
              {
                namespace: 'app',
                name: 'CreateUserBodyV2',
                type: 'CreateUserBodyV2',
                source: './examples/schema-types-v2.ts',
                codec: 'json',
                fields: {
                  name: 'string',
                  tags: ['string'],
                  profile: {
                    type: 'object',
                    required: false,
                    nullable: true,
                    fields: {
                      active: 'bool',
                      score: { type: 'f64', nullable: true },
                      role: { enum: ['admin', 'user'] }
                    }
                  }
                }
              },
              {
                namespace: 'auth',
                name: 'LoginBodyV2',
                type: 'LoginBodyV2',
                source: './examples/schema-types-v2.ts',
                codec: 'json',
                fields: {
                  email: 'string',
                  password: 'string',
                  remember: { type: 'bool', required: false }
                }
              }
            ]
          }
        }
      }
    }
  }
}))
