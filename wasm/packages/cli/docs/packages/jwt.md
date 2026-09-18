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

RS256, EdDSA, remote discovery, custom crypto providers, and automatic
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

Signing is a request-owned effect on Node and Fastly, with Native guest HMAC/ES256
and explicit JavaScript Web Crypto realizations. Native calls require literal
options and a direct awaited local assignment or keyed `ctx.parallel` member.
Claims can be computed within the supported handler language.

The protected header contains the selected `alg`, `typ: "JWT"`, and an
optional explicit `kid`. One trusted
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

## ES256 issuance and key rotation

Use the same effect with `algorithm: 'ES256'` and select `ES256` in the crypto
profile. Add `kid: 'rotation-1'` when the verifier selects from a static JWKS.
The `kid` is optional, nonempty when supplied, at most 256 UTF-8 bytes, and
must not contain NUL. HS256 signing also accepts this header field.

The named secret must contain a UTF-8 JSON private P-256 JWK with `kty: 'EC'`,
`crv: 'P-256'`, and canonical unpadded base64url `x`, `y`, and `d` members of
32 bytes each. The private scalar must be valid and match the public point.
Optional metadata is restricted to `alg: 'ES256'`, `use: 'sig'`,
`key_ops: ['sign']`, a boolean `ext`, and a bounded `kid`. If both the secret
and options specify `kid`, they must agree. Unknown or duplicate members,
public-only keys, other curves, and PEM input are rejected. The JSON secret
has the same 4096-byte upper bound as HS256 secret material.

Provision the private JWK through the provider secret binding; give verifiers
only its public `kty`, `crv`, `x`, `y`, and matching `kid`. Do not copy private
`d` or signing-only metadata into verification options. Rotation requires
provisioning the new secret and updating the verifier's static public keys;
Pulse does not discover or rotate keys automatically.

Native ES256 signs deterministically using RFC6979 in the crypto-owned Rust
guest. JavaScript uses runtime Web Crypto. Both return a 64-byte JOSE signature;
applications must not depend on signatures being byte-identical across runtimes.
The current four-target fixtures include independent signature verification,
invalid private keys, redaction, and a complete Fastly Native CLI build. They
are development evidence, not live Fastly or aggregate release acceptance.

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
