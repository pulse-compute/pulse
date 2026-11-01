# Host-extension adoption — priority and reuse audit

Date: 2026-10-28 (UTC). Classification: documentation and planning audit.
Inspected production base: `latest` at `534acd58fb8afaeb7cb33cf4cb03866698668816`.
Inspected P08 candidate: local `b4b5a5a655939327efe65e9cbf86476922b378d6`,
published `be2d58bceddf69c4a8d1f28c431a68d2b17175fe`, identical tree
`e8c7b1d665d61b08ade56a70d0dff9b0b6abd1c1`.
Research reference: `hex-integration` at
`ecc36468b5900a0de57a415379b85d12c5026f3f`.

Human direction: audit current state and upcoming work with package extension of
hosts as the top criterion. Reuse lifecycle, instrumentation and management so
each host/package does not rebuild them. Cache is a useful exercise; cache ABI
quirks and additional cache guarantees belong to a concrete package's work.
This correction supersedes the earlier execution priority and cache prerequisites
for the host-extension milestone. It does not declare an implementation complete,
change an executable contract, waive a failed test or authorize merge/publication.
Entry point: `documentation-current`; writes are internal adoption records only.

## Acceptance criteria

The milestone succeeds when an independently named trusted package can contribute
an operation to an explicitly selected host through versioned generic contracts,
using the ordinary authored compiler/build/pack path. The provider supplies ABI
bindings and qualified status/ownership facts. Pulse supplies the common
invocation machinery. Packages own operation semantics and resource-specific
cleanup. Different hosts may implement different subsets.

Every implementation ticket must answer these questions with source and evidence:

1. Can a new package/operation be added without a package-name switch, new global
   capability constant or bespoke compiler/provider dispatch branch?
2. Which existing discovery, admission, tickets, settlement, readiness, original
   deadline, closure and response-authority owners does it reuse? Any duplication
   must identify a concrete missing shared invariant before implementation.
3. Can lifecycle observation and management attach through shared contracts?
   Keep host representations and ABI outcomes in adapters. Optional HTTP,
   accounting and observers must not be mandatory for unrelated extensions.
4. Are owner, operation, target, protocol, selected implementation and declared/
   observed imports attributable through build/report/compare? Missing evidence
   remains unknown; build attribution does not establish runtime execution.
5. Does an outside-checkout packed consumer work through declared exports? Do
   absent, imported-unused and generic-only controls omit unselected machinery?
6. Do a second operation/package and unsupported-target controls prove reuse,
   while preserving existing responses, deadlines and primary errors?

Nonterminal operations must be explicitly supported or rejected. A terminal-only
contract may be delivered as a bounded first slice but cannot establish general
nonterminal or resource-owning extension support. Instrumentation belongs in the
shared design; broad accounting parity and cost work need not precede that slice.

## Current implementation

| Area | Evidence at the inspected candidate | Assessment |
| --- | --- | --- |
| Package discovery and carrier | `package-contract.js` normalizes owned effects and `realizationArtifacts`; `package-operation-seam.js` transports reachable trusted contributions. | Reuse. A carrier alone is not host-extension admission or execution. |
| Lifecycle contract | `handler/lifecycle-planner.js` validates ordered execution and optional HTTP bindings; `runtime-core-as/.../lifecycle-emitter.js` emits structural sites. | Shared foundation exists. Keep the semantic planner independent of ABI source and driver storage. |
| Two driver styles | Fastly `build/lifecycle.js` and Node `native-execution-lifecycle.js` bind the shared planner; P03/P09A/P10 record common conformance and installed-consumer work. | Reuse existing scheduling, tickets and closure. These internal service seams are explicitly not package contribution APIs. |
| Resource management | P04's shared Native ledger and P05 admission calculations are used by selected P07/P08 services. | Useful reusable facilities. They do not establish generic package attachment, total-memory bounds or parity on every target. |
| P08 cache | Package owns facade/lowering, but `canonical-provider.js` names cache capabilities and Fastly `native-platform-capabilities.js` hardcodes identity checks, kinds, begin/wait dispatch, imports, profiles and hooks. | A private cache adapter experiment, not proof of package-only host extension. Reuse of lifecycle is useful; provider specialization is the remaining architectural gap. |
| Package extension protocol | The research reference has `provider/host-extension.js`, operation selection, provider admission and import/signature auditing. The inspected adoption candidate does not contain that protocol owner. | P15 remains the central production adoption task. Adapt selected research; do not merge the branch wholesale. |
| Nonterminal observations | Open evidence PR #523 investigates immediate observations through existing invocation/continuation machinery; its description explicitly leaves a nonterminal service contract unresolved. | Reuse that evidence for P15's operation-form decision. It is neither a production service nor a reason to implement cache ABIs. |
| Instrumentation | Shared lifecycle observation points exist. Research HEX-04 attributes package contributions; RA-08 supplies observation research. | Production package attachment and attribution still need qualification. Do not require each provider/package to invent its own observer machinery. |
| Cache readiness finding | Viceroy's body readiness path can consume a stream error. Live probes showed readable bytes and EOF after abandon; the original forced-error oracle was overstrong. | Host/emulator/package evidence. No demonstrated defect in Pulse's generic extension mechanism and no established live-host blocker. |

Sources above are repository-root-relative: contracts live under
`wasm/packages/contracts/src/`, compiler under `wasm/packages/compiler/src/`,
runtime emitter under `wasm/packages/runtime-core-as/src/compiler/`, and provider
files under `packages/provider-fastly/src/`. See the linked P02/P03/P09A/P10 and
P04/P05/P07 records for retained validation. This audit inspected source and
existing receipts; it did not rerun runtime or host qualification.

## Upcoming work disposition

The P identifiers remain stable. The table updates priority and acceptance; it
does not retrospectively undo completed accounting work or erase prior evidence.

| Unit | Disposition under the primary criterion |
| --- | --- |
| P01 | Apply this direction to the earlier three-milestone decision. Generic extension delivery is the immediate objective. |
| P02/P03/P09A | Retain and reuse the implemented foundation. Inspect any missing package binding at its actual owner; do not build another lifecycle or scheduler. |
| P04/P05/P07/P11A | Retain completed reusable management, profiles, fetch integration and baseline work. Further RA expansion is not an extension prerequisite. |
| P08 / PR #555 | Park the private cache product experiment. Preserve source, failed/inconclusive captures and error propagation. Cache completeness, length/integrity policy and host quirks are future package work. Do not call P08 the generic extension implementation or gate P15 on its cache oracle. |
| P15 policy, next | Define the minimum package/provider contract, supported operation forms, optional lifecycle/management services, trust and experimental exposure. Reconcile research terminal-only support with the broader goal; reject unimplemented forms explicitly. No cache-product decision is needed. |
| P15 implementation, next | Adapt operation-owned contribution/admission/import auditing to the current foundation. Connect selected contributions to existing lifecycle/management and instrumentation owners without package-specific provider switches. Prove a separately named package. |
| P12A | Carry package/operation/contribution/policy provenance through current report/compare and packed consumers. Include instrumentation selection and coverage appropriate to the admitted slice; historical absence stays unknown. |
| P16 | Prove Router terminal placement and ordinary sibling routes through the same extension contract. Keep handoff-specific semantics in the package/adapter; no second response lifecycle. |
| P10 | Qualify the actual admitted extension placements and lifecycle reuse. Include negative admission and a second-operation/package control. Do not substitute a complete cache product matrix for this task. |
| P13 | Separate mechanism conformance from operation-specific host qualification. A host defect blocks the affected operation/target claim only. Qualify actual handoffs where claimed; cache quirks do not gate unrelated extensions. |
| P14 | Review one immutable extension candidate, complete selected regressions, maintained fixtures, packed closure and unused-path evidence. Preserve independent review and release authority. |
| P06 | Defer cache → fetch → insert composition. Revisit generic compiler composition only when a selected extension needs it; do not invent a package callback scheduler. |
| P09B | Defer broad JavaScript RA parity. Unsupported extension targets still require clear rejection in the immediate slice. |
| P11B | Defer broad RA cost qualification. Keep unused-extension overhead checks in immediate acceptance. Measure additional shared machinery when selected; no cache benchmark gate. |
| P12B | Keep bounded resource observations/reporting as a follow-up. Design P15 to reuse shared instrumentation and preserve coverage distinctions; do not postpone all extensibility instrumentation to this unit. |

Recommended order: P15 policy → bounded P15 implementation → P12A/P16 as
applicable → extension-specific P10/P13 → P14. Cache, composed caching and broad
RA parity/cost/report adoption remain separately scoped work.

## GitHub ticket reconciliation

Open issues #508–#512 still describe the historical `hex-integration` passes.
The pinned research contains HEX-02/03/04 implementations and evidence, so their
old unchecked lists and “not started” prose are not reliable production progress.
Keep that history, annotate the adoption direction, and use P15/P16/P12A and
milestone qualification to track production work targeting `latest`.

| Ticket | Audit action / production acceptance |
| --- | --- |
| #508 tracker | State package host extension and shared lifecycle/management/instrumentation as the primary objective; point to the adoption sequence. |
| #509 HEX-01 | Preserve the historical proof. Its production successor must work through current generic contribution and lifecycle owners; do not repeat the research spike as new product work. |
| #510 HEX-02 | Feed P15 selection/admission/import-policy adoption. Require independently named package proof and no per-package registry/constants/dispatch. |
| #511 HEX-03 | Feed P15/P16 shared terminal authority and second-operation qualification. Preserve host-specific ownership uncertainty; no cache dependency or replacement lifecycle. |
| #512 HEX-04 | Feed P12A/P10/P13/P14 installed-consumer, attribution, shared observation and exact-artifact qualification. Distinguish research completion from production adoption. |
| PR #523 | Input to the nonterminal contract decision, with investigation limits retained. Avoid repeating the spike or treating its isolated adapter as production adoption. |
| #516/#538 | Keep report freshness and evidence-capture defects separate. Reconcile a recurrence where it affects current evidence; passing retries do not resolve their causes. |
| #556 | Sequential instance reuse is a separate runtime ticket. State the tested invocation lifetime; do not make a new reuse guarantee implicitly. |

The P-series work units currently live in this adoption plan, not separate
GitHub issues. This audit does not create duplicate implementations or silently
close the historical HEX tickets.

## Review boundary and retained limits

The Viceroy finding is not currently a Pulse defect. A generic Pulse defect would
be, for example, duplicated scheduling, lost host-reported errors, incorrect
ownership wiring, unselected imports or package-specific admission required by
the shared extension mechanism. A host-specific semantic gap belongs to its
adapter/package and limits only the relevant support claim.

Cache checksums, framing, length validation, completion guarantees and additional
safety policies are possible package follow-ups. They are not required by this
workflow. Existing failed captures remain failed under their original assertions;
their interpretation and scope are corrected without relabeling them as passes.
PR #555 remains private/draft for disposition and review, not because a cache
host issue blocks the package extension milestone.
