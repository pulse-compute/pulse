# B10-CI03 — command-scoped guest inspection gate

Issue [#389](https://github.com/pulse-compute/pulse/issues/389). Target `latest`.
Class: evidence. Disposition: **defer the memo; preserve fresh inspection**.

The gate found repeated immutable guest bytes within individual commands, but
no repeated full inspection invocation in the retained observations. Every later call used a distinct work
directory. The current inspector combines fact extraction with Binaryen output
creation and its associated failures. A separate probe demonstrates that equal
bytes and label can succeed in one directory and fail in another. Discarding
that part of the options to obtain hits would not establish equivalent behavior.

This completes the issue's explicit stop-gate path. It is not an implemented
optimization or evidence that reuse is impossible. A future pure-facts seam
would need its own demonstrated treatment of per-invocation artifact writes,
errors, effective options, tool/environment identity and command lifetime.
No cache budget or enabled/disabled trial was selected after the gate failed.
No wall-clock saving is booked for CI03 in #390 or Beta.10 qualification.

## Evidence boundary

The measurement uses clean commit `e0eae55f5f5bfc2f7cd39c8659c4217e9d729478`,
tree `c0c210a0b43e23d1adb508fe90fa7fa2bb2dd236`, based on `latest`
`4ea51dba61ccbfe98e90120d12bdf6bac33e3db7`. The measured changes are exclusively
the opt-in phase observer, its focused regression and the diagnostic driver.
The analysis, probe and this report were added afterward; they do not change
the measured observer or product code.

The complete ordered selection is `jwt-rs256`, `jwt-installed-workflow`, serial,
with a 30-minute outer deadline and no checkpoint or shared-pack reuse. The
installed task freshly constructs the exact candidate packages, installs them
outside the checkout with lifecycle scripts disabled, and copies the standalone
observer into that consumer. Its cleared `NODE_OPTIONS` boundary is retained.
Node 24.18.0, lockfile, actual inspector implementation, Binaryen bytes,
invocations and restricted tool environment digests are bound in the report.
Dependency/tool caches were warm; diagnostic read/hash overhead is included.
This is one development observation, not a seal, hosted setting comparison or
provider-reality qualification. No #373 trial ran in this checkout alongside it.

## Measured outcome

[results.json](results.json) retains provenance, per-command packaged inspection
identities, command/inspection intervals, complete facts hashes, tool identities,
trace digests, task outcomes, installed cells and the cleanup ledger.
[output-boundary.json](output-boundary.json) records the separate failure probe.

| Observation | Workspace JWT | Installed JWT |
| --- | ---: | ---: |
| Task wall time | 307.641 s | 310.704 s |
| Observed inspections, all roles | 249 | 183 |
| Successful packaged inspections in successful commands | 48 | 32 |
| Commands containing those candidates | 32 | 23 |
| Same-byte later inspections within a command | 16 | 9 |
| Full invocation repeats observed | 0 | 0 |

The pair completed in **618.436 seconds**. All candidates used the same
36,378-byte guest (`b1d09f10…6e4aecf`). The 25 later byte-only inspections had
identical facts but distinct options and occupied **14.436 seconds** in total.
That is an observed opportunity requiring a different, proven facts boundary,
not a cache-hit count or expected end-to-end benefit. All 1,076 Binaryen calls
occupied 319.409 seconds; most were never memo candidates. No setting comparison
was run because the safety gate did not pass.

The workspace task passed 146 direct executions at each of 2048/3072/4096 RSA
widths across four targets, plus its build/harness matrix. Installed acceptance
passed 12 cells, 120 harness cases, six independent Native test/build hash
comparisons, 12 dev-signature oracles, composition expectations, unchanged
package verification and the provider cleanup fixture.

Two limitations remain explicit:

- The workspace trace and 63 of 64 installed CLI traces have complete terminal
  records with zero drops/errors. The RS256 Node JavaScript `dev` trace lacks
  its tail. Its independent acceptance record passed with zero compiler
  invocations, and its retained prefix contains no guest inspections. This
  absence is not silently treated as complete observation; counts above describe
  retained calls. Source inspection and the output probe independently establish
  why byte-only identity is insufficient. No retry is pooled into this trial.
- Three task-owned `.rs-sign-*` workspace fixture directories remained after the
  runner reported cleanup passed; two were visible at installed-task start.
  Tracked source was unchanged. Their 65 file/symlink entries were inventoried
  by hash, then the three directories were removed after all tasks terminated;
  the checkout returned to clean. The cleanup discrepancy is retained in
  `results.json`, not converted into a clean seal claim. Fixture credentials
  are not published.

The sampler observed 3,085 snapshots with a maximum 242 ms gap. Corrected
sampler-excluded peak summed RSS was 1,118,152 KiB (about 1.07 GiB); interval
sampled CPU was 823.330 seconds. These include diagnostic overhead and carry
the sampling limits below. The sequential whole-task compiler occupancy is
618.345 seconds; it overlaps nested tool intervals and is not CPU time.

## Identity and exclusion rules

The observer rereads current input bytes for each call, retains full supplied
options as a digest, hashes the inspector package's source files, and observes
actual Binaryen executable bytes, argument/options digests and environment
digests at launch. Current Node identity is separately bound. Returned input
hashes and complete fact hashes are compared; parent spans retain command
ownership. These are diagnostic identities, not an approved production cache
key or a substitute for package/manifest validation.

Workspace command lifetime is the outermost observed build, test, inspect,
doctor or preparation API invocation. The installed CLI lifetime is one process,
never the encompassing test process or installation. A successful packaged
inspection under materialization is a candidate only when its owning command
also succeeds. Composed/final audits, primary/memory-owner inspections and
failed commands are excluded. Independent commands and consumers never share
a group, even when they inspect the same packaged guest bytes.

The analyzer checks terminal task coverage of both selected tasks, all three RSA
widths and four workspace targets, and every installed CLI process. It checks matched inspection ends and two successful tool operations per
successful inspection, and reports incomplete process tails separately.
The installed acceptance oracle independently checks all 12 target cells and
120 cases, Native test/build hashes, emitted-signature verification, byte-exact
installed packages, negative composition expectations and cleanup.

## Why the existing owner cannot simply return prior facts

- `wasm/packages/wasm-guest-link/src/stage.js` creates a fresh temporary directory
  for each link stage and removes it afterward.
- `src/materialize.js` validates package ownership, manifest, provenance and
  artifact bytes before calling the inspector with the packaged label and that
  stage's work directory. Those checks must stay fresh.
- `src/inspect.js` validates bytes, runs `wasm-opt` to write a feature-check Wasm,
  runs `wasm-dis` to write WAT, reads the WAT, and returns facts. Output paths and
  failure options participate in the operation; this is not a pure lookup.
- `src/pipeline.js` also invokes the inspector for primary, owner, composed and
  final modules; the final WAT is consumed downstream. Those calls cannot be
  folded into a packaged-guest memo.

`output-boundary-probe.cjs` uses the same immutable packaged input and label in
two fresh directories. One succeeds; an existing directory at the second
feature-output filename makes the second invocation fail. Removing the
obstruction permits success with identical complete facts. The probe cleans its
owned temporary files. It proves that dropping output behavior from identity
would hide an existing error, without claiming that a carefully separated
facts cache could never preserve that behavior.

## Reproduction and limits

```sh
node docs/internal/b10-ci03/diagnose.cjs /new/diagnostic/directory
node docs/internal/b10-ci03/analyze.cjs /new/diagnostic/directory > gate.json
node docs/internal/b10-ci03/output-boundary-probe.cjs /path/to/checkout
node wasm/test/release/assert-phase-observer.cjs
```

Use a clean candidate with pinned dependencies and local provider prerequisites.
The driver uses the existing task runner, process supervisor, installed report
path and resource observer. It does not replace release scheduling or evidence
authority. The analyzer preserves incomplete process tails as evidence gaps and refuses
unterminated inspection calls; it never grants reuse or qualification authority. Source-only hashes do not prove equivalence
of arbitrary future options, mutable implementation state or host environments.

RSS/CPU are sampled process-tree lower bounds, not unique physical memory or
exact compiler CPU. The existing raw sampler incorrectly labels its own process
as excluded; the derived report excludes that process and subtracts the initial
controller CPU counter. Short-lived processes and exit tails can be missed.
Whole-task compiler occupancy and nested Binaryen intervals overlap and must
not be added. The conditional memo has zero retained bytes and zero actual hits
because it was not implemented; hypothetical exact-match misses are not runtime
cache counters.

The focused observer regression checks same bytes across distinct command
parents, changed bytes/options, successful fact hashes, thrown errors and
redaction, alongside its existing disabled-mode and span-cap checks. Required
maintainer, documentation and unit validation is recorded in the PR. Human
review retains merge, architecture and release authority.
