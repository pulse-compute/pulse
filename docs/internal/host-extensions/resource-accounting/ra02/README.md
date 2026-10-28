# RA-02 — admission, reservation and refund policy

Status: **internal candidate policy; review checkpoint after RA-01/02**.
Human direction: “Implement RA-02.” Base:
`7ab4741ea9c519bc01488d169441889288303b5c` (`hex-integration`, #527).
No exact named Entry Point covers this internal cross-owner policy investigation;
ordinary root/docs instructions apply. Production code and public contracts are
unchanged. RA-03 service implementation is a separate unit.

## Recommended first policy

Reserve the complete bounded operation at a known admission boundary. Use one
execution ledger shared by package and core effects, with:

1. A per-root work envelope, plus protected cleanup headroom.
2. A provider-owned execution reserve for terminal output and failure handling.
3. Separate dimensions for handle pools, live bytes, bookkeeping and exact
   exclusive binding identities. Never convert them to one universal score.
4. Atomic **resource** reservation for a sealed fresh parallel cohort; reject the
   cohort if any member cannot fit. Do not truncate, serialize, queue or retry it.
5. Capacity refunds based on qualified evidence for each dimension. Unknown
   disposal stays charged; ownership handoff does not refund anything.

This is conservative admission, not a promise that host allocations, network
work, cleanup or persistence will succeed. It guarantees that the modeled Pulse
ledger has not promised the same capacity twice. Shared host load, platform
quotas, fragmentation, external side effects and real teardown remain separate.

[policy.json](policy.json) records the candidate decisions and fixture proof
vocabulary. [model.cjs](model.cjs) is an offline accounting oracle, not a resource
service or scheduler. [check.cjs](check.cjs) pressures admission and refunds,
including two traces passed through the actual RA-01 ownership oracle.

## Units, limits and demand owners

| Dimension | Counts | Must not be inferred from it |
| --- | --- | --- |
| Handle pool capacity | Qualified logical units within a provider-declared namespace/pool | Host memory, network requests completed, or all platform handle types |
| Live byte capacity | Bounded backing storage and simultaneous copies, including pinned/in-flight bytes | Reference count, payload length alone, or RSS |
| Bookkeeping capacity | Resource and attempt records needed before a hostcall can produce outputs | Number of settled effects or an unlimited observation history |
| Exclusivity | Exact provider-resolved physical binding/domain; reserve once for one root | That differently named aliases identify different hardware |
| Cumulative effects | Existing admitted invocation count plus promises for future declared children | Live resources or concurrency |

The oracle instantiates three numeric dimensions (`handles`, `bytes`, `records`)
and exact exclusive names. Its handle unit is a **logical accounted claim**, not
a measured Fastly handle ceiling; real profiles may need several distinct pools.
Its fixture proof can return that logical unit after known consumption while
retaining bytes and records. That is not evidence of physical host reclamation.

Provider profiles own ceilings, units, scope and evidence provenance. Package
contracts supply bounded demand and dependencies; provider realization validates
and translates them. A project may narrow a supported ceiling, never override
an unqualified physical limit. Missing dimensions, unknown profiles, incompatible
versions, unbounded demand and integer overflow reject explicitly. A provider may
select an explicitly labeled policy cap where no physical limit is measured;
it must not relabel that cap as the host's actual limit.

No numeric production defaults are selected here. Sensible provider profiles and
derived per-operation bounds should carry normal usage. Application authors
continue choosing semantic bounds such as collection `max` and structured body
size; they do not tune internal child slots or per-phase handle counters.
Diagnostics must distinguish a policy ceiling, a host-qualified ceiling and an
unknown/unavailable guarantee. RA-09/10 are still needed to select defaults.

Coverage must be complete **for the declared accounting domain**. A mixed core or
package operation whose demand is unknown cannot bypass the ledger while the
execution still claims a global bound. It needs a validated profile or a proven
baseline allocation; otherwise reject that combination. Profile declarations are
trusted build inputs to validate, not a sandbox or proof of host-internal cost.
The oracle checks the coverage marker; it does not establish compiler/ABI coverage.

## Demand envelope and admission boundary

For each root, derive a finite work peak over its admitted paths, including
preparation, input/output overlap, live result aliases and transient copies.
Derive cleanup headroom separately, including possible late output acquisitions
and their records. The first policy reserves the **sum**. Cleanup may use any
unused work space too; ordinary work may not spend protected cleanup headroom.
The additive policy deliberately avoids a general optimizer for mutually exclusive
phases. Proven overlap reductions can be considered later with matched evidence.

For a cohort of actual members, reserve the sum of each member's envelope.
The effect builder's literal maximum bounds construction and static storage;
runtime reservation uses the actual sealed membership. An empty collection adds
no root resources or tickets. Static generated slots and execution infrastructure
still have their own baseline footprint. Demand must include core fetch and
terminal output; a package-local cache counter cannot stand in for the total.

The execution also reserves its provider baseline and terminal/failure lane
before dispatch. That lane cannot be borrowed by package work. It covers only
its declared bounded output strategy; it does not promise an arbitrarily large
error response or a second response after a downstream commit. If execution
reserves themselves cannot fit, reject before starting resource-bearing work.

Finite acquisition paths, bounded read/write/cleanup steps and one inherited
deadline are prerequisites of an admitted descriptor. A capacity reservation
alone does not bound CPU time or the number of repeated hostcalls. The oracle
checks resource arithmetic on finite supplied traces; RA-03 must validate these
control bounds and enforce them through the existing driver.

### Three authoring forms and the current source gap

| Form | Required resource boundary | Current evidence / integration obligation |
| --- | --- | --- |
| Direct await | Before preparation/acquisition for that root | Provider dispatch is the integration point; not implemented by RA-02 |
| Keyed `ctx.parallel` | Sealed fresh membership before any member host dispatch | Native group plan can identify membership; JS keyed grouping currently does not claim/release fresh roots as the builder does |
| Effect builder | Sealed actual membership before releasing captured roots | Existing capture/flush gate is a useful hook; add the shared admission decision there |

JavaScript `dispatch` counts a root synchronously and schedules ordinary work
through a microtask. Collection `add` claims fresh roots and flush releases them;
keyed `parallel` currently validates/collects them without that gate. **Atomic
resource admission is a proposed behavior requiring an explicit pre-dispatch
hook**, not a claim about existing JavaScript semantics. Microtask timing alone
is not an authority boundary. RA-03/07 must realize that hook without a second
scheduler, or reject the unsupported resource-bearing placement before dispatch.
Already-started effects cannot gain retroactive all-or-none admission or rollback.
Existing ordinary effects must not silently acquire a new lazy execution model.

Resource-admission failure dispatches none of that fresh cohort, preserves any
earlier independent work, and flows through existing deterministic error handling.
The driver invalidates the failed cohort's tickets/claims; the oracle's `deny`
event models that fence. A failed flush is not reusable. A new explicit operation
has a new identity and consumes its own existing effect admission. There is no
hidden retry or admission queue.

## Existing effect budget and child progress

Do not replace the cumulative invocation budget. Account for roots at their
existing capture/ticket boundary, including admissions whose host work is later
suppressed. Those counts remain spent if resource preflight fails. Reserve only
the **remaining** bounded child admissions; do not charge captured roots twice.

The arithmetic is:

`spent admissions + outstanding child promises + proposed child promises <= limit`

A declared child moves one promised unit to the existing spent counter when its
ticket is admitted. Skipped children release unused promises when no longer
possible at root completion. Spent counts never refund. Every other consumer of
that execution budget must respect the promises; otherwise the progress guarantee
is false. This includes core/local effects, not just the new package service.
The current 1,024 default is inherited policy, not a host-resource limit.

A cache hit may use two actual admissions while a miss uses four in the existing
fixed recipe. Reserving all four can reject a would-be hit near the budget limit.
That is an intentional conservative tradeoff: the admitted operation has capacity
for its declared miss path. There is no speculative hit-first execution followed
by a surprise inability to admit its loader.

The finite graph must not require progress from a sibling holding a conflicting
resource. Reject undeclared demand, cycles and unsupported nesting through the
existing plan/service validation owners. No readiness ordering, fairness or
reentrant lease-sharing protocol is introduced. The first milestone retains the
fixed-depth composition boundary; RA-02 is not a general child-plan validator.

## Ownership charges, refunds and retained results

Reservations and charges are different views of the same capacity. Acquiring a
resource converts reserved space into a charge; it does not add the charge again
to the execution total. Every resource needs bookkeeping before host entry. The
production service must preflight/register output capacity before a consuming
call can return resources; a post-hostcall bookkeeping failure is not safe
admission. Unexpected outputs or a violated descriptor require containment of
all observed resources and explicit failure, not dropping evidence or undoing
host work. RA-03 must implement that emergency path.

A proven refund during a live root restores space **inside that root's envelope**.
It is not lent to another root while the original operation may still need it.
No branch pruning or envelope shrinking occurs mid-operation in v0. Internal
child/result handoff retains the same charge, binding identity and root attribution.
Aliases use RA-01's single claim/pins; copies require separate byte charges.

| Ownership fact | Refund policy |
| --- | --- |
| Retained or busy | Keep charges; no capacity evidence |
| Unknown or failed terminal disposal quarantined as retained | Keep charges and exclusivity through execution lifetime; no in-execution reconciliation in v0 |
| Released | Refund only dimensions whose release condition and quiescence are qualified |
| Consumed | May refund a qualified logical handle unit; do not infer byte, record or physical-host capacity release |
| Transferred | Refund only capacity that demonstrably leaves the accounting domain; guest backing bytes can remain charged |
| Effect settled / retirement counter zero / invocation returned | No resource refund follows |

Side-effect acceptance is independent. An accepted failed commit is neither a
refund receipt nor a rollback opportunity. Failed disposal is not retried to
recover quota. Cleanup continues only for independent, safely owned resources.
The oracle's proof names are fixture provider mappings, not application assertions
or a production evidence format. Actual provider/version mappings need RA-10.

### Cleanup capacity must survive settlement

When a root's admitted children and effect are settled, release future child
promises and unnecessary work reservation. Surviving result/unresolved charges
remain in the execution ledger. Keep their bounded cleanup headroom as well:
a pending result can still need records/handles for a late response/body pair.
The retained tail cannot exceed the original root envelope or grow during finish.

The oracle bounds the retained total componentwise by the smaller of the original
envelope and `remaining charges + original cleanup allowance`. Within that bound,
late cleanup spends available headroom and a proven refund can make it available
again. Ordinary business work cannot use this tail. When no charged obligation or
exclusive claim remains, its tail reserve disappears. All of this remains under
the original execution deadline and finite cleanup-step bound; capacity does not
authorize background waiting after closure.

This can be conservative for permanently unresolved claims with no safe cleanup
left: v0 keeps their bounded headroom until execution end rather than adding a
separate proof for early retirement of cleanup obligations. That optimization is
not needed for correctness and should earn its complexity through measurement.
An execution ending or trapping produces no synthetic release receipt.

## Exclusivity and hardware pressure

Reserve a required exclusive binding for the root's whole declared operation.
A group with two conflicting roots rejects atomically; do not silently serialize
it. Children of the same root share that reservation only through explicit RA-01
ownership handoff and access rules, not duplicate leases or implicit reentrancy.
Actual lease acquisition can still fail at the host; the logical reservation is
not a hardware lock. Provider resolution must collapse aliases of one physical
binding before admission.

An unacquired lease promise releases when the root finishes. An acquired uncertain
lease remains charged and exclusive afterward. Cancellation does not prove a
buffer is no longer in use; release needs qualified quiescence and disposition.
A consumed handle may free one logical handle unit while backing bytes remain
unavailable. RA-04 must pressure the precise buffer/lease dependency and reuse
rules; this pass claims no ESP-IDF, DMA or board qualification.

## Quantified conservatism, not measured host limits

The numerical pressure fixture assigns each root work `(3 handles, 192 bytes,
4 records)`, cleanup `(2 handles, 64 bytes, 2 records)` and the execution exit
reserve `(2 handles, 64 bytes, 2 records)`. These are intentionally synthetic
small bounds, not derived production demand or physical Fastly limits.

| Actual members | Total handles reserved | Bytes reserved | Records reserved | Root + possible child admissions |
| --- | ---: | ---: | ---: | ---: |
| 0 | 2 | 64 | 2 | 0 |
| 1 | 7 | 320 | 8 | 4 |
| 2 | 12 | 576 | 14 | 8 |
| 8 | 42 | 2,112 | 50 | 32 |

Every exact boundary admits; one fewer handle rejects before member acquisition.
For eight members, work-only reservation would be 26 handles including exit;
protected cleanup raises it to 42. That **16-unit reservation cost** is real in
this policy model even if cleanup never acquires a handle. It is not measured
allocation overhead or a comparison against the old spike's incomplete host
census. The [receipt](receipt.json) retains the exact arithmetic fixtures.

Full envelopes also reserve miss-path demand on hits, retain result cleanup
headroom, and hold exclusive promises longer than phase-local scheduling would.
The benefit is simple, deterministic failure and a progress budget independent
of sibling timing. The cost is lower admissible concurrency/utilization. This is
a reviewable first policy, not evidence that those tradeoffs are optimal.

Rejected alternatives for the first milestone:

- Incremental global acquisition without reserved progress: can admit several
  roots that each later need capacity held by another.
- Waiting or automatic concurrency reduction: changes execution behavior and
  requires scheduling/ordering machinery.
- Refund on failure, consumption or settlement alone: contradicts RA-00/01.
- General branch-sensitive optimization: adds proof and implementation complexity
  before a bounded service has been measured.

## Evidence, review checkpoint and next work

The offline tests cover exact/insufficient cohort capacity, independent dimensions,
protected lanes, cumulative promises, skipped children, retained results, late
cleanup, exclusivity, unknown outcomes, qualified partial refunds, stale/repeated
claims and binding identity. Negative preflight checks leave accounting state
unchanged; the driver then separately fences rejected cohort members. The oracle
uses retained JavaScript history for inspection, not a bounded runtime layout.
The final selection passes **72/72 scenarios**, including **15 refund-dimension
combinations**, exact/one-below cohort boundaries, and two RA-01 integration traces.

```sh
node docs/internal/host-extensions/resource-accounting/ra02/check.cjs /tmp/hex-ra02-receipt.json
```

[receipt.json](receipt.json), [evidence-index.json](evidence-index.json),
[source-index.json](source-index.json) and [validation.json](validation.json)
record inputs, full-trace archive identity and validation. RA-00 Wasm and the
cache/composition receipts are inherited, not newly executed. No production
integration, complete regression, standard `pulse report` integration, new Wasm
size/speed result, JavaScript host parity or real-host qualification is claimed.

The planned RA-01/02 checkpoint is now concrete. Review these choices before
RA-03: additive cleanup reserve, atomic fresh-cohort admission, future child
promises against the existing budget, charge/tail retention after settlement,
quarantined uncertainty and whole-operation exclusive reservations.

Recommendation: carry this conservative policy into the minimal RA-03 service
prototype, with explicit measurements and rejection diagnostics. Treat the JS
keyed preflight hook, bounded record allocation/containment, exact demand-profile
validation and unused-path cost as acceptance obligations, not solved details.
RA-04 then tests whether lease/buffer pressure justifies tighter policy. No further
implementation, merge or release is authorized by this document.
