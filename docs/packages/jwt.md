# `@pulse-compute/jwt`

`@pulse-compute/jwt` provides bounded, provider-neutral JWT verification for
Pulse handlers.

```bash
npm install @pulse-compute/jwt@1.0.0-beta.5
```

## Verify a bearer token

```ts
import { jwt } from '@pulse-compute/jwt'

const verified = await jwt.verify(
  ctx,
  jwt.bearer(ctx.req),
  {
    algorithms: ['HS256'],
    key: { type: 'secret', binding: 'JWT_SECRET' },
    issuer: 'https://issuer.example',
    audience: 'pulse-api',
  },
)
```

The provider resolves request-owned secret material and passes bounded bytes to
`@pulse-compute/crypto`. JWT authenticates the compact JWS before exposing
claims, captures one wall-clock instant after authenticity, evaluates
registered claims, and then applies an optional runtime schema. Results are
detached and deeply frozen.

## Algorithms and keys

The Beta supports HS256 and ES256 verification. ES256 accepts inline public
P-256 JWKs or static JWKS values with at most 16 entries. Key selection is
deterministic and fails closed for duplicate, missing, ambiguous, or unknown
identities.

RS256, EdDSA, signing, remote discovery, custom crypto providers, and automatic
fallback are not part of this release.

## Boundary

JWT verifies identity claims; it does not authorize application or host
behavior. The package root is the supported application contract. Provider,
compiler, and Native lowering exports are first-party integration surfaces and
are not application APIs.

## Related material

- [Crypto verification](./crypto.md)
- [Project configuration](../reference/project-config.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Package-owned lowering](../concepts/package-owned-lowering.md)
