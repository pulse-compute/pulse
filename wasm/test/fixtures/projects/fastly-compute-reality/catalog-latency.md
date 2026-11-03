# Catalog latency evidence

This is an opt-in Fastly Native experiment, not a new portable timing API or a
production observability promise. Entry point: `provider-fastly`.

The internal `inspectFastlyCanonicalTarget` and platform compilation options
accept `latencyDiagnostics: true`. Selection requires an explicit request budget
and rejects package-owned emitters, fetch, streaming S3 bodies and terminal
handoffs. Ordinary builds generate exactly the original source. The candidate
manifest records `pulse.request-latency.v1`; reusing it without the same explicit
selection fails. No public configuration field, guest hostcall or dependency is
added. Existing deadline, ownership, acceptance and readback logic remains active.

## Measurement

The diagnostic build adds one `x-pulse-latency` response header, at most 4096 ASCII
bytes. It contains only numeric timing/counter data and fixed field names:

- `v`: format version, 1.
- `valid`: whether diagnostic clock samples remained valid and monotonic.
- `wallUs`: invocation entry through the response-header snapshot, in microseconds.
- `open`: started effects that did not settle before the snapshot. Early JWT or
  error responses can legitimately leave this nonzero; coverage is incomplete.
- `dropped`: completed operation rows omitted by the 2400-character row budget.
  Per-kind totals still include those completed operations.
- `totals`: `[kind, count, elapsedUs, waitUs, credentialUs, signingUs, bodyUs]`.
- `spans`: `[effectIndex, kind, startOffsetUs, elapsedUs, waitUs, credentialUs,
  signingUs, bodyUs]`. The build's `effect-map.json` maps indices to effect names.

Effect elapsed time runs from dispatch entry through resolution. S3 wait covers
the provider's header/body readiness waits; credential time covers store opening
and credential retrieval/decoding; signing covers the S3 signing function; body
processing includes response interpretation, validation, hashing and decoding,
with the measured readiness waits subtracted. KV wait covers readiness waits and
the request-budget wait helper. Other hostcall time remains inside effect totals.

These are wall durations, not CPU measurements or pure remote-service timings.
Operation intervals can overlap under parallel execution: never add them and
label the result request wall time. CPU and platform accounting must be measured
separately. The response snapshot excludes final handoff and delivery. Timing
instrumentation has overhead and does not prove which layer caused a delay.
Clock and header-append failures do not replace application outcomes. Header
serialization exceeding its bound drops the header rather than expanding it.

No keys, bodies, store names, endpoint URLs, credentials, tokens or caller-provided
text enter this header. Enabling it exposes numerical workload structure to the
client; select it deliberately for a diagnostic service/window.

## Consumer helpers

The adjacent `catalog-latency-build.mjs`, `catalog-latency-qualify.mjs` and
`catalog-latency-pack.mjs` take explicit Catalog/prepared/candidate paths. They
reuse the Catalog corpus, preserve immutable source/toolchain identities and
package only the exact tested bytes. Published installations remain unchanged.
The scripts do not deploy or activate a service.

`catalog-latency-client.py` runs at most 32 sequential GETs within 180 seconds,
using one curl process with connection reuse and no retries or redirects. An
explicit local token adapter supplies credentials through stdin. Evidence keeps
selected connection/first-byte/total timings, body digests and validated numeric
diagnostic headers; raw headers, bodies and tokens are discarded. A failed cohort
retains its partial report and is never silently retried.

`catalog-latency-analyze.py BASELINE.json DIAGNOSTIC.json EFFECT_MAP.json`
reproduces the read-cohort breakdown. It requires matching successful response
bodies, complete timing records and nonoverlapping operation intervals before
adding readiness waits as a fraction of server wall time. Parallel workloads
need a separate critical-path analysis.

Run the focused compiled check with:

```sh
node wasm/test/provider/assert-fastly-request-latency.cjs
```

It injects known KV, S3 header/body and secret delays, checks timeout and early
failure behavior, verifies secret exclusion, preserves totals after truncation,
and verifies overlapping parallel intervals. It is included in the existing
`fastly-native-platform-capabilities` test task. This local evidence does not
substitute for the separately recorded live Catalog sample.
