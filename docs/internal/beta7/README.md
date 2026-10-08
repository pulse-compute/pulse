# beta.7 release readiness

Repository-only release-owner review ledger, initially prepared for B7-01 on
October 7, 2026 UTC (October 6 in Denver), refreshed October 8 for B7-06 and the
requested small readiness refresh. The release notes and versioned copies use
`documentation-release`; this ledger and setup attestation are documentation-owner
scope. Preparation does not authorize merge, tag, settings changes, publication
or deployment.

Inspected base: `latest` at `e98d34b9494899f5b588f921aab093631bb3b386`, tree
`e06c01826d643ab61ad7fbd8f344189e2806a3da`. This identifies the inventory, not
the final release candidate. Preparation commits and the eventual main/tag
identity need their own checks and final qualification.

**Preparation is reviewable; release readiness is incomplete.** The release owner
selected explicit KV/CAS qualification with a later human gate. Its evidence is
pending, not waived. B7-02 through B7-11 retain their own setup, workflow and
final-candidate obligations. This ledger is a review record,
not an executable waiver or a replacement for preflight and terminal evidence.

## Applied snapshot and inventory

- `1.0.0-beta.7`, Beta channel, is already selected across all 20 public
  package manifests. The npm dist-tag remains `latest`; publishing advances
  unqualified installs. No new version-preparation pass is required.
- The manifest retains Node `^22.14.0 || ^24.0.0`, with publication pinned to
  Node 24.18.0, npm 11.15.0 and pnpm 12.4.2. Local development measurements on
  Node 24.19.0 are not evidence from that pinned publication environment.
- Apache-2.0 and the exact root LICENSE/NOTICE remain the legal contract.
  `release/documentation-site-archives/v1.0.0-beta.6` is the preserved exact-tag
  documentation archive; do not regenerate or rewrite it for beta.7.
- The current [changelog](../../../CHANGELOG.md) inventories Report, the Native
  boundary improvement, PS, MCP and publication-flow work;
  earlier released entries remain unchanged.

| Work since beta.6 | Retained implementation/development evidence | Release limit |
| --- | --- | --- |
| PS-01/02 test-cost attribution, candidate deadline and shared construction | [Cost ledger](../ps01/README.md), `a48c8dfd2ced3ba286315bbcb635d1e555e962a4` | Cost observations are not a beta.7 full-seal speedup claim |
| PS-03 JWT thinning and installed corpus ownership | [Coverage/measurements](../ps03/README.md) | Installed semantic owners remain required; workspace replays cannot substitute |
| PS-04/05 same-candidate recovery and bounded workers | [Recovery](../ps04/README.md), [worker qualification](../ps05/README.md), current release controller | Local controller defaults remain serial; publication selects two workers and one compiler slot. Memory admission, source identity and verified cleanup still apply |
| PS-06 checkpoint qualification | [Retained checkpoint history](../ps06/README.md), manual `seal-checkpoint.yml` | Earlier reports remain bound to their sources; ordinary PRs do not acquire another seal gate |
| PS-07 retired historical O-10/O-11 replay cluster | [Deletion and surviving-owner ledger](../ps07/README.md) | Historical failures/regressions remain recoverable; current semantic owners survive |
| PS-08 manual performance baseline | [Protocol and initial results](../ps08/README.md) | Small Node fixtures; no CI/seal threshold or broad performance promise |
| PS-09/10/11 final Native emitter boundaries | [Closeout and paired measurements](../ps11/README.md) | Measured artifact hashes/bytes preserved; no measured speed or size win asserted |
| PMCP-01/01A/01B adapter and actual client compatibility | `packages/mcp/README.md`, client tasks under `wasm/test/mcp/` | Modern profile is default; measured Codex legacy profile is explicit; no blanket client/environment promise |
| PMCP-02 through PMCP-05 immutable corpus, Entities operations, built host and public example | `examples/12-pulse-context-mcp/README.md`, context source/host tests | Five read-only tools; no inspect/build/doctor execution, workspace access or hosted deployment |
| PMCP-06/07 public package and exact installed onboarding | PRs [#214](https://github.com/pulse-compute/pulse/pull/214)/[#215](https://github.com/pulse-compute/pulse/pull/215), `mcp-installed` release-feature owner | Development acceptance is not final tag qualification or registry installation evidence |
| PRPT-00 through PRPT-06 Report capsules, retained evidence, CLI and offline viewer | [Installed qualification](../prpt06/README.md), [acceptance matrix](../prpt06/acceptance.md), registered Report unit/CLI tasks | Final candidate identity must be matched or qualified. Resource/reachability attribution is scoped; Own/Shared is unavailable; browser qualification remains partial |
| Native static error-boundary bindings | [Current contract](../../architecture/current-contracts.md#native-internal-helper-sharing), PR [#229](https://github.com/pulse-compute/pulse/pull/229), application-error regression owners | Literal pairs use retained wrappers; dynamic boundaries retain their arguments. No new optimizer flag or broad performance promise |
| B7-04/05 single candidate and published context verification | PRs [#232](https://github.com/pulse-compute/pulse/pull/232)/[#233](https://github.com/pulse-compute/pulse/pull/233), [publishing runbook](../../maintainers/npm-publishing.md) | Workflow preparation is merged; final tagged seal, publication and registry replay remain pending |
| Documentation promotion fix | `3c24d1a4e79a6c47df5241cdf9b773549b076e4c`, current `documentation-deploy.yml` | Purge precedes public verification; final beta.7 origin/storage/config still need owner verification |

The five tools are `pulse.start`, `pulse.search`, `pulse.read`, `pulse.example`
and `pulse.explain_diagnostic`. Returned starter commands are client-side
instructions; the server does not execute them. The example is bundled with the
CLI, uses exact matching Pulse versions and runs from built artifacts outside
the source checkout. MCP name reservation and owner-confirmed publisher setup
are complete; actual beta.7 OIDC publication remains pending.

## Readiness ledger

`proven` below means the named source/preparation fact was inspected; it does not
mean beta.7 has shipped. `pending` is required later work. `blocked` requires an
owner decision or prerequisite. The [preflight policy](../../../release/release-preflight.json)
remains the machine-owned stage contract; this ledger adds current beta.7 context.

| Requirement | Status | Owner / ticket | Next action and completion evidence |
| --- | --- | --- | --- |
| Version/channel/package selection, support boundaries and legal-file policy | proven | Release engineering / B7-01 | Preserve the 20-package manifest and root legal files; preflight/docs checks establish preparation consistency |
| beta.6 archive and released changelog history | proven | Documentation / B7-01 | Preserve exact prior bytes; final docs deployment must not replace immutable objects |
| beta.7 KV/CAS qualification and human gate | pending | Nathan White + release engineering / B7-07 | Explicit qualification selected by owner; retain dedicated local/deployed K4 evidence and human review before publication |
| npm package-name bootstrap | proven | Release owner / B7-02 | [Post-bootstrap verification](bootstrap.md#post-bootstrap-verification) confirms all 20 names compliant and published MCP bytes identical to the reviewed placeholder; refresh registry evidence before publication |
| Trusted publishers, organization recovery/access and protected environment | proven | Release owner / B7-03 | Owner confirmed “Yes everything is setup” on October 7; [attestation](publisher-setup.md#owner-completion-attestation) closes setup. Private settings were not independently inspected; actual OIDC proof remains B7-08 |
| One candidate, blocking audit, protected approval and mandatory Fastly lane wiring | proven | Release engineering / B7-04; execution / B7-07 | Merged #232 uses one seal and its accepted tarballs, a blocking read-only audit before approval, two bounded workers and required checksum-pinned Fastly tooling. Final tagged execution remains pending |
| Published CLI/context smoke wiring | proven | Release engineering / B7-05; execution / B7-09 | Merged #233 requires the narrow context smoke and its exact-version/cleanup report after registry/CLI verification, retaining failures. Actual registry replay remains pending |
| Report release scope and disclosed gaps | proven | Release owner / B7-06; final review / B7-07 | Ship existing Report coverage with disclosed gaps; richer compiler telemetry is beta.8 work. This disposition does not turn partial browser evidence into a pass or replace final candidate matching |
| Release PR, frozen main source and exact tag | pending | Release owner / B7-06 | Complete required main PR checks, review and tag the final source |
| Complete seal, installed gates, dependency closure, Fastly lifecycle and cleanup | pending | Release engineering / B7-07 | Qualify once from the final tag; complete ordered coverage and exact artifacts are required |
| Production advisory/license closure and dispositions | pending | Release engineering + release owner / B7-07 | Refresh existing audits in the final seal; apply the policy below, retain reports and resolve any findings |
| Registry publication and actual installed smoke | pending | Release owner + verification job / B7-08/09 | Publish the sealed set; verify all integrities/tags, clean CLI and bundled context setup/start/shutdown |
| Immutable docs, alias promotion, purge and public routes | pending | Release infrastructure / B7-10 | Review protected storage/origin settings and retain exact-tag deployment, purge and public verification receipts |
| Public release record and final evidence ledger | pending | Release owner / B7-11 | Publish reviewed notes/assets/links and record terminal status for every required stage |

Registry observations belong in the generated
`.pulse-release-preflight/npm-catalog-audit.json`, not source policy. A prior
registry audit and beta.6 OIDC success do not prove current private settings.
Freshness and final candidate identity must be checked when those stages execute.

## B7-06 release preparation

Refresh base: `latest` at `5ab8941aa21203a06f5e28314a892bc4e2fffcf8`;
release base: `main` at `4410513f82378f1dc4f4abb868b70fd0673115c4`.
The release PR carries that reviewed work plus this small notes/ledger refresh.
Version selection, the 20-package set, toolchain pins, npm `latest` policy,
`https://pulsecompute.io/` and the preserved beta.6 archive remain selected.

The October 8 release direction is to cut beta.7 with existing Report coverage
and disclosed gaps, and defer compiler telemetry expansion to beta.8. Retain
the [partial browser criteria](../prpt06/acceptance.md) and attribution limits as
such. Final release review must assess that scope and exact installed candidate
identity; this refresh claims no new browser, application-scale or provider proof.

The ordinary main-target PR checks run before merge; this preparation adds no
seal checkpoint. After review and those checks pass, the release owner merges,
checks out the resulting remote `main` commit and uses `release:tag` to check and
create the annotated `v1.0.0-beta.7` tag. Record the actual merge/tag commit, tree,
tag object and publication workflow run in the release PR/handoff. Those final
identities cannot be substituted with this preparation branch's commit.

## KV/CAS direction — qualification selected, evidence pending

On October 6, 2026 at 22:17:14 Denver time (October 7 UTC), the release owner
directed: "we will explicitly prove with human gate later." This closes the
B7-01 choice in favor of qualification, not a beta.7 exception. The frozen
candidate's dedicated evidence and explicit human review remain required later.

The October 4 direction covers the documented missing-key discrepancy on
evidence-backed Viceroy 0.21.0/0.21.1, with raw results retained. It does not cover
all local failures or replace deployed Pulse cross-location qualification.

The [beta.6 disposition](../../../release/beta6-kv-cas-disposition.json) additionally
accepted the local multi-winner failure and deferred deployed cross-location K4
only for sealed source `0da09bba3a806b04ee6ef0e6f98d196e3a2232c1`.
Its raw local result was `failed`; deployed qualification was `not-run`.
Neither result qualifies the future beta.7 tag or supplies inherited authority.

Qualify the dedicated local and deployed Pulse cross-location K4 lanes for the
frozen beta.7 candidate under the existing policy, and present their terminal
results at the explicit human gate before publication. Retain candidate
revision/tree, raw reports, provider/toolchain identities and the review outcome.
No local or deployed run is claimed by this preparation. Failed, missing or
not-run evidence remains unresolved and blocking until the existing policy is
satisfied or the release owner supplies a separate explicit disposition.

**No beta.7 exception is approved or applied.** Do not alter the historical
beta.6 record, weaken assertions, infer a semantic pass or change the public CAS
contract. Generic Fastly reality, portable corpus or standalone SDK evidence
does not satisfy the separate K4 requirement. See
[K4](../../../wasm/test/kv/K4.md).

## Advisory and license disposition policy

No current frozen beta.7 advisory/license report is established by this
preparation. The July observations have been removed from the current evidence
gate descriptions; no zero-advisory or complete-license claim is carried forward.

- Final `production-vulnerability-audit.json`: critical/high advisories stop
  shipment; remaining production advisories require explicit owner disposition.
- Final `production-license-inventory.json`: missing, custom, copyleft,
  source-available or non-allowlisted licenses require explicit owner review.
  Inspect all redistributed material, including generated Native artifacts.
- The retained NOTICE disposition covers AssemblyScript, json-as and xjb-as
  material. It does not establish the final dependency closure. Every tarball
  must carry the exact root LICENSE/NOTICE bytes.
- Existing audit commands fail when findings require review. Recording a human
  decision does not by itself make those strict commands pass; resolve the finding
  or separately review any necessary bounded policy/enforcement change.

These reports refresh in the existing final seal. B7-01 adds no duplicate audit,
performance, client or packed-consumer campaign and no new automatic gate.

## Closeout rule

B7-01 preparation is complete after focused preflight, maintainer, publication
and documentation checks pass and this diff is reviewable. The owner has now
selected explicit KV/CAS qualification with later human review. B7-06 may freeze
the reviewed source once its other preparation prerequisites close; B7-07 must
produce the dedicated evidence and complete that human gate before publication.
The direction closes the preparation choice, not the qualification itself.

One final tagged publication run should qualify the candidate, perform a
blocking read-only audit/plan, wait for protected owner approval, then publish
and verify the same sealed bundle. B7-04/05 wiring is merged; its final tagged
execution remains pending. Reuse work only through the existing
verified same-candidate/checkout recovery rules, preserve failed attempts, and
do not combine foreign or partial proofs into a seal.
