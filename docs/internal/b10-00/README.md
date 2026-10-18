# B10-00 — compiler concurrency measurement

Issue: #373. Target: `latest`. This diagnostic changes no release selection,
scheduler admission, workflow default, checkpoint authority or product contract.

The Beta.9 hosted reference is [run 38865225416](https://github.com/pulse-compute/pulse/actions/runs/38865225416),
candidate `8ee88d27e605f712fdf1e56fb2439ded352f73fd`, tree
`bc5cbd64519fdd047e16c5143f1c70b1e21d5933`. Released `main` and the initial
Beta.10 `latest` baseline `fda16de1` have that same tree. The reference release
stage passed 190 tasks in 65m40s, followed by 11 installed gates in 10m09s.

## Diagnostic

`release-seal-measure.cjs --process-tree` adds a separate Linux `/proc` sampler
at a nominal 200 ms interval. It tracks the controller and observed descendants,
including detached groups and previously observed reparented processes, using
PID plus process start time. PID namespaces are resolved against the sampler's
namespace. The sampler does not signal the workload or decide qualification.

Each phase retains `process-samples.jsonl`, `process-summary.json`, and an
`observer-result.json`. Samples include simultaneous summed RSS, sampled CPU
counters, process identities, recognized asc processes and current runner state.
The existing preload also records launch/end intervals for recognized compiler,
pack and install calls without retaining arguments or environment values.

These observations have explicit limits:

- Short processes, exit CPU tails and unseen reparenting can be missed. Values
  are sampled lower bounds; maximum sample gap is retained.
- Summed RSS counts shared pages in each process; it is neither unique physical
  memory nor cgroup usage. It does not sum lifetime RSS peaks.
- `compilerLimited` records queued tasks at a sampled compiler-slot limit with
  other scheduling hints satisfied. Those tasks may also lack a free worker.
  It is not exclusively compiler-caused delay. Current phases and admissions
  are sampled from atomic runner reports, not exact scheduling events.
- The preload misses native/custom-promisified calls and consumers clearing
  `NODE_OPTIONS`. Interrupted launches may lack an end record. Its elapsed
  totals are not CPU time. The process sampler observes independently.
- Observer failures are retained separately. A passing seal does not imply a
  complete resource observation; both outcomes must be inspected.

## Controlled trial

Restore release-owned tools and lockfile dependencies. Commit the diagnostic
and keep that exact clean revision and input bytes fixed for both fresh trials.
Use the same checkout/runner, 2 workers and 6144 MiB admission estimate; vary
only compiler slots. No checkpoint resume. Record warm/cold state and preserve
failures. Avoid competing resource-heavy work on this runner.

```sh
node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-00-c1 \
  --skip-install --timeout-minutes 100 \
  --workers 2 --compiler-workers 1 --memory-budget-mib 6144 --process-tree

node scripts/release-seal-measure.cjs \
  --out .pulse-seal/measurements/b10-00-c2 \
  --skip-install --timeout-minutes 100 \
  --workers 2 --compiler-workers 2 --memory-budget-mib 6144 --process-tree
```

`--skip-install` requires separately recorded setup provenance. The explicit
deadline avoids inheriting the 55-minute default, shorter than the baseline.
The helper retains the existing complete seal/evidence verification. Compare
terminal status, coverage, source/input identities, task slowdown, memory/CPU,
cleanup and observation quality before recommending a setting. Local results
are not hosted speedup claims. Repeat or alternate only if variance affects the
decision. Three/four-worker simulations do not authorize those configurations.

## Focused checks

```sh
node wasm/test/release/assert-release-seal-measure.cjs
node wasm/test/release/assert-release-resource-observer.cjs
```

Checks cover real subprocess error/promise behavior, redacted interval records,
PID reuse, detached/reparented ownership, simultaneous RSS, CPU, scheduling
observations and terminal process cleanup. They add no aggregate release task.

Results and the recommendation are recorded after the controlled attempts.
