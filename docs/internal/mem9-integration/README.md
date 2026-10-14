# MEM9 integration workstream

Branch: `codex/mem9-integration`. Final destination: `latest`.
Recorded 2026-10-14. Related issue: [#289](https://github.com/pulse-compute/pulse/issues/289).

Human direction is to consolidate the current drafts, target MEM9-07/08/09 at
this branch, and complete full compliance qualification before merging into
`latest`. The integration PR remains draft during that work. This direction
authorizes integration into this working branch, not a merge into `latest`,
publication, deployment, or an unreviewed ownership design.

## Integrated baseline

The branch starts at `latest` commit
`ae7f75b5c9a0a268f4cb5e9d2087459a946dab02`, including AN9-08 handler names,
AN9-09 report normalization and the 64 MiB report budgets.

| Input | Pinned head | Content |
| --- | --- | --- |
| [#345](https://github.com/pulse-compute/pulse/pull/345) | `7e2987c9644e1f35cd60be8f184f1567604a438b` | MEM9-04/05/06A/06B, including #336, #338 and #341 |
| [#334](https://github.com/pulse-compute/pulse/pull/334) | `38686976b4fa7555bb35707e020c1179a407565a` | Independent MEM9-03 residual map |

Original commit ancestry and all measurement records are retained. Historical
records describe their own pinned source, failures and qualification scope;
they are not rewritten to imply qualification of this integration candidate.
The five original drafts remain open until the final integration reaches
`latest`; then close or reconcile them with a link to the integrated result.

Canonical architecture documentation merges the MEM9 numeric policy with current
analytics contracts. The only merge conflicts were the two generated MCP
context corpora, regenerated through `docs:sync` from the combined owners.
No production runtime conflict required a new implementation choice.

The previously failing import boundary is repaired by adding the exact CLI
`internal/report/snapshot.js` / public `canonical-project-compiler` pair to the
existing allowlist. That module already reads the exported `sourceInputsForCompiled`
receipt accessor used by AN9-04. No export, package dependency, compiler-private
access, wildcard permission or production code is added. Existing positive and
negative import restrictions remain enforced.

## Remaining work and PR targets

| Work | Target | Boundary |
| --- | --- | --- |
| MEM9-07 | `codex/mem9-integration` | Budget-preserving numeric regions; preserve charging, caps and latched failure behavior |
| MEM9-08 | `codex/mem9-integration` | General temporary ownership design; review before implementation |
| MEM9-09 | `codex/mem9-integration` | Incremental implementation of the approved design, with lifetime and cost qualification |

Create each follow-up from the current integration head and target its PR at
this branch. If a follow-up needs an unintegrated predecessor, state that
dependency explicitly. Human review remains required. Do not independently
target these changes at `latest` or close #289 from an intermediate PR.

## Qualification boundary

This consolidation runs the workspace build, unit profile, focused Native
numeric regressions and the imported-report-input regression, plus maintenance,
documentation and scope checks. Results are recorded separately from the
original campaigns. These checks establish development integration only.

Before the final merge into `latest`, freeze one clean integrated source after
MEM9-07/08/09 review and run the full compliance selection through the existing
qualification controllers: required unit, Native, JavaScript, conformance,
CLI/provider and installed-consumer/release gates. Recheck the unchanged
524,288-addition workload and 128 MiB allocation gate with both arena settings,
the affected lifetime matrix and short/long CPU/latency behavior. Preserve
terminal coverage, source/tree identity and any dependency-bound limitations.
Do not substitute individually passing historical runs for a complete final
candidate result or waive outstanding required checks.

Reconcile intervening `latest` changes before that final qualification. The
single integration PR limits reconciliation points but cannot prevent future
conflicts while other development continues. Full qualification is intentionally
pending; it has not run at this consolidation step. Merge into `latest` remains
human-owned, after review of those results.
