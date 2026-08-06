# `@pulse-compute/crypto`

`@pulse-compute/crypto` provides bounded, provider-neutral cryptographic
verification for Pulse applications and first-party capability packages.

```bash
npm install @pulse-compute/crypto@1.0.0-beta.1
```

## Verification surface

Applications may import the package root and request MAC or signature
verification. Inputs are explicit bytes; the package does not perform ambient
string encoding or expose backend objects.

```ts
import { crypto } from '@pulse-compute/crypto'

const result = await crypto.mac.verify({
  algorithm: 'HS256',
  key: {
    type: 'hmac-key-bytes',
    bytes: secretBytes,
  },
  data: messageBytes,
  tag: authenticatorBytes,
})
```

The result is one frozen status:

- `valid`
- `invalid-authenticator`
- `invalid-key`
- `invalid-input`
- `realization-failure`

HS256 accepts bounded key, data, and authenticator bytes. ES256 accepts an
exact P-256 public point, the original signing input bytes, and an exact JOSE
signature. Neither algorithm retries another realization after failure.

## Profiles and realization

Profiles declare the exact algorithms a project may use:

```ts
export default {
  prod: {
    crypto: ['HS256', 'ES256'],
  },
}
```

Planning proves that reachable demand is covered by the selected profile and
target capability. JavaScript providers use their selected Web Crypto
realization. Native compilation links the selected first-party guest
realization. Target probing and automatic fallback are prohibited.

## Boundary

The package root is the supported application contract. Native integration,
guest provenance, and realization records are toolchain-owned surfaces. JWT
owns compact-JWS parsing, key selection, and claims semantics; this package
owns normalized cryptographic verification.

## Related material

- [JWT verification](./jwt.md)
- [Project configuration](../reference/project-config.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Package-owned lowering](../concepts/package-owned-lowering.md)
