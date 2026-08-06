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
                name: 'RichComboBodyV2',
                type: 'RichComboBodyV2',
                source: './examples/schema-types-v2-combinations.ts',
                codec: 'json',
                fields: {
                  id: 'string',
                  roles: [{ enum: ['admin', 'user'] }],
                  steps: [{
                    type: 'object',
                    fields: {
                      kind: { enum: ['click', 'view'] },
                      count: 'i32',
                      note: { type: 'string', required: false, nullable: true },
                      score: { type: 'f64', required: false, nullable: true }
                    }
                  }],
                  profile: {
                    type: 'object',
                    required: false,
                    nullable: true,
                    fields: {
                      status: { enum: ['draft', 'live'] },
                      aliases: ['string'],
                      metrics: {
                        type: 'object',
                        required: false,
                        nullable: true,
                        fields: {
                          score: { type: 'f64', nullable: true }
                        }
                      }
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
