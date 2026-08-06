export default defineConfig((env) => ({
  entry: './examples/integrated-compiled-app.js',
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
            defaultNamespace: 'app',
            contentTypePolicy: 'accept-json-or-missing',
            maxBytes: 65536,
            schemas: [
              { namespace: 'app', name: 'CreateUserBody', type: 'CreateUserBody', source: './examples/schema-types.ts', codec: 'json', fields: { name: 'string', age: 'i32', active: 'bool' } }
            ]
          }
        }
      }
    }
  }
}))
