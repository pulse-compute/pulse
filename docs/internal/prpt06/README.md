# PRPT-06: Installed qualification and beta.7 handoff

Implements the qualification packet in the [v2 plan](../prpt00/feature-spec-v2.md).
Base: `4859e531019e831113ae6b92aa60039a8374b8c0` (`latest`, PR #227).
The Report product code is unchanged by this ticket. Qualification exposed and
fixes three current-contract links to repository-only packets that broke the
official CLI packer. Generated installed docs and the context corpus are rebuilt
from their canonical sources.

Entry point: none; ordinary root/wasm/CLI/docs instructions apply. Classification:
**evidence**, with a bounded packaging-documentation fix. User direction is to
implement PRPT-06 against `latest`. Recommendation remains **Sol / high**; no
agents were delegated. This packet supplies evidence to the existing beta.7
release process; it does not seal, publish, change release authority, or add a
new default gate. The ticket explicitly calls for reuse of earlier proofs rather
than another full suite.

## Installed candidate

The official `scripts/pack-release.cjs --skip-build` produced all **20 beta.7
packages** after a successful workspace TypeScript build. The first pack attempt
correctly rejected a relative link from packed current contracts to an excluded
internal packet. The fix uses repository URLs for PRPT-02/03/05 and regenerates
the installed copies; the second pack passed.

[install.cjs](install.cjs) installs these exact tarballs through the existing
read-only scoped registry, with npm lifecycle scripts disabled. It verifies every
installed archive file against the tarball: **1,072 files**, no workspace package
links, no missing/rejected registry requests. The HTML shell, script, stylesheet
and capsule schema are present. [Package proof](evidence/installed-packages.json)
retains all 20 archive hashes and a digest of the installed file inventory.

[check-installed.cjs](check-installed.cjs) executes the installed CLI and compares
help, both machine-spec copies, all three completion scripts and the Report
reference with its installed source catalog. [Command proof](evidence/installed-command.json)
records the results. Existing inspect/doctor contract evidence is reused from
PRPT-04/05 and the unchanged-product preview correction run.

These archives identify the qualified candidate; a later release candidate must
be matched or qualified by its release owner. Local packing is not publication.

## Public fixture and reproducibility

The retained corpus is `examples/01-hello-json` at the base above, copied into an
isolated installed consumer and built with its default Node Native profile.
[Measurements](measurements.md) and [acceptance](acceptance.md) describe this
public fixture and the reusable producer/renderer checks.

Private consumer source pins, application inventories, artifact hashes, build
costs and replay receipts are excluded from this repository. Their measurements
must remain with the application's authorized owner. Removing those records does
not turn the public minimal fixture into real-app or large-app acceptance.

## Focused proof

[qualify.cjs](qualify.cjs), using [measure-worker.cjs](measure-worker.cjs), runs
installed commands in fresh processes. Project mode may load the existing static
configuration parser and TypeScript. The guard rejects Native compiler entry
points, providers, project execution, subprocess and network imports; artifact
replay additionally rejects the configuration evaluator and TypeScript. Prior
retained-evidence tests supply malicious handler/harness execution canaries.

For each successful build, the helper checks:

- Three project JSON collections, three completed-manifest collections and three
  historical capsule replays produce identical canonical JSON.
- Terminal artifact size and evidence identity agree with that capsule; the
  decoded HTML payload reproduces its canonical serialization.
- Repeated project HTML writes are byte-identical and leave snapshot matching
  valid; historical HTML renders in isolation with a throwing config canary.
- Exact Wasm hashes are unchanged by reporting; section bytes plus the eight-byte
  header reconcile to each physical artifact total.
- Three fresh processes per measured mode retain elapsed time, maximum RSS,
  output size and hashes. Builds are separate from report timings.

The minimal fixture and adversarial synthetic cases test configuration-value and
path redaction. Passing those cases does not make an arbitrary application's
report safe to publish without review.

The earlier PRPT-03 paired build/capture proof establishes unchanged guest bytes
with and without passive capture. The new before/after report hash checks have a
different scope: they establish that collection/rendering does not mutate the
retained artifacts. Neither proof is a measurement of total build overhead.

## Run the qualification

Use a fresh work directory outside the repository and source inputs. Verify
source/dependency identity and preserve authored bytes. Place installed candidate
dependencies inside any explicit application workspace boundary; contract
discovery does not scan ancestors outside that boundary. Keep private application
inputs, measurements and receipts outside this public repository.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.workspace.json
node scripts/pack-release.cjs --skip-build --out /absolute/pack --json
node docs/internal/prpt06/install.cjs /absolute/pack /absolute/work
node docs/internal/prpt06/check-installed.cjs /absolute/work/consumer /absolute/work/command-proof.json
# Prepare a corpus beneath consumer, then build it using the installed pulse CLI.
node docs/internal/prpt06/qualify.cjs /absolute/work/consumer /absolute/work/consumer/minimal local /absolute/work/consumer/minimal/dist/pulse-build.json /absolute/results/minimal
```

Run measured corpora sequentially without concurrent builds. Results belong
outside source inputs. Do not run project qualification on stale evidence or
manufacture a completion envelope after a failed build. Rebuild explicitly when
source/dependency identity changes. A failed helper writes a failure receipt;
review/sanitize it before sharing because upstream error messages can name
private inputs. The worker timeout is 120 seconds per report command.

The committed [minimal capsule](examples/minimal.json) and
[offline HTML example](examples/minimal.html) are actual installed CLI outputs.
They contain three routes and are examples, not the synthetic design fixture.
Replay without project code:

```sh
node wasm/packages/cli/bin/pulse.js report --artifact docs/internal/prpt06/examples/minimal.json --json
```

## Beta.7 handoff

1. Review the package/documentation fix and this evidence packet on `latest`.
2. Keep the existing release owner and gate. Reuse prior proof only while the
   identified product code is unchanged; match exact candidate/package identity
   when continuing release preparation.
3. Carry the explicitly scoped resource, reachability and ownership limits in
   release notes. Resolve or explicitly accept the attribution and browser gaps in
   [acceptance](acceptance.md); none is silently marked passed.
4. Browser follow-up should use a real generated report and the exact four
   [locked v2 assets](../prpt00/feature-spec-v2.md#19-locked-arc-design-baseline-and-library-asset-manifest),
   including the updated **expandable schema view**. Record offline opening,
   keyboard/focus, download bytes, mobile/theme and corrected graph/count/size
   layout behavior. Earlier user preview feedback establishes tabs/expansions,
   including schemas, but does not establish every browser criterion.
5. Sealing, publishing, deployment and merging remain separate human/release
   actions. This qualification PR is reviewable with its gaps and need not stay
   draft merely because the full browser matrix remains open.
