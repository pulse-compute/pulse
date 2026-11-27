# MAC-00: proposed request-owned exact-text HMAC verification

Status: implementation contract for issue #601, pending human review and
MAC-01–03. This repository-only specification and its reference corpus do not
declare a currently available authoring API, target support, or a release gate
pass. The existing raw-byte Crypto and JWT contracts remain unchanged.

## Authoring and authority

```ts
import { crypto } from '@pulse-compute/crypto'

const proof = await crypto.verifyMacText(ctx, message, tag, {
  algorithm: 'HS256',
  key: { type: 'secret', binding: 'REQUEST_PROOF_KEY' }
})
if (proof.status !== 'valid') {
  return ctx.text('Verification failed', { status: 401 })
}
```

Proposed package identity: `pulse.crypto`, package `@pulse-compute/crypto`,
operation and capability `crypto.verifyMacText`, provider kind `crypto`,
status-only result class `mac-text-verification`. Profile demand: HS256;
provider requirements: the named operation and secret.get. Do not select
HMAC-SHA256 instead of HS256 merely because an internal byte-output operation
exists. The package owns its canonical lowering, runtime facade, validation,
and result projection. The provider owns authorized named-secret resolution,
the selected realization and request lifecycle. The canonical effect must carry
the literal binding selector and runtime text/tag inputs, never resolved keys.

The current HTTP context is required. Start with direct await into a local;
keyed ctx.parallel is eligible only with equivalent request ownership,
cancellation and failure evidence. No effect loops, shared-stage or callable
admission expansion. Support default/named facade and direct named import
aliases following digestText, with the same import identity and anti-shadowing
rules. Native options are exactly a static object literal with HS256 and a
static secret descriptor, no additional fields, spreads, accessors, computed
keys or dynamic binding selection. Binding must be a nonempty, well-formed
literal name, at most 256 UTF-8 bytes, no NUL, unchanged (no trimming); existing
provider binding-name restrictions still apply. JavaScript uses the same
declared operation and binding authority, not an ambient provider lookup.
Invalid option or authority shapes are never dispatched.

No change to crypto.mac.verify, verifyMac, JWT, Authorization, request body
reading or request canonicalization. No raw secret result, signing operation,
clock or replay mechanism. An HMAC authenticates the caller's chosen text
under a key, not a user or a request by itself. Application protocol owns
method/target/destination, body identity, freshness, replay and key rotation.
Arbitrary raw bytes are out of scope for this v1 text operation.

## Input and bounds

| Input | Contract |
| --- | --- |
| Message | Exact Unicode scalar text, UTF-8 encoded without BOM removal, normalization, newline conversion, JSON parsing or reserialization. Empty text, NUL, CRLF and astral scalars are legal. |
| Maximum message | 65,536 UTF-8 bytes; an early 65,536 UTF-16 code-unit limit precedes scalar scanning. Validate all bounded code units before deciding the encoded-byte bound; no replacement of lone surrogates. |
| Tag | Exactly 64 lowercase ASCII hex characters, representing all 32 bytes of HMAC-SHA256. No whitespace, prefix, alternate encodings, truncation or coercion. |
| Key | Provider-owned secret bytes (or a well-formed string encoded exactly once as UTF-8), 32–4,096 bytes inclusive. No decoding as hex/base64, trimming, normalization or raw key authoring. Validate length before copying/allocating where possible, reject malformed secret types and lone surrogates, and snapshot owned mutable storage. |
| Effect envelope | Operation-only ceiling 458,752 encoded bytes (6 × 65,536 + 65,536 for bounded metadata), independent of the generic 256 KiB and digest/S3 2 MiB text allowances. |

The 64 KiB message ceiling is an intentionally conservative v1 choice, aligned
with the existing internal Crypto byte frame, not the 1 MiB ordinary HS256
verification limit. A 64 KiB all-NUL message expands to 393,216 bytes before
metadata when serialized as JSON. The reference harness measures 393,613
bytes for its representative envelope with a 256-character binding. MAC-01
must bound runtime arguments before cloning/serializing: do not copy an
unbounded input, truncate it into a potentially valid message/tag, or let
oversize input escape as a generic envelope failure. Preserve a bounded
over-limit/invalid-input signal. MAC-02 must prove the actual Native and
JavaScript envelopes handle all legal input, including worst escaping, without
enlarging the general package payload ceiling or existing Crypto staging frames.

## Result and precedence

Only an exact frozen/closed status record is projected to the application:
`{ status: ... }`. No error text, key material, computed MAC, tag or message.

| Status | Meaning |
| --- | --- |
| valid | Selected verifier accepted the full 32-byte authenticator. |
| invalid-authenticator | Well-formed tag mismatches for the resolved valid key and message. |
| invalid-input | Invalid option shape at runtime, non-text message, malformed scalar text or noncanonical tag. |
| too-large | Message exceeds the early code-unit or encoded-byte ceiling. |
| unavailable | Required selected operation, secret authority or verifier unavailable at execution despite successful build/admission. |
| invalid-key | Authorized lookup explicitly found no secret, or returned invalid representation or key length. |
| realization-failure | Lookup/verification threw an unexpected error, returned an invalid result, or failed internally; never expose provider detail. |

Unsupported static algorithm, binding, call shape or missing declared capability
is a deterministic build/inspection diagnostic for a managed target, not a
successful compile with a runtime fallback. For runtime-normalized inputs the
order is: validate option descriptor, message type, early code-unit limit,
scalar validity, UTF-8 byte limit, tag syntax, availability of selected
operation/secret authority/primitive, secret lookup, key validity, verification.
Normalize explicit provider missing-secret outcomes to invalid-key, distinguish
from an unexpected lookup failure. No lookup for invalid or over-limit inputs.
Only valid is success. Cancellation/deadline/completion containment takes
precedence over projection and terminates the effect through the existing
request lifecycle; it is not a successful status result.

## Realization and security evidence

Existing ownership anchors:

- packages/crypto/src/digest.ts and pulsewasm.compiler.cjs: request-owned
  exact-text facade, package lowering, runtime inputs and redaction.
- packages/runtime/src/internal/package-runtime.js: fixed first-party effect
  catalog and per-operation payload admission; no dynamic registration.
- packages/jwt/src/crypto-verifier.ts and pulsewasm.compiler.cjs: static
  named-secret selector, provider-only resolution and HS256 composition.
- packages/crypto/as/pulse-hmac-as.ts: existing HS256 verifier compares all
  32 bytes with XOR/OR accumulation before branching; wipes the expected tag.
  Review selected compiled path and frame cleanup in MAC-02, not timing tests.
- packages/crypto/src/internal/realization.ts: existing selected Web Crypto
  HMAC verify path (not application-authored digest equality).
- wasm/packages/contracts/src/crypto/contracts.js and existing provider
  capability/target descriptors: exact selection, no automatic fallback.

Candidate cells (all unqualified for the new effect): Node Native and Fastly
Native using guest-source:pulse-hmac-as; Node JavaScript and Fastly JavaScript
using runtime-builtin only when secret binding and HS256 capability plus
representation parity are demonstrated. Existing Fastly JS secret.get and
JWT HS256 admission are evidence of components, not new-effect support.
A cell without the exact operation, declared algorithm, binding authority
and realization fails admission explicitly. Unsupported targets remain
unsupported; no browser, provider discovery or trust widening.

Use the existing reviewed verify primitive, never compare hexadecimal strings
or return a computed tag. Retain request-owned cancellation, terminal
completion and isolation. Wipe owned key, message/tag staging, intermediate
MAC and guest/host frames on every return or trap; do not claim erasure of
provider-owned immutable strings or Web Crypto key objects. Secret material
must not be exposed to author code. This is not a stronger Wasm sandbox
claim. Compiler/inspection artifacts contain static operation/requirement
metadata only; do not serialize payloads, tags, resolved keys, computed
MACs or provider errors into diagnostics or default traces/reports. No
application-header reads or writes are performed by the effect.

## Evidence and handoff

The sibling mac-text-v1.json contains only synthetic material; repeated inputs
are represented compactly. Run:

```sh
node wasm/test/crypto/assert-mac-text-corpus.cjs
node wasm/scripts/run-wasm-tests.cjs --task crypto-mac-text-corpus --no-report
```

This is an independent fixture oracle (Python-generated fixed HMAC values,
RFC 4231 case 6 from the existing corpus, Node crypto/Web Crypto comparison
and a tiny classification model). It does not execute Pulse, prove the
provider's failure normalization, attest constant-time Wasm machine code, or
qualify a deployed Fastly service. Do not import the reference oracle as the
production implementation. The next passes must consume the same vectors in
the actual effect, not regenerate expected outputs with the code under test.

MAC-01 must prove positive and negative static call shape, missing HS256,
missing operation capability/binding, no fallback, old raw-byte API and
digest regression, report redaction, and bounded envelope admission.
MAC-02 must prove known-answer and negative fixture parity through real
dispatch, secret resolution only after validation, failure precedence, no
extra result fields, exact encoding, cancellation/duplicate completion,
independent parallel ownership if supported, owned storage cleanup and
primitive/code review. MAC-03 must prove an unmodified packed consumer and
Fastly Native request with independent proof header and unchanged existing
Bearer header, and classify hosted evidence separately from local or Viceroy
execution. Preserve all current support tiers and existing JWT/digest tests.

MAC-00 changes repository test/evidence files and test registration only.
No runtime, compiler, manifest, provider, generated public docs, release
snapshot or package publication changes. Do not close #601 on this evidence.
