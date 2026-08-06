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
            target: 'auto',
            parser: 'as-json',
            contentTypePolicy: 'accept-json-or-missing',
            maxBytes: 65536
          }
        }
      }
    }
  }
}))
