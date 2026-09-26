# MEM11 — Fastly conditional-KV temporary allocations

**Ship the bounded read-path changes while keeping the production allocator.**
Both 64-row cases use 20 MiB of linear-memory capacity instead of 40 MiB.
The final paired local Viceroy run improved the mean of per-launch latency
medians by 5.5% for text rows and 12.6% for object rows. The loop Wasm grows
by 17 bytes (45,037 to 45,054); its reported build median is 1,809 ms versus
1,855 ms. Treat build-time differences at this scale as noise.

This implements the temporary-allocation follow-up to MEM10. It does not
switch allocators, remove retained payload roots, change cumulative budgets
or implement general escape analysis. MEM06/MEM07 remain parked.

## What changed

The conditional-KV reader previously allocated `wireBytes + 1` bytes for
every found row, including small values. The new buffer is allocated on the
first acquired read and belongs to that Wasm instance. Reads complete
synchronously through UTF-8 validation, owned-string decoding and parsing.
Even parallel effects enter those waits serially; no pending hostcall or
returned value retains a view into the scratch bytes. Each read starts at
offset zero and inspects only its written prefix, so an earlier longer body
or failed body cannot supply a later body’s tail. Missing-key and write-only
paths do not allocate this buffer. Instance teardown owns its lifetime.

Read validation previously used `__KvEncoder.encode()` and discarded the
serialized result. It now runs the same visitor without accumulating parts
or joining a JSON string. The visitor still performs all byte/depth/entry
checks, finite-number and cycle checks, and redaction registration in the
same order. Writes retain the ordinary encoder and immutable wire snapshot
before any binding/body/dispatch hostcall. String quoting and parser work
remain; this deliberately does not attempt a second codec or root release.

## Allocation attribution

Separate diagnostic builds retain the pinned stub allocator implementation
and add only a read-only arena-offset accessor and integer stage counters.
These builds are never used for timing. Arena bytes include unreachable
allocations retained by stub, not live objects or RSS. The ordinary production
artifacts supply the capacity measurements. Diagnostic response, raw host
trace, cumulative charges and resource closure must match production.

| Variant | Text-64 arena bytes | Text-64 capacity MiB | Objects-64 arena bytes | Objects-64 capacity MiB |
| --- | ---: | ---: | ---: | ---: |
| baseline | 24,638,032 | 40 | 27,299,984 | 40 |
| buffer-only | 20,504,224 | 20 | 23,166,176 | 40 |
| validation-only | 22,514,256 | 40 | 24,514,880 | 40 |
| candidate | 18,380,448 | 20 | 20,381,072 | 20 |

Across 64 reads, the buffer/output-counter stage falls from 4,201,472 to
67,664 bytes: one reusable buffer plus the same per-read output counters.
Read validation falls from 12,781,408 to 10,657,632 bytes for text, and from
10,620,048 to 7,834,944 for objects. Parse-stage allocations remain exactly
6,526,176 and 11,361,680 bytes respectively. The total arena reduction is
25.4% for text and 25.3% for objects. Crossing a stub growth threshold produces
the larger 50% reduction in memory capacity; capacity is not allocation volume.

Neither change alone takes the object corpus below the 20 MiB capacity
threshold. The two independent changes together do. This is why the report
retains both the ablations and stage allocation totals.

## Production-artifact comparison

Base: `34b9f54651e20a65965763d778f6d71bef9982db`. The benchmark reconstructs only the
two preceding implementation snippets in memory. All three baseline Wasm
hashes must match the committed MEM10 production artifacts exactly. Each
baseline/candidate build is repeated three times and must be deterministic.
The small-config and schema artifacts remain byte-identical; the conditional
KV loop alone changes. Allocator, optimization, host imports, memory cap and
production build/audit pipeline are unchanged.

Each latency cell below is the range of two independent Viceroy launch
medians, in milliseconds. Order reverses on the second round. Each launch
discards three warmups and measures 20 requests. These are local end-to-end
HTTP costs, not deployed latency guarantees or confidence intervals. The shared
MEM10 helper uses the upper middle sample for an even sample count.

| Case | Baseline capacity MiB | Candidate capacity MiB | Baseline local HTTP ms | Candidate local HTTP ms |
| --- | ---: | ---: | ---: | ---: |
| small-config | 0.625 | 0.625 | 0.45–0.56 | 0.41–0.44 |
| text-1-small | 1.25 | 1.25 | 0.58–0.60 | 0.57–0.67 |
| text-1 | 1.25 | 1.25 | 1.26–1.74 | 1.15–1.82 |
| text-8 | 5 | 5 | 6.21–6.26 | 5.92–6.00 |
| text-64 | 40 | 20 | 46.46–49.79 | 44.16–46.76 |
| objects-64 | 40 | 20 | 30.74–31.75 | 27.13–27.47 |
| schema-small | 2.5 | 2.5 | 0.91–0.92 | 0.99–0.99 |
| schema-near-bound-ascii | 5 | 5 | 14.32–16.03 | 13.79–22.48 |
| schema-escaped-unicode | 5 | 5 | 6.30–6.84 | 6.05–6.16 |
| schema-nested-128 | 5 | 5 | 3.24–3.33 | 3.23–3.40 |
| missing-first-row | 1.25 | 1.25 | 0.42–0.44 | 0.42–0.48 |

Both paired rounds improve text-64 and objects-64 latency. Smaller timings
are mixed; the unchanged schema and small-config bytes also show material
run-to-run timing noise (including a slower near-bound schema launch). There
is no schema performance claim here, nor a claim that every small request is
faster. The allocation/capacity result is deterministic; latency is sampled.

The report retains every timing sample, p95, first-request time, spawn-to-listen
time, compiler-reported duration and tool/artifact hash. Build duration runs
from AssemblyScript launch through artifact inspection, excluding plan/source
construction. Spawn-to-listen has 75 ms polling resolution and is unsuitable
for fine startup comparisons. No test suite ran during either paired replay.

## Correctness and lifecycle evidence

- All 11 cases preserve status/body, exact injected host trace, available
  cumulative memory/value charges, zero pending lookups and zero acquired
  read bodies. Direct Viceroy responses match injected execution.
- The existing Fastly conditional-KV suite gains nine cases for retained
  values/aliases, parallel long/short/malformed reads, invalid numeric/byte
  limits, partial UTF-8, body-read transport/protocol failure recovery, and
  scalars split at the 64 KiB host-read boundary. Redaction survives reuse.
- Existing cases continue to cover immutability, exact value/depth/entry
  boundaries, cross-codec bytes, write snapshots, deadlines, uncertainty,
  cancellation and opaque generation tokens.

The final replay has 44 local server launches, 880 measured HTTP requests
and 132 warmups. Its main injected comparison has 506 fresh invocations;
allocation attribution adds four variants across seven payload cases.
An initial four-variant probe and paired run established the candidate; the
final replay follows allocation-on-first-read refinement and adds the
missing-key control. Only the complete final report is committed.

These are injected-host and direct local Viceroy 0.21.1 observations. They
do not change K4 acceptance policy, prove deployed Pulse acceptance or
establish deployed memory usage. The attribution corpus is unlinked;
guest-linked ownership and fixed-memory contracts are unchanged.

## Reproduction

Use the pinned workspace dependencies (AssemblyScript 0.28.18) and a real
Viceroy binary. Missing Viceroy fails the evidence task.

```sh
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
  node wasm/scripts/run-wasm-tests.cjs --task fastly-read-temporaries-mem11 --no-report

node wasm/scripts/run-wasm-tests.cjs --task fastly-conditional-kv --no-report
```

The evidence task is opt-in and excluded from release profiles. It writes
`evidence.json`, compiled artifacts, diagnostic allocator source and local
configs below `wasm/.test-results/mem11-evidence/` (override `MEM11_OUT`).
Only `complete: true` is a finished replay. The committed JSON is an unedited
copy from the final run. It records the source/harness hashes and working-diff
hash because the production change was uncommitted at measurement time.

The existing conformance task carries the regression tests into the normal
suite; the external benchmark does not substitute for those gates.

## Validation of the implementation

The final workspace TypeScript build and maintainer control-plane check passed.
The complete combined `unit`, `native`, `javascript`, `conformance` and
`providers` replay passed all 109 selected tasks with no failed or skipped
tasks. This includes all 204 Fastly conditional-KV cases, bounded read loops,
schema/KV parity, all four targets and provider packaging/lifecycle checks.
The full run completed in 1013.57 seconds.

The runner identifies the base Git commit; the implementation was uncommitted.
Its tracked working diff remained byte-identical to the benchmark's recorded
`workingDiffSha256` (`b1d8edd2c736241cecece32b1440368c546706bd8678468c35ee0689deae2d15`) through validation. The untracked evidence harness
is separately identified by `harnessSha256`; the production KV source has its
own hash. Documentation/evidence copies were finalized after measurement.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.workspace.json
node scripts/validate-maintainer-control-plane.cjs
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native \
  --profile javascript --profile conformance --profile providers \
  --report .test-results/mem11-validation.json
```

The scope declaration classifies this as hardening and names the protected
provider paths. No semantic provider registry or target-selection change is
introduced. Human review and merge remain required.
