import { defineConfig } from 'pulse'

export default defineConfig((env) => ({
  entry: env('ENTRY_FILE'),
  rootRouter: 'app',
  profile: env('PULSE_PROFILE', 'local'),
  profiles: {
    local: {
      routes: env('ROUTE_SET')
    }
  }
}))
