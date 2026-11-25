# UPLOAD-02 — bounded transfer and ownership prototype

The transfer experiment passes on Node JavaScript, Node Native and emitted
Fastly Native. It supports continuing to UPLOAD-03 failure qualification. It
does **not** admit a public upload API, change supported `s3.putText` semantics,
or establish RC1 readiness. All changes are confined to this research directory.
The candidate policy remains [UPLOAD-00](../upload-00/README.md).

## What is actually integrated

| Target | Real owners exercised | Research substitution / limit |
| --- | --- | --- |
| Node JavaScript | Existing request ownership, effect scheduler, package context, bounded Node body pump, S3 signing and response metadata validation | In-memory package bridge adds an exclusive synchronous claim before a nonparallel experimental effect. The effect payload contains only binding/key; the body marker never crosses generic cloning. A research HTTP PUT adapter supplies transport. |
| Node Native | Actual compiled Wasm authorization, dynamic key and result continuation; existing ownership and Node pump | An ordinary `putText` plan is an explicit compiler scaffold. The research provider adapter substitutes incoming-body transfer. Public upload source admission/lowering is **not** exercised. |
| Fastly Native | Actual emitted Wasm, secret store/SigV4, fixed binding, typed result continuation, streaming hostcalls and partial writes | Only the emitted S3-owned contribution is adapted in memory. The shared resolver and invocation driver are asserted byte-identical to baseline generation. Execution uses the existing injected Fastly ABI, not deployed Compute or Viceroy. |

`scaffold.cjs` deliberately contains `putText(..., '')`. Its experimental
substitution must never be used as an application implementation. Native
experiments admit exactly one ungrouped S3 site. Generic streams and shared
scheduler ownership changes were unnecessary for this prototype; proving the
future package operation's compiler admission is still required.

## Evidence

[evidence.json](./evidence.json) records the baseline commit/tree, dirty checkout,
SHA-256 of every probe source, generated contribution/Wasm hashes and all cases.
Its 34 cases passed (17 Node JavaScript, 6 Node Native, 11 Fastly Native).

- Exact binary transfer at 0, 1, 16,385 and 1,048,576 bytes on all three targets.
  A runtime Unicode/space/percent key is signed under fixed bucket/host authority.
  An independent verifier checks SigV4 at the Node wire and Fastly hostcall boundary.
- Authorization precedes body consumption. Missing/duplicate length and cap
  overflow reject without reading/dispatching. Node also probes invalid keys,
  conflicting framing and a credential deadline.
- Node JavaScript rejects duplicate/foreign claims and structured-body conflicts
  with the ownership error, rejects object/collection parallel use, and rejects
  a stale context after completion. These are **not** Native compiler negatives.
- Node continuation waits for complete acknowledgement and returns measured byte
  length with no payload digest claim. Both Native continuations consume status
  and measured byte length, not merely a transport completion notification.
- Node observes an origin prefix before source EOF. Its existing pump caps emitted
  chunks at 16 KiB and input backing storage at 64 KiB; it waits for each write
  callback before requesting the next chunk.
- Fastly uses 16 KiB payload scratch, separate 16 KiB header scratch and 96 bytes
  of I/O scratch (including the existing 20-byte send-error detail). Partial writes
  use 997-byte fixture progress. A blocked writer prevents source reads. Guest
  memory is constant across the four successful payload sizes; see the receipt
  for its exact value. This is not a host-memory or total-RSS bound.
- Fastly successful transfers release owned outbound request/body/response
  handles. Early 403 is `not-stored`; early 200 is `unknown`; both consume zero
  source bytes. Writer timeout is `unknown`. Full failure/cleanup qualification
  remains UPLOAD-03, including invocation-scoped pending handles.

The Node oracle uses loopback HTTP while retaining a fixed HTTPS signing
authority. TLS is not modeled. Test origins retain at most 1 MiB for exact byte
comparison; this storage is outside the production pump. Fastly host queues,
throughput, increasing concurrency and slow real transports remain unmeasured.
No external credentials, live provider calls, retries or compensating deletes
are used. UPLOAD-01's live early-rejection limitation still applies: local early
response behavior does not prove the real origin rejects before consuming input.

## Reproduce and validation

From a dependency-restored checkout:

```sh
node wasm/test/s3/upload-02/run.cjs /tmp/upload02-new-attempt.json
node wasm/scripts/run-wasm-tests.cjs --task s3-read-contract --task s3-write-contract --task fastly-incoming-body-forwarding --report /tmp/upload02-new-baseline.json
```

The runner isolates each overlay in a subprocess, saves progressive receipts,
refuses to overwrite a previous attempt and requires terminal case coverage.
It pins reused owners by the baseline tree and refuses tracked product changes
outside this directory. Run it as focused development evidence; it is not added
to the release acceptance registry.

[baseline-evidence.json](./baseline-evidence.json) completed all three selected
regressions. `npm run maintainer:check`, `npm run docs:check` and
`node scripts/documentation-release.cjs` passed. Broad profiles remain CI-owned.

The final replay is attempt 3. [attempts.json](./attempts.json) preserves the two
failed umbrella attempts and their source identities: attempt 1 passed raw binding
configuration to a normalized generator seam; attempt 2 compared a raw contribution
to post-instrumentation source. Both failures were in added evidence assertions.
The final assertion compares the generated shared resolver and invocation driver
against baseline generation. Earlier individual development runs and a debug
reproduction are not release acceptance runs.

## Decision and remaining work

The bounded transfer shape is viable enough to proceed to UPLOAD-03. Retain the
1 MiB probe ceiling and known-length `UNSIGNED-PAYLOAD` policy; these are test
limits, not selected public limits. Keep public package admission/lowering as an
explicit implementation item. UPLOAD-03 must cover cancellation, stalls, resets,
length mismatch, malformed/late acknowledgements, no replay and no continuation
after cancellation. UPLOAD-04 must qualify installed artifacts, payload/concurrency
scaling, host memory and provider reality before UPLOAD-05 makes the release decision.
