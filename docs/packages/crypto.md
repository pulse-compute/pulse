# `@pulse-compute/crypto`

`@pulse-compute/crypto` provides bounded, provider-neutral cryptographic
verification and exact-text SHA-256 for Pulse applications and first-party capability packages.

```bash
npm install @pulse-compute/crypto@1.0.0-beta.5
```

## Exact-text digest

Use the public package root before uploading text:

```ts
import { crypto } from '@pulse-compute/crypto'

const digest = await crypto.digestText(ctx, text)
if (digest.status === 'failed') return ctx.text(digest.reason, { status: 422 })
// digest.sha256 is 64 lowercase hexadecimal characters.
// digest.byteLength is the exact UTF-8 byte length.
```

The root also exports `digestText`, `TextDigestResult`, and
`DIGEST_TEXT_MAX_BYTES` (`2097152`). The operation requires the current HTTP
`PulseContext`, a text argument, and `pulse.crypto: ['SHA-256']` in project
configuration. Await it into a local variable or use it directly in a keyed
`ctx.parallel` group. Named import aliases and the default `crypto` facade
are supported; detaching the operation, dynamically accessing it, or shadowing
its imported binding is outside the lowering contract.

Digest input is the exact Unicode scalar text encoded as UTF-8: no Unicode
normalization, BOM removal, newline conversion, JSON parsing, or re-encoding.
Empty input succeeds. Embedded NULs, CRLF and astral characters retain their
bytes. Unpaired UTF-16 surrogates fail as `invalid-text` rather than being
replaced. Input beyond 2 MiB fails as `too-large`; the early code-unit bound
also rejects strings longer than 2097152 code units before scanning them.

The closed result is either `{ status: 'ok', sha256, byteLength }` or
`{ status: 'failed', reason }`, with `reason` equal to `invalid-text`,
`too-large`, `unavailable`, or `realization-failure`. Invalid runtime input
uses `invalid-text`. Provider details and input bytes never appear in failures.
Invocation cancellation terminates execution through the ordinary effect
lifecycle and produces no digest success result.

Node and Fastly Native reuse Crypto's selected
`guest-source:pulse-hmac-as` SHA-256 implementation. Node and Fastly
JavaScript use the selected `runtime-builtin` Web Crypto digest. The trusted
package bridge owns execution, parallel grouping and cancellation; Crypto owns
text validation, framing, encoding and results. Missing selection fails
inspection; unavailable or failing execution never tries another realization.

Hash the output of `ctx.encodeJson(value, 'app.Resource')` when that exact
encoded text will be uploaded. On supported S3 targets, hashing the same text
before `s3.putText` produces its receipt's `sha256` and `byteLength`; hashing
the exact `s3.getText` text produces the same values. Hashes identify bytes,
not parsed JSON equivalence. S3 bindings independently opt into up to 2 MiB; owning KV values and
application history/receipt budgets remain separately bounded. Fastly JavaScript's existing S3 transport limitation remains.

The fixed first-party digest/S3 PUT effect bridge admits at most 12,648,448
encoded bytes (six times 2 MiB plus 64 KiB of metadata). This accommodates JSON
escaping without increasing unrelated effect envelopes. Request bodies and
schema encoding retain their explicit `schemas.maxBytes` limits; a transport
carrying escaped text may need a larger envelope than the text itself.

Primary-memory Native modules using digest or S3 enforce a 256 MiB Wasm ceiling.
This is a module maximum, not a per-object allocation or a concurrency allowance.
The separate fixed-memory ES256 guest ABI remains unchanged; its smaller heap
cannot establish the 2 MiB capacity profile. Allocation failure never enables
another realization. Applications must select a compatible capacity profile.

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

Native capability packages can also select `SHA-256` and `HMAC-SHA256` for
internal byte output. Their exact `guest-source:pulse-hmac-as` realization uses
32-byte output, at most 2 MiB of SHA-256 data, 32 KiB of HMAC data and 8 KiB of
HMAC key material. Crypto owns reusable, wiped host staging frames. The original
40,992-byte frame serves HMAC and small hashes; a separate 2,097,184-byte frame
is allocated lazily for larger host-staged hashes. These operations are separate from JWT's
32-byte minimum HMAC verification key; the application verification API retains
its existing limits. Node JavaScript also supports the trusted byte-output
seam; Fastly JavaScript supports SHA-256 digest output.

The package root is the supported application contract. Native integration,
guest provenance, and realization records are toolchain-owned surfaces. JWT
owns compact-JWS parsing, key selection, and claims semantics; this package
owns normalized cryptographic verification.

## Related material

- [JWT verification](./jwt.md)
- [Project configuration](../reference/project-config.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Package-owned lowering](../concepts/package-owned-lowering.md)


## RS256 signature contract

`crypto.signature.verify` accepts `algorithm: 'RS256'` and a
`rsa-public-key-bytes` key. `normalizeRsaPublicKey({ n, e })` converts public
JWK integers into that representation; `normalizeRs256JoseVerifyRequest`
also decodes the canonical, fixed-width JOSE signature. JWT owns JWK metadata
and selection policy. No generic public signing API is introduced.

The normalized key is a little-endian 32-bit modulus byte length, the unsigned
big-endian modulus, and a four-byte big-endian public exponent. Supported
lengths are 256, 384, and 512 bytes; the modulus has its high bit set and is
odd. Exponents are odd integers in `[3, 4294967295]`. Signature width equals
modulus width, including any leading zero signature bytes. Data is at most
12288 bytes. Verification returns the existing closed status taxonomy.

The exact Native selection is `guest-linked:pulse-rs256-bearssl-i31` with
`bearssl.0.6.rsa-i31.sha256.v1`. It shares the pinned ES256/RS256 prebuilt and
fixed 2 MiB memory with ES256. The private signing adapter accepts normalized
RSA/CRT bytes, validates their consistency, and checks every resulting
signature by public exponentiation before release. The caller erases its
16640-byte invocation frame and the borrowed 64 KiB guest stack on return.
The Node wrapper also clears both regions on a trap; a Fastly Native trap
aborts execution before in-Wasm cleanup can run. The guest has no retained
key state, entropy imports, allocation, or host callbacks. PKCS#1 v1.5
signing is deterministic and needs no nonce.

BearSSL `i31` uses constant-time arithmetic rather than RSA blinding. Its
security assumptions include constant-time integer multiplication and a
compiler/engine that preserves the intended data-independent execution.
This is not a formal timing proof for every Wasm engine or CPU. The pinned
upstream source, license, archive hash, per-file hashes, compiler versions,
and reproducible build command ship with the guest. The historical guest
path and module name remain for compatibility; its ABI is now
`pulse.crypto.es256-rs256.verify-and-sign.v3`.

JavaScript explicitly selects `RSASSA-PKCS1-v1_5` with `SHA-256` in Web Crypto
and independently verifies signing output. Redundant private-field import
checks use JavaScript BigInt, which is not constant time; private
exponentiation and blinding belong to the selected Web Crypto runtime.
Immutable JWK strings and runtime-owned key objects cannot be explicitly
erased by Pulse. The provider retains its existing cancellation and
redaction boundaries.

The combined prebuilt is 36378 bytes. The development corpus observed 6324
bytes of guest stack writes within the reserved 65536 bytes. Local warmed
4096-bit operations took roughly 43 ms to sign and 1.5 ms to verify; these
are local Node Wasm observations, not performance guarantees or Fastly
measurements. `crypto-rs256` regenerates the observations and tests independent
interoperability, malformed PKCS#1 encodings, CRT corruption, frame bounds,
and cleanup. `jwt-rs256` covers the provider and CLI paths.
