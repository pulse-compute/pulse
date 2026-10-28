# RA-03 — bounded accounting service prototype

Status: **internal executable prototype; no production integration**.
Native follow-up: [compiled fixed-profile ledger and generated-driver evidence](native/README.md).
This page records the original JavaScript unit; Native results are separate.

Base: `9084527` (`hex-integration`, merged RA-02 sweep #529).
Human direction: proceed with RA-03, including bounded storage, admission before
host dispatch, unexpected-output containment, finite cleanup and implementation
cost measurements. No exact named Entry Point covers this internal cross-owner
experiment; ordinary root/docs instructions apply. Change class: evidence;
scope: evidence-only. Production runtime/compiler/provider sources, public API,
package exports and the existing scheduler are unchanged.

## Result and stopping boundary

The [service](service.cjs) implements the RA-02 reservation/refund policy using
fixed-capacity typed-array banks. It has no growing history, root map, resource
map, timer, polling loop, queue or independent executor. The [provider hooks](provider-hooks.cjs)
reserve output records before entry, record qualified outcomes and preserve
unknown obligations. The [JavaScript bridge](javascript-bridge.cjs) injects
private hooks into an in-memory copy of the **real existing executor**, using
checked source anchors. This is an executable seam experiment, not a supported
runtime option or structural production hook.

**52 ledger cases and 23 executor/hook cases pass.** All 33 RA-02 sweep cases are
replayed from their saved full traces and compared after every event. Additional
checks cover generations, stale owners, transfer/refund dimensions, finite
storage and steps, protected physical cleanup slots, pending and late output,
exclusive conflicts, partial refunds, emergency overflow and shared cumulative
admission with existing local effects. The real executor is exercised at 8, 16
and 32 in keyed and collection forms, with both successful and rejected cohorts.

This establishes a bounded **JavaScript prototype** with a concrete provider
boundary. It does not implement a Native/AssemblyScript accounting backend,
modify a production executor, integrate actual fetch/cache disposition, or
establish Fastly/ESP32 teardown guarantees. RA-05/06/07 retain their production
integration obligations; RA-04 retains lease/in-flight-buffer pressure. RA-09
still owns matched target/application cost qualification. No adoption, merge,
release or numerical production default follows from this receipt.

## Service boundary

A trusted provider creates one ledger per execution with finite resource ceilings,
root/claim/child storage, qualified profile identities, an inherited deadline and
a monotonic clock. Profiles have an exact schema: separate work and cleanup
vectors, a bounded child-effect count, finite work/cleanup steps, a bounded binding
index and exclusive identities. Missing/unknown/extra fields, incompatible
versions, non-finite numbers, insufficient banks and impossible reserves reject.
The provider must explicitly resolve each descriptor to a profile; the hook has
no catch-all default resolver.

Profile validation checks structure and arithmetic, **not the truth of an ABI's
resource demand**. The fixture declares its demand; compiler derivation,
byte-copy/handle-pool coverage, actual provider evidence and graph validation are
not implemented here. General nested/cyclic child plans are not accepted by this
schema. They are not silently converted into ordinary profiles.

| Operation | Responsibility |
| --- | --- |
| `capture`, `admit`, `deny` | Spend existing root admission; atomically reserve fresh cohort resources and future child admissions; explicitly retire denied captures |
| `child`, `settleChild`, `local` | Authenticate bounded reusable child tickets; keep cumulative count spent; prevent a local producer consuming promised child capacity |
| `prepare`, `adopt`, `noOutput` | Register output charges and physical records before host entry; bind returned handles; refund absent output only with explicit provider proof |
| `handoff`, `beginAction`, `completeAction` | Keep root attribution while changing current actor; fence stale actors, duplicate completion, in-flight handoff and failed disposal retry |
| `observe`, `refund` | Accept trusted fixture/provider observations; refund only qualified dimensions; uncertainty does not refund |
| `stop`, `settleEffect`, `finish`, `end` | Stop new business work; distinguish effect settlement from pending resource completion and result retention; never infer teardown release |
| `contain` | Freeze new work, retain a finite emergency prefix and explicitly mark incomplete accounting when demand/count assumptions fail |

References contain execution identity, slot and generation. Reusing a retired
slot increments the generation. Cross-execution and stale references reject;
raw handles are private ledger data and omitted from snapshots. This is a trusted
provider API, not an unforgeable capability sandbox against its caller.
Owner numbers are bounded fixture actors scoped to a root; `handoff` changes the
actor without changing root/binding or returning capacity. The narrow action
fixture supports read/close/send. It does not replace the full RA-01 action,
borrow/pin, alias, receiver or hardware-access contract.

## Storage and cleanup protection

The fixture uses **2 × width root slots**, allowing one retained cohort and a
second captured cohort. It provides six physical claim records and three child
ticket slots per root, plus two execution-owned emergency records. These sizes
are experiment configuration, not suggested provider defaults.

The work lane can allocate only the physical work portion of each root's bank.
Cleanup can use its protected portion and unused work slots. This protection
matters even after a qualified *logical* record refund: a record carrying other
live charges or exclusive ownership still occupies a physical slot. Work cannot
use partial refunds to fill the physical cleanup bank. Exhaustion rejects before
host entry. Fully retired records recycle; 5,000 acquire/release cycles retain
one-record peak and unchanged backing storage.

The six typed-array banks are allocated at ledger construction. Immutable profile
metadata is also bounded. Returned tokens, vectors, argument lists, errors and
diagnostic snapshots are ordinary JavaScript allocations; this is **not an
allocation-free API**. The ledger retains no token/snapshot history. Callers and
the existing executor retain their own bounded-by-contract state; these results
do not prove that an arbitrary surrounding JavaScript program is bounded.

| Width | Fixed backing bytes | KiB | Miss cycle CPU µs | Full cleanup cycle CPU µs | Executor added CPU µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8 | 14,232 | 13.9 | 311 | 265 | 434 |
| 16 | 28,200 | 27.5 | 390 | 447 | 284 |
| 32 | 56,136 | 54.8 | 804 | 1086 | 639 |

CPU figures are medians for this local Node process, including ledger construction.
The executor column subtracts control/enabled medians for matched synthetic work;
it is not an application latency estimate. Full wall/CPU samples are in the receipt.

The backing-byte count is exact for these banks. Process heap deltas are separate
local GC estimates for batches of retained idle ledgers. Small typed arrays may
be stored in the V8 heap rather than the external ArrayBuffer counter; do not add
all counters as though they were disjoint measurements. Neither quantity includes
host resources, resource backing bytes, application results or peak transient
caller allocations. The original RA-02 modeled bytes were logical charges, not
ledger storage sizes.

## Admission without a new scheduler

The bridge claims keyed and collection membership synchronously, invokes one
whole-cohort resource hook, and releases the existing root gate only after it
passes. Direct effects use the same hook immediately before provider dispatch.
A resource-short cohort performs **zero member host dispatches** and retains
spent capture counts. The bridge rejects already-started keyed members instead
of claiming they were admitted atomically in retrospect.

The existing executor continues to own dispatch, Promises, signal races,
completion ordering and closure. Existing local effects charge the same ledger
count before their producer can run; reserved child promises cannot be spent by
an unrelated local producer. The prototype child-ticket API is exercised against
the oracle; real composed children are not wired into this JS fixture.

An absent/disabled bridge returns the exact production module and source, creates
no ledger and preserves the control's results. That proves **no current unused
production-path change**, not the eventual cost of an adopted structural hook.
There is no new Native/Wasm size result in this unit.

## Cancellation, failed disposal and containment

Effect settlement can precede a host result when cancellation wins the existing
signal race. `settleEffect` records settlement but defers ledger finish while
prepared outputs, active actions or child tickets remain. A late output still
binds to its preregistered slot; after deadline/end it is unresolved and charged.
Only once pending work is accounted for can the root shrink to its retained tail.
The executor cancellation error is preserved rather than replaced by an attempted
premature ledger finish.

Acquisition and action entry check the inherited deadline and finite per-root
work/cleanup step counts. Cancellation stops work but retains the cleanup lane;
deadline expiry blocks additional cleanup entry as well. Late observations may
still record reality. They do not grant another cleanup deadline, a wait loop,
retry, background task or synthetic release receipt. Failed disposal quarantines
the claim even if the reported disposition is retained.

A conforming call's maximum outputs have records before entry. A thrown call
without qualified no-output evidence leaves those registrations unresolved.
Unexpected outputs trigger a fixed emergency bank, stop business admission and
call the provider-owned containment/escalation hook once. Known normal outputs
remain represented too. Quarantined extras have unknown resource demand, so the
receipt sets `accountingComplete: false`; ordinary charge counters must no longer
be read as a complete resource census.

**No finite bank can promise to store an arbitrary number of outputs from a
provider that violates its own ABI maximum.** Emergency traversal/storage is
bounded. Overflow explicitly sets `coverageLost`; execution containment/host
teardown is required. The fixture verifies escalation, not real reclamation.
It never retries disposal, silently discards the overflow fact or reports cleanup
success. This is a concrete failure boundary for RA-05/06/10 to map onto hosts.

## Cost interpretation

The measurements include construction and complete synthetic hit/miss, cleanup,
unknown-disposal, retained-result and mixed lifecycles. A matched control uses the
same real JS executor, group width, synthetic host-call count and time results;
the enabled side includes ledger construction/hooks. Bridge source compilation
is outside the timed loop. The receipt retains all samples, warmups, repetitions,
process CPU time, wall time, Node version and source hashes.

Linear retained storage does **not** prove linear CPU cost. Several operations
scan fixed banks (including duplicate-handle checks); worst-case cohort work can
be quadratic in configured width. At these bounded widths the prototype measures
that cost explicitly. Wall samples are noisy on this shared environment; neither
median differences nor microbenchmarks establish application/host latency,
throughput, optimal concurrency, deployment thresholds or a universal overhead.
No performance gate is selected from these observations.

The first memory attempt reused a process across GC batches; deferred reclamation
made its external-buffer deltas misleading. Final memory samples each use a fresh
process. Earlier measurements and the initial hook test failure (the harness used
`adapter` instead of the actual `effectAdapter` option) are preserved as attempts.
They are not presented as final evidence.

## Evidence and reproduction

```sh
node docs/internal/host-extensions/resource-accounting/ra03/check.cjs /tmp/hex-ra03-check.json
node docs/internal/host-extensions/resource-accounting/ra03/check-hooks.cjs /tmp/hex-ra03-hooks.json
node docs/internal/host-extensions/resource-accounting/ra03/measure.cjs /tmp/hex-ra03-measure.json
```

- [Ledger checks](checks.json), [executor checks](hooks.json), and [measurements](measurements.json).
- [Evidence index](evidence-index.json) pins exact inputs, original/bridged executor
  source, final receipts and prior attempts in the retained archive.
- [Validation](validation.json) records completed repository checks and retries.

No full regression, compiled Native accounting service, production fetch/cache
integration, real-host cleanup, hardware timing, standard report/compare schema
or release qualification is claimed. The next unit should pressure exclusive
leases and in-flight buffers against this explicit boundary. Production adoption
must replace source-anchor injection with structural hooks and qualify the Native
implementation and unused-path cost independently.
