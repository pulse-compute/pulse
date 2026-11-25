# UPLOAD-00 — candidate contract and reuse/gap map

Decision evidence, November 24, 2026 (America/Denver). Inspected `latest`:
`8faa3f9ff64d79598b5281ed14373c194a04418e`, including DELETE/OPTIONS #603.
No upload API, provider support, release inclusion or public API freeze is
established here. `putBody` below is a probe name, not a selected API.

**Verdict: a legitimate bounded capability worth the next two proofs.** Pulse
already owns exact-key S3 authority/signing and single-consumer body transfer.
The useful addition is one authorized incoming object upload without converting
binary bytes to application data. It is not just a new verb: streaming signing,
an owned body claim at the package boundary, and typed write settlement are
missing. RC1 inclusion remains undecided until those seams are proven.

No single repository Entry Point covers this cross-owner evidence task. Changes
are confined to this research directory. S3, compiler/runtime and provider
owners are read-only; existing tests are replayed without modifying their gates.

## Candidate contract (proposed, not frozen)

| Boundary | Candidate for the first vertical |
| --- | --- |
| Workload | One incoming HTTP body, one fixed-binding S3 PutObject, one bounded result. Raw binary object bytes; no form-data parsing or transformation. Application authorization happens before ownership reservation or input reads. |
| Authority | Literal logical S3 binding; fixed HTTPS origin, bucket, signing region, secret references and Fastly static backend. Runtime key uses existing 1–1024 UTF-8-byte admission/encoding. Runtime data cannot select credentials, backend or destination authority. |
| Ownership | Reserve the current request's sole unread body atomically before dispatch. Structured reads, transforms, aliasing, teeing, replay, a second upload and grouping an upload with competing consumers fail closed. Carry the claim out-of-band as a request-local host capability, never as bytes or a serialized marker in a package payload. |
| Placement | First vertical: authorize/read bounded metadata, await one upload, then render a small response. Ordinary result continuation is required; terminal opaque HTTP proxying alone does not satisfy this workload. No upload in `ctx.parallel` or effect collections initially. |
| Length | Known length first, including zero: provider validates unambiguous ingress length before dispatch, checks declared length against policy, meters actual bytes and requires exact EOF. Missing/invalid/duplicate/conflicting length fails before dispatch. A declaration never substitutes for metering. Unknown length is deferred, not silently buffered. |
| Metadata | Literal bounded content type, default `application/octet-stream`; reuse the current 128-character validation. Provider constructs framing and signed headers. No implicit forwarding of cookies, authorization, Host, trailers, content encoding or arbitrary client metadata. |
| Capacity | Explicit upload-specific byte limit; do not repurpose `maxTextBytes` or imply its 2 MiB ceiling is an upload policy. Begin proof at or below the existing Fastly 1 MiB ceiling; evaluate 8/64 MiB as later experimental rungs. No larger supported ceiling or default is selected by 00. |
| Deadline | One enclosing request deadline, with an earlier binding deadline covering secret resolution, signing, body transfer, upload finish and complete acknowledgement. Start with the existing finite ≤30 s policy. No background completion, reset at EOF, or new phase-timeout contract. Slow-client suitability is a qualification question. |
| Memory/backpressure | Demand-driven provider pump with fixed bounded payload storage, no next source read until prior chunk is written. Reuse Node's 16 KiB emission/64 KiB source-allocation checks and Fastly's 16 KiB scratch as starting mechanisms. Measure transport/host queues separately; neither implies constant total RSS or zero-copy. |
| Retry/redirect | Exactly one dispatch attempt; redirects and retryable responses are surfaced, never automatically replayed. Partial transfer, disconnect and cancellation cannot establish rollback. |
| Targets | Evaluate Node JavaScript/Native, then Fastly Native. Fastly JavaScript remains outside the candidate because the existing S3 raw-header and incoming-forwarding contracts exclude it. |

Authorization may use existing metadata/config/secret/JWT effects before the
upload. Whether this can compose without broadening the current forwarding
scheduler is a required proof, not assumed reuse. Application policy still
owns which key a caller may write. This operation may replace an existing key;
it is neither conditional create nor an atomic metadata-plus-object transaction.

## Signing and integrity decision

| Mode | Consequence | 00 disposition |
| --- | --- | --- |
| Current payload-hashed PUT | Existing S3 signer requires the full `Uint8Array` before signing. Text Native paths also materialize bytes before dispatch. | Retain for `putText`; not the opaque upload implementation. |
| SigV4 authorization with `UNSIGNED-PAYLOAD` over HTTPS | Avoids the pre-read. Request identity/selected metadata are signed, but SigV4 does not authenticate the payload bytes. | First UPLOAD-01 candidate; require actual intended-origin acceptance. Do not silently downgrade `putText` or claim signed-payload integrity. |
| SigV4 `aws-chunked` payload signing | Bounded chunk processing is possible, but requires protocol framing and a chained signature per chunk. AWS's documented form still requires decoded object length. | Separate 01 comparison if stronger integrity is required or unsigned payload fails; not equivalent to ordinary HTTP chunking. |
| Full pre-read/spool, multipart, caller-supplied prehash or checksum trailers | Introduces additional storage, transaction, trust or protocol contracts. | Outside the first vertical; reconsider explicitly if the first two modes cannot meet the intended requirement. |

The first candidate promises exact metered transport and an origin acknowledgement,
not a Pulse-computed whole-object digest. An ETag remains opaque. A hash computed
while forwarding is only an observation unless a qualified origin protocol
validates it; a mismatch discovered after dispatch cannot undo a write. Do not
add a `sha256` result merely to resemble `putText`.

AWS documents both unsigned payload authorization and chained chunk signing.
Fastly's reviewed guide establishes S3-compatible uploads but does not establish
acceptance of these exact streaming/signing/framing combinations. Compatibility
must be observed against the selected endpoint; absence of proof is not a claim
that a mode is unsupported. References consulted November 24, 2026:

- [AWS header-based signing](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html).
- [AWS streaming payload signatures](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-streaming.html).
- [Fastly Object Storage operations](https://www.fastly.com/documentation/guides/platform/object-storage/working-with-object-storage/).

## Settlement and cancellation

Reserve → validate/sign → dispatch → pump exact input → finish upload → validate
complete acknowledgement → resume handler. Every failure fences later work and
disposes owned handles. Successful local writer close alone is not `stored`.

| Observation | Candidate outcome |
| --- | --- |
| Invalid key/length/policy, unavailable credentials, deadline before possible dispatch | `not-stored`: this attempt was not sent; no statement about a previously existing object. Body remains unread and request cleanup owns disposal. |
| Complete explicit origin 4xx rejection other than 408 | `not-stored`, following the existing S3 rule, only after bounded response/protocol validation. Early rejection stops the input pump; no unbounded drain. |
| Exact input EOF, upload finish and complete qualified 200 acknowledgement with empty body and valid bounded metadata | `stored` with measured byte length and optional opaque ETag. Require all three; an early 200 alone cannot establish successful transfer. |
| Failure after possible dispatch: timeout, reset, length mismatch/overflow, incomplete/malformed acknowledgement, 408/5xx/unexpected success status | `unknown`. The object may exist; no hidden retry, rollback or compensating delete. Conservative dispatch uncertainty is intentional. |
| Request cancellation/disconnect | Terminal lifecycle cancellation; stop reads/writes, abandon unfinished transport and dispose late responses. No resumed handler result or guarantee the origin cancelled. |

Retain existing 16 KiB aggregate/1 KiB selected response-metadata limits. The
candidate rejection-body read/drain budget is separately finite (at most 16 KiB
for the first probe); exceeding it yields `unknown` after dispatch. Reason names
and exact result types remain unfrozen. A lost client-facing success response
after origin acknowledgement is still an application reconciliation problem.

## Reuse and required changes

Paths below are relative to the inspected repository root; hashes are retained
in [boundary-evidence.json](./boundary-evidence.json).

| Owner / current source | Reuse | Missing seam / next proof |
| --- | --- | --- |
| S3 `src/provider.js`, `src/signing.js`, `as/read.as.ts` | Fixed authority, key encoding, SigV4 derivation, secret hygiene, bounded metadata and ambiguous-write rules | Add a selected streaming signing mode without changing buffered PUT semantics; origin validation belongs to 01. Generic `/signing` support for a payload marker is not package upload support. |
| Runtime `src/internal/incoming-body.js` | Request-local WeakMap identity, exclusive reservation, conflict invalidation, best-effort cancellation | Package effects currently clone data: an incoming marker becomes `{}` and loses authority. Need an explicit host-owned lease/claim channel, plus lifetime and duplicate-claim proof. Never preserve arbitrary application object identities in generic payload cloning. |
| Compiler `src/spine/incoming-body-source.js`; S3 `pulsewasm.compiler.cjs` | Closed source admission, package-owned operation/lowering, runtime key input | Source validator only admits inline POST fetch; S3 lowerer rejects `putBody`. Recognize one approved package body consumer and prove request ownership through Native lowering. |
| Node `src/javascript/incoming-body.js`; `src/runtime/s3-reader.js` | Lazy bounded body pump, abort handling; raw-header S3 response validation | Existing forwarding hardcodes POST and returns an opaque response; S3 transport uses `req.end(request.body)`. Compose a backpressured PUT plus bounded acknowledgement, not a signature on a generic fetch escape. |
| Fastly `src/build/native-body-forwarding.{js,as.ts}`; `src/toolchain/body-forwarding.js` | `send_async_streaming`, fixed scratch, readiness/partial writes, early response, cleanup and byte/deadline meters | Current plan admits one terminal opaque POST effect, static URL/literal headers and 1 MiB cap. Signed dynamic-key PUT, preceding authorization effects and typed result continuation are additional integration work. |
| Fastly `src/build/s3-native.as.ts` | Secret store, S3 signing, raw-header extraction, pending request and result interpretation | Currently buffers a text payload and fills body before `send_async`. Must connect to streaming pump; preserve invocation-bound pending ownership (no pending-request cancellation hostcall). |

Large downloads remain a separate policy and qualification decision. Existing
opaque `getBody` is useful response-ownership evidence, not upload capability.

## Evidence and exit from 00

[probe.cjs](./probe.cjs) exercised six current boundaries: absent upload method,
compiler POST/PUT/package-body admission, marker identity loss through package
cloning, Node rejection before input/dispatch, whole-byte signer requirement,
and Fastly's 1 MiB ceiling. All passed. These are admission/reuse observations,
not a working upload prototype. No network or external writes occurred.

The clean-base replay passed `s3-read-contract`, `s3-write-contract` and
`fastly-incoming-body-forwarding` (3/3). The latter produced a 42,977-byte Wasm
with SHA-256 `ec73b53f71b75ed914a020d6525dd9a9981a9e5535244c60d4a058e85f0acaa4`.
Its injected ABI matrix retained 16,384 payload-scratch bytes, 17,536 metadata
scratch bytes and 1,310,720 guest memory bytes. Host queues were not measured.
Viceroy, installed packages, live Fastly and S3 upload compatibility were not
run. Historical FWD9 qualification is context, not new upload acceptance.
See [baseline evidence](./baseline-evidence.json) and the retained
[forwarding receipt](./forwarding-proof.json).

Reproduce from a dependency-restored checkout:

```sh
node wasm/test/s3/upload-00/probe.cjs /tmp/upload-00-boundaries.json
node wasm/scripts/run-wasm-tests.cjs --task s3-read-contract --task s3-write-contract --task fastly-incoming-body-forwarding --report /tmp/upload-00-baseline.json
```

00 is complete: candidate scope, length/integrity decisions, ownership/results,
source gap map and next acceptance gates are recorded. Recommendation: proceed
to 01 as an experiment, not implementation admission or an RC1 commitment.

| Work | Evidence needed / stop condition |
| --- | --- |
| UPLOAD-01 — signing/origin | Known-length signed PUT to the intended store, prefix before input EOF, exact binary readback, zero/limit/early-rejection cases; compare selected integrity modes. Record endpoint/region and exact bytes. Stop and re-estimate if only buffering/multipart works. Use an isolated test prefix and explicitly authorized credentials/writes. |
| UPLOAD-02 — transfer/ownership | Node then emitted Fastly Native: auth-before-read, runtime key with fixed authority, single claim, signed upload, bounded typed acknowledgement and continuation, fixed payload storage/backpressure. Stop for redesign if this requires generic stream APIs or shared scheduler ownership changes. |
| UPLOAD-03 — failures | Stall/reset/disconnect/early response/length mismatch/deadline/late result matrix, truthful ambiguous writes, no replay, no post-cancellation continuation, bounded cleanup. |
| UPLOAD-04 — capacity/install | Exact installed artifacts; increasing payload/concurrency, guest and host memory, slow clients/origin, throughput/deadline fit and provider reality. Select limits from evidence. |
| UPLOAD-05 — release decision | Include, defer or narrow with qualified target/origin/signing/size matrix, operational reconciliation story, and explicit remaining evidence. |
