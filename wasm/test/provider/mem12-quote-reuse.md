# MEM12 — Fastly conditional-KV quote reuse

**Ship quote reuse with the production allocator unchanged.** Against merged
MEM11, this removes 23.1% of stub arena allocation for 64 text rows, 13.1%
for 64 object rows, and 24.3% for 64 escaped Unicode rows. The 8-row text
case crosses a growth threshold, reducing linear-memory capacity from 5 to
2.5 MiB. The 64-row cases remain at 20 MiB capacity with more unused space.
The loop Wasm shrinks by 59 bytes, from 45,054 to 44,995.

Both paired local Viceroy rounds improve all three heavy cases. The mean of
per-launch latency medians falls 24.7% for text-64, 18.4% for objects-64,
and 30.2% for quoted-64. These are sampled local observations, not deployed
performance guarantees. Allocation savings and artifact sizes are deterministic.

## What changed

The KV encoder previously quoted each string value and object key twice:
once to register the escaped form for redaction, then again to validate or
serialize the value. The private redaction helper now returns the quoted
string it already created, and the encoder consumes that same string.

Raw and escaped redaction registration still occurs in the same order before
the byte charge. Byte/depth/entry limits, finite-number and cycle checks,
validation-only reads, immutable write snapshots, scratch-buffer ownership,
and hostcall order are unchanged. Key/generation-only callers ignore the
return value and retain the same registration behavior. There is no new cache,
allocator policy, lifetime rule, or compiler analysis.

## Allocation attribution

The diagnostic builds use the pinned production stub allocator with only a
read-only arena-offset accessor and integer counters. They are never timed.
Arena bytes include unreachable allocations retained by stub; they are not
live bytes or RSS. Ordinary production artifacts supply capacity measurements.

| Variant | Text-64 arena bytes | Objects-64 arena bytes | Quoted-64 arena bytes |
| --- | ---: | ---: | ---: |
| MEM11 baseline | 18,380,448 | 20,381,072 | 20,386,848 |
| Reuse value quotes only | 14,165,664 | 20,366,736 | 15,477,024 |
| Reuse key quotes only | 18,343,584 | 17,720,720 | 20,340,064 |
| MEM12 candidate | 14,128,800 | 17,706,384 | 15,430,240 |

Value quoting accounts for nearly all the text savings; key quoting accounts
for nearly all the object savings. The two savings add exactly. The read
buffer/output stage remains 67,664 bytes for each 64-row case, and parse-stage
allocation remains 6,526,176 / 11,361,680 / 6,766,944 bytes respectively.
Only the validation-stage allocation falls: 10,657,632 to 6,405,984 for text,
7,834,944 to 5,160,256 for objects, and 12,421,216 to 7,464,608 for quoted rows.

Text-8 arena allocation falls from 2,990,480 to 2,459,024 bytes, crossing
the stub growth threshold. No measured case increases capacity. The missing
first-row control still uses 1.25 MiB and does not allocate read scratch.

## Paired production-artifact comparison

Base: `71429357b02de7e3993eef213c3fb9114d17f809` (merged MEM11).
The benchmark reverses only the three quote-reuse edits in an in-memory
compiler copy. Every baseline artifact must match the committed MEM11
production artifact hash exactly. Every candidate must match an unmodified
production build. Three alternating build rounds must be deterministic.

Small-config and schema Wasm remain byte-identical at 28,168 and 124,592 bytes.
The loop build median is 1,913 ms versus 1,879 ms; this small three-sample
difference supports no build-time improvement claim. Allocator, optimization,
host imports, memory cap, and production build/audit pipeline are unchanged.

Each latency cell is the range of two independent Viceroy launch medians in
milliseconds. The second round reverses execution order. Each launch discards
three warmups and measures 20 requests; the inherited helper uses the upper
middle sample for an even sample count.

| Case | MEM11 capacity MiB | MEM12 capacity MiB | MEM11 local HTTP ms | MEM12 local HTTP ms |
| --- | ---: | ---: | ---: | ---: |
| small-config | 0.625 | 0.625 | 0.58–0.59 | 0.48–0.57 |
| text-1-small | 1.25 | 1.25 | 0.75–0.78 | 0.66–0.82 |
| text-1 | 1.25 | 1.25 | 1.32–1.37 | 1.09–1.13 |
| text-8 | 5 | 2.5 | 6.32–7.38 | 4.26–4.99 |
| text-64 | 20 | 20 | 48.62–49.75 | 34.94–39.12 |
| objects-64 | 20 | 20 | 31.92–34.76 | 26.87–27.57 |
| schema-small | 2.5 | 2.5 | 1.06–1.07 | 0.96–1.17 |
| schema-near-bound-ascii | 5 | 5 | 14.84–16.71 | 14.71–15.56 |
| schema-escaped-unicode | 5 | 5 | 6.49–6.87 | 6.51–6.65 |
| schema-nested-128 | 5 | 5 | 3.48–3.64 | 3.70–3.81 |
| missing-first-row | 1.25 | 1.25 | 0.49–0.51 | 0.51–0.63 |
| quoted-64 | 20 | 20 | 43.58–44.43 | 30.06–31.34 |

Small timings remain mixed, including the missing-key control. Byte-identical
small-config and schema controls also vary, so this does not establish a
universal latency improvement or a schema performance change. Both rounds
improve text-1, text-8, and the three 64-row cases.

The corpus retains all MEM11 cases and adds `quoted-64`: 64 linked rows with
distinct strings containing quotes, backslashes, controls, CJK and a non-BMP
scalar, repeated in a second field with an escaped key. Row sizes remain
within the ordinary KV value bound. Both implementations receive identical
fixtures through the same shared injected-host and Viceroy helpers.

The report retains every timing sample, p95, first-request time, spawn-to-listen
time, compiler-reported duration, and tool/artifact hash. Build duration excludes
plan/source construction. Spawn-to-listen has 75 ms polling resolution and
does not support fine startup comparisons. No test suite ran during measurement.

## Correctness and lifecycle evidence

- All 12 cases preserve status/body, exact injected host trace, available
  cumulative memory/value charges, zero pending lookups and zero acquired read
  bodies. Every direct Viceroy response matches injected execution.
- Four allocation variants across eight cases match their uninstrumented
  response, trace, accounting and resource closure.
- The Fastly conditional-KV suite passes 209 cases. New coverage checks escaped
  keys and values, controls, Unicode, lone surrogates, exact 65,536-byte value
  serialization, byte-identical cross-codec writes, and one-byte-over rejection
  on reads and before write dispatch. Read-only logging verifies raw and escaped
  redaction without a preceding write that could mask a registration regression.
- Existing coverage retains depth/entry bounds, immutable values,
  snapshot timing, retained aliases, parallel reads, failed-read recovery,
  deadlines, cancellation, races, and uncertainty.

This replay has 48 local launches, 960 measured HTTP requests and 144 warmups.
The main injected comparison has 552 fresh invocations; attribution adds four
variants across eight cases. These are injected-host and direct local Viceroy
observations, not deployed Pulse acceptance or a change to K4 policy.
The attribution corpus is unlinked; guest-linked ownership and fixed-memory
contracts are unchanged. MEM06/MEM07 remain parked.

## Reproduction and provenance

Use pinned workspace dependencies (AssemblyScript 0.28.18) and Viceroy 0.21.1.
Missing Viceroy fails the opt-in evidence task.

```sh
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
  node wasm/scripts/run-wasm-tests.cjs --task fastly-kv-quote-reuse-mem12 --no-report

node wasm/scripts/run-wasm-tests.cjs --task fastly-conditional-kv --no-report
```

The task is excluded from release profiles. It reuses the MEM11 harness with
`--quote-reuse` and writes below `wasm/.test-results/mem12-evidence/` (override
`MEM12_OUT`). The default MEM11 command retains its historical comparison;
both historical loop artifact hashes were checked after extending the harness.
Only `complete: true` is a finished replay. The committed JSON is an unedited
copy of this run.

The production source and harness hashes are recorded separately because the
implementation was uncommitted during measurement. The tracked working diff
hash was `cd7b1c0d1c342104133d5d7e8b1cc6503bd085a4b1fd9c6c6e469a408cdb292a`.
The new evidence JSON and this report are finalized after measurement.

## Validation

The workspace TypeScript build, maintainer control-plane check and scope check
passed. All 109 tasks selected by unit/native/javascript/conformance/providers
passed across two segments: 80 completed before the runner exited with
`fatal library error, lookup self`, then all 29 unfinished tasks passed on
restart (373.038 seconds). The task active at interruption was rerun and
passed. No assertion failure was recorded, and no selected task was omitted.

The original and resumed result sets were checked for exact coverage of the
109-task selection. The measured working diff, production source and harness
hashes remained unchanged through validation. The runner reports identify the
base Git commit because the implementation was still uncommitted.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.workspace.json
node scripts/validate-maintainer-control-plane.cjs
node wasm/scripts/run-wasm-tests.cjs --profile unit --profile native \
  --profile javascript --profile conformance --profile providers \
  --report .test-results/mem12-validation.json
```

This is hardening within the current provider contract. The scope declaration
names the protected provider paths; no provider registry, public API, capability,
or target-selection semantics change. Human review and merge remain required.
