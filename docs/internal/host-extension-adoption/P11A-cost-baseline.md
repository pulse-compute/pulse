# P11A — Ownership-equivalent cost baseline

Status: **control and measurement recipe implemented; numeric budgets proposed**.
Date: 2026-10-26. Base: `latest` at
`2b6580c9af326f9a70197f4e4306760dcc702144` (P05 #548).
Branch: `adoption/p11a-cost-baseline`; PR target: `latest`.

Human direction: “Proceed,” following P05 and the recommendation to establish
P11A before the accounting core. No exact Entry Point covers this maintained
benchmark/control fixture. Root/Wasm and root/docs instructions apply. Writes
are limited to test/performance fixtures, registry/release evidence task mapping
and this internal adoption record/index. Classification: evidence / evidence-only.
No production contract, provider execution, public API or support tier changes.
Numeric cost thresholds below are proposals, not automatic gates or approval.

## What the control establishes

The [fixture](../../../wasm/test/performance/resource-baseline/ownership.as.ts)
is an accounting-free Native ownership control. Its builder uses the production
Fastly invocation ticket source and structural lifecycle emitter. It retains
identity checks, single-use settlement, result guards and cleanup after ticket
invalidation. Fixture-owned resource states record prepared, owned, fenced,
released and unknown outcomes; handles are qualified by two namespaces and zero
is valid in each. Cleanup attempts each known owned resource once under the
original remaining budget. It never retries an uncertain/trapped disposal or
reopens a ticket. Cleanup failure preserves the primary business error.

The control contains no P04 accounting counters, admission enforcement, observer
report data model or scheduler. Its fixed per-slot ownership metadata is **part
of the baseline**, not free space that an accounting candidate may remove to
look cheaper. P05 derives the fixture envelope outside timing: `width` handles,
`width × (B + 1)` backing bytes, `2 × width` resource/allocation-family records,
`width` cleanup steps and `width` effects. This calculation is not runtime
admission. The six i32/wasm32 array element banks use `24 × width` bytes:
five fixture arrays plus the existing ticket array. This excludes array headers,
scalars, emitted code, allocator state and linear-memory rounding.

Each invocation acquires one reader per root, reads one bounded binary payload,
consumes all bytes into a checked checksum, delivers through the production ticket
owner, invalidates tickets and closes known resources. A `B + 1` byte backing
allocation per root remains accessible after logical close. This prevents a cost
control from silently discarding retained payloads or refunding backing.

This is **a synthetic fixed-cohort ownership microbenchmark**, not the complete
Fastly driver, compiler-proven fetch/cache composition, HTTP authority, live
Fastly ABI behavior or Node host RA parity. The two host namespaces and outcomes
are injected assumptions. It uses bounded binary allocation, not P05's current
chunk/concatenate text reader; it does not measure or fix that reader. Repeated
site reuse, child graphs, actual cache lifetimes and real host disposal stay with
their product/qualification owners. Every benchmark invocation gets a fresh
instance; there is no instance-reuse qualification.

A separately compiled observed variant changes only the note function to an
explicit observer import. Semantic checks compare state and host traces after
removing observer events. The control has no observer import. Both variants use
identical payload/ownership/cleanup behavior and compiler options. Baseline
artifacts have no accounting variant disguised as a no-op implementation.

## Correctness qualification

The maintained `resource-ownership-cost` task compiles both variants at widths
1, 8, 16 and 32 and runs 72 cases. It covers payloads 1 byte/1 KiB/16 KiB/64 KiB;
foreign/stale/duplicate result denial before reads; failed acquisition; failed
read; unknown disposal; guest/host-call traps; expired cleanup; rejected delivery;
retained backing; closed-state guards; idempotent cleanup; and primary-error
preservation. An independent host rejects duplicate/foreign disposal and checks
that all tickets are invalid before cleanup. Traps during reads skip closure;
traps during disposal leave a fenced claim and do not authorize another attempt.

Three compiled mutations omit cleanup, weaken result authentication or overwrite
a primary error. Each must fail the semantic oracle. The mutation builder's first
attempt used an incorrect fixture anchor and failed before compilation; that
anchor was corrected, without weakening the control's assertions. Mutation
artifacts are never included in timing results.

These cases protect the control's scope; they do not grant a production accounting
claim. An eventual accounting-on candidate must pass the same oracle and its
broader admission/shortage matrix before performance is compared. The off control
cannot meaningfully pass accounting-pressure cases that require the missing
accounting mechanism; those are additional candidate-only correctness gates.

## Measurement boundaries

Run correctness through the registry:

```sh
node wasm/scripts/run-wasm-tests.cjs --task resource-ownership-cost --no-report
```

Run the standalone measurement only when the checkout is idle. Commit or stage
all changes first, and use a fresh absolute output directory outside the checkout:

```sh
node wasm/test/performance/resource-baseline/measure.cjs /tmp/pulse-p11a-fresh
node wasm/test/performance/resource-baseline/measure.cjs --validate /tmp/pulse-p11a-fresh/report.json
```

The measurement is deliberately not part of routine CI/release timing gates.
Its correctness task is registered once in Native/release coverage. No historical
research harness, receipt, archive or evidence-repository download is needed.
The local outputs are regenerated experiment artifacts, not new repository weight.

The campaign compiles eight artifacts, runs semantic parity first, then measures
12 cells: widths 1/8/16/32 × payloads 1/16/64 KiB. Each variant has five warmup
invocations and eleven samples of five fresh instances. Variant order alternates
per sample. Raw sample means, median, quartiles and range remain in the report;
negative observer deltas remain signed rather than being called zero overhead.
There are no statistical-confidence or hosted-latency claims from eleven samples.

| Quantity | Included | Excluded / interpretation |
| --- | --- | --- |
| Initialization | JS fixture-host construction and Wasm instantiation/initialization. | Compilation and network. Report separately from guest execution. |
| Execution | Guest acquisition/read/checksum/delivery/cleanup and synchronous host import work. | Host assertions, trace arrays, result inspection and report serialization. This is not isolated CPU time of a kernel. |
| Observer delta | Additional note import/counter on the observed artifact. | Full event capture/serialization and product report overhead; this is a minimal observer, not RA-08 reporting. |
| Payload backing | Exactly `width × (B + 1)` for this reader model. | Metadata, allocator headers and host buffers. No physical reclamation inference. |
| Ownership metadata | Declared `24 × width` array element bytes. | Accounting banks do not exist yet. P04/P11B must report their actual additional layout. |
| Guest memory | Linear-memory capacity after execution. | Live bytes, RSS and engine memory; pages need not be reclaimed. |
| Reporting | One separately timed JSON serialization of the finished report. | Disk IO, product reporting, or an observer-to-report pipeline. This diagnostic single measurement is not a cost gate. |

The independent host ownership assertions are disabled only inside timing, after
the same artifacts have passed semantic checks. Synthetic host bookkeeping and
payload filling remain identical in both variants. No forced GC or custom Node
flags are used; engine tiering/GC/host scheduling can still produce noise. Run
campaigns serially on a stable host and preserve outliers; do not cherry-pick a
retry. Cold instance setup remains distinct from warmed module execution.

Reports bind source base and staged Git tree (or clean committed tree), compiler
version/content digest, lockfile digest, Node/V8/CPU information, recipe, generated
source and Wasm hashes/imports/sizes. Unstaged or untracked changes reject at start
and source identity is rechecked at completion. The validator requires complete
cell/artifact coverage and verifies actual generated files against their hashes.
This remains development evidence, not a release seal or full dependency closure
attestation. Exact run identities/results belong in the PR.

`accountingOverhead` is **null**, with an explicit reason: no production P04
candidate exists. The ownership baseline's runtime is not the cost of accounting.
P05 static plan construction is also excluded and must be measured separately
when a real compiler/runtime producer uses it. There is no total-memory or host
resource limit claim.

## Engineering acceptance targets approved for P04

The owner approved these engineering targets for implementation and qualification
with “I'm with 2.” after review of the P04 policy and cost proposal. They are not
measured conclusions, accepted SLOs or timing-sensitive CI gates. They separate
fixed invocation overhead from per-root cost and allow a small absolute floor so
sub-microsecond controls do not create misleading ratios. P11B must qualify the
actual candidate; foundation promotion and merge/release remain separate decisions.

| Area | Approved review target | Basis / remaining qualification |
| --- | --- | --- |
| Ownership semantics | Same host work, payload allocation, result checks and failure/cleanup outcomes on/off; candidate additionally passes admission-pressure tests. | Mandatory correctness, not a performance tradeoff. |
| Unused feature | Zero added guest code/imports/banks on matched absent/imported-unused/generic-only controls; distinguish embedded identity bytes. | Existing adoption requirement; verify on production candidate, not this selected fixture. |
| Payload duplication | Zero additional payload backing solely for accounting. | Accounting should attach bounded metadata, not copy bodies. |
| Incremental execution | At most `5 + 2 × width` microseconds per invocation, excluding observer/report work, on the pinned local measurement recipe. | Proposed fixed + per-root allowance; P11B must confirm suitability on actual adopted operations and report noisy/inconclusive cases. |
| Additional bank storage | At most 128 bytes per reserved resource/allocation-family record plus 1 KiB invocation state. | Proposed bookkeeping ceiling, separately list alignment, headers, stacks and allocator overhead. Real layout remains P04. |
| Growth | Explain every width-dependent scan; aim for ≤2.5× incremental work from 16→32 once the delta is distinguishable from noise. | A superlinear scan needs redesign or explicit reviewed justification, not a width-8 cutoff. |
| Observation/reporting | Separate modes and budgets; never include observer cost in the accounting delta or claim it is zero from a noisy negative sample. | Numeric budgets remain with P12/P11B after the actual reporting implementation exists. |

The fixture baseline does not enforce these approved review targets. Time thresholds are not
part of correctness CI. Before P04 is finalized, resolve the bank layout and
baseline/candidate equivalence; before promotion, P11B measures real compiled
artifacts and P13 qualifies relevant hosts. Foundation P10/P13/P14 remains a
separate prerequisite for runtime integration. P11A does not bypass that gate.
