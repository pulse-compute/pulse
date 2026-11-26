# UPLOAD-03 — failure, cancellation and ambiguous-write qualification

The bounded upload experiment passes 104 current-path cases: 32 Node JavaScript,
32 Node Native and 40 emitted Fastly Native. Two defects in the UPLOAD-02 Fastly
prototype were reproduced and corrected within this research directory. This
supports proceeding to UPLOAD-04 capacity/install qualification; it does not
introduce a public upload operation or select release limits.

There is no exact repository Entry Point for this cross-owner research fixture.
The ordinary root/wasm instruction chain applies. The product runtime, compiler,
provider owners, public API and shared scheduler are unchanged on disk.

## Defects and fixes

| Finding | Reproduction | Research fix |
| --- | --- | --- |
| Immediate streaming-send error retained the claimed incoming body | `send-error`: `unknown` was correct, but one source body remained open | Close the claimed source on this terminal send-error path. Do not relabel the write as safely absent; dispatch uncertainty remains `unknown`. |
| Operation deadline could expire during final response cleanup, after acknowledgement validation | `deadline-response-close` returned `stored`; `late-early-rejection-cleanup` returned `not-stored` after expiry | Recheck the operation deadline after cleanup on both the normal acknowledgement and early-response paths, before publishing a typed result. Expiry yields `unknown`. |

[native-overlay.cjs](./native-overlay.cjs) applies guarded substitutions over the
frozen UPLOAD-02 contribution. It does not patch the original experiment or
production S3 owner. The final receipt replays the old contribution against the
same matrix and requires exactly these three failing assertions, then requires
all 40 cases to pass with the fixes. The shared generated resolver and invocation
driver remain byte-identical to baseline generation.

## Qualification matrix

| Boundary | Node JavaScript / Native | Fastly Native injected ABI |
| --- | --- | --- |
| Input failure | Underflow, overflow, reset, stalled source; exact successful binary transfer | Same, plus host source-read failure |
| Output pressure/failure | Blocked write-completion gate, origin reset | Writer readiness stall, write failure, immediate send error, pending transport failure |
| Acknowledgement | Header/body stall, truncation, nonempty success, oversized rejection, duplicate length, oversized metadata, unsupported encoding | Corresponding body underflow/overflow/read failure, framing and metadata cases |
| Early origin result | 200, 403, 408, 429, 500, 307; stalled input cancelled when headers arrive | Same statuses, plus rejection during partial upload backpressure |
| Operation deadline | Stalled source/writer/headers/body; source and acknowledgement released after deadline cannot cause further work | Expiry at input EOF, upload close, returned headers, acknowledgement EOF and final response close |
| Request cancellation | Before credentials complete, during input, after prefix, after upload; deliberately late provider result cannot resume handler | Host disconnect before source, during write, after upload, after acknowledgement; no hostcalls after trap and a fresh invocation succeeds |
| Request deadline | Existing request-budget error, zero continuation effects | Existing 504 timeout response, zero continuation effects |
| No replay / cleanup | At most one dispatch/request, sockets closed before fixture teardown; late work cannot add reads, writes, dispatches or continuation | At most one dispatched request, no retry/delete, no remaining owned bodies/responses on normally returned operation outcomes; pending handle qualification below |

The scaffold adds an observable `AFTER_UPLOAD` secret effect after the upload
await. Node verifies zero continuation effects after cancellation/deadline and
one after ordinary completion. Fastly request-deadline cases verify that effect
never executes; disconnect traps fence all subsequent hostcalls. Fresh invocations
exercise the same compiled module without carrying claims forward.

The Node operation deadline is 250 ms (500 ms when testing a 75 ms request
budget); other request budgets are 2 s. The Fastly operation/request deadlines
are 1.5/2 s using the ABI fixture's monotonic clock. Node's write stall is injected
at the existing write-completion test gate; this does not measure OS send-buffer
capacity. Node server byte storage is counted, not accumulated. The prior 1 MiB
probe ceiling, 16 KiB emitted chunks and 64 KiB Node source-backing cap remain.

## Outcome and cleanup semantics

- A complete qualified 200 acknowledgement, exact source EOF and upload finish
  establish `stored`. The byte length is measured; `UNSIGNED-PAYLOAD` supplies no
  payload-hash integrity claim.
- A complete bounded explicit 4xx rejection other than 408 is `not-stored` while
  the operation deadline remains valid. It makes no claim about an earlier object.
- Failures after possible dispatch, invalid/incomplete acknowledgements, 408/5xx,
  redirects, early 200 and operation deadline expiry are `unknown`. There is no
  automatic replay, rollback or compensating delete.
- Request cancellation/deadline fences the application continuation. A timeout
  response does not establish whether the origin stored the object.

**Fastly has no pending-request cancellation ABI.** On nine tested failure paths,
one pending request remains invocation-owned after guest-owned bodies/responses
have been released. The receipt preserves those nonzero counts. Pending work is
left for host invocation teardown; this proof does not establish remote write
cancellation, physical host cleanup latency or host memory reclamation. A host
trap cannot run guest cleanup. The disconnect cases prove fencing and fresh
invocation isolation, not post-trap cleanup code execution.

No source read or output write is allowed to resume after the tested terminal
boundary. A remote write may still complete. Applications need an explicit
reconciliation policy for `unknown`, and UPLOAD-04 must measure real provider
teardown and capacity before release qualification.

## Evidence and replay

[evidence.json](./evidence.json) pins the baseline commit/tree, working-tree state,
every UPLOAD-03 source hash, compiled artifacts, individual outcomes and resource
counts. It contains 104 passing current-path cases and a separately labelled
40-case historical run with exactly three expected failures. These are local
workspace/injected-host experiments, not installed-package or live-provider proof.
Node Native and Fastly still use the explicitly labelled `putText` compiler
scaffold from UPLOAD-02. Public upload source admission/lowering remains open.

```sh
node wasm/test/s3/upload-03/run.cjs /tmp/upload03-new-attempt.json
node wasm/scripts/run-wasm-tests.cjs --task s3-read-contract --task s3-write-contract --task fastly-incoming-body-forwarding --report /tmp/upload03-new-baseline.json
```

The runner isolates overlays in subprocesses, records progressive status, rejects
incomplete case coverage and refuses to overwrite earlier attempts. The historical
failure replay is required; passing it means reproducing the expected failures.
No real credentials or external writes are used. The Node transport is loopback
HTTP; Fastly runs the existing injected ABI. TLS, Viceroy, deployed Compute and
origin cancellation behavior are not newly qualified here. UPLOAD-01's live early
rejection limitation remains in force.

[baseline-evidence.json](./baseline-evidence.json) completed the three selected
S3/forwarding regressions. Maintainer, generated documentation and documentation-
release checks passed. Scope is `evidence-only`; broad profiles remain CI-owned.
[development-attempts.json](./development-attempts.json) retains development failure
results, including an ineffective first cleanup change and a corrected test
expectation: this S3 scaffold uses the existing 504 request-budget response,
whereas the separate forwarding fixture may trap on expiry. The final source-pinned
replay is authoritative for this experiment.

UPLOAD-04 should use these corrected research paths for increasing payload and
concurrency, slow-client/origin pressure, host/guest memory, installed artifact
identity and real-provider teardown. Public API/compiler integration must be
explicitly implemented before an installed upload-support claim can pass. No
shared scheduler redesign was needed for the qualified cases.
