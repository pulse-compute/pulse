# RPT8-05: Integrated Report qualification

RPT8-05 joins the installed package, build completion, retained evidence,
historical capsule and offline HTML paths after the beta.8 Report changes.
It adds an installed mode to the existing synthetic lifecycle regression;
the default truth-suite task continues to exercise workspace packages.
There are no compiler, guest, provider, schema or viewer behavior changes.

## Bounded installed pass

Use the existing pack and install helpers with a fresh directory outside project
inputs. The install helper verifies archive bytes and rejects workspace package
links. Run the CLI and application from the same installed dependency root:
package discovery and Report identity both depend on that workspace boundary.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.workspace.json
node scripts/pack-release.cjs --skip-build --out /absolute/pack --json
node docs/internal/prpt06/install.cjs /absolute/pack /absolute/work
node docs/internal/prpt06/check-installed.cjs /absolute/work/consumer /absolute/work/command-proof.json
node wasm/test/cli/assert-report-retained-evidence.cjs /absolute/work/consumer /absolute/results/synthetic
```

The last command refuses existing fixture paths, creates a synthetic application
in the fresh consumer, and removes only its owned fixture paths on completion.
It preserves installed packages and optionally writes a capsule, HTML and
acceptance summary outside the project. The install is dedicated to this check;
do not point it at an application checkout. Omitting both arguments retains the
normal workspace mode. Installed mode excludes the separate workspace-bound
inventory mutation corpus, reporting `inventoryCases: null` explicitly.

The shared lifecycle regression checks portable and provider-final evidence,
unchanged portable guest bytes, selected resource representations and producer
coverage, schema joins and a resolved binding reference. It also checks stale,
missing and tampered inputs/sidecars, completion invalidation after interruption,
recovery, historical replay, repeatable HTML, and passive collection guards.
Existing capture-proof and size-evidence tasks supply paired executable and
response checks; this command does not replace those tasks.

## Consumer comparisons and limits

Use [the existing installed collector](../prpt06/qualify.cjs) for a selected small
consumer and a larger consumer, keeping exact source/configuration/dependency
pins and all private outcomes outside this repository. Copy unchanged authored
and generated inputs for each candidate. Compare route/body mapping, unresolved
reference categories, graph eligibility, producer coverage, sidecar/report sizes
and capture costs. Historical capsules must preserve their identities when
replayed by the new candidate. Unknown or unsupported denominators remain
unknown; absent old fields are not zero coverage.

Measure capture on/off in separate processes with identical inputs and flags,
and verify executable equality before interpreting timing differences. State
whether costs cover portable capture or a complete provider build. A single
pair is an observation, not a performance threshold or a universal claim.
Failed builds have no successful Report completion and cannot supply invented
coverage. Preserve the failure and its source identity, then bound any retry.

Offline HTML payload equality and the viewer interaction regression do not
establish real-browser layout, focus or download behavior. Record browser checks
separately, including blocked checks. Own/Shared root proof, final linked
identity and retained resource-payload attribution remain deferred. Arbitrary
application string literals do not become recognized embedded assets.

This is one selected integration pass, repeated only for an exposed defect or a
relevant change. It adds no default gate, clean-machine campaign, release seal
or publication step. The release owner matches and qualifies the eventual
release candidate through the existing process. Public regressions stay
synthetic; private inputs, measurements and raw receipts do not belong in the PR.
