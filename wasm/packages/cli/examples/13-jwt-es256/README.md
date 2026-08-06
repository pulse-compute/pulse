# ES256 bearer verification

This Node example verifies one bearer JWT with an inline public P-256 JWK.
The Native profile links the released RustCrypto verifier explicitly and does
not probe for a fallback realization.

The deterministic harness covers a valid token, a one-byte signature mutation,
and a token whose declared algorithm is outside the allowlist. The fixture
contains only a public verification key; no private signing material is part of
the application or build output.

## Workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
pulse build
```

The documented result below is executed against the exact linked Native
artifact by the documentation gate.

<!-- pulse-doc-run {"project":"examples/13-jwt-es256","args":["test","--json"],"timeoutMs":240000} -->
```bash
pulse test --json
```
```json
{
  "status": "passed",
  "provider": "node",
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "cases": [
    {
      "name": "valid ES256 bearer",
      "status": "passed",
      "response": {
        "status": 200
      }
    },
    {
      "name": "wrong ES256 signature",
      "status": "passed",
      "expectedError": {
        "code": "PULSE_JWT_SIGNATURE_INVALID"
      }
    },
    {
      "name": "disallowed algorithm",
      "status": "passed",
      "expectedError": {
        "code": "PULSE_JWT_ALGORITHM_NOT_ALLOWED"
      }
    }
  ]
}
```

## Wasm size

| Artifact | Default build | `--experimental-native-size` | Reduction |
|---|---:|---:|---:|
| Application input | 2.7 KiB (2,759 bytes) | 2.5 KiB (2,577 bytes) | 6.6% |
| ES256 guest input | 20.5 KiB (21,009 bytes) | 20.5 KiB (21,009 bytes) | 0.0% |
| Final linked `canonical-native.wasm` | 23.1 KiB (23,647 bytes) | 22.9 KiB (23,461 bytes) | 0.8% |

The executable documentation gate rebuilds and measures both variants on
`1.0.0-beta.1`. These are uncompressed on-disk sizes, not transfer sizes or
platform limits. The first two rows are the exact primary and guest inputs
recorded by `guest-link-report.json`; the last row is the validated output of
the deterministic static link. Linked output is not the arithmetic sum of its
inputs because the linker composes and deduplicates the modules.

## Application

<!-- pulse-doc-source: examples/13-jwt-es256/src/index.ts -->
```ts
import { jwt } from '@pulse-compute/jwt'

export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['ES256'],
    key: {
      type: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: 'YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y',
        y: 'eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk',
        alg: 'ES256',
        use: 'sig',
        key_ops: ['verify'],
        kid: 'g3-key',
      },
    },
  })
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg)
}
```
<!-- /pulse-doc-source -->

## Project config

<!-- pulse-doc-source: examples/13-jwt-es256/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'node-native',
    strict: true,
  },
  'node-native': {
    host: 'node',
    target: 'native',
    outDir: 'dist-node-native',
    crypto: {
      ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' },
    },
    dev: { host: '127.0.0.1', port: 8787, networkFetch: false },
  },
}))
```
<!-- /pulse-doc-source -->

## Test harness

<!-- pulse-doc-source: examples/13-jwt-es256/tests/pulse.harness.ts -->
```ts
const valid =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJFUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'LgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

const wrongSignature =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJFUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'rgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

const disallowedAlgorithm =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJIUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'LgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

function authorization(token: string) {
  return { authorization: `Bearer ${token}` }
}

export default { cases: [
  {
    name: 'valid ES256 bearer',
    request: { method: 'GET', path: '/verify', headers: authorization(valid) },
    expect: { status: 200, text: 'g3-sensitive-subject:ES256' },
  },
  {
    name: 'wrong ES256 signature',
    request: {
      method: 'GET',
      path: '/verify',
      headers: authorization(wrongSignature),
    },
    expect: {
      error: { name: 'JwtError', code: 'PULSE_JWT_SIGNATURE_INVALID' },
    },
  },
  {
    name: 'disallowed algorithm',
    request: {
      method: 'GET',
      path: '/verify',
      headers: authorization(disallowedAlgorithm),
    },
    expect: {
      error: { name: 'JwtError', code: 'PULSE_JWT_ALGORITHM_NOT_ALLOWED' },
    },
  },
] }
```
<!-- /pulse-doc-source -->

See [JWT](../../docs/packages/jwt.md) for the full verification policy and
supported key sources.
