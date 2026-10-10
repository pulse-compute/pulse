# PERF8-02: baseline comparison and variation

Human direction: implement PERF8-02 after PERF8-01. Class: evidence; scope:
evidence-only. No named Entry Point matches this test-owned tool; the ordinary
root/Wasm/docs chain applies. No product, dependency, compiler-default, CI,
threshold gate or public CLI changes.

## Compare

From the repository root, collect two clean [PERF8-01](../perf8-01/README.md)
campaigns to different output files, then run:

```bash
node wasm/test/performance/check-perf8-compare.cjs
node wasm/test/performance/perf8-compare.cjs before.json after.json > comparison.json
node wasm/test/performance/check-perf8-compare.cjs before.json after.json
```

The comparator is separate from the measured harness, so adding comparison logic
does not invalidate the PERF8-01 harness digest. The legacy PS-08 v1 comparator
is unchanged. Inputs must be terminal, successful v2 campaigns and reconcile
with their raw samples through PERF8-01 validation. The comparison additionally
requires environment, dependency, target and retained compiler identities.
Malformed, interrupted and incomplete inputs exit 1 without a comparison.

The JSON output is `pulse.performance-comparison.v2`. Exit 0 means a valid
comparison was produced, **not** a performance pass. Valid but incompatible
inputs produce `status: incompatible`, reasons, both identity envelopes and no
metric deltas, with exit 2. There is no force/ignore-compatibility switch.

Recorded Node versions/binary/options, OS, CPU/cgroup limits, dependencies,
protocol/harness, fixture, target, artifact kind and effective build settings
must match. Native build metadata is compared across every sample on both sides:
producer, context, stage names, compiler/toolchain versions, flags/completeness,
optimization, timeouts and reuse/cache observations. Timings and artifact/capsule
IDs are excluded from this setup comparison. Source revisions may differ and
are retained explicitly. Unknown CPU identity or incomplete flags prevents
comparison. Matching recorded metadata does not prove equal host load, OS cache
state, or full installed dependency bytes. A `not-recorded` cache observation
stays an uncertainty, not evidence of a cache hit or miss.

## Read the evidence

Each cell remains its own fixture/target/artifact-kind comparison. The result
includes input file SHA-256 digests, source identities, environment, dependencies,
protocol, settings and effective build basis. Artifact hashes are retained with
within-run stability and across-run equality; a size delta is not a determinism
claim. Raw input reports remain the authority for individual observations.

Every metric retains both sample counts, minimum, maximum, mean, p50 and p95,
plus range and range as a percentage of median. Measured pairs expose median
absolute and percentage deltas and whether the observed ranges overlap. A zero
baseline has a null percentage, even when both sides are zero. A missing value
on either side prevents a delta and retains each side's availability/reason.
Compile-only runtime remains unavailable. CPU is microseconds, elapsed time is
milliseconds, memory/artifacts are bytes; they are never combined.

Warm request distributions contain 90 sequential requests across three workers.
The comparison also summarizes the **three worker medians** to reveal clustering;
it does not pretend there are 90 independent processes. Cold/build measurements
have three observations. Cleanup has only one. Nearest-rank p95 with three
observations is the maximum and is not a stable tail estimate. The five process
memory snapshot phases are summarized separately, including V8 heap, external
and array-buffer fields. These are not guest-only memory, per-request peaks or
leak evidence; no forced GC is performed.

Observed ranges are not confidence intervals. Overlap does not establish
no regression, and non-overlap does not establish significance or causation.
No regression threshold is established from this small local sample. Any future
gate needs repeated independent campaigns, controlled hardware/load, a noise
budget and an agreed practically meaningful change; unit tests of this
comparator are not that evidence.

## ARC production evidence: input outstanding

No usable ARC production request-log export was available in this implementation
session. Located ARC build/report captures are not production runtime logs and
are not substituted. Production analysis remains input-blocked; no production
latency, CPU, memory, throughput or regression conclusion is claimed.

Supply a sanitized export and a field dictionary describing units and sampling.
The export needs a capture window/timezone, deployment/version identity, host
and target, route template/operation, response/error outcome and request elapsed
time. Include CPU, memory, upstream/effect timing, cache/cold-start indicators,
region and payload/workload buckets only where actually recorded. Missing fields
stay unavailable. Exclude secrets, authorization headers, bodies, raw customer
identifiers and URL query strings; use route templates instead of raw URLs.

Analyze that evidence separately by deployment, operation and outcome, retaining
sample counts, missingness, sampling policy and time windows. Confirm measurement
boundaries before attributing network/upstream latency to Pulse. Compare like
traffic cohorts and report mix changes. Production observations must not be
pooled with the in-memory Node synthetic suite or treated as a controlled
before/after experiment. Real-log parsing should follow the supplied schema;
this ticket does not invent an exporter or infer units from field names.

## Development evidence

The manual comparison checks cover unchanged and changed sources, reordered
cells, exact deltas, variation, worker clustering, zero denominators, missing
measurements, compile-only cells, environment/harness/dependency/compiler drift,
malformed or interrupted inputs and CLI behavior. No CI task was added. The PR
records the clean-source repeat campaign and resulting observations. Complete
raw evidence remains outside the repository's package/release payload.
