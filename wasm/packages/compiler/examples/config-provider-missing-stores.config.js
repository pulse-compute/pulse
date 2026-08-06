import { defineConfig } from 'pulse'

export default defineConfig({
  entry: './examples/example.js',
  rootRouter: 'app',
  profiles: {
    edge: {
      runtime: {
        engine: 'wasm',
        handlerExecutionMode: 'compiled-wasm',
        capabilities: {
          backends: {
            usersApi: {
              baseUrl: { $config: 'USERS_API_BASE_URL' },
              allowedMethods: ['GET']
            }
          }
        }
      }
    }
  }
})
