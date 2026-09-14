# `@pulse-compute/jwt`

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications verifying bounded JWT bearer credentials through Pulse providers.<br>
> **Install directly:** Yes, when an application verifies JWTs.<br>
> **Supported entry points:** `@pulse-compute/jwt`<br>
> **Stability:** The package root is the supported provider-neutral verification contract; provider and compiler integration subpaths are not application APIs.<br>
> **npm:** [`@pulse-compute/jwt`](https://www.npmjs.com/package/@pulse-compute/jwt)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.4/packages/jwt/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.4` package policy.
<!-- pulse-package-status:end -->

Bounded, provider-neutral JWT verification for Pulse handlers.

This package and `@pulse-compute/crypto` are members of the synchronized
`1.0.0-beta.4` release catalog.

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

ES256 accepts only inline public P-256 JWKs or static JWKS values with at most
16 entries. Coordinates are canonical unpadded base64url encodings of exactly
32 bytes. Private and certificate members are rejected; `kid` selection is
deterministic; duplicate, missing, ambiguous, and unknown selections fail
closed. There is no remote discovery, fetch, cache, or refresh path.

The provider resolves the request-owned secret and passes only bounded bytes to
`@pulse-compute/crypto`. JWT authenticates the compact JWS before exposing
claims, captures one wall-clock instant only after authenticity, evaluates
registered claims before an optional runtime schema, and returns a detached,
deeply frozen result. It does not authorize application or host behavior.

RS256, EdDSA, signing, remote key authority, custom crypto providers, and
automatic fallback remain unavailable. The shared G3 ES256 corpus and
package-to-crypto composition are recorded in
`wasm/.test-results/jwt-g3/jwt-g3-evidence.json`; the six-cell target matrix is
recorded in `wasm/.test-results/boundary-h4/es256-six-cell-matrix.json`. The
prior four-cell HS256 seal remains historical regression evidence.
