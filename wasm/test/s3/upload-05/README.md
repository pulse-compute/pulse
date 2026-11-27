# UPLOAD-05 — RC1 decision record

Prepared November 25, 2026 (America/Denver), against `latest` after
[UPLOAD-04 / #608](https://github.com/pulse-compute/pulse/pull/608).

**Recommendation: defer incoming binary S3 uploads from RC1.** The evaluation
is complete enough to make that recommendation. Upload release qualification
remains blocked; no target/origin/size combination has passed all gates.
The capability is technically legitimate and worth retaining as follow-on work,
but it is not a small remaining packaging task.

This is a reviewable recommendation, not approval or execution of a release
change. Human release authority remains with the maintainer. The manifest,
public API, supported limits and existing `putText`/`getBody` contracts are
unchanged. No service activation or object writes occur in this pass.
There is no single matching Entry Point for this cross-owner evidence synthesis;
the ordinary root/wasm instruction chain applies.

## Include, narrow, or defer

| Choice | Assessment |
| --- | --- |
| Include all three candidate targets | Not justified. Public source admission and installed operation are absent; deployed Compute streaming and teardown are unqualified. |
| Narrow to Node only | Plausible follow-on, not an RC1-ready fallback. Node JavaScript uses a research bridge and Native uses a `putText` compiler scaffold. Both need the real package operation, admission/ownership negatives and exact installed qualification. Local HTTP results do not qualify production TLS queues or a complete Node-to-intended-origin path. |
| Narrow to 1 MiB on Fastly | Reduces the next experiment's exposure but does not repair missing admission, pre-Wasm buffering evidence or unresolved cleanup. A smaller cap is not a qualification pass. |
| Defer uploads from RC1 | Recommended. Keeps RC1 independent of this optional capability while preserving the bounded prototype, failed gates and specific reopening work. |

This decision concerns incoming binary upload support. It neither removes
existing supported text writes nor expands large downloads, multipart, unknown
length, arbitrary streams, presigned upload workflows or Fastly JavaScript.
The release manifest remains the authority for current support.

## Evidence matrix

Every size below is a **tested research size**, not a supported ceiling. The
qualified public-upload matrix is empty. Loopback/injected-host, installed
package, and live-origin evidence are separate and cannot be multiplied into
an untested end-to-end claim.

| Execution target / path | Origin and signing | Sizes / concurrency observed | What passed | Missing or failed gate |
| --- | --- | --- | --- | --- |
| Standalone UPLOAD-01 HTTPS transport through the environment proxy | Selected Fastly Object Storage QA bucket at `https://us-central-1.object.fastlystorage.app`, region `us-central-1`; known-length SigV4 `UNSIGNED-PAYLOAD`, plus hashed control | Unsigned 0, 1, 16,385 and 1,048,576 bytes; hashed 1 KiB; sequential attempts | Five valid PUTs and exact GET readback; recorded exact-key cleanup | Full live matrix **failed**: invalid-signature 403 arrived after all 1 MiB was generated/submitted. Remote prefix consumption unobservable. Not execution through Pulse or deployed Compute. Exact bucket/prefix remain in the original receipt. |
| Node JavaScript research bridge | Loopback HTTP, fixed signing authority, independent SigV4/byte verifier | 0/1/16,385/1 MiB transfer proof; 64 KiB and 1/8/32 MiB at concurrency 1/8/16, plus slow input/origin | Ownership, continuation and local failure cases; 14 capacity cells | Public operation absent; no installed upload or production HTTPS/origin/host-capacity qualification |
| Node Native research adapter | Same loopback origin/signing policy; compiled `putText` scaffold | Same transfer and capacity sizes/concurrency as JavaScript | Typed continuation, local failure cases; 14 capacity cells | Actual upload source admission/lowering absent; same installed/real-path gaps |
| Fastly Native injected ABI | Independent fixture verifies known-length unsigned SigV4 | 0/1/16,385/1 MiB; deterministic fault cases | Transfer, bounded guest scratch, continuation; 40 current-path failure cases | Injected transport is not host-memory, remote cancellation or deployed capacity evidence; pending handles can remain invocation-owned |
| Fastly Native research Wasm on Viceroy 0.21.1 | Loopback verifier; explicit framing-from-headers preserves signed Content-Length | 64 KiB and 1/8/32 MiB at concurrency 1/8/16; two separate slow cells | Eleven normal and two slow capacity cells; real local wire signatures/bytes | 32 MiB × 16 **failed** with timeout; known-length ingress buffered before guest execution; timeout teardown unqualified |
| Deployed Fastly Compute → intended Object Storage | Candidate known-length unsigned SigV4 over HTTPS, fixed backend/bucket/region | **Not run** | None established by UPLOAD-04 | Streaming ingress, host queues/memory, early rejection, cancellation/teardown, deadlines and repeatability |
| Exact installed release artifacts | 20 packed packages, isolated npm consumer | 1,231 installed files checked before/after | Pack and byte integrity | `s3.putBody` absent; TS2339. A passing negative assertion does not qualify uploads. |
| Fastly JavaScript / other S3 origins | Outside this candidate | Not evaluated | None | No support inference from S3 compatibility or Node results |

[UPLOAD-02](../upload-02/README.md) has 34 passing transfer/ownership cases;
[UPLOAD-03](../upload-03/README.md) has 104 passing current-path failure cases,
plus a separate historical defect reproduction. Neither exercised public upload
admission. [UPLOAD-04](../upload-04/README.md) has 28 passing Node capacity cells.
At 32 MiB × 16, Node JavaScript/Native client p95 was 7.78/7.33 seconds and sampled
RSS about 136/168 MiB. Viceroy reached about 1.80 GiB sampled RSS in its failed
largest cell. These are diagnostic batches with different memory populations,
not comparative provider benchmarks or production limits. In particular,
Viceroy buffering and RSS do not establish deployed Compute behavior.

## Candidate retained for a future implementation

Retain the narrow shape from [UPLOAD-00](../upload-00/README.md): one unread
incoming body, one authorized runtime key under a fixed logical S3 binding,
one dispatch and a bounded typed result followed by ordinary continuation.
Authorization precedes body reservation/read. Length must be known, unambiguous,
metered and exact at EOF. The host owns credentials, destination, framing and
signed headers. No parallel body consumers, replay or silent JavaScript fallback.

Keep **1 MiB as the next probe ceiling**, not a public default. The 32 MiB
experiment does not select a shipping ceiling. Select per-target size,
concurrency, operation/request deadlines and host admission limits together
from qualified evidence. Guest chunk bounds alone cannot bound ingress/host
queues. Preserve both UPLOAD-03 cleanup/deadline corrections and UPLOAD-04's
explicit framing correction when porting the prototype.

The retained signing candidate is known-length `UNSIGNED-PAYLOAD` over HTTPS.
It authenticates the request metadata, not the payload bytes. Exact metering,
a complete acknowledgement and optional opaque ETag do not provide a whole-object
cryptographic integrity guarantee. The live readback checks are test evidence,
not a new application promise. Requiring stronger integrity reopens the signing
choice explicitly; do not silently switch to buffering, multipart or chunk signing.

## Operational reconciliation for ambiguous writes

This is the application policy a future integration must implement and qualify;
it is not an application API added by this decision pass.

1. Before dispatch, authorize the actor/key and durably record an application
   attempt ID, an exclusively allocated object key, expected length and intended
   metadata/publication action. Retain enough information to query status after
   client disconnect. Unique keys must be enforced by application authority;
   this proposal does not make PutObject conditional or prevent arbitrary overwrites.
2. On `stored`, record the complete acknowledgement and measured byte length,
   then perform the application's metadata/publication transition. Object storage
   and application metadata are separate writes: failure of the second does not
   roll back the first. A lost client-facing response must be recoverable by
   querying the same attempt record without uploading again.
3. On `not-stored`, record only what the attempt proves: no dispatch, or a complete
   qualified explicit rejection. It says nothing about a previous object at that
   key. Do not delete an existing object or equate this result to bucket absence.
4. On `unknown`, disconnect, request timeout or a missing terminal result, keep the
   attempt unresolved. Do not automatically repeat PUT, reuse the key, publish the
   asset or issue a compensating DELETE. A remote write may still finish after the
   handler has stopped. Application cancellation and origin rollback are distinct.
5. Reconcile through a separately authorized bounded job/operator action. HEAD can
   establish observed existence/length; it cannot prove byte identity. A 404 during
   unresolved in-flight work is not final absence. Where exact identity matters,
   use an origin-qualified checksum or bounded readback against a trusted expected
   digest, with no inferred hash semantics for ETag. A client-provided hash alone
   does not establish trusted content. No such verification API is introduced here.
6. Bound reconciliation attempts and observation time; escalate unresolved outcomes
   instead of converting them to success or absence. There is no qualified safe
   waiting interval yet. Only after establishing writer settlement and exclusive
   ownership may application policy authorize exact-key cleanup or a new attempt.
   Never list/delete a bucket to repair one ambiguous write. Cleanup failure stays
   visible; the historical QA cleanup is not a production rollback guarantee.

The operational acceptance cases must include an origin commit with lost ACK,
lost client success after commit, metadata publication failure, process restart
with an unresolved attempt, HEAD 404 followed by late appearance, same-length
wrong content and a conflicting writer. Until the real provider's pending-work
lifetime is measured, this policy deliberately leaves some attempts unresolved.

## Concrete work to reopen inclusion

These are proposed follow-on work units, not completed work or newly created
GitHub issues. Node-only inclusion may be reconsidered independently once its
own complete gates pass; Fastly evidence cannot be waived by that narrowing.

| Work unit | Owners / prerequisite | Acceptance needed |
| --- | --- | --- |
| UPLOAD-NEXT-01 — admit the operation | S3 facade/types/lowerer, compiler incoming-body admission, runtime request-local claim seam; approve the bounded public contract | Real source compiles/runs without `putText` substitution or monkey patches on selected targets. Authorize-before-read, fixed authority, missing/conflicting length, double/foreign/stale claims, structured-read conflicts and parallel-consumer negatives. Preserve generic payload cloning and shared scheduler invariants. |
| UPLOAD-NEXT-02 — integrate providers | Node/Fastly transport owners after NEXT-01; may begin bounded deployed research earlier | Port only qualified prototype mechanisms and all three research fixes. Independent wire signatures/bytes, bounded metadata, early response, backpressure, exact EOF, one dispatch and no post-cancellation continuation. Explicit Fastly framing failure fails closed. No retained host work may be called cleaned up because the fixture destroyed it. |
| UPLOAD-NEXT-03 — qualify real paths and limits | Exact provider artifacts; bounded QA deployment/origin access with explicit activation authorization | For each selected target/origin: client-to-origin prefix-before-EOF, pre-read policy rejection, secret/operation/request deadlines, host/guest memory under slow peers and concurrency, disconnect/late-result fencing, observed pending cleanup and recovery. Reproduce origin rejection timing; do not claim early rejection from client submission counts or lower the existing gate silently. Select and repeat the actual size/concurrency envelope. |
| UPLOAD-NEXT-04 — qualify installed and operational use | NEXT-01/02 plus selected real-path envelope and application reconciliation owner | Isolated exact-tarball public consumer, positive upload and negative admission matrix on each target; binary readback/integrity policy; the reconciliation cases above; immutable source/package/Wasm/provider identities and complete receipts. |
| UPLOAD-NEXT-05 — revisit release inclusion | All selected-target gates terminal; human release review | Publish a nonempty qualified target/origin/signing/size/deadline matrix and truthful limitations. Only then update canonical support docs/manifest and select the release. |

No new production dependencies or generic stream framework is justified by these
results. The prototype reused the current scheduler; that is encouraging, not a
proof that public admission and provider integration are already complete.

## Evidence identity and completion

[evidence-index.json](./evidence-index.json) pins the reviewed base commit/tree
and SHA-256 of the retained source reports. Earlier reports preserve their own
source/artifact identities, failed attempts and limitations. This pass reads
those results; it does not replay them, relabel failed matrices as passes or
claim an immutable end-to-end acceptance campaign. The UPLOAD-04 final harness
snapshot is distinct from its earlier development iterations.

To check the indexed bytes from the repository root:

```sh
node - <<'NODE'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const index = JSON.parse(fs.readFileSync('wasm/test/s3/upload-05/evidence-index.json'));
for (const entry of index.evidence) {
  const actual = createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex');
  if (actual !== entry.sha256) throw new Error(`Evidence changed: ${entry.path}`);
}
console.log(`Verified ${index.evidence.length} evidence files; qualification remains blocked.`);
NODE
```

UPLOAD-05 completes the requested release decision preparation: defer is the
recommended RC1 disposition, the useful capability is retained, and remaining
implementation, evidence and application responsibilities are explicit. The
maintainer's review decides whether to accept that recommendation or fund a
selected continuation. This record grants no merge, publication or deployment
authority and does not block RC1 on an optional upload feature.
