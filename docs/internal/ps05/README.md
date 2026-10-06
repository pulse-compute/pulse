# PS-05: bounded local seal scheduling

Human direction: implement PS-05 from the next-stream plan. Entry point:
`release-readiness`, with explicitly scoped runner, evidence-verifier, CI and
testing-documentation owners. This adds local scheduling and worker provenance;
publication and merge authority remain human-owned.

The implementation builds on the qualified PS-06 head
`1b539b24700563d7035a7847d3f1f1bc9957f7a6` (PR #198), against `latest`
`d16255369b16efab5a88704bd009d5efaff854c7`.

Serial is the default. `--workers 4 --compiler-workers 2 --memory-budget-mib 6144` enables up to four
private local worktrees of one clean candidate. Dependency/build copies and
workspace links isolate mutable outputs; the existing shared package receipt
admits only registered children of its controller. Task definitions, coverage,
timeouts, cleanup and same-candidate checkpoint checks remain authoritative.
Weighted ready-work ordering supports explicit dependency edges, resource locks
and exclusive benchmarks. All active subprocess groups are cancelled on failure
or interruption. Aggregate results remain in canonical selection order.

The 768 MiB per-worker admission estimate bounds scheduling, not physical RSS.
The representative helper samples summed process-tree RSS every 200 ms on Linux,
records workspace setup separately and compares four real compilation/CLI tasks
serially and with four workers. Shared pages can be double-counted. The helper is
development evidence, never an additional registered seal task.

```bash
node wasm/test/release/ps05-measure.cjs
node scripts/release-seal-measure.cjs --skip-install --timeout-minutes 50 \
  --workers 4 --compiler-workers 2 --memory-budget-mib 6144 \
  --out .pulse-seal/measurements/ps05-qualified --verify-resume
```

The opt-in hosted checkpoint restores pinned dependencies without lifecycle
scripts, then runs one complete parallel seal and interrupted recovery
demonstration. The paired comparison is a manually selected development workload,
not a recurring qualification gate. Retained artifacts exclude disposable worker
checkouts. Full seal speedup remains unmeasured until that job passes; the goal is
10–15 minutes, not an acceptance claim or relaxed coverage.

The previous serial hosted sample (run `37415935504`, same implementation base)
took 1,883,457 ms for 163 release tasks plus 368,563 ms for ten installed gates:
about 37m57s overall. It is a retained historical comparison, not a controlled
same-source serial/parallel pair. Recovery was about 20–22 seconds and remains a
separate benefit.

The local sample on clean implementation candidate
`b4a5ed0e1f46f9c45ab2ed86063435af78b70961` passed all four tasks in each mode:

| Mode | Task wall time | Setup | Including setup |
| --- | --- | --- | --- |
| Serial | 187.073 s | 0 s | 187.073 s |
| Four workers | 70.604 s | 1.693 s | 72.297 s |

That is 2.59× including setup. Node 24.19.0 reported eight available CPUs;
dependencies were relinked from the existing PS-04 graph, not freshly restored.
PID inspection is unavailable in this sandbox, so RSS and the memory acceptance
remain unresolved locally. This single serial-first development sample is not a
full-seal estimate. Worker checkouts were removed after the sample.

Unit coverage passed 45/45; build, maintainer, publication, generated docs and
documentation-release checks passed. Follow-up supervision coverage keeps spawned
workers owned even when child tracking fails and uses short termination grace
periods only in synthetic scheduler fixtures; production deadlines are unchanged.
Hosted results, tested source identity and artifact links belong in the PR and its
retained Actions evidence. This note grants no release-candidate KV exception.

The first hosted comparison (run `37423259848`, source `5f39e95a79f70b46a869bd61ef4ae3c6283689c2`)
passed the same four tasks with freshly installed pinned dependencies on four CPUs:
220.954 s serial versus 145.981 s parallel plus 4.827 s setup (1.47× including
setup). Sampled summed process-tree RSS rose from 856,608 to 2,891,212 KiB,
within the 6144 MiB budget; worker source/dependency/build inputs were unchanged.
The subsequent full seal failed before release tasks: the maintainer source walk
counted the four disposable worktrees as additional AGENTS sources (45 instead
of nine). The canonical walk now excludes generated `.pulse-seal` contents,
consistent with its existing publication/documentation-output exclusions.
The failed attempt and successful comparison remain retained in the run artifact;
neither is described as a passing full seal.
Real package construction with two active worktrees then passed all 19 packages
and the canonical nine-instruction-file check. The retry proceeds directly to
full qualification; the already completed six-minute paired comparison is retained
rather than added to every seal.

The next attempt (`37424416574`, source `9119941e9dc01fc112f2b32f8e13c949090e03c2`)
passed package construction, but four simultaneous heavy tasks made
`schema-codecs` exceed its unchanged 180-second deadline. The other three tasks
were cancelled and cleanup passed. Its retained failure is not passing coverage.
A separate `--compiler-workers` limit now defaults to two and is bound into the
worker layout/recovery context. Native, conformance, CLI, provider, release and external tasks use
compiler slots by default; hints can override the classification. The four-worker
pool can still overlap lighter work. Fixture coverage verifies compiler admission
and overlap separately from exclusive benchmarks and shared-resource locks.
The earlier paired samples describe the original four-compiler schedule; they do
not estimate the throughput of this revised policy. Full qualification measures
the revised schedule with the original task deadlines.

Attempt `37425767655` retained the same timeout because its initial classifier
omitted the registry's `providers` and `release` evidence categories: two heavy
tasks bypassed the two compiler slots. That classification defect is corrected;
unit and JavaScript tasks are light by default, other categories consume compiler
slots unless explicitly overridden. A regression checks the four actual registry
entries from the failing cluster, in addition to the scheduler's admission fixture.

Attempt `37426674953` confirmed the compiler cap but exposed a shared-package
validation race: a consumer checked every sibling's untracked files while another
worker was creating a temporary JWT fixture. Active consumer validation now keeps
the exact revision, tracked-source and registered-layout checks while allowing
untracked sibling fixtures. The consumer itself and the controller's pre/post
execution barriers still require full cleanliness. A regression rejects tracked
sibling mutations and confirms temporary sibling files do not block a consumer.

Attempt `37427390122` retained 159 passing release tasks before independent
artifact construction failed. The example-source filter considered absolute path
segments, treating the `.pulse-seal` ancestor of a worker as generated example
output and excluding all canonical examples. The filter now uses checkout-relative
segments; the existing artifact-determinism task runs early to catch worker
packaging boundaries before the long compiler lane. Documentation synchronization
is an explicitly scoped additional owner for this worktree-path correction.
This failed aggregate is retained and is not a full-seal timing result.
