# UPLOAD-01 — signing and origin compatibility probe

**Status: live upload/readback accepted; early-rejection gate failed.** This is
the next experiment after [UPLOAD-00](../upload-00/README.md), based on `latest`
at `f840fb474c4f3e9886dd71382cec27e2bbee8f6c`. No Pulse upload API, compiler
admission, provider realization or RC1 inclusion is added.

The November 25 live probe reached Fastly Object Storage in `us-central-1`
using the user's isolated QA account and a newly created bucket-scoped
`read-write-objects` key. The bucket and regional endpoint were recovered from
that account's existing access-key metadata and configured service backend.
Only unique probe keys were written. The five valid uploads passed exact GET
readback, including known-length `UNSIGNED-PAYLOAD` at 1 MiB. The deliberately
invalid signature returned 403 but the producer had already generated and
submitted the complete 1 MiB body. The full matrix therefore **failed** its
early-rejection requirement; the acceptance checks were not weakened.

The evidence task has no single matching Entry Point. Writes are confined to
this directory; S3 protocol, provider, compiler, configuration, workflow and
release sources remain unchanged.

## What is ready

- [transport.cjs](./transport.cjs): bounded research HTTP/HTTPS transport reusing
  the existing S3 `createAuthorization` helper. Generates deterministic binary
  bytes in chunks of at most 16 KiB; waits for each write callback before
  producing another. Signed known Content-Length, content type, host, date and
  payload-mode metadata; no SDK-added trailers/checksums, retries or redirects.
- [local.cjs](./local.cjs): real loopback HTTP with an independent SigV4 verifier,
  an existing AWS known-answer vector, explicit server-observed prefix gating,
  exact GET readback, cap admission, malformed acknowledgement and deadline
  cases. Its bounded object storage is a test oracle, not a production pump.
- [run.cjs](./run.cjs): incremental receipt writer, strict live Fastly HTTPS
  endpoint selection, unique `pulse-upload-01/<UUID>/` prefix, HEAD-404 collision
  check, two signing modes, bounded readback and exact-key cleanup. The plan is
  saved before every attempted PUT; failed cleanup retains the affected keys
  and fails the run. It never lists or sweeps a bucket.

The hashed control computes a hash from the repeatable fixture in a separate
bounded pass before signing. This is a protocol control, not a solution for a
single-use incoming body. The unsigned candidate signs request metadata with
`UNSIGNED-PAYLOAD`; it does **not** authenticate payload bytes. Post-write exact
readback is experiment evidence, not a new application integrity guarantee.

AWS documents this distinction in
[header-based signing](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html).
Fastly's [AWS CLI configuration guidance](https://www.fastly.com/documentation/guides/platform/object-storage/aws-cli-for-fastly-object-storage/)
uses `request_checksum_calculation = when_required`. This runner sends no
SDK-generated checksum trailers; it does not assume that AWS's protocol
documentation establishes Fastly acceptance. Sources reviewed November 24, 2026.

## Retained observations

[local-evidence.json](./local-evidence.json) records 14 passing cases and 30
loopback requests on Node 24.22.3. Primary source/probe hashes and the inspected
base revision are retained. The replay used head
`d869c0c7377a110986cc5b2e0e2a73bbdfca115d` with the recorded research transport
and runner edits present; product source was unchanged. The initial local run
also passed. Source hashes identify the exact probe bytes independently of the
checkout's commit ID.

| Case | Observation |
| --- | --- |
| AWS known-answer signature | Existing signer matches the independently published expected signature. |
| Live target containment | Reject loopback HTTP in live mode, non-Fastly endpoint, embedded credentials and non-root endpoint paths. |
| Unsigned payload sizes | Exact bytes at 0, 1, 16,383, 16,384, 16,385 and 1,048,576 bytes; complete 200/empty acknowledgement; exact GET comparison and SHA-256 match. |
| Prefix before producer EOF | For the two multi-chunk cases, the producer withholds the remainder until the local server observes data. This is a causal gate, not a wall-clock inference. |
| Hashed control | Correct digest accepted; valid authorization with deliberately wrong payload digest rejected with 400 by the independent fixture. |
| Early rejection | Corrupted signature with Expect/Continue receives 403 before any payload generation. |
| Upper bound | 1 MiB + 1 rejected before dispatch. This is a probe limit, not a newly supported upload limit. |
| Malformed acknowledgement | Duplicate selected metadata rejected. |
| Deadline | Stalled response terminates at the selected transport deadline. |
| Cleanup | Successful fixture objects deleted and absence checked; no fixture objects remain. |

The client does not collect the complete upload or GET readback. The loopback
origin deliberately buffers at most 1 MiB per fixture object, outside client
transfer accounting. This run does not measure total RSS, TLS queues, host
memory, Fastly backpressure, concurrency or throughput. Transport deadlines
are prototype request deadlines; integration with Pulse's enclosing lifecycle
and credential/signing deadline belongs to UPLOAD-02/03.

[live-evidence.json](./live-evidence.json) retains the live matrix, using the
workspace's configured network proxy. The hashed 1 KiB control and unsigned
0/1/16,385/1,048,576-byte objects received complete 200 acknowledgements and
passed byte-for-byte GET comparison and SHA-256 checks. The 1 MiB producer
submitted 64 writes of at most 16 KiB without whole-object accumulation.

The invalid signature received 403 and left no object, but all 1 MiB had been
generated and submitted before the response arrived. This is a failure of the
selected client/route's early-rejection gate. It does not establish when Fastly
validated the signature or consumed bytes: intermediary buffering and response
timing are unobserved. The loopback's zero-generation rejection remains a
separate passing result. Neither Viceroy nor deployed Fastly Compute was used.

The live run made 30 request attempts. All six attempted-write keys were deleted
with 204 and then confirmed absent with HEAD 404, including the rejected key.
[credential-cleanup.json](./credential-cleanup.json) records revocation of the
new temporary bucket key (DELETE 204, subsequent lookup 404). Existing credentials
and the user-supplied management token were not revoked. Secret values were
removed from the execution workspace and are absent from retained evidence.

Attempt history is retained:

- [live-initial-blocked.json](./live-initial-blocked.json): original missing-input
  attempt, zero external requests.
- [live-direct-failed.json](./live-direct-failed.json): restored workspace's direct
  transport failed at the initial HEAD, before any PUT. A separate unsigned HEAD
  diagnostic returned `EAI_AGAIN`; the configured proxy route was reachable.
- [live-evidence.json](./live-evidence.json): explicit proxy run; no per-request
  retry, signing fallback, or hidden buffering was introduced to obtain a pass.

## Run and resume

```sh
node wasm/test/s3/upload-01/run.cjs --local /tmp/upload-01-local.json
node wasm/test/s3/upload-01/run.cjs --live /tmp/upload-01-live.json
```

Provide these values through the execution environment; do not put credentials
in source, command arguments, PRs or receipts:

| Variable | Purpose |
| --- | --- |
| `UPLOAD01_ENDPOINT` | Selected root HTTPS Fastly Object Storage regional origin; no path, credentials, query or port. |
| `UPLOAD01_BUCKET` | Authorized test bucket; no default or production-bucket inference. |
| `UPLOAD01_REGION` | Exact signing region for that endpoint. |
| `UPLOAD01_ACCESS_KEY_ID` | Test credential allowed to operate on the probe objects. |
| `UPLOAD01_SECRET_ACCESS_KEY` | Matching secret. |
| `UPLOAD01_SESSION_TOKEN` | Optional token, only when needed by the selected credentials. |
| `UPLOAD01_USE_ENV_PROXY` | Set to `1` to use the execution environment’s configured HTTP(S) proxy; default is direct. Requires Node 24.5+ or 22.21+. |

Use a bucket-scoped test credential permitting PUT, GET, HEAD and DELETE of the
generated objects. The user-selected experiment needs those writes and their
cleanup, not account administration, bucket creation, settings changes or
deployment permissions. Network access to the selected endpoint must be
available. Node uses its standard HTTP/TLS transport with certificate validation.
Proxy mode creates a dedicated Node agent per request with `proxyEnv: process.env`
and destroys it at settlement. Proxy addresses and credentials are not recorded.
The live receipt records the selected route and request-attempt count. Proxy
buffering is outside the producer accounting and is not a streaming guarantee.

The live matrix starts with a 1 KiB hashed control, then unsigned 0/1/16,385/1 MiB
objects and a deliberately invalid signature. Keys include Unicode, a space
and percent encoding. Each PUT has one attempt; its complete acknowledgement
must be 200 with an empty body and exact generated length. Successful objects
are fetched, compared byte-for-byte and hashed independently. The invalid
signature must receive 403 before producer EOF and leave no object. Cleanup
deletes only the generated keys confirmed absent before an attempted write,
then requires HEAD 404. No production key is selected or overwritten.

The first chunk is followed by a 40 ms producer pause in live mode. This makes
incremental client writes explicit, but does **not** prove when the remote
application consumes them. The receipt labels remote prefix consumption
unobservable; the local causal proof is separate. Stronger remote consumption
evidence would require origin instrumentation or a provider-specific observable.

The report is written incrementally to a caller-selected path. Keep it outside
the tracked evidence directory for a new attempt. On failure, preserve the
receipt: ambiguous writes may need cleanup. If the process is killed before
cleanup, inspect only its recorded test keys; never replace that with a bucket
sweep. Runtime errors are reduced to bounded codes, without logging raw origin
responses, request Authorization or credential values. Target and test keys are
intentional non-secret evidence.

Exit 0 means the selected mode's checks passed, exit 2 means live configuration
is missing, and exit 1 means a check/transport/cleanup failed. A local pass is
never live acceptance. A live matrix pass establishes only the recorded
endpoint/region/credential policy and tested byte sizes, not all S3 origins.

## Decision still outstanding

The signing/origin question is resolved for these sizes and this target:
known-length unsigned PUT is accepted without a precomputed payload digest.
Chunk signing is not required merely to achieve this observed acceptance;
payload integrity requirements remain a separate design decision.

The early-rejection gate is unresolved for the intended provider path. Do not
rely on `Expect: 100-continue` or signature failure to bound bytes produced.
The next useful evidence is UPLOAD-02's actual Pulse ownership/transfer vertical
with explicit size/deadline limits, followed by rejection/cancellation settlement
in UPLOAD-03. A provider-path probe must distinguish client generation, host
submission, and observable origin behavior; repeating this proxy run cannot
establish the missing timing guarantee.

**The retained live matrix is failed, not an upload or RC1 go decision.** The
successful transfer cases support continuing the evaluation with that limitation
explicit; no public API, Native support or release promise follows from them.
