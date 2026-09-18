# `@pulse-compute/jwt`

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications verifying JWT credentials and issuing bounded HS256/ES256/RS256 worker tokens through Pulse providers.<br>
> **Install directly:** Yes, when an application verifies or signs JWTs.<br>
> **Supported entry points:** `@pulse-compute/jwt`<br>
> **Stability:** The package root supports provider-neutral verification and bounded HS256/ES256/RS256 signing; provider and compiler integration subpaths are not application APIs.<br>
> **npm:** [`@pulse-compute/jwt`](https://www.npmjs.com/package/@pulse-compute/jwt)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/jwt/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

Bounded, provider-neutral JWT verification and HS256/ES256/RS256 signing for Pulse handlers.

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

EdDSA, remote key authority, custom crypto providers, and
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


## RS256 issuance and verification

Select `RS256` in `pulse.crypto` and in `jwt.sign` options. The named secret
contains a UTF-8 JSON private RSA JWK with `kty: "RSA"`, `n`, `e`, `d`, `p`,
`q`, `dp`, `dq`, and `qi`. Its total encoded size is at most 4096 bytes.
Optional metadata is `alg: "RS256"`, `use: "sig"`, `key_ops: ["sign"]`,
boolean `ext`, and a `kid` of at most 256 UTF-8 bytes. If signing options and
the secret both carry `kid`, they must agree. Never put private JWKs into
application source or verification options.

Verification uses `algorithms: ['RS256']` with an inline public JWK or a
static JWKS of at most 16 entries. Public keys require only `kty`, `n`, and
`e`; optional `alg`, `use`, `key_ops: ['verify']`, and `kid` follow the same
policy. Private, certificate, multi-prime (`oth`), and unknown fields are
rejected. Duplicate `kid` values reject the set; selection is exact by `kid`
or requires one eligible key. Failure never retries another key.

Supported modulus sizes are exactly 2048, 3072, and 4096 bits, with an odd
public exponent from 3 through 4294967295. JWK integers use minimal unsigned,
canonical unpadded base64url. Private keys require two distinct, odd factors
of half the modulus width with their top bit set. Crypto checks `n = p*q`,
`d < n`, the two reduced exponents, their relation to `e`, and `q*qi mod p`.
These checks establish consistency; key generation and primality testing
remain outside this API.

RS256 means RSASSA-PKCS1-v1_5 with SHA-256. RSA-PSS is not accepted. Signatures
are exactly 256, 384, or 512 bytes, and original signing input is bounded to
12288 bytes. Issued claims retain the 8192-byte bound and application-owned
positive safe-integer lifetime. The provider owns secret lookup and clock
capture; authenticity precedes claim validation.

Node and Fastly JavaScript use Web Crypto. Both Native providers use the
pinned BearSSL 0.6 `i31` code in the shared signature guest. Each signer
verifies its output before returning it. JavaScript uses BigInt to check
redundant private key fields during import; that validation and the engine's
key handling have no Pulse constant-time guarantee. Native uses BearSSL's
constant-time arithmetic design; compiled Wasm timing still depends on the
engine and CPU. See the Crypto guide for the implementation assumptions.

Native RS256 and ES256 share one linked guest. The current fixed-memory
linker rejects composition with the allocating SHA-256/HMAC guest; use a
separate Native artifact or an explicitly selected JavaScript target for
that combination. Fastly Native also retains one verification algorithm per
artifact. Signing and verification with RS256 together, issuance alone,
verification alone, and RS256/ES256 issuance composition are tested through
the normal CLI build path. Injected Fastly hosts are portable evidence, not
a deployed-service confirmation or an aggregate release seal.
