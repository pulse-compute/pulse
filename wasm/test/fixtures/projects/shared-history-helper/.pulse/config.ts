import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', defaultProfile: 'node', strict: false, crypto: ['SHA-256', 'HMAC-SHA256'] },
  node: { host: 'node', target: 'native', schemas: {maxBytes:2097152}, node: { bindings: { s3: { objects: {
    endpoint: 'https://objects.example.invalid', bucket: 'pages', region: 'us-east-1',
    accessKeyIdSecret: 'S3_ID', secretAccessKeySecret: 'S3_KEY', maxTextBytes: 1835008, timeoutMs: 1000,
  } } } } },
  javascript: { host: 'node', target: 'javascript', schemas: {maxBytes:2097152}, node: { bindings: { s3: { objects: {
    endpoint: 'https://objects.example.invalid', bucket: 'pages', region: 'us-east-1',
    accessKeyIdSecret: 'S3_ID', secretAccessKeySecret: 'S3_KEY', maxTextBytes: 1835008, timeoutMs: 1000,
  } } } } },
  fastly: { host: 'fastly', target: 'native', schemas: {maxBytes:2097152}, fastly: { bindings: { secretStore: 'app_secrets', s3: { objects: {
    endpoint: 'https://objects.example.invalid', bucket: 'pages', region: 'us-east-1', backend: 'object_origin',
    accessKeyIdSecret: 'S3_ID', secretAccessKeySecret: 'S3_KEY', maxTextBytes: 1835008, timeoutMs: 1000,
  } } } } },
}))
