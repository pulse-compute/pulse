# @pulse-compute/s3

<!-- pulse-package-status:start -->
> **Support tier:** Supported provider/extension surface<br>
> **Audience:** Applications using bounded exact-key object reads and writes through Pulse effects.<br>
> **Install directly:** Yes, when an application uses S3 object operations.<br>
> **Supported entry points:** `@pulse-compute/s3`<br>
> **Stability:** The package root supports head, getText and putText on Node Native, Node JavaScript and Fastly Native. Fastly JavaScript is ineligible. Provider and lowering subpaths are toolchain-only; live origin acceptance is separate.<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.1/packages/s3/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.1` package policy.
<!-- pulse-package-status:end -->

This package provides bounded, exact-key `head`, `getText` and `putText` effects for
Node Native, Node JavaScript and Fastly Native. Await an operation into a local
variable or use it directly in keyed `ctx.parallel`. The binding is a literal
logical name; key and text may be runtime strings.

Providers own fixed HTTPS origin, bucket, region, named credential references,
deadline and transport. Fastly additionally requires a named static backend.
Crypto selection must include `SHA-256` and `HMAC-SHA256`. Crypto owns the
digest and MAC primitives; S3 owns signing and exact object semantics.

Put mappings under `<profile>.node.bindings.s3` or
`<profile>.fastly.bindings.s3`. A logical `objects` entry has these fields:

| Field | Value |
| --- | --- |
| `endpoint` | Fixed HTTPS origin, for example `https://objects.example.invalid` |
| `bucket`, `region` | Explicit bucket and signing region |
| `accessKeyIdSecret`, `secretAccessKeySecret` | Named provider secret references |
| `sessionTokenSecret` | Optional named session-token reference |
| `maxTextBytes` | 1–32768; default 32768 |
| `timeoutMs` | 1–30000; default 10000 |
| `backend` | Fastly-only named static backend |

The profile declares `crypto: ['SHA-256', 'HMAC-SHA256']`. A read looks like
`const object = await s3.getText(ctx, 'objects', key)` inside a handler.

GET accepts at most 32,768 raw bytes and strictly decodes UTF-8, preserving a BOM.
It returns the raw-byte SHA-256 digest and byte length with optional opaque ETag
and content type. HEAD requires a safe integer Content-Length but does not read a
body. A 404 returns `not-found`; other failures return a bounded reason and an
HTTP status when observed. Redirects, compression, retries and caching are disabled.

PUT accepts scalar text encoded once as UTF-8, including empty text, up to the
binding's byte limit. Use `const result = await s3.putText(ctx, 'objects', key,
text, { contentType: 'application/json' })`. Options are literal metadata; they
do not serialize text. The default content type is `text/plain; charset=utf-8`.
A complete 200 acknowledgement with an empty bounded body returns `stored`,
sent byte length, SHA-256 and optional opaque ETag. The digest identifies sent
bytes; it is not an origin durability receipt.

Before dispatch, validation, credential, signing and deadline failures return
`not-stored`. A complete explicit 4xx rejection, except 408, also returns
`not-stored`. After entering send, transport loss, timeout, unavailable origin
or malformed acknowledgement returns `unknown`: bytes may already be stored.
There are no retries. Cancellation terminates the operation through the existing
request lifecycle; it does not return an S3 outcome or promise rollback. Fastly
has no pending-request cancel hostcall; invocation termination owns its release.

Node JavaScript explicitly uses Crypto's bounded Web Crypto byte realization.
Native targets compose Crypto's AssemblyScript primitives. Fastly JavaScript S3
is ineligible because its SDK projects raw headers and loses required metadata
information. This target exclusion does not gate supported targets.

For a JSON request carrying the maximum text consisting of escaped control
characters, configure the existing `schemas.maxBytes` request envelope to
262144; the object itself remains bounded to 32768 UTF-8 bytes. The acceptance
consumer uses generic JSON responses (`strict: false`) to compare the complete
result unions. Applications using strict JSON must declare response schemas.

The package root is the supported application API in the synchronized
`1.0.0-beta.1` release candidate. Provider, manifest, compiler and Native
subpaths are trusted toolchain integration, not application imports. Install
S3 with the exact compatible Pulse, CLI and provider candidate set; candidate
preparation does not imply npm publication.

See the [S3 guide](https://pulsecompute.io/v1.0.0-beta.1/packages/s3/) for the
lowering contract, support matrix and acceptance boundaries. Local acceptance
executes Node Native, Node JavaScript and compiled Fastly Native Wasm against
controlled origins. Live Object Storage evidence follows infrastructure setup.
