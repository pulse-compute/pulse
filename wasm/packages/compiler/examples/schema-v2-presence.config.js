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
                name: 'PresenceBodyV2',
                type: 'PresenceBodyV2',
                source: './examples/schema-types-v2-presence.ts',
                codec: 'json',
                fields: {
                  id: 'string',
                  alias: { type: 'string', required: false },
                  nickname: { type: 'string', nullable: true },
                  bio: { type: 'string', required: false, nullable: true },
                  profile: {
                    type: 'object',
                    required: false,
                    nullable: true,
                    fields: {
                      active: 'bool',
                      note: { type: 'string', required: false, nullable: true }
                    }
                  }
                }
              }
            ]
          }
        }
      }
    }
  }
}))
