# `@pulse-compute/jwt`

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications verifying JWT credentials and issuing bounded HS256/ES256 worker tokens through Pulse providers.<br>
> **Install directly:** Yes, when an application verifies or signs JWTs.<br>
> **Supported entry points:** `@pulse-compute/jwt`<br>
> **Stability:** The package root supports provider-neutral verification and bounded HS256/ES256 signing; provider and compiler integration subpaths are not application APIs.<br>
> **npm:** [`@pulse-compute/jwt`](https://www.npmjs.com/package/@pulse-compute/jwt)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/jwt/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

Bounded, provider-neutral JWT verification and HS256/ES256 signing for Pulse handlers.

This package and `@pulse-compute/crypto` are members of the synchronized
`1.0.0-beta.5` release catalog.

Verification is implemented for HS256 in all four sealed target cells. G3 also
activates ES256 through the crypto-owned signature seam. H4 aligns Node and
Fastly JavaScript on the runtime-builtin realization and both Native providers
on the exact guest-linked composition. No target probes for a realization and
no failure falls back to a different key, algorithm, backend, target, or
provider.

Applications import the package root:

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

ES256 verification accepts only inline public P-256 JWKs or static JWKS values with at most
16 entries. Coordinates are canonical unpadded base64url encodings of exactly
32 bytes. Private and certificate members are rejected; `kid` selection is
deterministic; duplicate, missing, ambiguous, and unknown selections fail
closed. There is no remote discovery, fetch, cache, or refresh path.

The provider resolves the request-owned secret and passes only bounded bytes to
`@pulse-compute/crypto`. JWT authenticates the compact JWS before exposing
claims, captures one wall-clock instant only after authenticity, evaluates
registered claims before an optional runtime schema, and returns a detached,
deeply frozen result. It does not authorize application or host behavior.

`jwt.sign(ctx, claims, { algorithm: 'HS256', key: { type: 'secret', binding: 'WORKER_KEY' }, expiresInSeconds: 45 })`
returns a compact JWT through a request-owned effect. Select `HMAC-SHA256` in
the crypto profile. The provider resolves a 32–4096 byte secret and captures
one trusted clock reading; the package supplies `iat` and `exp`. Lifetimes
are explicit positive safe integers in seconds, and expiration must fit the
supported Date range. Applications own lifetime policy. Claims are bounded ordinary JSON; caller-supplied `iat`,
`exp`, and `nbf` are rejected. See the package guide for exact limits and
Native authoring requirements. Four-target signing fixtures exercise Node and
Fastly Native/JavaScript; they are not deployed Fastly evidence.

RS256, EdDSA, remote key authority, custom crypto providers, and
automatic fallback remain unavailable. The shared G3 ES256 corpus and
package-to-crypto composition are recorded in
`wasm/.test-results/jwt-g3/jwt-g3-evidence.json`; the six-cell target matrix is
recorded in `wasm/.test-results/boundary-h4/es256-six-cell-matrix.json`. The
prior four-cell HS256 seal remains historical regression evidence.

ES256 issuance selects `ES256` in both signing options and the crypto profile.
The named secret contains a UTF-8 JSON private P-256 JWK (`kty`, `crv`, `x`,
`y`, `d`); the private scalar must match the public point. An optional `kid`
(up to 256 UTF-8 bytes) is copied into the protected header for key selection.
Private keys never belong in application options or static JWKS artifacts.
Native signing uses the revised, reproducibly built RustCrypto guest; JavaScript
uses Web Crypto. Historical verification seals do not validate the revised
binary. Current signing fixtures cover all four targets without claiming a
live deployment or a new aggregate release seal.
