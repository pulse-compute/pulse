import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = new URL('.', import.meta.url);
const fromRoot = (path: string) => fileURLToPath(new URL(path, here));

export default defineConfig({
  resolve: {
    alias: {
      '@pulse-compute/crypto/provider': fromRoot('packages/crypto/src/provider.cjs'),
      '@pulse-compute/crypto': fromRoot('packages/crypto/src/index.ts'),
      '@pulse-compute/grip': fromRoot('packages/grip/src/index.ts'),
      '@pulse-compute/assets/pulsewasm': fromRoot('packages/assets/src/pulsewasm.ts'),
      '@pulse-compute/assets': fromRoot('packages/assets/src/index.ts'),
      '@pulse-compute/jwt/provider': fromRoot('packages/jwt/src/provider.ts'),
      '@pulse-compute/jwt': fromRoot('packages/jwt/src/index.ts')
    }
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'wasm/test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true
  }
});
