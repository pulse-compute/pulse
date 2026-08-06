import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/pulse/schemas/index.ts',
    defaultProfile: 'native',
    strict: true,
  },
  native: {
    host: 'node',
    target: 'native',
    schemas: {
      contentTypePolicy: 'require-json',
      maxBytes: 32768,
    },
  },
  javascript: {
    host: 'node',
    target: 'javascript',
    schemas: {
      contentTypePolicy: 'require-json',
      maxBytes: 32768,
    },
  },
}))
