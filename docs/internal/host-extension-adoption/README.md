# P00 — Lifecycle, HEX and resource-accounting adoption kickoff

Status: **planning baseline; no production adoption implemented**.
Date: 2026-10-25. Development base: `latest` at
`e30754019f03fa95a74ae72392382f44f2351927`. Research reference:
`hex-integration` at `ecc36468b5900a0de57a415379b85d12c5026f3f`.
This repository-only plan is not public or installed documentation.

Follow-up: [P01 adoption decision](P01-adoption-decision.md) records the milestone
scope, ownership, target/placement matrix, remaining detailed decisions and
qualification gates. It does not mark the later implementation units complete.
[P02 lifecycle contract and planner](P02-lifecycle-contract.md) records the shared
metadata implementation. [P03](P03-fastly-lifecycle.md) and
[P09A](P09A-node-lifecycle.md) record the guest and host driver integrations;
foundation qualification and promotion gates remain open.
[P05](P05-resource-profiles.md) supplies resource profile/admission calculations
and the allocation/budget inventory; runtime accounting is not installed. P11A
and foundation qualification still precede P04.

## Direction and stopping point

Human direction: “So we should probably work in an new branch targeting latest.
Implement p00.” The preceding review established selective adoption from the HEX
and RA investigations, with evidence-repository work explicitly outside this
session. No earlier P00 definition was found; this pass establishes the kickoff
and preserves P01–P16 as the subsequent work identifiers.

Branch: `adoption/p00-kickoff`, created directly from the development base above.
PR target: `latest`. P00 writes only this internal plan. No exact named Entry
Point covers this cross-owner planning pass; the root/docs instruction chain
applies. Change class: documentation; scope: inside-developer-preview. The future
architecture boundaries are identified below, not changed by this pass.

P00 completes when this plan is committed on the fresh branch, documentation and
maintenance validation is recorded in the PR, and the PR is available for review.
P01 is the next implementation request. This plan does not execute later units,
approve their detailed contracts, merge a branch, publish, deploy or change a
support tier. Model/effort entries below are planning recommendations, not agent
delegation instructions or GitHub assignees.

## Adoption strategy

`hex-integration` will not be merged into `latest`. New production PRs start from
the then-current `latest`, or explicitly stack on an identified adoption PR with
its dependency recorded. Preserve attribution to the pinned research source when
adapting implementation; qualification must apply to the new candidate bytes.
Research history supplies evidence and reference implementations, not production
ancestry or a blanket compatibility promise.

The three independently reviewable milestones are:

1. **Portable lifecycle foundation:** common semantics and conformance, explicit
   Fastly driver sites, and a minimal Node Native realization of the same contract.
   No RA kernel, cache package or handoff API is needed to finish this milestone.
2. **Usable experimental HEX:** owned package contributions through the existing
   discovery/effect pipeline, explicit surface policy, bounded Router terminal
   placement, report attribution and candidate-specific host qualification.
3. **Bounded RA:** production resource profiles and accounting, core fetch, cache
   and compiler-proven fixed composition, target parity and resource evidence.

Evidence migration, archive publication, branch/tag retirement, history rewriting
and repository-wide size cleanup are separate owner work. They are neither P00
deliverables nor prerequisites for foundation development. Adoption must keep
routine build/test/pack paths independent of the research tree and any evidence
repository. Minimal maintained regression harnesses belong in the test tree;
historical tarballs and generated research outputs are not copied into this plan.

## Architectural requirements for the adoption units

| Owner | Proposed responsibility |
| --- | --- |
| Shared contracts | Lifecycle points, invocation identity/settlement rules, rejection postconditions, deterministic contribution planning and optional HTTP authority semantics. No runtime scheduler or provider source. |
| Driver-style implementation | Guest AssemblyScript emission or host JavaScript adapter. Storage and execution locations may differ while satisfying the same semantic contract. |
| Provider | Concrete site bindings, ABI calls, handle namespaces, rejection actions and qualified consumption/disposal/transfer observations. |
| Capability service | Resource profiles, acquisitions, ownership transitions and resource-specific cleanup. |
| Existing execution driver | Scheduling, original deadlines, continuation delivery and invocation closure. |

One invocation contract does not require one storage implementation. A provider
selects HTTP semantics because it serves HTTP, not because of its hardware name.
P09A must pressure this separation with Node Native before portability is claimed.
Guest after/exit hooks run only on normal return; they are not trap finalizers.
HTTP response authority, resource ownership, client delivery and host quiescence
remain distinct facts. Unknown host outcomes never justify automatic retry,
speculative disposal, reopening response authority or unsupported refunds.

Preserve explicit provider selection and trusted package lowerer ownership.
Packages contribute bounded admitted implementations, not arbitrary driver hooks.
No new scheduler, silent Native-to-JavaScript fallback, publisher allowlist or
runtime self-registration is introduced. Admission remains operation-specific.
No arbitrary callbacks, nested composition, all-ABI migration, ESP32 driver or
Fastly provider repository extraction is included in these milestones.

Zero unused-feature inclusion remains an acceptance requirement: compare absent,
imported-unused and generic-only controls with their own matched baselines. Record
embedded identity differences separately from code/import growth. Do not claim
whole-Wasm identity where authored source identity necessarily differs.

## Work units and acceptance boundaries

Each unit ends with a bounded PR and completed focused validation. Broad checks
run at the milestone checkpoints; historical receipts or manually combined retries
do not substitute for a complete required candidate selection.

| Unit | Dependency / milestone | Deliverable and stopping condition | Recommended model / effort |
| --- | --- | --- | --- |
| [P01 — Adoption decision](P01-adoption-decision.md) | P00; all milestones | Record the scoped RA-11 adoption decision, ownership, support/placement matrix, open compatibility decisions and qualification requirements. Distinguish accepted direction from unresolved detailed contracts; no runtime changes. | Astra / High |
| [P02 — Lifecycle contract and planner](P02-lifecycle-contract.md) | P01; foundation | Adapt the six execution and optional HTTP semantics into the shared owner; define one invocation contract and ordered dispatch data with binding validation. Keep emitted source and host-specific rejection actions outside the semantic planner. | Astra / High |
| [P03 — Structural Fastly integration](P03-fastly-lifecycle.md) | P02; foundation | Emit lifecycle calls at explicit driver sites, preserving settlement authentication, rejected delivery, normal-return closure and response-authority precedence. Remove migrated anchor/pass-order dependence. Migrate forwarding as needed and reject unsupported combinations. Preserve unused paths. | Sol 6.1 / High |
| P04 — Production accounting core | P05 and P11A, foundation complete; RA | Implement bounded ledger storage under the appropriate runtime owners, generations, overflow/exhaustion handling, retained claims and protected cleanup. Select by reachability. Do not copy fixture banks or introduce a second scheduler. | Astra / High |
| [P05 — Profiles and admission](P05-resource-profiles.md) | P01, P02; RA design can begin early | Derive heterogeneous envelopes from selected operations, payload bounds and actual allocation strategy. Reserve overlapping lifetimes and cleanup before dispatch. Reconcile existing value/handle/effect budgets while preserving distinct dimensions. State excluded memory explicitly. | Astra / High |
| P06 — Compiler-owned composition | P04, P07, P08; RA | Validate fixed child graphs, parent ownership, conditional work, effect counts, result authentication and deadline continuity in the canonical plan. Remove post-compiler graph expansion and experimental export replacement. Reject unsupported nesting/callbacks. | Astra / High; split implementation and qualification |
| P07 — Core fetch accounting | P04, P05; RA | Structurally integrate acquisition, send/wait/poll, body allocation, alias retention, opaque transfer and cleanup. Reconcile existing enforcement; preserve primary failures and uncertainty. No new cancellation guarantee. | Astra / High |
| P08 — Cache contract and adapter | P05 for contract, P04 for implementation; RA | Decide incomplete-entry, read-failure, commit and abandon semantics before exposing a production package. Implement qualified read/write disposal and readiness rules. Never infer rollback or treat body-read error as a cache miss without a separate reviewed policy. | Astra / High |
| [P09A — Second-driver lifecycle](P09A-node-lifecycle.md) | P02; foundation, integrate with P03 | Bind the shared lifecycle to Node Native host JavaScript. Both driver styles pass common settlement, stale-result, rejected-delivery, closure and trap traces; apply HTTP authority cases only where that capability is selected. No claim of Node support for Fastly handoffs. | Astra / High |
| P09B — JavaScript RA parity | P04–P08; RA | Replace experimental executor injection with maintained integration. Prove whole-cohort pre-dispatch admission and semantic ownership/deadline parity for admitted operations; do not equate synthetic JS charges with physical stream memory. | Sol 6.1 / High |
| P10 — Application qualification | Matrix defined in P01; execute per milestone | Qualify admitted mixed effects, repeated sites, sequential groups, ctx.call, Router recovery, forwarding and partial-progress failure. Implement or explicitly reject each relevant placement. Foundation/HEX cases precede the RA matrix; no blanket syntax widening. | Sol 6.1 / High |
| P11A — Equivalent cost baseline | P05; before finalizing P04 | Establish an ownership-preserving accounting-free control, measurement boundaries and proposed cost budgets. Isolate accounting from observer/report overhead. Review thresholds before enforcing them; no unexplained width-8 cap. | Sol 6.1 / High |
| P11B — Production cost qualification | P04–P10 as applicable; RA | Measure actual adopted artifacts at widths 1/8/16/32 and representative payloads. Report execution, allocation, banks, observer, reporting and unused-path results separately. Optimize scans if accepted budgets require it; do not infer hosted latency from local kernel timing. | Sol 6.1 / High |
| P12A — HEX report attribution | P15 implementation; HEX | Carry selected operation/owner/contribution/import provenance into production report/compare, including retained and packed consumers. Historical missing attribution stays unknown. | Sol 6.1 / High |
| P12B — Resource report adoption | P05–P09B and production identities; RA | Integrate static envelopes plus optional bounded observations. Preserve redaction and separate final-record, aggregate and sampled-event coverage. Missing or incomplete evidence is not zero; no physical-reclamation claim. | Sol 6.1 / High |
| P13 — Host qualification | Relevant implementation complete; per milestone | Replay exact candidate artifacts through applicable pinned local engines and separately authorized hosted lanes. Qualify consumption/disposal and incomplete cache cases for the claimed support level. Preserve conservative behavior for unqualified outcomes. | Sol 6.1 / High |
| P14 — Promotion checkpoint | Applicable units complete; repeat per milestone | Verify the actual diff, maintained fixtures, package closure, packed consumer, docs and required regression selection on one immutable candidate. Routine tests must not import research harnesses. Reconcile failures honestly. Prepare review; no automatic merge, seal, release or deployment. | Sol 6.1 / High |
| P15 — Public surface and HEX adoption | P01 for policy; foundation for implementation; HEX | First decide experimental API exposure, diagnostic compatibility, protocol versioning and provider advertisement. Then adapt the production contribution pipeline from the research reference: package-owned artifacts, transport, deterministic admission, provider realization and final import/signature audit. Preserve the complete provider baseline audit; apply function-only restrictions to contributions where appropriate. Verify packed exports/types and an independently named package. | Astra / High for policy; Sol 6.1 / High for implementation |
| P16 — Router terminal handoff | P15 implementation and foundation; HEX | Admit one narrowly bounded terminal handoff in a Router route. Preserve original deadline, authenticated terminal completion and response/error authority. Prove ordinary sibling routes; reject unsupported surrounding effects, token escape and parallel handoffs. No arbitrary composition claim. | Astra / High |

P15 has two reviewable checkpoints (surface policy, then contribution pipeline).
P06 must also be split if implementation plus qualification would exceed one
bounded task. These splits preserve the agreed IDs rather than inventing another
workstream. None of the table's future units is marked implemented by P00.

## Execution order and milestone gates

- Foundation: P01 → P02 → P03 and P09A → applicable P10/P13 → P14.
- Usable HEX: P15 policy can follow P01; its implementation follows foundation.
  Then P16 + P12A → applicable P10/P13 → P14.
- RA: P05 + P11A → P04/P07 and P08 → P06 → P09B + RA P10 →
  P11B/P12B/P13 → P14. Foundation is required for runtime integration. Early
  profile/baseline investigation need not wait for HEX product completion.

Each gate decides only the support claimed by that milestone. Internal contracts
must not accidentally expose experimental handoff methods through the default
package object. Hiding a type alone does not hide a runtime export. Detailed
public-surface and support choices remain P01/P15 decisions.

P14 moves only the reusable minimal fixtures required by adopted code into their
maintained test owners. Repository-wide evidence relocation is not part of P14.
Source-free packed consumers must work outside the checkout, and ordinary builds
must not retrieve historical evidence. Regenerate canonical documentation mirrors
and context data only when their canonical inputs change; do not transplant the
research branch's generated corpus.

Future semantic changes must declare their actual protected boundaries: effects,
continuations, provider/target contracts, lowerer trust, public authoring and,
where applicable, package publication/configuration. Detailed review remains with
the human owner. This plan does not authorize merging, publishing, activation or
changes to repository settings.

## Pinned research references and limits

The references below are historical inputs, not qualifications of `latest` or of
future adoption artifacts. They use immutable source revisions so later evidence
relocation does not silently change what was reviewed.

| Reference | Useful result | Limit retained by this plan |
| --- | --- | --- |
| [Shared lifecycle extraction](https://github.com/pulse-compute/pulse/blob/ecc36468b5900a0de57a415379b85d12c5026f3f/docs/internal/host-extensions/shared-lifecycle/README.md) | Execution and optional HTTP semantics separated; before/after artifact identity checked. | Shared semantics are not a second-driver implementation; Fastly source anchors remain. |
| [RA-07 composition](https://github.com/pulse-compute/pulse/blob/ecc36468b5900a0de57a415379b85d12c5026f3f/docs/internal/host-extensions/resource-accounting/ra07/README.md) | 81 cases and seven mutation checks for joint cache/fetch accounting. | Fixed experimental graph; children were not proved by the canonical compiler. |
| [RA-08 diagnostics](https://github.com/pulse-compute/pulse/blob/ecc36468b5900a0de57a415379b85d12c5026f3f/docs/internal/host-extensions/resource-accounting/ra08/README.md) | Coverage-aware bounded observation and comparison. | Internal sidecar, not production report output. |
| [RA-09 costs](https://github.com/pulse-compute/pulse/blob/ecc36468b5900a0de57a415379b85d12c5026f3f/docs/internal/host-extensions/resource-accounting/ra09/README.md) | Matched observer variants, ledger costs and unused paths; superlinear scans identified. | No ownership-equivalent accounting-free baseline; no hosted latency or total-memory guarantee. |
| [RA-10 host behavior](https://github.com/pulse-compute/pulse/blob/ecc36468b5900a0de57a415379b85d12c5026f3f/docs/internal/host-extensions/resource-accounting/ra10/README.md) | 33 Viceroy 0.21.1 cases and six bridge controls; abandon can leave a visible incomplete cache entry. | Local, version-specific outcomes; no hosted acceptance, physical reclamation or rollback guarantee. |
| [HEX-04 transport run](https://github.com/pulse-compute/pulse/actions/runs/40056898039/job/120761750232) | Six cases include real Pushpin hold/publish and WebSocket bidirectional frames; the runner enforces complete coverage and artifact hashes. | Retained HEX-04 artifacts, Viceroy 0.18.0 and Pushpin 1.42.0; not the new lifecycle/adoption candidate. |
| [Report freshness investigation #516](https://github.com/pulse-compute/pulse/issues/516) | Records unresolved freshness/identity failures and earlier signatures. | A passing retry is not resolution or proof of a shared cause; inspect current status at P14. |

## P00 acceptance

- The branch starts directly from the recorded `latest` base; no research commits
  or evidence archives are merged or copied.
- This internal plan is the only tracked addition. It does not change public
  documentation, runtime behavior, release manifests or generated context data.
- P01–P16 retain their meanings, with P09/P11/P12 split by milestone and explicit
  dependency/stopping conditions. Evidence migration remains outside scope.
- Run maintainer/documentation synchronization and checks, documentation release
  validation, scope classification and whitespace validation. Record exact results
  and limitations in the PR; no runtime suite or fresh research replay is claimed.
- Open the reviewable P00 PR against `latest` and return its link. The next unit
  is P01's adoption decision; this pass does not proceed into P02 implementation.
