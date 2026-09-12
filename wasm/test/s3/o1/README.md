# O1 — bounded S3 package contract

Status: design and executable acceptance specification, based on `latest`
at `cbcd858563539a69ddd73cffc5b4e218b835a29d`. O1 defines the boundary for
O2–O4; it does not install a package or declare a supported runtime capability.
The working package name is settled as `@pulse-compute/s3`, contract `pulse.s3`.
No exact existing Entry Point covers a new S3 owner; this work follows the
root and `wasm/AGENTS.md` instruction chain. Classification: architecture,
under the user's instruction to implement O1; human review retains authority.

## Public subset

The draft [types](api.d.ts) and [machine contract](contract.json) specify one
provider-neutral facade. Each call returns a request-owned `PulseParallelEffect`.
Direct `await` and keyed `ctx.parallel` use the existing continuation lifecycle.
Calls outside an active request fail through the package runtime contract.

| Call | Runtime inputs | Result |
| --- | --- | --- |
| `s3.head(ctx, 'objects', key)` | exact key | found metadata, not-found, or failed |
| `s3.getText(ctx, 'objects', key)` | exact key | found strict UTF-8 text plus byte length/SHA-256, not-found, or failed |
| `s3.putText(ctx, 'objects', key, text, options?)` | exact key and text | stored, not-stored, or unknown |

Binding names and the optional `{ contentType: 'literal' }` object must be
compiler-proven literals. Unknown fields, spreads, dynamic bindings/options,
extra arguments and detached/aliased facade methods are rejected in the first
lowering subset. Runtime strings for key and text are required, not reserved.
TypeScript cannot enforce the literal restriction; O2/O3 lowerer diagnostics
must enforce it. Ordinary unsupported values never trigger JavaScript fallback.

The default PUT content type is `text/plain; charset=utf-8`. An explicit value
is 1–128 printable ASCII bytes, with no surrounding whitespace. It is opaque
metadata; `application/json` does not serialize, parse, or canonicalize text.
No list, delete, range, multipart, presign, version selection, arbitrary headers,
conditional writes, write-once claim, binary or streaming API is included.
Catalog owns object naming, JSON canonicalization, receipts and commit policy.
The S3 package has no Catalog or Assets dependency.

## Exact keys and bytes

Keys contain 1–1024 UTF-8 bytes. Reject lone UTF-16 surrogates, C0/C1 controls
and any slash-delimited segment equal to `.` or `..`. These are explicit subset
restrictions to avoid URL-parser normalization, not claims that S3 forbids those
keys. Preserve repeated, leading and trailing slashes, case, Unicode normalization
form and literal percent signs. Never decode a supplied key. Encode each segment
with RFC 3986 uppercase percent escapes and preserve the separators. Thus
`/a//b/` becomes `/o1-fixture//a//b/`, and `%2F` becomes `%252F`.
Canonical URI and transmitted request path must be identical.

Text is limited to 32,768 UTF-8 bytes; a binding may lower this cap. This is a
package limit, not an origin limit. It accommodates worst-case JSON escaping
under the existing 262,144-byte package-effect envelope. Validate the final
serialized request and result envelope as well. Reject invalid scalar strings
before PUT encoding. GET must bound raw bytes during reading, hash those bytes,
then decode strict UTF-8 with a preserved BOM. Do not replace invalid sequences,
strip a BOM, normalize text, decompress, or transform JSON. Empty bodies are valid.
PUT signs and sends exactly the single UTF-8 encoding whose digest it returns.
`ctx.req.text()` is already a string: feeding it to PUT does not claim preservation
of the original incoming HTTP bytes.

HEAD reports a nonnegative safe-integer Content-Length, potentially larger than
the text cap. Missing, duplicated or malformed length is a protocol failure.
GET counts actual raw bytes; if Content-Length is present, it must be unique,
valid and match. A missing GET length is allowed with a complete bounded read.
The provider must distinguish EOF from a failed/truncated read. ETag and content
type are optional, opaque values of at most 1,024 UTF-8 bytes each; malformed,
duplicate or over-limit selected metadata fails rather than being truncated.
Selected metadata must contain valid Unicode scalar values and no C0/C1 controls;
an ETag, when present, is nonempty. Total response headers are capped at 16,384 bytes.
ETag is never a content digest;
HEAD cannot return the GET/PUT SHA-256 field. SHA-256 is 64 lowercase hex digits.

## Authority and provider configuration

[bindings.json](bindings.json) is a future configuration example, not accepted
configuration in the current release. Both provider owners must add and validate
their schema rather than accepting an unknown generic property.

| Binding field | Constraint / authority |
| --- | --- |
| logical name (`objects`) | 1–64 ASCII characters: `[A-Za-z][A-Za-z0-9_-]*`; fixed in the compiled operation |
| `endpoint` | fixed HTTPS origin, at most 253 hostname characters; no userinfo, non-default port, query, fragment or path beyond `/` |
| `bucket` | fixed 3–63 character DNS-style lowercase name, no dots, adjacent punctuation or IPv4 literal; narrower portable subset |
| `region` | explicit 1–64 characters `[a-z0-9-]+`; must match the selected origin, no inferred AWS default |
| `backend` | Fastly-only fixed backend alias, 1–64 characters `[A-Za-z][A-Za-z0-9_-]*`; address, TLS SNI and host override must agree with endpoint |
| `accessKeyIdSecret`, `secretAccessKeySecret` | required provider secret references, never values; reference names use the logical-name grammar |
| `sessionTokenSecret` | optional provider secret reference with the same grammar |
| `maxTextBytes` | integer 1–32768; default 32768; applies to GET/PUT, not HEAD object size |
| `timeoutMs` | integer 1–30000; default 10000; one deadline including credentials, signing and origin read |

Node's `node.bindings.s3` belongs to provider-node's toolchain normalizer,
configuration document and execution-options mapping. Today its generic
normalizer returns empty bindings: changing that is an explicit O2 prerequisite.
Node resolves references through provider-owned secret lookup. Fastly's
`fastly.bindings.s3` belongs to provider-fastly; references resolve through the
configured `fastly.bindings.secretStore`. Raw credentials are not config fields.
Resolved access IDs are 1–256 printable ASCII bytes, secret keys 1–4096 UTF-8
bytes, and optional session tokens 1–4096 printable ASCII bytes, with no CR/LF.
Missing, invalid or inaccessible values fail before dispatch.

Fastly Object Storage requires path-style S3 access and SigV4; choose a regional
endpoint and matching region. The package does not offer AssetBucket's virtual
host option. [Fastly Object Storage guide](https://www.fastly.com/documentation/guides/platform/object-storage/working-with-object-storage/)

The package owns exact-key URL construction, S3 HTTP semantics and SigV4 protocol
composition. Providers own credentials, wall clock, concrete crypto realization,
network/body handles, deadlines and dispatch state. Application-visible payloads,
results, generated artifacts and diagnostics never contain credentials, signing
keys, tokens or Authorization values. Diagnostics/traces must also omit object
text, exact keys/URLs and their digests by default; only explicitly returned
application results contain object data. This restriction covers S3 effect and
provider observations; it does not retroactively redact other application effects.
Fastly's trusted provider layer is
compiled into the same Wasm module as the handler: this is an ownership and
authoring boundary, not a separate-memory security guarantee.

Every request uses the fixed direct object origin, disables redirects and cache
reuse, and requests identity encoding. Unexpected Content-Encoding fails as
protocol; no cached CDN response can stand in for origin verification. Fastly's
native provider currently lacks the required explicit cache-bypass hostcall;
O2 must add it and its host-mock evidence under the provider owner. Node must
disable redirects and implicit decompression or reject encoded responses before
consuming them. No ambient fetch, secret access or endpoint authority crosses
the package invocation boundary.

## Signing and the Crypto seam

Use SigV4 service `s3`, explicit region, provider UTC time, sorted canonical
headers and the exact encoded URI. GET/HEAD sign the SHA-256 of zero bytes; PUT
signs the actual body digest. Always send `x-amz-content-sha256`; do not use
`UNSIGNED-PAYLOAD`. Host, date, payload hash, optional session token and PUT
content type are signed. The initial API has no query parameters. Signing does
not normalize object paths. [AWS SigV4 specification and worked vectors](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html)

The existing Crypto package exports verification, not a production MAC-emission
contract. Its private `__pulse_crypto_hmac_sha256` can be reused *inside Crypto*;
the proof-only digest export and JWT's HS256 verifier are not S3 signing APIs.
O2 first adds bounded internal SHA-256 and HMAC-SHA256 byte operations, with
32-byte output, checked pointer/length ranges and temporary-key wiping. The
HMAC primitive must allow short keys used by SigV4's derivation; do not weaken
JWT verification's separate 32-byte minimum. O2 corrects the primitive bound:
SigV4 prefixes a secret of up to 4096 bytes with `AWS4`, so Crypto allows up to
8192 key bytes and 32768 data bytes. The provider secret limit remains 4096.
Native guest-source emission and JavaScript Web Crypto must satisfy the same
known answers. Exact export ABI is Crypto-owned and must be recorded with that
implementation, rather than guessed by S3.

Add explicit SHA-256/HMAC-SHA256 requirement and realization records through the
existing package builder's `cryptoRequirements` and Crypto planner. Missing
algorithm, source, export or provider support is a compile/build failure. Crypto
owns the primitive/source; S3 owns canonical request and key-derivation protocol;
the provider composes these in its trusted execution layer. No copied SHA/HMAC
implementation in S3, JS Promise escape in Native, or mislabeled HS256 requirement.

## Lowering contract

`contract.json` pins operation identities and argument mapping. The future
package owns its facade, `pulse.package.json`, `pulsewasm.manifest.cjs`, trusted
builder and result validation. The import is the package root and the first
slice accepts the named `s3` facade. No third-party lowerer discovery is added.

Each package call produces `pulse.canonical-package-effect.v1`, then the existing
`pulse.canonical-package-operation.v1` and lowering bundle. For operation `op`:

- `kind` and `capability` are `s3.<op>`; `operation` is `<op>`. O2 corrects
  `providerKind` to `s3`, matching the package-level runtime authority.
- `resource` and static `payload` contain `{ binding: 'objects' }`; PUT payload
  additionally contains the normalized literal `contentType`.
- Runtime `key` maps to call argument 2; PUT `text` maps to argument 3. Neither
  may overwrite binding, content type or operation identity. Compiler supplies
  the real call `range`, `loc` and placement (`await` or keyed parallel member).
- Result is the operation's named bounded structured result in the machine
  contract, not an opaque body handle. No custom generic envelope fields.
- Provider requirements include the exact operation, secret access and wall
  clock. Crypto requirements are separate package contributions. Provider plans
  include the selected logical binding and realize every required operation.
- Package-specific redaction covers key, text, digest and metadata; provider
  redaction additionally covers credentials and signed request details.

The existing generic runtime-input bridge can express this shape. The O1 check
passes its records through the real normalizer and operation constructor; this
proves envelope compatibility only. O2 must register first-party identity in
the runtime effect catalog, manifest/lowerer loader and provider capability
catalogs, and prove actual source lowering. Generic compiler orchestration must
not acquire an S3 parser or direct provider/credential imports.

## Outcomes, cancellation and retry

| Observation | GET / HEAD | PUT |
| --- | --- | --- |
| invalid key, body, binding or credentials before dispatch | bounded failed reason | not-stored |
| complete HTTP 200 with valid selected headers/body | found | stored |
| complete HTTP 404 | not-found; does not prove bucket existence | not-stored / rejected |
| complete HTTP 401/403 | failed / not-authorized | not-stored / not-authorized |
| complete HTTP 429 | failed / throttled | not-stored / throttled |
| other complete 4xx except 408 | failed / protocol | not-stored / rejected |
| HTTP 408 or timeout | failed / timeout | unknown / timeout after dispatch attempt |
| 5xx | failed / unavailable | unknown / unavailable |
| redirect, unexpected 2xx, malformed/incomplete acknowledgement | failed / protocol | unknown / protocol |
| transport failure | failed / transport | not-stored before dispatch attempt; unknown after it |

GET over-limit data is `too-large`; invalid UTF-8 is `invalid-utf8`. A failure's
`httpStatus` is present exactly when a final origin status was observed. Never include
origin error bodies or headers in failure results. PUT `stored` requires the
complete HTTP 200 acknowledgement with a bounded empty body and valid selected
metadata; an absent or opaque ETag conveys no digest guarantee. The returned
SHA-256 and byte length describe the sent bytes, not server durability or
universal visibility. Missing acknowledgement never becomes success.

Set dispatch state conservatively immediately before calling the provider send
primitive. Once entered, timeout, connection loss and uncertain send failures
are unknown even if the host cannot prove bytes left. Never retry automatically,
including after an ambiguous write. Complete explicit 4xx rejections above only
classify this attempt; they do not establish conditional-write or CAS semantics.

Request cancellation retains Pulse's rejection/termination lifecycle. Abort and
release host work; do not resume a cancelled continuation with a fabricated typed
result. An unconfirmed in-flight PUT remains unknown to any reconciliation logic.
The O3 provider implementation and tests must preserve the dispatch stage across
abort/timeout. No new continuation or background reconciliation API is introduced.

## Reuse and named implementation owners

| Existing source / gap | Decision and owner |
| --- | --- |
| `packages/assets/src/sigv4.ts` RFC3986/key helpers and canonical header logic | One-time adaptation into S3 with provenance. No Assets import. Donor has no relevant test vectors; add independent known answers. |
| `packages/assets/src/asset-bucket.ts` key/path normalization | Do not copy: strips leading slashes and collapses repeated slashes. S3 rejects unsafe dot segments and preserves other keys. |
| AssetBucket signer and middleware | Signer currently constructs a bodyless Request. Implement explicit signed-body ownership in S3/providers; exclude cache, fallback and middleware policy. |
| `packages/crypto/as/pulse-hmac-as.ts`, `packages/crypto/pulsewasm.native.cjs` | Crypto owns the new bounded internal digest/MAC contract, guest source, exports and known-answer evidence. |
| `packages/s3/` (new) | S3 facade, package product/manifest/lowerer contracts, protocol and structured result validation. |
| `wasm/packages/contracts/src/s3/` (new) | S3-owned vocabulary; generic package/library-kit contracts retain envelope and trusted-builder validation. |
| `packages/runtime/src/internal/package-runtime.js` | Runtime owns fixed first-party effect registration, request ownership and bounded/redacted effect transport. |
| `wasm/packages/compiler/src/spine/` | Generic runtime-argument/placement composition only; use the existing package-operation seam. |
| `packages/provider-node/` | New owned binding schema, normalization/documentation, execution mapping, crypto/network and bounded body realization. |
| `packages/provider-fastly/` | Binding schema/backend validation, secret lookup, primary-Wasm realization, cache bypass and native host mock. |
| `wasm/packages/contracts/src/crypto/`, Crypto planner / guest-link owners | New exact crypto requirements, provider realizations, source composition and final-artifact import/export validation. |
| `release/pulse-release-manifest.json`, package/export/pack owners | Explicit eventual package membership and truthful support matrix; O4 packed acceptance and human release approval. |

## Executable gates and phase handoff

Run O1's unit task:

```sh
node wasm/scripts/run-wasm-tests.cjs --task s3-design-contract --no-report
```

It type-checks positive/negative consumers against the isolated draft declaration,
checks canonical envelope compatibility and worst-case byte budgets, and validates
exact-key/UTF-8/signing known answers with Node reference primitives. It neither
installs the draft as a package nor labels those checks Native conformance.

Run the Native acceptance target explicitly:

```sh
node wasm/test/s3/run-native-read-acceptance.cjs
```

It exits **2 / blocked** while the real S3 package is absent. After O2 supplies it,
it must load provider-owned bindings through the real project configuration,
compile the actual consumer and execute both Node Native and Fastly Native Wasm.
It has no draft-type shim, custom S3 dispatcher, mock lowerer or JS fallback.
Missing later dependencies or failed assertions are failures, never skipped passes.
O2 promotes this target into the Native profile after the real package and both
Native implementations pass. The design-only fixture remains historical input.

The fixed corpus covers runtime keys (including `%`, Unicode and repeated slashes),
HEAD/GET agreement, strict byte length/digest/BOM handling, invalid/oversized bodies,
404 versus forbidden, and keyed parallel dispatch. Origin I/O and credentials are
local fixtures. Fastly signing must additionally be verified against known answers
inside its real Crypto realization in O2; the current host mock redacts signed
headers and cannot by itself prove signature correctness. Live origin behavior is
separate O4/T2 evidence.

O2 closes Crypto emission, binding validation, cache bypass and result-redaction
gaps before completing Native HEAD/GET and promoting this executable target into
the Native profile. O3 adds PUT, dispatch-stage failure/cancellation evidence and
both JavaScript realizations. O4 adds the full negative compiler/config matrix,
signature/header tampering, truncation/encoding/secret-redaction conformance,
packed consumers and release/support metadata. Assets alignment remains separate.
