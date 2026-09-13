# `@pulse-compute/crypto`

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications and first-party packages using provider-neutral cryptographic verification.<br>
> **Install directly:** Yes, when an application uses the crypto verification surface directly; JWT applications receive it transitively.<br>
> **Supported entry points:** `@pulse-compute/crypto`<br>
> **Stability:** The package root is the supported bounded verification contract; realization and Native integration subpaths remain toolchain-only.<br>
> **npm:** [`@pulse-compute/crypto`](https://www.npmjs.com/package/@pulse-compute/crypto)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.2/packages/crypto/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.2` package policy.
<!-- pulse-package-status:end -->

Provider-neutral cryptographic verification contracts for Pulse.

This package and `@pulse-compute/jwt` are members of the synchronized
`1.0.0-beta.2` release catalog.

## Verification contract

This package owns the verification surface while target planning owns backend
selection. HS256 uses the MAC seam:

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

Keys, messages, and authenticators are byte inputs. The package never performs
ambient string encoding. HS256 keys must be between 32 bytes and 4 KiB, data is
bounded to 1 MiB, and authenticators are exactly 32 bytes.

Verification returns one frozen, status-only result:

- `valid`
- `invalid-authenticator`
- `invalid-key`
- `invalid-input`
- `realization-failure`

Backend objects, error text, key material, messages, and authenticators do not
cross the result boundary.

G3 also activates ES256 through the signature seam. Its normalized request
contains an exact 64-byte P-256 public key (`x || y`), the original signing
input bytes, and an exact 64-byte JOSE signature (`r || s`). JavaScript keeps
Web Crypto key objects inside the runtime-builtin adapter. Native uses the
audited `guest-linked:pulse-es256-rustcrypto-p256` unit. Both return the same
status-only result taxonomy, and neither retries another realization.

Pulse profiles can declare HS256 and ES256 globally or replace that declaration
in a named profile:

```ts
pulse: {
  crypto: ['HS256', 'ES256'],
},
prod: {
  crypto: {
    HS256: { realization: 'guest-source:pulse-hmac-as' },
    ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' },
  },
},
```

An empty array or object explicitly declares no algorithms. Planning considers
only requirements emitted by reachable packages, resolves every declared
algorithm against the selected target, reports the exact realization, and
fails before lowering when the relationship
`reachable demand ⊆ profile declaration ⊆ target capability` is invalid.
Selection never enables detection or fallback.

JavaScript targets now execute the selected `runtime-builtin` realization
through Web Crypto with explicit HMAC/SHA-256 or ECDSA/P-256/SHA-256
parameters. ES256 validates the normalized point before constructing a
runtime-private public JWK, so malformed points cannot escape into a target's
Web Crypto implementation. Key import and verification stay inside the
byte-only public boundary; invalid authenticators, invalid keys, unavailable
runtimes, and operation failures return normalized status-only results.

The implementation imports no Node API and represents Node, browser, and
Fastly JavaScript uniformly as `runtime-builtin`. It is not a Fastly Native
host ABI.

The Native realization is `guest-source:pulse-hmac-as`: first-party
AssemblyScript compiled into the primary Native module. It implements bounded
SHA-256 and HMAC-SHA-256, scans every authenticator byte before branching, and
has no host imports, guest-link dependency, runtime probing, or fallback. Its
source provenance, hash, resource limits, exports, and disabled-fallback posture
are recorded in the Native manifest without recording key, data, or tag bytes.

The crypto seal uses one versioned corpus for the JavaScript Web Crypto and Native
AssemblyScript realizations. The corpus includes published RFC 4231 vectors,
authenticator mismatches at the first, middle, and last byte, altered inputs,
invalid key and tag shapes, and empty, maximum, and over-limit messages. The
same proof covers profile replacement without array or object merging,
unavailable exact realization pins, target capability failures, normalized
result categories, disabled fallback, and report redaction.

The Phase C seal records the locally observed artifact impact rather than treating
it as a portable benchmark. With the repository's pinned toolchain, the
default Native fixture grew from 2,212 to 5,385 bytes (3,173 bytes), and the
experimental size profile grew from 2,058 to 4,951 bytes (2,893 bytes). The
five emitted JavaScript runtime modules total 7,676 bytes, or 1,962 gzip bytes.

## JWT composition

`@pulse-compute/jwt` depends directly on this package. It uses `mac.verify` for
HS256 and `signature.verify` for ES256. JWT owns compact-JWS, bounded public
JWK/JWKS selection, and claims semantics; crypto owns fixed-width byte
normalization, backend realization, and normalized authenticity status.
Neither package duplicates the other's responsibility, and JWT has no active
`jose`, Web Crypto, guest-direct, or provider-direct crypto path.

The G3 composition and shared ES256 corpus are recorded in
`wasm/.test-results/jwt-g3/jwt-g3-evidence.json`. This working-candidate proof
does not add signing, remote key discovery, fallback, publication, or
deployment.

## Trusted byte-output composition

S3 uses Crypto-owned SHA-256 and HMAC-SHA256 byte outputs. Native composes the
existing guest-source unit; Node JavaScript explicitly binds Web Crypto through
`@pulse-compute/crypto/provider`. The trusted seam snapshots Uint8Array input,
allows at most 32768 data bytes and 8192 HMAC key bytes, returns exactly 32 bytes,
and wipes input staging on success or failure. It rejects unavailable selected
primitives and does not fall back. Empty HMAC keys use the equivalent padded
zero block required by HMAC, preserving Native semantics despite Web Crypto's
zero-length import restriction. This provider seam does not add an author-facing
signing API or change JWT key limits.
