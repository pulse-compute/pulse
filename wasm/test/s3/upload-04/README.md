# UPLOAD-04 — capacity, artifacts and provider reality

**Qualification status: blocked.** The research work and decision evidence are
complete; installed public upload support and end-to-end Fastly streaming have
not passed. Do not turn these measurements into an RC1 upload promise or raise
the supported body limit. UPLOAD-05 can now decide whether to defer or fund the
remaining integration and deployed qualification.

## What ran

| Gate | Result | Evidence |
| --- | --- | --- |
| Node JavaScript and Native capacity | 28/28 cells passed | 64 KiB, 1/8/32 MiB × concurrency 1/8/16 on each target; slow-client and slow-origin cells on each target |
| Exact release pack and isolated install | Passed after two documentation generator fixes | 20 tarballs; 1,231 installed files compared byte-for-byte before and after the isolated consumer; package digests and npm lockfile hash retained |
| Installed public upload | **Blocked** | Installed `s3.putBody` is absent; TypeScript reports TS2339. Existing `putText` is present. No experimental overlay is loaded in this consumer |
| Viceroy wire framing/signature | Passed after research correction | Default framing removed signed Content-Length. Explicit framing mode preserves it; the independent local origin verifies SigV4 and exact bytes |
| Viceroy capacity | **Failed at 32 MiB × 16** | Eleven normal cells passed; the largest cell returned `unknown:timeout`. Two additional slow cells passed separately |
| Prefix before input EOF / declared-cap pre-read rejection | **Failed in Viceroy** | Known-length input is buffered before Wasm starts; partial-input probes cannot reach the guest admission/pump |
| Local timeout teardown | **Not qualified** | A stalled origin response remained open after the 10-second operation timeout plus a 2-second observation grace |
| Deployed Compute / intended S3 origin | **Not run** | No service was activated and no external object writes occurred |

## Capacity observations

These are one diagnostic batch per cell, not statistical load qualification.
At concurrency 16, p95 is the slowest of 16 requests (nearest-rank). The isolated
Node workers include the producer, runtime and loopback origin; Viceroy RSS is
sampled from a separate process. They are different measurement populations.

| Payload, concurrency 16 | Node JS p95 | Node Native p95 | Local Viceroy p95 |
| --- | ---: | ---: | ---: |
| 1 MiB | 382 ms | 457 ms | 234 ms |
| 8 MiB | 2,137 ms | 2,320 ms | 2,682 ms |
| 32 MiB | 7,778 ms | 7,330 ms | failed: operation timeout |

Node sampled peak RSS at 32 MiB × 16 was about 136 MiB (JavaScript) and 168 MiB
(Native), versus baseline processes around 53 MiB. These include generated input,
streaming hash verification, Node queues, Wasm instances and allocator/GC effects.
Sampling every 5 ms is not a hard memory bound; the sampling timer shares Node's
thread. Each Node cell runs in a fresh child process, with explicit GC before
baseline and after completion. Input and origin bytes are generated/hashed in
chunks rather than retained as whole objects.

Viceroy's sampled peak RSS at 32 MiB × 16 was 1,927,663,616 bytes (about 1.80 GiB).
Its cells share a server process, so baseline/after RSS include retained allocator
and engine memory. Do not infer a deployed Compute memory cost from that number.
Viceroy's 32 MiB × 8 cell completed at about 11.25 s client p95 despite a 10 s
operation budget: client ingress/queuing is outside the guest operation's start.
The Node 32 MiB cells also leave limited margin within the operation deadline.

The experimental cap is 32 MiB, operation budget 10 s, request budget 15 s. The
existing 16 KiB guest/Node emission chunk and 64 KiB Node source-backing limits
remain. The cap increase exists only in the research overlays, not a public API
or product default. Keeping the previous 1 MiB candidate until real-provider
qualification is more defensible than selecting 32 MiB from these results.

## Provider findings

1. **Framing is part of signing.** The earlier injected host preserved an explicitly
   set Content-Length. Viceroy's default streaming send instead emitted chunked
   framing, invalidating the signature because Content-Length is signed. The
   research build now calls `fastly_http_req.framing_headers_mode_set(req, 1)`
   before dispatch and fails closed if the call fails. Header authority, size
   validation and exact-byte metering remain provider-owned. This is a new
   implementation prerequisite for a future product operation, not a product
   capability change in this PR.
2. **Local Viceroy is not a streaming ingress oracle for known-length input.**
   Pinned Viceroy 0.21.1 buffers a known-size body in `body_tee::tee` before handing
   it to Wasm. A partial body produces no origin prefix; destroying that input
   triggers Viceroy's known-size buffering error. The independent Node wire
   oracle and earlier injected ABI results cannot fill this provider gap.
3. **Guest completion is not remote cancellation.** The local stalled-ack case
   returns `unknown:timeout`, but its origin response remains open after the
   observation grace. The fixture then explicitly destroys its own outstanding
   responses so subsequent cases are isolated. That destruction is not counted
   as provider cleanup. A subsequent healthy request succeeds. Cancellation
   before Viceroy starts Wasm also recovers, but is not cancellation of an
   already-dispatched upload.

Primary source for the pinned local behavior:
[Viceroy body buffering](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/body_tee.rs#L68),
[pre-invocation tee](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/execute.rs#L449),
and [framing ABI](https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/adapter/src/fastly/core.rs#L54).
The Linux executable and release archive SHA-256 values are recorded in the
receipts; the archive digest matched the GitHub release asset metadata.

## Artifact boundaries and package fixes

Native still uses the explicit `putText` compiler scaffold from UPLOAD-02/03.
`build.cjs` emits a research Node artifact and Fastly Wasm. The latter is executed
as an actual Wasm file by Viceroy; no injected Fastly ABI is used for its wire
measurements. Node's prototype uses the existing runtime and bounded pump plus
an in-memory ceiling change. No production effect, package operation, compiler
admission, shared scheduler or provider configuration was added.

The real release pack initially failed on two existing installed-doc links:
`preview-scope.md` pointed outside the runtime's packed docs to `../API.md`, and
the CLI lifecycle guide targeted the repository README's `start-here` anchor
inside the different packaged CLI README. Their canonical copy generator now
relocates those links; generated copies were regenerated. No validation gate was
removed or weakened. The successful pack comes from clean source commit
`2aa4cb0df490c85a3bd14c1b591fc5aebc056566`; it contains product/doc bytes identical
to this experiment's product baseline. Later research files do not enter packages.
The workspace TypeScript build was run explicitly before `--skip-build` packing.
The build used restored workspace dependencies; this was not an offline or
clean-machine dependency-restoration proof. The separate npm consumer has no
workspace product imports or package symlinks, and the exact archives are verified.

## Receipts and reproduction

The `evidence/` directory retains Node capacity, normal/slow Viceroy capacity,
settlement, installed-package and baseline-regression reports. Historical failed
wire runs and build/pack attempts are retained separately. Artifact hashes pin
the tested Wasm and serialized Native program. These are development experiments,
not an immutable release-acceptance campaign: the harness evolved during diagnosis.
`source-manifest.json` records the final reproducible harness and product baseline;
it does not relabel earlier harness versions as exact-current-source acceptance.

```sh
node wasm/test/s3/upload-04/build.cjs /tmp/upload04-artifacts-new
node wasm/test/s3/upload-04/capacity.cjs /tmp/upload04-artifacts-new /tmp/upload04-node-new.json
node wasm/test/s3/upload-04/viceroy.cjs /tmp/upload04-artifacts-new/fastly.wasm /path/to/viceroy /tmp/upload04-wire-new.json
node wasm/test/s3/upload-04/viceroy.cjs /tmp/upload04-artifacts-new/fastly.wasm /path/to/viceroy /tmp/upload04-slow-new.json slow
node wasm/test/s3/upload-04/viceroy.cjs /tmp/upload04-artifacts-new/fastly.wasm /path/to/viceroy /tmp/upload04-settlement-new.json settlement
node wasm/test/s3/upload-04/installed.cjs /path/to/verified-release-pack /tmp/upload04-consumer-new /tmp/upload04-installed-new.json
```

Use fresh output paths. Capacity/Viceroy failures are saved with nonzero exit;
installed-probe exit 0 means its **negative admission assertion** passed, not
that upload support exists. Viceroy sweeps can consume around 2 GiB RSS in this
environment. Data is deterministic fake content; secrets are fixture strings;
all wire origins are loopback HTTP. No TLS, hosted throughput, production cost,
real S3 reconciliation or deployed teardown guarantee follows.

## Remaining gates for a go decision

- Implement the explicit public body-consumer operation and its compiler admission,
  then repeat installed consumer qualification without overlays or scaffold substitution.
- Deploy a bounded QA candidate with explicit framing and known artifact identities;
  measure origin prefix before client EOF, host memory, cancellation and pending
  cleanup on the actual Compute path. Existing UPLOAD-01 signing acceptance is
  separate and did not prove early rejection timing.
- Select payload/concurrency/deadline limits from that evidence and define how
  applications reconcile `unknown`. No hidden retry, rollback or compensating delete.

Until these pass, UPLOAD-04 remains blocked and uploading is not release-qualified.
