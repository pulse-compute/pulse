# UPLOAD-LIVE-01 — deployed Fastly size and settlement qualification

This follow-on to UPLOAD-05 executes the research upload on deployed Fastly
Native at 8, 16 and 32 MiB, offered concurrency 1, 8 and 16, using the existing
10-second operation / 15-second request budgets. The user explicitly requested
the deployed QA qualification, including the necessary isolated service setup,
activation, bounded traffic and cleanup. No production service is modified.

## Results

**All nine requested size/concurrency cells passed, with exact readback of 75 objects.**
The additional 32 MiB × 16 batch also passed (16 more objects). Guest linear
memory remained **4,456,448 bytes (4.25 MiB)** across every successful upload,
including both maximum-size batches.

| Payload | Offered concurrency | Guest operation p50 | Guest operation p95 | Client p95 |
| --- | ---: | ---: | ---: | ---: |
| 8 MiB | 1 | 0.70 s | 0.70 s | 4.73 s |
| 8 MiB | 8 | 1.33 s | 1.48 s | 5.48 s |
| 8 MiB | 16 | 1.95 s | 2.70 s | 6.37 s |
| 16 MiB | 1 | 0.68 s | 0.68 s | 4.62 s |
| 16 MiB | 8 | 2.26 s | 2.67 s | 6.27 s |
| 16 MiB | 16 | 3.85 s | 5.05 s | 9.85 s |
| 32 MiB | 1 | 0.93 s | 0.93 s | 4.41 s |
| 32 MiB | 8 | 4.14 s | 4.27 s | 7.43 s |
| 32 MiB | 16 | 6.36 s | 8.84 s | 12.74 s |
| 32 MiB (repeat) | 16 | 6.47 s | 8.69 s | 12.00 s |

At concurrency 16, nearest-rank p95 is the slowest of 16 observations. These
small batches do not estimate a production tail distribution. The two 32 MiB × 16
maxima (8.84 s and 8.69 s) fit the 10 s operation budget but leave only about
1.2–1.3 s margin. **16 MiB is the more comfortable initial candidate at concurrency
16; 32 MiB is demonstrated, with a tighter deadline margin.** These are engineering
recommendations for a future implementation, not newly supported limits.

The 8 MiB paced-client transfer passed at 6.61 s guest operation time. Stalling
after 64 KiB returned `unknown:timeout` at 10.002 s with EOF still withheld;
all 64 KiB were read and accepted by the outbound body API, and both guest cleanup
calls succeeded. The incomplete key remained HEAD-404 through the recorded
15-second window. Client disconnect likewise left no observed object. Declaring
32 MiB + 1 rejected before any guest read/write; the healthy 8 MiB recovery request
then passed at 0.65 s guest operation time. This resolves the local Viceroy
pre-Wasm buffering concern for the observed deployed path, without asserting
that Object Storage independently observed the prefix before EOF.

The timeout, disconnect and size-rejection observations do not prove rollback
or physical host resource reclamation. In particular, a deliberately stalled
origin acknowledgement after full upload remains untested here.

All 99 recorded keys passed exact-key cleanup and a second HEAD-only absence
check beginning 30 seconds after cleanup completed. Before forced cleanup,
95 completed uploads existed and the four unsuccessful attempts were absent.
Cleanup began 57.2 seconds after deactivation. The owned S3 key was revoked;
the probe service and secret store were deleted. Existing services and objects
outside the random prefix were untouched.

The metric receipt accounts for 99 service requests (98 intended probe invocations
plus one routing-health GET); the initial no-app smoke did not execute this service.
Reported RAM accounting was 4.25 MiB per request throughout. Two backend errors
were reported in the fault window, with no nonzero memory/resource-limit errors
reported in the collected data. Nine metric-poll timeouts occurred after test
traffic completed; the receipt remains `completed-with-errors`. No continuous
idle-memory trace or absence of late host activity is inferred from those timeouts.


## What these measurements establish

- The actual deployed artifact performs known-length `UNSIGNED-PAYLOAD` PUTs over
  HTTPS to the selected Fastly Object Storage endpoint in `us-central-1`.
  Successful uploads receive complete bounded acknowledgements, then independent
  GET readback checks exact generated length and SHA-256. The signer still does
  not authenticate payload bytes; readback is experimental verification.
- `guestInitialBytes` / `guestFinalBytes` are Wasm linear-memory allocation,
  measured after authorization and at S3 settlement. They are not used heap or
  host RSS. Linear memory cannot shrink during an invocation. Instrumentation
  adds counters and a bounded result object; it does not buffer payloads.
- Fastly's real-time `compute_ram_used` and request/execution metrics are retained
  as one-second service aggregates with POP breakdown. Aggregate RAM is not a
  simultaneous resident-memory peak. Dividing reported RAM by reported request
  count is labelled per-request accounting, not physical host-buffer measurement.
- Guest operation time begins at S3 ownership reservation, before credential
  lookup/signing, and ends at result decoration. Client latency includes proxy,
  connection and network time. Cell wall time also includes preflight HEAD.
  Readback happens after upload timing and is not included in request latency.
- These are diagnostic batches from one proxy-connected generator and observed
  POPs, not a sustained multi-region capacity guarantee. Each concurrent task
  performs its own HEAD-404 preflight before POST; starts are not synchronized.
  Offered concurrency does not prove every guest was executing simultaneously.
  A single generator and shared uplink can constrain throughput and deadline fit.

The service/package version, domain and SHA-512 of the exact submitted archive
are verified against Fastly. The archive contains the locally hashed Wasm.
Public source admission remains absent: the Native plan deliberately uses the
prior `putText` scaffold with the research body-consumer substitution. This is
real deployed-provider evidence, **not installed public upload support**.

## Failure and cleanup interpretation

The paced 8 MiB request delays each 16 KiB producer chunk by 12 ms. The stalled
input sends 64 KiB of a declared 8 MiB body and withholds EOF until the response.
This separates guest streaming from Viceroy's pre-invocation buffering. Guest
written-byte counts mean acceptance by Fastly's outbound body API, not independently
observed prefix consumption at Object Storage.

The disconnect case destroys the client connection after the 64 KiB prefix.
The oversized-declaration case announces 32 MiB + 1, sends only a prefix and
withholds EOF. HEAD checks at approximately 0, 2 and 15 seconds after each
result record object visibility. Network latency can push the second check
past its nominal target; actual observation offsets are retained.

Successful close/abandon counters describe guest-owned handles. They do not count
pending-request reclamation by the host. The timeout result remains `unknown`;
HEAD-404 is an observation, not a rollback or final-absence guarantee. The
experiment does not manufacture a typed result after client cancellation.

The service is deactivated before exact-key cleanup. Only keys recorded after
HEAD-404 under this run's random prefix are eligible. The final cleanup receipt
records actual DELETE and HEAD responses; forced cleanup is never classified as
provider teardown. Temporary S3 credentials and owned service/store resources
are retired after the observations. The user's management token is not revoked.

Remaining limits: physical host transport-buffer RSS and cleanup latency are not
exposed by these metrics; no controlled origin was used to hold a full upload's
acknowledgement; no remote rollback, no-replay application reconciliation, public
compiler admission or exact installed upload consumer is newly qualified. The
UPLOAD-01 invalid-signature early-rejection question is separate from the
successful deployed pre-read size rejection here.

## Scope and reproduction

No single Entry Point covers this cross-owner evidence fixture. Root/wasm
instructions apply; product runtime, provider, compiler, public API and release
manifest stay unchanged. All substitutions occur in memory while compiling the
research artifact. The UPLOAD-03 cleanup/deadline fixes and UPLOAD-04 explicit
framing correction are preserved. The local artifact check uses an independent
wire signature verifier, exact bytes, auth-before-dispatch and telemetry checks.

The target JSON contains only endpoint, region, bucket and a fresh
`pulse-upload-live/<UUID>/` prefix. Credentials are supplied through a private
state file outside the checkout. `control.py bootstrap` creates a dedicated
service/store and bucket-scoped object key. Never commit that state or the API
key. `activate` explicitly uploads and activates the built artifact; running the
local checks does not deploy anything.

```sh
node wasm/test/s3/upload-live-01/build.cjs /private/target.json /tmp/new-upload-artifact
node wasm/test/s3/upload-live-01/local.cjs /tmp/new-upload-artifact /path/to/viceroy /tmp/new-local.json
python wasm/test/s3/upload-live-01/control.py bootstrap --key-file /private/api-key --state /private/new-state.json --target /private/target.json
python wasm/test/s3/upload-live-01/control.py activate --key-file /private/api-key --state /private/new-state.json --artifact /tmp/new-upload-artifact
# Wait for an unauthenticated POST to reach the expected 403 before live controls.
node wasm/test/s3/upload-live-01/metrics.cjs /private/new-state.json /private/api-key /tmp/new-metrics.json /tmp/new-metrics.stop
```

Run the metric collector separately while executing `run.cjs` with the state,
a fresh receipt path, and `smoke`, `capacity`, `faults`, then optionally
`repeat-max`. A failed capacity cell stops escalation; failed and partial
receipts must be retained. No upload is retried inside a case. Run `inspect`
before/after traffic with `--artifact` and a fresh `--out` receipt to verify
active version/domain/package identity. `deactivate` stops the owned service;
record at least a 45-second observation grace before `cleanup.cjs <state> <fresh-out> <receipts...>`.
Run `verify-absence.cjs <state> <cleanup-receipt> <fresh-out>` for a second
HEAD-only observation after at least 30 seconds. After cleanup observations,
create the collector's stop file, then run `retire --cleanup-receipt <completed-cleanup.json>`
to revoke the owned object key and delete the owned service/secret store.
All control actions require the explicit `--key-file` and `--state` paths.

`evidence/` retains the exact deployed package, reports and deployment identities;
`source-manifest.json` records hashes and development limitations. The failed
initial local integrations, rejected package format and pre-propagation hosted
control are retained separately. No failed result was rewritten into a pass.

Primary references:
[Fastly real-time metric definitions](https://www.fastly.com/documentation/reference/api/metrics-stats/realtime/),
[package API](https://www.fastly.com/documentation/reference/api/services/package/),
and [CLI package layout](https://github.com/fastly/cli/blob/d438503bb9fa60efea5774977d8af528740de747/pkg/commands/compute/pack.go).
