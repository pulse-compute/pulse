# RC-H00 — integrated development baseline

## Decision and source identity

The release owner requested “Implement RC-H00” after selecting candidate-baseline
reconciliation as the first RC hardening pass. This integrates the existing
beta.11 preparation and qualification fixes with current development. It does
not select an RC version, freeze a release, authorize publication, or transfer
historical qualification to the integrated source.

| Input | Exact commit | Role |
| --- | --- | --- |
| `latest` | `aba81789801c34684b46c25e6b43408bbc1b7561` | First parent; DELETE/OPTIONS and upload research through #610 |
| `main` | `dbad9e9b553d87999ae35a68c2f94335c99b3acc` | Second parent; beta.11 preparation and qualification repairs from #591 |

The integration branch is `hardening/rc-h00-baseline`, proposed into `latest`.
Its merge commit binds both exact inputs; the PR records the resulting head,
tree and validation identities. Neither existing branch is moved by preparation.
The input histories diverged by eight `latest` commits and nine `main` commits.

## Reconciliation

- Retain beta.11's existing package versions, dependency ranges, release metadata,
  documentation history and generated references. These identify the inherited
  development baseline, not newly published beta.11 bytes. A later release must
  select a new version before publication; immutable beta.11 artifacts must not
  be replaced.
- Retain all DELETE/OPTIONS runtime, type, regression and documentation changes
  from #603, plus the documentation-generator corrections from #608.
- Restore #591's fixed lifecycle fixture clock, separate real-transport fetch
  test budget, finite Fastly capability task budget and Native-A CI job budget.
  These are existing main-branch changes, not new assertion relaxations.
- Preserve all upload research files and receipts byte-for-byte from `latest`.
  The 8/16/32 MiB deployed proof in #610 remains evidence for its recorded
  artifact, not a public upload operation or qualification of this integration.
- The sole textual merge conflict was the installed copy of
  `docs/guides/project-lifecycle.md`. Regenerate it through `docs:sync` from the
  canonical main-branch link, `../getting-started.md#create-a-project`.
  Do not hand-edit generated documentation.
- Run the context generator with its pinned Node 24.18.0 producer and verify
  canonical and installed mirrors. No context output changed.

The public package set and support tiers remain those of beta.11. S3 still
supports `head`, `getText`, `getBody` and `putText`; this pass does not admit
upload, list or delete operations. DELETE/OPTIONS here refer to outbound fetch
methods, not S3 package operations or new automatic inbound OPTIONS behavior.

## Current hardening ledger

| Pass | Status after this integration | Exit requirement |
| --- | --- | --- |
| RC-H00 | Prepared; see PR for exact validation and merge status | One integrated baseline containing both input histories, synchronized generated files, focused regression evidence and required non-main CI |
| RC-H01 | Pending | Repair raw Git file-byte handling in #594; finish remaining scope/intake corrections in #602 without repeating already merged documentation changes |
| RC-H02 | Pending | Review supported HTTP/effect boundaries and run focused parity, ownership, deadline and cancellation checks; repair demonstrated gaps |
| RC-H03 | Pending | Qualify clean installed consumers and reconcile supported package/target claims against exact packed bytes |
| RC-H04 | Pending | Record candidate-specific deployed provider evidence or explicit owner dispositions for remaining proof gaps |
| RC-H05 | Pending | Select release identity/scope, freeze one clean candidate, complete full CI and the existing aggregate release/installed acceptance gates, then hand off |

#572 remains the overarching release tracker. Its beta.11 receipts and owner
acceptance are historical and candidate-specific; they do not close RC-H03–05.
#508's beta.11 administrative closure is separate from this new candidate.
#516 stays parked unless a fresh signal appears; a failing new gate remains a
failure. S3 list/delete (#599), uploads, OpenAPI export, HMAC (#601), phase timeout
controls (#577) and rate limiting (#566) are not silently added to this baseline.

## Validation boundary

This is development integration, not a release seal. Local validation covers
maintenance/publication controls, generated documentation and context consistency,
release metadata, and focused fetch/lifecycle regressions for the combined source.
The PR retains actual command outcomes, including setup failures and reruns.
Required non-main CI checks apply; main full portable, packed acceptance, deployed
provider replay and final release qualification remain later checkpoints.

No npm publication, tag creation, deployment, support promotion or historical
evidence rewrite is part of RC-H00.
