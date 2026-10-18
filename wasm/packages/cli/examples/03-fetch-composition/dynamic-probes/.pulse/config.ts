import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'node-native', strict: true },
  'node-native': { host: 'node', target: 'native' },
  'node-javascript': { host: 'node', target: 'javascript' },
  'fastly-native': { host: 'fastly', target: 'native', fastly: { bindings: { backends: { 'https://one.example': 'origin', 'https://two.example': 'origin' } } } },
  'fastly-javascript': { host: 'fastly', target: 'javascript', fastly: { bindings: { backends: { 'https://one.example': 'origin', 'https://two.example': 'origin' } } } }
}))
