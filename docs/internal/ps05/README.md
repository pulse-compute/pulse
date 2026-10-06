# PS-05: bounded local seal scheduling

Human direction: implement PS-05 from the next-stream plan. Entry point:
`release-readiness`, with explicitly scoped runner, evidence-verifier, CI and
testing-documentation owners. This adds local scheduling and worker provenance;
publication and merge authority remain human-owned.

The implementation builds on the qualified PS-06 head
`1b539b24700563d7035a7847d3f1f1bc9957f7a6` (PR #198), against `latest`
`d16255369b16efab5a88704bd009d5efaff854c7`.

Serial is the default. `--workers 4 --memory-budget-mib 6144` enables up to four
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
  --workers 4 --memory-budget-mib 6144 \
  --out .pulse-seal/measurements/ps05-qualified --verify-resume
```

The opt-in hosted checkpoint restores pinned dependencies without lifecycle
scripts, runs the representative comparison, then one complete parallel seal and
interrupted recovery demonstration. Retained artifacts exclude disposable worker
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
