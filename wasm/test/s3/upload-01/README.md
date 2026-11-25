# UPLOAD-01 — signing and origin compatibility probe

**Status: local proof passed; intended-origin acceptance blocked.** This is
the next experiment after [UPLOAD-00](../upload-00/README.md), based on `latest`
at `f840fb474c4f3e9886dd71382cec27e2bbee8f6c`. No Pulse upload API, compiler
admission, provider realization or RC1 inclusion is added.

Fastly Object Storage is the intended origin. The current workspace exposes
none of the five required target/credential values. The live runner exited 2
with `status: blocked` before making any external request. Existing production
documentation configuration identifies a different deployment purpose; neither
its bucket nor its protected credentials were selected implicitly.

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
base revision are retained. New research files were present; product source was
unchanged. The initial local run also passed; the final run adds live-target
containment checks and pins the vector input.

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

[live-evidence.json](./live-evidence.json) retains the actual blocked attempt:
no origin selection, credentials, requests, writes or cleanup were performed.
Neither Viceroy nor deployed Fastly Compute was used. No compatibility result
is inferred from the passing loopback fixture.

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

Use a bucket-scoped test credential permitting PUT, GET, HEAD and DELETE of the
generated objects. The user-selected experiment needs those writes and their
cleanup, not account administration, bucket creation, settings changes or
deployment permissions. Network access to the selected endpoint must be
available. Node uses its standard HTTP/TLS transport with certificate validation.

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

1. Supply the test target and scoped credentials, then run the unchanged live
   matrix and retain its terminal receipt, exact source hashes and cleanup.
2. If hashed control works but unsigned PUT fails, record that distinction and
   separately evaluate `aws-chunked` signing/integrity before implementation.
   Do not silently buffer, switch signing modes, or add multipart.
3. If the candidate is accepted by the origin and its integrity limits are
   acceptable, proceed to UPLOAD-02's actual Pulse ownership/transfer vertical.

**UPLOAD-01 remains open at the real-origin gate.** The prepared probe narrows
the remaining work; it does not establish a go decision for uploads or RC1.
