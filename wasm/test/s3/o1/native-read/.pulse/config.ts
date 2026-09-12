import { defineConfig } from '@pulse-compute/pulse'

// O2 acceptance target. Provider-owned binding fragments are supplied by the
// runner; this fixture must resolve the real package, never the draft .d.ts.
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: true },
  'node-native': { host: 'node', target: 'native' },
  'fastly-native': { host: 'fastly', target: 'native' },
}))
