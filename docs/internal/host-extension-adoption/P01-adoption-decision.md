# P01 — Scoped lifecycle, HEX and RA adoption decision

Status: **adoption direction recorded for review; production gates remain open**.
Date: 2026-10-25. Base: `latest` at
`5b087bff3e99be0eb88105a5d63dd8ae75ae5f98`, after merged [P00 #543](https://github.com/pulse-compute/pulse/pull/543).
Research reference: `ecc36468b5900a0de57a415379b85d12c5026f3f`.
Branch: `adoption/p01-decision`; PR target: `latest`.

Human direction: “Implement p01,” under the [P00 work plan](README.md). This is
the scoped RA-11 adoption review, implemented as an internal decision record.
It settles direction and gate ownership; it does not implement or qualify P02–P16.
No exact named Entry Point covers this cross-owner architecture review. The
root/docs instruction chain applies; writes are confined to this directory.
The future effect/continuation, provider/target and lowerer boundaries require
review, but their executable contracts are unchanged here. Human architecture
review, merge and release authority remain unchanged.

## Decision and evidence assessment

Proceed with three independently qualified increments: portable lifecycle,
usable experimental host extensions, and bounded resource accounting. Do not
merge `hex-integration`. Adapt selected implementations in focused PRs from
`latest`, preserving attribution and requalifying the resulting artifacts.
Lifecycle integration must not wait for a production RA kernel or cache package.
HEX adoption must not imply that the experimental RA code ships with it.

The research demonstrates a useful invariant: one driver can own settlement,
closure and response authority while services retain resource-specific ownership
and cleanup. Independent host observations and mutation checks support this
direction. The retained checkpoints do not establish general production support:

| Finding | Adoption consequence | Closure owner |
| --- | --- | --- |
| Shared execution/HTTP semantics exist, but Fastly still inserts hooks through text anchors. | Reuse the semantics; implement structural sites and a host-JavaScript realization before portability claims. | P02, P03, P09A |
| RA-07 expands a fixed child graph after canonical compilation. | Do not admit that composition in production until the compiler represents and validates its authority and budgets. | P06 |
| RA-09 isolates observer variants and kernel timings, not total incremental accounting cost. | Build an ownership-equivalent baseline before finalizing the kernel; measure the adopted implementation afterward. | P11A, P11B |
| RA profiles omit some application/allocator/host memory and reserve large body allowances. | Derive useful operation profiles; distinguish logical reservations from actual allocation and total memory. | P05 |
| RA-10 shows incomplete cache entries after abandon, consumption on failed calls and origin work after guest termination. | No rollback, retry, reclamation or cancellation guarantee follows from guest cleanup. Define cache failure behavior explicitly. | P08, P13 |
| HEX-04 has a successful six-case Pushpin/WebSocket replay. | Replay the adoption candidate; do not describe historical local acceptance as hosted or current-artifact qualification. | P13 |
| Research harnesses are imported by several research-branch production tests. | Port small maintained fixtures alongside the implementation; routine tests must not fetch the research/evidence repository. | Each implementation unit, checked by P14 |

The immutable references and their exact limits are indexed in
[P00's research table](README.md#pinned-research-references-and-limits).
No research or runtime suite was rerun by this decision-only pass.

## Decisions fixed for implementation planning

| Decision | Chosen direction |
| --- | --- |
| D1 — Delivery | Three milestone gates, each with its own candidate. No blanket branch merge or automatic release. |
| D2 — Semantic ownership | Shared lifecycle contracts and a deterministic dispatch planner; concrete execution and storage follow driver style. |
| D3 — Invocation identity | Extend the existing canonical invocation policy and conformance, rather than invent a competing ticket contract or scheduler. |
| D4 — HTTP capability | Optional semantic contract selected by capability; not mandatory for every provider or tied to a particular device. |
| D5 — Package authority | Reachable trusted package operations contribute admitted implementations. They do not register arbitrary driver hooks or gain authority from observed imports. |
| D6 — Runtime ownership | Services own resource-specific acquisition and cleanup; the existing driver owns scheduling, settlement and closure under the original deadline. |
| D7 — Cost/admission | Derive profiles and measure equivalent behavior before adopting the RA kernel. Keep handles, backing bytes, records, effects and cleanup distinct. |
| D8 — First HEX product slice | Fastly Native terminal handoffs in a bounded Router route, with ordinary sibling routes preserved. Public names/exposure remain P15's detailed decision. |
| D9 — First RA product slice | Core-fetch ownership/accounting, then Fastly Native cache and fixed depth-one cache → fetch → insert. No arbitrary callback or nested child graph. |
| D10 — Evidence independence | Research artifacts are reference inputs. Routine production build/test/pack runs use maintained source and fixtures without downloading historical evidence. |

These are implementation directions, not a statement that this PR has already
changed support or enacted the proposed contracts. P02 and P15 must bring their
precise schemas/API choices for review in their own bounded PRs.

## Contract ownership and invariants

The current [canonical invocation policy](../../../wasm/packages/contracts/src/handler/canonical-runtime.js)
already defines execution-owned single-use tickets and reusable static sites.
[Node's invocation owner](../../../wasm/packages/host-runtime/src/runtime/effect-invocations.js)
authenticates ticket object identity, consumes a ticket before guest delivery and
invalidates outstanding tickets at closure. The [Native host](../../../wasm/packages/host-runtime/src/runtime/canonical-native-host.js)
delivers through `pulse_set_effect_result`; Fastly implements its driver in
generated guest code. Shared semantics must accommodate both locations.

| Layer / source owner | Required responsibility and boundary |
| --- | --- |
| `wasm/packages/contracts` | Extend canonical invocation semantics; define execution points, optional HTTP authority, contribution ordering and binding metadata validation. Planner output is data, without AssemblyScript bodies, ABI types or provider-private globals. |
| `wasm/packages/runtime-core-as` | Reusable guest emission where genuinely shared. It must not become a mandatory driver for host-managed execution. |
| `wasm/packages/host-runtime` | Node Native host realization and conformance; preserve ticket consumption/closure and guest rejection behavior. |
| Provider packages | Concrete driver sites, role/type bindings, ABI status interpretation, handle namespaces and disposal rules. Fastly status observations never become universal core rules. |
| Capability/accounting implementations | Resource profiles and state, qualified ownership transitions and bounded cleanup. No independent event loop or competing admission authority. |
| Compiler and existing execution owners | Prove reachable operations and eventual bounded child graphs; enforce cumulative effects/deadlines, continuation authority and valid admission. |

P02 should use the reviewed six execution points (`effect.settle`,
`effect.deliver`, `effect.result`, `invocation.close`, `invocation.end`,
`invocation.closed`) and the optional HTTP points (`request.acquired`,
`response.error`, `response.authority`, `result.claim`) as its starting set.
Additional points require a demonstrated missing invariant and explicit review.
The planner must validate unique owner/order constraints, deterministic ordering,
semantic parameter roles and authority precedence without concrete source matching.
P03 chooses explicit emission sites; P09A chooses host-JavaScript call boundaries.

The shared conformance contract must enforce:

- Authenticate execution, site and active ticket before consuming settlement;
  reject forged, foreign, stale, duplicate and closed results without delivery.
- Once consumed, a rejected or trapped delivery cannot reopen the ticket. Preserve
  accepted-failure versus business-success distinctions and the primary error.
- Around notifications reverse on normal return, including rejected delivery;
  guest traps do not promise after/exit notifications. Host-owned cleanup may have
  stronger qualified behavior, but must not be advertised as a guest finalizer.
- Close invalidates delivery authority before cleanup that requires closed
  invocation state. Repeated cleanup does not dispose the same known resource twice.
- HTTP authority is fenced before dispatch and never reopened by an uncertain
  outcome. Transfer/local completion requires provider-qualified evidence; neither
  proves client delivery, host quiescence or physical reclamation.
- Cleanup consumes protected capacity and the original remaining deadline. It does
  not renew time, retry unknown disposal or drain pending work without a bound.
- Unsupported bindings/versions and unexpected imports fail closed. Audit the
  whole module against the declared provider baseline plus selected contributions;
  do not reject legitimate baseline non-function imports merely because contributed
  imports use a function-only contract.
- Include no unselected accounting/observer machinery or host imports. Compare
  absent, imported-unused and generic-only artifacts against matched controls;
  report embedded identity differences honestly.

## Target and placement matrix

This is the **adoption acceptance matrix**, not today's support inventory. The
[release manifest](../../../release/pulse-release-manifest.json),
[current contracts](../../architecture/current-contracts.md) and executable
acceptance remain authoritative for existing behavior. P01 changes none of them.

| Increment | Fastly Native | Node Native | Node/Fastly JavaScript | Other providers / compile-only |
| --- | --- | --- | --- | --- |
| Lifecycle foundation | Positive structural driver and HTTP-authority qualification. | Positive host-JavaScript execution lifecycle qualification; HTTP cases where actually bound. | Existing supported behavior regresses against its current contract; this is not P09B RA parity. | No new provider claim; contract loading is not driver qualification. Compile-only is not host execution. |
| HEX handoffs | Intended initial experimental realization: Fanout and WebSocket passthrough. Each needs its own positive transport/host evidence. | Reject these host-specific operations; preserve generic package methods. | Reject recognized unsupported operations and guard dynamic facade use; preserve generic methods. | Require explicit compatible advertisement and realization; otherwise reject. Never silently fallback. |
| RA core fetch | First Native integration and derived profiles. | Preserve existing fetch semantics; qualify accounting here before claiming it for this target. | P09B requires positive semantic accounting tests for supported fetch operations. Synthetic charges do not prove physical stream bounds. | No target promise by inheritance. |
| RA cache/fixed composition | Initial positive cache/composition target after P06/P08/P13. | Not admitted unless an independently qualified cache realization is added. | No cache parity claim from rejection or mock-only tests. If the public operation is admitted here, require positive equivalent-semantic qualification before promotion. | Explicitly unsupported until a reviewed realization exists. |

The M2 surface is intentionally experimental, not silently stable. The existing
manifest has no generic experimental support tier; P15 must choose an explicit
exposure/compatibility mechanism and reconcile it with release policy. P01 does not
invent a tier or grant compatibility to every exported internal module.

| Placement | Initial adoption rule / required evidence |
| --- | --- |
| Existing ordinary routes, effects, forwarding and bounded collections | Preserve current admitted behavior. P10 must cover affected paths; do not narrow existing syntax merely to make accounting tests pass. A necessary compatibility change needs separate review. |
| Direct terminal handoff | Preserve the qualified terminal token, single-dispatch and no-later-response rules. Normal-response branches remain valid. |
| Router terminal route | P16's first slice: one terminal handoff on a selected route, with ordinary sibling routes. Routing itself grants no extra effect authority. Qualify normal/error/timeout outcomes and token confinement. |
| Effects or middleware before/after handoff | Outside the initial handoff slice; reject unsupported authored combinations explicitly. Logging or fetch around handoff is not implicitly enabled by Router admission. |
| Handoff through ctx.call, callbacks, parallel work or escaped results | Reject. Current ctx.call computations have no effect authority; lifecycle work does not widen that contract. |
| RA fixed composition | One direct parent or bounded static keyed cohort; depth one, at most the fixed lookup/fetch/insert children per parent, one shared root envelope and original deadline. Prove compiler-owned conditional paths; no general callback interpretation. |
| Mixed profiles, repeated sites, sequential cohorts, recovery and forwarding | P10 must qualify affected existing operations and explicitly classify new combinations before admission. Distinguish static site reuse from invocation identity; the fresh-instance research fixture is not proof of reuse. |
| Dynamic collections of new composed operations / nested composition | Deferred. Existing primitive collection support remains unchanged; no automatic admission from the width-32 research result. |

## RA policy and decisions deliberately left to their owners

Reservations must cover overlapping resource lifetimes, protected cleanup and
execution-exit capacity before host acquisition. An adapter observation may retire
a logical handle claim without refunding retained backing. Unknown outcomes retain
their claims and remain visible. Allocation/profile exclusions must be explicit;
the ledger is not a process-RSS or platform-capacity meter. Budget reconciliation
must remove duplicate enforcement where it is genuinely redundant without erasing
distinct value, byte, handle, record, effect or time constraints.

For cache, the conservative initial policy is error propagation on incomplete
body reads, with no automatic miss reinterpretation, loader retry or rollback
promise. Read close, writer completion and writer abandon remain distinct. P08
must define the public operation/failure contract and test incomplete entries;
P13 must verify the relevant actual-host behavior. Earlier successful writes are
not rolled back by sibling failure.

| Open detailed decision | Owner / deadline | Required resolution |
| --- | --- | --- |
| Lifecycle schema/version and planner interfaces | P02, before emitter implementation | Exact fields, deterministic ordering, provider binding validation and conformance cases; reuse the existing invocation policy. |
| Hook/contract packaging and compatibility | P02 for internal access; P15 before shipped HEX surface | Distinguish internal toolchain access from stable supported exports. Inspect actual packed files/types; no accidental API promise. |
| Handoff names, exposure, diagnostics and support status | P15 policy checkpoint before pipeline/public surface | Choose an explicit experimental mechanism; hiding declarations alone cannot hide the runtime object. Document version/error compatibility and unsupported-target behavior. |
| Resource dimensions, namespace/lifetime model and profile derivation | P05 before P04 | Derived envelopes including overlap; overflow/exhaustion rules; real namespaces and generations; inventory of unaccounted memory. |
| Accounting cost acceptance thresholds | P11A before finalizing P04 | Equivalent ownership/failure baseline, realistic payloads, widths 1/8/16/32 and explicit metrics. No preset width-8 cutoff or claim that inconclusive observer deltas prove zero cost. |
| Cache facade, detailed incomplete-entry policy and admitted target list | P08 before public cache admission | Review semantics and provider realization; preserve the conservative no-retry/no-rollback policy unless separate evidence supports a deliberate change. |
| Canonical child representation and failure delivery | P06 before composed admission | Compiler proof, identity/provenance, shared envelopes, child/effect budgets and deadline continuity. No patched experimental graph. |
| Host outcome profile and hosted acceptance | P13 before corresponding support claim | Bind observations to provider/engine/operation and exact artifacts; leave unqualified outcomes conservative. |

## Qualification gates and stopping rules

| Gate | Required evidence on the adoption candidate | What may proceed afterward |
| --- | --- | --- |
| Foundation — P02/P03/P09A, applicable P10/P13, P14 | Common positive/negative traces on Fastly guest and Node host styles; explicit sites; ordinary error/timeout/forwarding regressions; version/binding rejection; unused baselines; packed internal consumers without Fastly/research coupling. | Review foundation adoption independently of HEX and RA. |
| Usable HEX — P15/P16/P12A, P10/P13/P14 | Independently named package through trusted discovery; deterministic ownership/admission; full import/signature audit; Router and unsupported-placement matrix; exported surface check; retained report attribution; source-free outside-checkout package acceptance; current-artifact Pushpin/WebSocket transport. | Review experimental HEX adoption for precisely documented targets and placements. |
| Bounded RA — P05/P11A → P04/P07/P08/P06, P09B/P10/P11B/P12B/P13/P14 | Pre-dispatch shortages acquire nothing; overlap/cleanup/unknown claims remain accounted; compiler-owned children; positive target parity where admitted; realistic memory/cost results; cache failures; complete/incomplete report coverage; unused machinery absent. | Review the bounded RA product slice; no universal resource or compatibility claim. |

Local engine evidence and hosted Fastly evidence are separate lanes. A locally
qualified change can be reviewed as internal development without representing
hosted support as complete. P13 must provide separately authorized hosted evidence
for the handoff/cache support being claimed; this task does not deploy a service.

Each P14 records the immutable candidate/tree, selected checks and terminal
coverage, packed identities, actual engine versions and unresolved limitations.
Focused development passes are not a release seal. Retries remain visible; do not
waive hashes, freshness or completion checks. Issue #516 was still open at this
review; a recurrence must be reconciled against the candidate, not labelled fixed
because an isolated retry passed. A release seal/publication remains separate.

Stop the affected unit with a bounded prerequisite if it needs a second scheduler,
ambient package authority, renewed cleanup time, speculative disposal/refunds,
unproved Native child work, silent fallback or a broader placement/API than this
matrix. Do not hold unrelated foundation work behind deferred RA investigation.

Evidence-repository migration, history cleanup, all-ABI migration, arbitrary
callbacks, nested composition, new hardware providers and provider repository
extraction remain outside these adoption units. Minimal maintained test fixture
adaptation is included; historical evidence transfers are not.

## Handoff to P02

P01's deliverable is this reviewable decision record and its link in the work
plan. P02 can next prepare the shared lifecycle contract/planner and conformance
specification, using the existing canonical invocation policy as its authority.
Its stopping point is a bounded contract implementation with metadata tests and
packed access; concrete Fastly sites and the Node adapter belong to P03/P09A.
P02 must not expose handoff methods, install an RA kernel or migrate evidence.

Validation for P01 is documentation/maintenance synchronization and checking,
documentation-release validation, scope classification and whitespace validation.
Exact results belong in the PR. No public schema, runtime, manifest, generated
corpus or target support is changed by this decision record.
