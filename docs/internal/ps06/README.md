# PS-06: seal checkpoint — qualification blocked

Repository-only evidence and manual measurement tooling. Human direction:
implement PS-06 from the next-stream plan. Base is `latest` at
`ce75cd009c456046b1a1bdd6356653b8b1c465b4` (PS-04 merged).
The clean implementation candidate is recorded in `results.json`; subsequent
report-only commits are not automatically qualified by its development results.

**The complete final seal, full-seal recovery demonstration and fresh-run
speedup claim remain open.** No release, publication or provider status changes.
This checkpoint stops here instead of starting another optimization campaign.

## Scheduling decision

PS-05 is skipped for this checkpoint. Execution remains serial: the current
suite includes workspace build and cleanup owners, and independent resources
for bounded parallel scheduling have not been demonstrated. PS-02 pack sharing,
PS-03 coverage consolidation and PS-04 verified recovery can be measured without
changing scheduling. Skipping the conditional PS-05 task does not waive coverage.

## Observations and limits

| Observation | Result | Meaning |
|---|---|---|
| Required-Fastly controller attempt on clean implementation candidate | Failed before any seal step; `PULSE_FASTLY_CLI_UNAVAILABLE` | Terminal failure, zero completed release tasks or installed gates |
| Real package/installed recovery demonstration | 8.680 s late-failed attempt; 0.140 s retry | 19 packages and installed Assets proof reused; failed fixture executes again |
| Fresh complete seal wall time and reduction | Unavailable | No assertion that the approximately 50% goal passed or failed |
| Complete worker CPU and simultaneous process-tree peak RSS | Unavailable | Local `/proc` PIDs differ from runtime PIDs; no GNU `time` available |
| Observed Node resources for the failed prerequisite attempt | 84.243 ms CPU; 46,256 KiB peak single-process RSS | Only the observed Node process, not a complete seal or whole-worker peak |

The development demonstration runs `ast01-installed` against actual packed
tarballs, then deliberately exits a later fixture with code 9. Its first report
retains `passed, failed`; retry retains `reused, executed`. Both attempts have
successful task cleanup. The original package and Assets proof IDs survive;
installed report bytes and SHA-256 match. Its context is explicitly
`pulse.ps06-development.v1`, so it cannot be aggregated into a release seal.
The sample excludes build, always-fresh seal stages, external reality, all 163
release tasks and the other nine installed gates. Its retry saving is not a fresh full-seal speedup estimate.

An earlier preparation attempt failed while packing GRIP before the workspace
was built. Its log remains diagnostic history and is not combined with the
successful demonstration. Initial build invocations also failed through the
unconfigured tool wrapper/global pnpm shim; the release-owned pnpm command
with dependency verification disabled then built successfully.

Dependencies came from the existing successful PS-04 installed graph, relinked
to this checkout, not a fresh official bundle restoration. Environment: Node
24.19.0, pnpm 12.4.2, TypeScript 5.9.3, AssemblyScript 0.28.18, Ubuntu 24.04.3,
Linux 6.18.44, x64. Release reproducibility owns Node 24.18.0 and a Docker-built
Debian bundle. This environment has no Docker, compatible bundle or Fastly CLI;
12-second npm registry and Fastly CLI release probes timed out. Production audit
still requires a fresh registry response. Viceroy 0.21.1 alone does not satisfy
the required Fastly lifecycle.

The observer also passed a separate real installed-consumer compatibility check:
19 pack launches, one install and zero AssemblyScript launches were observed
across its two attempts. That sample took 9.376 s and 0.147 s. Its observed Node
CPU totaled 9,858.468 ms and the largest observed Node process peaked at 342,552
KiB; these are partial process observations, not whole-worker resource totals.

## Baseline and remaining bottleneck

The retained PS-01 seal took 1,984,848 ms (33m 04.848s), with 1,968,905 ms serial
task occupancy, on Node 24.18.0 with install skipped and Fastly unavailable.
It is a single earlier observation, not a matching current controlled baseline.
The older 48m 11s Beta.6 observation remains orientation only. Neither can be
divided by the prerequisite failure or the focused recovery sample to claim a
full-seal improvement.

PS-03's paired JWT task samples saved 112,684 ms: 699,386 → 586,702 ms, with
131 → 99 AssemblyScript launches. That is approximately 16.1% of those two
workflows, not the whole seal. JWT remains a known expensive cluster; the
current full critical path is unmeasured. Provisioning the qualified toolchain,
registry access and Fastly is the immediate checkpoint blocker. Measure before
deciding whether that cluster or another owner warrants further work.

## Qualified CI runner

The opt-in `Seal checkpoint` workflow provisions Node 24.18.0, manifest-owned
pnpm, npm 11.15.0 and checksum-pinned Fastly CLI 16.1.0 on Ubuntu 24.04. A fresh
frozen-lockfile install with lifecycle scripts disabled is a supported
restoration route; the offline bundle is only needed when using that route.
An early local Fastly execution check catches environment failures before the
expensive seal. The workflow has read-only permissions and no publication jobs.

`--verify-resume` measures one complete fresh seal, restores its checkpoints in
a second attempt, deliberately interrupts that retry at the always-fresh Fastly
step, and resumes the immediate interrupted attempt. All three use the same
candidate and environment. The final report must pass the existing complete
evidence verifier. This avoids a second fresh compilation campaign just to
exercise recovery. GNU time separately records combined worker CPU and maximum
individual process RSS across the command; that RSS is not a simultaneous sum
of process-tree memory.

Automatic execution is limited to the explicit `evidence/ps06-qualified-seal`
bootstrap branch when the workflow, measurement helper or release-test fixtures change. Ordinary PRs
keep their existing fast lane. Later runs are manually dispatched. Every attempt
and measurement is archived, including failures and interruptions.

## Manual commands in a qualified environment

Restore the official compatible dependency bundle and Fastly CLI first. Use a
clean immutable candidate and the same environment, options, cache state and
observer for any controlled before/after comparison. Record restoration and
cache provenance alongside the result; `--skip-install` alone proves neither.

```bash
# A complete fresh observation. Fastly is mandatory in this wrapper.
node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/ps06-fresh --skip-install

# A separate fresh interrupted run followed by its immediate same-context resume.
# This does not count the interrupted wall time as a complete fresh measurement.
node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/ps06-recovery --skip-install \
  --interrupt-at s3-body-installed
```

The wrapper uses the existing controller, then its existing recovery evidence
verifier. A zero process exit alone cannot qualify a report. It preserves
terminal failed/interrupted attempts, verifies complete coverage before a
passing measurement, and keeps executed work and avoided original task time
separate. A missed interruption is invalid, not a recovery demonstration.
The wrapper does not dispatch CI, alter gates or install new dependencies.

Results include wall/controller time, serial task occupancy, executed/reused
task counts, candidate package count, observed AssemblyScript/pack/install
launches and observed Node CPU/peak RSS. The preload records categories only,
without arguments or environment values, and lives outside the checkout to
preserve installed-consumer isolation. Launch and Node resource observations
are lower bounds: shell/native subprocesses, native custom-promisified calls and consumers that replace or clear
`NODE_OPTIONS` are outside this observer. Whole-worker CPU, whole-tree RSS and
total compiler launches remain explicitly unavailable, rather than inferred
from elapsed time. Keep the small preload until recovery is finished; subsequent
manual recovery must retain the exact original environment. Use an independent
worker resource collector for the remaining metrics in a controlled comparison.

Focused development commands, deliberately outside the aggregate task registry:

```bash
node wasm/test/release/assert-release-seal-measure.cjs
node scripts/pnpm-toolchain.cjs -- --config.verify-deps-before-run=false run -s build
node wasm/test/release/ps06-recovery.cjs
```

The last command has a distinct development schema and must never substitute for
the complete 163 release tasks, ten installed gates, fresh audit, always-fresh
controller stages, final cleanup and required external Fastly reality.

## External and candidate-specific dispositions

Local/deployed conditional KV and missing-key CAS qualification remains separate.
The earlier Beta.6/Viceroy exception stays attached to its documented candidate
and discrepancy; this checkpoint grants no exception for the PS-06 candidate.
Not-run, failed and deferred evidence retains those statuses. Deployed
cross-location acceptance, experimental transform qualification and publication
authority are not promoted by the Assets recovery sample or this tooling.
