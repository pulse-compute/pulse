# `@pulse-compute/jwt`

`@pulse-compute/jwt` provides bounded, provider-neutral JWT verification and signing for
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

RS256, EdDSA, asymmetric signing, remote discovery, custom crypto providers, and automatic
fallback are not part of this release.

## Issue a short-lived worker token

```ts
const token = await jwt.sign(ctx, {
  iss: 'catalog', aud: 'projection-worker', sub: 'scheduler',
  scope: 'reconcile', job: 'projection', epoch: 7,
  method: 'POST', path: '/step', bodySha256: bodyDigest,
}, {
  algorithm: 'HS256',
  key: { type: 'secret', binding: 'WORKER_KEY' },
  expiresInSeconds: 45,
})
```

Select `HMAC-SHA256` in the profile's `crypto` configuration. A profile that also
verifies HS256 tokens selects both `HMAC-SHA256` and `HS256`. Provision a
32–4096 byte secret under the named binding; Fastly also needs
`fastly.bindings.secretStore`. Keys are resolved at execution and are never embedded in
the application artifact.

Signing is a request-owned effect on Node and Fastly, with Native guest HMAC
and explicit JavaScript Web Crypto realizations. Native calls require literal
options and a direct awaited local assignment or keyed `ctx.parallel` member.
Claims can be computed within the supported handler language.

The protected header is exactly `{"alg":"HS256","typ":"JWT"}`. One trusted
provider clock reading supplies integer `iat` and `exp`; `expiresInSeconds`
must be a positive safe integer, with an expiration within the supported
JavaScript Date range (at most 8,640,000,000,000 epoch seconds). Pulse imposes
no application lifetime ceiling; the 45-second worker lifetime above is an
application choice. Verifiers enforce their configured expiration and maximum-age
policies. Caller-supplied `iat`, `exp`, and `nbf` are rejected. The result
is a compact JWT string. The signer does not validate application authorization:
the caller chooses issuer, audience, subject, scope and request binding claims,
and the worker must verify them against the actual request.

Claims must be an ordinary JSON object, with no accessors, methods, sparse
arrays, cycles or non-finite numbers. Limits are 32 levels, 1024 values
including the root, and 8192 UTF-8 bytes after adding timestamps. Secrets,
claim strings, serialized claims, signatures and tokens are registered for
request log redaction. Invalid inputs, unavailable authority and crypto
failures terminate the effect without fallback or retry.

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
