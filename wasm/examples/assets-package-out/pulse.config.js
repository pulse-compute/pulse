export default defineConfig({
  entry: './app.js',
  rootRouter: 'router',
  profile: 'local',
  outDir: './.pulsewasm',
  profiles: {
    local: {
      runtime: {
        engine: 'wasm',
        assets: {
          stores: {
            public: {
              mode: 'local',
              dir: './public',
              methods: ['GET', 'HEAD'],
              responseBody: ['text'],
              cacheControl: 'public, max-age=60'
            }
          }
        }
      }
    }
  }
})
