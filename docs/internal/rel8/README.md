# REL8-00 — Release path after beta.7

Status: implementation handoff; repository-only planning input.
Reviewed: 2026-10-09. Model/effort: Sol / high.

The beta.8 release work should make the expensive qualification a prerequisite
of the release merge into `main`. After that merge, npm and documentation should
consume the accepted bytes through a short, mechanically verified handoff.
Run inexpensive rejection checks before starting the long qualification.

This document completes REL8-00's inventory and keep/delete/move decisions.
It proposes follow-up changes; it does not change current release authority,
required checks, artifact eligibility, or workflows. REL8-01 and REL8-02 must
update the owning contracts and their tests before the proposed path is usable.

## Reconciled starting point

Inspected source: `be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`, tree
`b66fac46754d3cf1a8847b25821c3957c3316833`. At inspection, remote `latest`,
`main`, and `v1.0.0-beta.7` resolved to that commit. These are observations,
not movable identifiers for future qualification.

- [PR #238](https://github.com/pulse-compute/pulse/pull/238) landed the
  qualification/publication split. Publishing already reuses accepted tarballs.
- [PR #239](https://github.com/pulse-compute/pulse/pull/239), the proposed
  post-release cleanup, was closed without merging. Its proposed default-input,
  copyable handoff and ledger changes are not present. Do not replay its branch
  reconciliation blindly: the current branch tips already match.
- The checked-in [beta.7 ledger](../beta7/README.md) still has pending release
  stages. It describes preparation, not an authoritative account of what shipped.
  Reconcile it from receipts separately; do not infer every stage passed from
  successful publication.

Observed Actions results, all on the inspected beta.7 SHA and attempt 1:

| Run | Observed result | Elapsed job time |
| --- | --- | --- |
| [Qualification 37851078226](https://github.com/pulse-compute/pulse/actions/runs/37851078226) | `candidate` succeeded; audit/publish/verify skipped | 32m20s candidate |
| [Publication 37854825110](https://github.com/pulse-compute/pulse/actions/runs/37854825110) | Candidate skipped; audit, publish and verify succeeded | 43s audit, 6m47s publish, 50s verify |
| [Docs 37858976410](https://github.com/pulse-compute/pulse/actions/runs/37858976410) | Candidate and deploy succeeded | 34s candidate, 7m56s deploy |

These are workflow job durations, not CPU measurements or beta.8 performance
budgets. The closed cleanup PR reports immutable-only docs upload; a green deploy
job does not itself prove alias promotion, purge or public-route verification,
because those steps are conditional. No new release, registry replay, provider
probe or production deployment was performed for this inventory.

## Current path and authorities

Paths below are repository-root-relative. Each row names the executable owner;
the current operator guide is [npm publishing](../../maintainers/npm-publishing.md).

| Stage | Owner | Current behavior / boundary |
| --- | --- | --- |
| Prepare | `.github/workflows/release-prepare.yml`, `scripts/release-prepare.cjs` | Prepare the version/archive/changelog/package snapshot and draft release PR. Separate source execution from the token-bearing PR creation job. |
| PR checks | `.github/workflows/validate.yml`, `scripts/release-pr-check.cjs`, `.github/workflows/documentation.yml` | Main-target full portable checks and preparation consistency. The preparation report explicitly returns `sealed: false`. |
| Merge and tag | `scripts/release-tag.cjs`, release owner | Current guide tags reviewed remote `main` before qualification. Human merge/tag authority remains separate. |
| Qualify | `.github/workflows/npm-publish.yml`, operation `qualify`; `scripts/validate-release.cjs` | Exact tagged source, fresh seal, required Fastly reality, accepted shared pack; uploads a candidate retained for 30 days. Job budget 100m, seal deadline 90m. |
| Resolve | `scripts/release-qualification.cjs` | Audit/publish require an explicit prior run ID. Validates repository, workflow, event, tag, SHA, successful current attempt/candidate job and exact unexpired artifact. |
| Audit / publish | `npm-publish.yml`, `scripts/release-candidate.cjs`, `scripts/publish-release.cjs` | Re-download and verify the candidate; blocking publish audit; protected `npm-publish` environment and OIDC; dependency-ordered publication with partial-publication recovery. No second seal or pack. |
| Registry acceptance | `scripts/verify-npm-release.cjs`, verification job | Exact catalog integrity/dist-tag checks, optional clean CLI smoke, mandatory exact-version context lifecycle smoke and cleanup. |
| Docs candidate / deploy | `.github/workflows/documentation-deploy.yml`, `scripts/documentation-deployment.cjs` | Rebuild docs from tag, seal and verify candidate, protected environment, immutable upload/storage verification; optional npm-gated alias promotion, purge and public verification. |
| Checkpoint diagnostics | `.github/workflows/seal-checkpoint.yml`, `scripts/release-seal-measure.cjs` | Manual fresh/resumed-seal measurement on selected source. Diagnostic lane, not publication authority or a PR gate. |

There is currently no single end-to-end release entry point. Retain **Release
preparation** as the operator's starting point and make its release PR the
authoritative qualification handoff in REL8-01. Do not introduce another parallel
candidate command or require the operator to coordinate workflow run IDs.
`npm-publish.yml` and documentation deployment remain consuming stages; their
manual dispatches can remain bounded retry/recovery interfaces.

## Required checks and actual duplication

The policy source is `release/maintenance-policy.json`, not this plan. It names
`Maintainer scope / scope`, `Repository validation / maintenance`,
`Repository validation / node-floor`, `Repository validation / portable`, and
`Documentation / build`. Main additionally requires
`Repository validation / full portable`; non-main uses `fast portable`.
This inventory describes repository policy and workflow wiring, not an audit of
live branch-protection settings.

The seal owner `scripts/validate-release.cjs` performs source/lock/prerequisite
checks, preflight, dependency setup, maintainer/publication validation, build,
production dependency audit, workspace unit tests and documentation checks. It
then runs the release profile and installed feature gates against a shared pack,
requires Fastly reality in the publication workflow, and finishes with preflight,
source verification, worker cleanup and a terminal aggregate.

At the inspected source the release profile has **173 tasks**; feature acceptance
has **11 installed gates**. Their task-ID sets do not overlap. That does not prove
there is no semantic overlap, but it rules out deleting an installed gate solely
because of an assumed duplicate task ID.

| Finding | Concrete owner / consequence |
| --- | --- |
| Publication validation is nested in maintainer validation | `validate-maintainer-control-plane.cjs` invokes publication validation; the seal also runs `publication:check`. Deduplicate invocation within one attempt after preserving named result reporting. |
| Documentation validation repeats maintainer validation | `documentation-release.cjs` calls maintainer validation, which also calls publication validation. Keep one explicit owner per check in the orchestrated pass. Standalone commands must remain complete. |
| Fresh packing validates documentation again | `pack-release.cjs` calls `validateDocumentationSource` before creating the shared pack. Include this nested call in the check graph; preserve validation for standalone packing. |
| Site generation repeats | Documentation workflows run `docs:check`, `documentation-release.cjs` and `docs:site`; each has a site build/check path. Capture one validated site output and seal that output. |
| Documentation deployment rebuilds after release | Move docs candidate generation into pre-main qualification and transfer verified bytes to deployment. Production checks remain fresh. |
| npm publish no longer requalifies | Preserve #238. Removing a second npm seal is already done and is not new beta.8 work. |
| Portable PR jobs and seal exercise some related surfaces | Portable reports are not complete seal proofs. Do not pool independent PR shards into release evidence or simply remove seal coverage. |
| `arc01-installed` sounds like an application gate | `wasm/test/provider/arc01-installed.cjs` and `arc01-fixture.cjs` create synthetic installed-package/provider fixtures. They do not check out the user's ARC project or require live model workflows. Keep the test; consider a clearer display label. |

The `seal-checkpoint` workflow deliberately measures fresh and interrupted
execution, including a preliminary Fastly check. Its repeated work serves that
experiment. Remove it from the normal release instructions, not from diagnostics
without a separate evidence-backed reason.

Beta.7's late-failure examples are useful ordering fixtures: the stale Router
size baseline fixed in [#237](https://github.com/pulse-compute/pulse/pull/237),
the fixed package-count assumption in
[#236](https://github.com/pulse-compute/pulse/pull/236), and the isolated-worker
fixture parent directory fixed in
[#235](https://github.com/pulse-compute/pulse/pull/235). Keep these fixes. Catalog
consistency can fail early; compiled size assertions need a build; isolation
needs a focused worker fixture. Do not replace their assertions with broader
tolerances just to shorten qualification.

## Target order

1. **Prepare once.** Produce the release PR and its exact candidate identity from
   Release preparation. Keep version/catalog/archive/changelog synchronization
   mechanical. No runtime behavior changes belong in this handoff.
2. **Reject inexpensive failures first.** Validate source identity, preparation,
   policy, workflow contracts, package/catalog consistency, generated docs and
   required tool availability before the expensive release matrix. Run narrow
   build-dependent checks as soon as their prerequisites exist. Give each stage
   a timing and an explicit failure; do not call compilation-dependent checks
   “cheap” without measuring them.
3. **Qualify before main.** Run the full release controller on the intended merge
   candidate with bounded local workers. Produce one accepted package set and
   one docs candidate, complete ordered coverage, terminal reports and hashes.
   Add a stable release-qualification PR gate alongside ordinary PR checks.
4. **Review and merge.** Any change to candidate source, target merge tree or
   qualification inputs invalidates eligibility. Human review and the dedicated
   feature dispositions must be visible before merge.
5. **Bind and consume.** Mechanically bind the reviewed merged/tagged source to
   the accepted qualification. Resolve the artifact without manual run-ID entry.
   Perform fresh publication audit and protected approval, then publish exact
   tarballs and run registry acceptance. Deploy the captured docs bytes through
   the existing protected path. No compiler build, pack or full seal after main.

### Identity is the critical implementation gate

Current eligibility is tied to `workflow_dispatch`, an exact release tag and its
SHA; current recovery is same-candidate/same-checkout only. A successful PR run
cannot simply be passed to today's resolver. A PR head, synthetic merge commit,
final merge commit and release tag may have different identities.

REL8-01 must define and test the merge strategy and candidate identity before
moving qualification. Prefer retaining the exact qualified commit where the
reviewed merge strategy permits it. Otherwise an explicitly reviewed binding
contract must establish the intended PR/base, qualified merge tree, resulting
main commit and tag, while preserving the original qualification provenance.
Tree equality alone is insufficient: verify embedded source identities, package
and docs manifests, task definitions, dependency/toolchain/build identities and
artifact digests. Never rewrite reports or tarball bytes to pretend the seal ran
on a different commit. If the chosen merge strategy cannot satisfy the contract,
stop before publication and resolve that design; do not silently rerun a long
post-main seal or weaken source matching.

REL8-02 may automate lookup only after this contract exists. Missing, ambiguous,
expired, superseded, failed or mismatched qualifications must fail closed with
an actionable reason. Preserve run/attempt/job/artifact IDs as machine provenance,
even when they disappear from the normal operator inputs.

## Keep / delete / move handoff

“Delete” below means remove redundant orchestration or an operator step after
its replacement is tested. It never means discard a unique assertion.

| Action | Item | Follow-up and completion condition |
| --- | --- | --- |
| KEEP | Release manifest, maintenance policy, preflight and documentation deployment manifest as authorities | REL8-01/02 update owners and regenerate their derived documentation; do not add a competing release manifest. |
| KEEP | Preparation facade and separated token-bearing PR creation job | REL8-01 attaches qualification to that release PR; human merge/tag/environment authority remains explicit. |
| MOVE | Expensive seal from post-tag publication lane to release PR | REL8-01 proves the merge/source binding and adds the stable required gate. Ordinary PR success cannot masquerade as a seal. |
| MOVE | Fast rejection checks ahead of expensive tests | REL8-01 identifies prerequisites and records stage timing; a deliberately stale catalog/docs/preparation fixture fails before release matrix execution. |
| KEEP | Full ordered release coverage, 11 installed gates, Fastly reality, audit/license closure and cleanup | REL8-01 preserves distinct coverage and terminal evidence. Any removed assertion needs an explicit equivalent owner. |
| KEEP | Bounded controller-owned worktrees and exact same-checkout recovery | REL8-01 preserves invalidation and per-attempt fresh stages from `release/AGENTS.md`; no cross-run checkpoint pooling. |
| DELETE | Repeated maintainer/publication invocations within one qualified attempt | REL8-01 retains complete standalone commands and named results; tests demonstrate a single orchestrated invocation per check. |
| DELETE | Manual qualification run-ID copying on the normal path | REL8-02 discovers the one eligible qualification and verifies full provenance. An explicit diagnostic selector cannot bypass eligibility. |
| KEEP | Existing accepted npm artifact reuse | REL8-02 preserves digest verification, immutable bytes and retry after partial publication; no re-pack in audit/publish. |
| MOVE | Docs source validation/build/seal to qualification | REL8-02 hands the exact docs candidate to deployment. Deduplicate builds while retaining source, link and manifest assertions. |
| KEEP | Fresh registry audit, npm integrity/tags, mandatory context smoke, cleanup | REL8-02 keeps external-state checks at consumption time; optional CLI smoke stays clearly labeled. |
| KEEP | Immutable docs verification, npm gate before alias promotion, purge and public-route verification | REL8-02 preserves protected approvals and immutable-only mode; report upload and promotion separately. |
| DELETE | Qualification-via-publication instructions and obsolete multi-candidate/manual glue after migration | REL8-02 replaces the runbook with prepare → qualify PR → review/merge/tag → consume. Retire old entry points only after parity and recovery tests. |
| MOVE | Checkpoint measurement to an explicitly diagnostic section | Keep `seal-checkpoint.yml` available for recovery/performance investigation; it is not a second release authority. |
| MOVE | Stale beta.7 ledger reconciliation to a bounded historical follow-up | Link actual receipts and retain unknown/not-run statuses. Do not turn the closed #239 proposal into release evidence. |

## Follow-up tickets and acceptance

These are the release-lane handoffs, not a new beta.8 runtime or report scope.
Model/effort are recommendations for execution, not measured duration estimates.

| Ticket | Scope | Model / effort | Done when |
| --- | --- | --- | --- |
| REL8-00 | This source-backed inventory and explicit keep/delete/move list | Sol / high | Beta.7 cleanup is reconciled; current versus proposed paths, unique gates, duplication and identity blockers are recorded. |
| REL8-01 | Qualification before main, cheap-first ordering, one controller-owned check graph | Sol / high | Required PR gate and identity contract are tested; mutation invalidates qualification; no coverage lost and no independent proof pooling. |
| REL8-02 | Mechanical qualified-artifact consumption and publication/docs handoff | Sol / high | No routine manual run-ID handoff, no post-main build/pack/seal; provenance rejection and partial-publication/deployment recovery are tested. |

Minimum follow-up failure cases: changed PR/base/tree; stale version/catalog or
generated docs; missing Fastly prerequisite; a failed or incomplete installed
gate; altered tarball/docs bytes; wrong repository/workflow/attempt; missing or
expired artifact; multiple eligible results; interrupted qualification; partial
npm publication; immutable docs collision; promotion or public verification
failure. Exercise these with focused fixtures first, then one authoritative
candidate validation under the selected release policy.

The separate [K4 local/deployed requirements](../../../wasm/test/kv/K4.md) must
remain explicit. Generic Fastly reality and a green aggregate do not establish
deployed cross-location KV/CAS evidence. The beta.6 candidate-specific exception
is not inherited by beta.7 or beta.8. Resolve dedicated evidence or an explicit
candidate-specific human disposition at the owning gate, preserving raw status.

Repository settings and production readiness are owner actions in the follow-ups:
verify the stable gate is actually required and confirm protected-environment
configuration. REL8-00 changes no settings and authorizes no merge, tag,
publication, deployment or provider activation.

## REL8-01 implementation handoff

REL8-01 adds the pre-main PR qualification producer and stable gate, exact
base/head/merge/tree identity, live-source checks, accepted package capture and
a tested merge/squash binding. It consolidates control-plane and docs validation
into one fresh source-check pass before compilation, with same-attempt verified
reuse by shared packing. Full ordered coverage and recovery rules remain.

REL8-02 completes automatic artifact selection, authenticated consumption and
prebuilt docs transfer. Publication and deployment consume the latest eligible
pre-main qualification without manual run IDs or post-main build/pack/seal.
The retained docs candidate comes from the same validated site build. Both
consumers pin run/attempt/job/artifact provenance and recheck eligibility after
approval, preserving original source identities in a separate merge binding.
Focused fixtures reject missing, ambiguous, expired, superseded and mismatched
proofs; publication/deployment simulations preserve partial-release retries,
immutable conflicts and interrupted promotion recovery. The human release owner
must install the main-only gate with strict up-to-date branch protection.
