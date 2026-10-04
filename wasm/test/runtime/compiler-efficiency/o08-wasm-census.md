# O-08 — optimized Wasm census

**The application-error Fastly driver is the confirmed growing final-function
boundary.** With that path selected, `__pulse_fastly_run_invocation` grows from
1,612 B at one static effect site to 12,519 B at 32 sites, becoming the largest
function at eight sites. Without an application error handler, the corresponding
driver stays near 1.2 KB. This is a census of the existing implementation; it
establishes a target for O-09's behavioral proof and O-10's factoring experiment,
not a performance improvement.

Entry point: none. Class: evidence, under the ordinary root/Wasm instruction
chain. Additional owners are the test registry and suite-shape exclusion.
Baseline: merged O-07 on `latest`,
`6ebf044f4d3469d6d3f583605e34a1da410b02d0`. Production code, optimizer settings,
dependencies and target contracts are unchanged.

## Method and identity gate

The [complete census ledger](o08-evidence.json) has terminal status `passed`:
ten cells, twenty serial compilations, one production and one names-enabled
companion per cell. Seven reproduce O-07's fixture definitions, schema IDs and
bindings exactly; all seven generated-source hashes match O-07. Three matched
1/8/32-site controls add one Router application error handler. All effects are
`config.get`; the additional handler contributes no effect site.

This extra axis is necessary: the O-07 fixture lacks an error handler and uses
the provider's indexed settlement loop. `native-application-errors.js` selects
a different loop when an application error route exists, emitting a settlement
and error-priority branch for each static site. B03 previously exposed that
path with a middleware/fetch fixture. These matched controls isolate its
selection without substituting for O-09's mixed pending/failure/ordering proof.

The test loads the unchanged Fastly compiler owner with a local
`child_process` dependency wrapper. Production arguments are forwarded intact;
the companion adds only `--debug` to the actual invocation. This preserves the
incremental runtime, strict json-as 1.5.0 transform, retention transform and
default `merge-similar-functions` pass. Both builds use identical generated
source and normalized compiler arguments. No separate compiler recipe or WAT
roundtrip is used to construct the companion.

Before reading names, the harness compares **every non-custom section byte for
byte, including order, section ID and length encoding**. Both binaries must
validate. A valid companion with a changed data byte is rejected even when code
is unchanged; added custom metadata is accepted. Function indices from the
verified name section must agree with the pinned Binaryen disassembly, accounting
for imported functions. Every direct call target must resolve. Tables and
indirect calls fail this bounded inspector rather than produce an incomplete
reachability claim. All retained functions in these ten cells are reachable
from the union of function exports and the Wasm start function.

Each cell records section hashes/bytes, the 15 largest functions and 15 most
repeated caller→callee edges, driver edges, exhaustive family totals and the
full graph hash. Reproduction writes the complete function/call graph, production
Wasm, named companion and disassembly alongside the report. Static call-site
counts describe instructions, not runtime invocation frequency.

## Artifact and driver sizes

`gzip` is GNU gzip with `-n -9 -c`. Code and data section sizes include section
headers and internal framing. The ledger separately reports code body bytes
(including local declarations) and initialized data payload bytes. Every binary
byte reconciles as its eight-byte header plus all section sizes.

| Cell | Raw B | gzip B | Code section B | Data section B | Functions | Driver B | Driver rank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 site | 66,216 | 24,434 | 47,838 | 16,710 | 140 | 1,240 | 8 |
| 8 sites | 67,832 | 25,034 | 49,100 | 16,920 | 143 | 1,200 | 8 |
| 32 sites | 72,829 | 26,729 | 52,850 | 17,684 | 144 | 1,225 | 8 |
| 8 routes × 3 sites | 72,602 | 26,362 | 53,432 | 16,966 | 164 | 1,216 | 7 |
| 16 repeated schemas | 68,176 | 25,076 | 49,250 | 17,232 | 158 | 1,240 | 8 |
| 16 diverse schemas | 123,408 | 40,737 | 91,844 | 29,708 | 239 | 1,244 | 23 |
| 32 repeated schemas | 70,287 | 25,651 | 50,768 | 17,808 | 174 | 1,244 | 9 |
| 1 site + error handler | 69,121 | 25,367 | 49,362 | 18,074 | 141 | 1,612 | 5 |
| 8 sites + error handler | 73,695 | 26,294 | 53,579 | 18,284 | 146 | 3,825 | 1 |
| 32 sites + error handler | 88,732 | 29,032 | 67,368 | 19,048 | 148 | 12,519 | 1 |

At 1→32 sites without an error handler, O-07's 45,972 B source increase becomes
6,613 B of raw Wasm and 2,295 B gzip. Adding the error-handler axis changes that
growth: 1→32 sites adds 19,611 B raw, including 17,990 B of function bodies.
The driver itself adds 10,907 B, about 61% of that body-byte increase.
At 32 sites it is over four times the next-largest body (2,811 B).

The eight-site error driver has eight calls each to the retained resolver and
settlement functions; the 32-site driver has 32 each. At one site, and in the
no-error controls, those names do not survive as standalone callees. Their
absence is not evidence that their behavior disappeared: inlined work is
charged to the surviving caller. These edges directly support examining the
per-site caller expansion rather than repeating GEN04's config resolver sharing.

## Retained families and remaining duplication

Family attribution is exclusive by surviving symbol, with function-body bytes
reconciled to the code body total. It cannot recover ownership of inlined code.
Optimizer-created/unnamed helpers remain a separate family with no inferred
source ownership. The ledger includes runtime/library and residual support
buckets so the selected families below do not masquerade as the whole module.

| Retained family (body B / functions) | 1 site | 32 sites | 32 sites + error handler | 32 repeated schemas | 16 diverse schemas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Expression helpers | 0 / 0 | 597 / 1 | 611 / 1 | 0 / 0 | 0 / 0 |
| Handler chunks | 2,703 / 3 | 4,138 / 4 | 6,495 / 5 | 2,710 / 3 | 2,710 / 3 |
| Portable dispatcher | 228 / 5 | 1,997 / 5 | 2,004 / 5 | 230 / 5 | 228 / 5 |
| Provider schema projectors | 493 / 2 | 493 / 2 | 569 / 2 | 2,422 / 3 | 1,988 / 20 |
| Schema codecs and json-as | 3,217 / 9 | 3,219 / 9 | 3,221 / 9 | 3,659 / 41 | 35,793 / 75 |
| Optimizer-created/unnamed | 206 / 1 | 206 / 1 | 206 / 1 | 663 / 2 | 5,952 / 12 |

O-07's 162 expression declarations in the 32-site source do not correspond to
162 retained expression functions: one named expression body survives here.
Likewise the 31,139 B source increase for 32 repeated schema IDs becomes
4,071 B raw Wasm. The repeated-ID source bodies alone are weak evidence for a
new Wasm-sharing change after the existing GEN work and Binaryen merging.

Schema diversity remains a different cost axis: at 16 IDs the diverse control
is 55,232 B raw larger than the repeated-shape control. Its codec/json-as body
family is 35,793 B, and its largest function is the 4,010 B numeric formatter
`~lib/xjb-as/assembly/dtoa/dtoa_buffered`. Per-family attribution follows surviving
names, so the small projector bucket does not imply cheap schema projection;
some work is in callers and optimizer-created shared bodies.

The next ticket is O-09: freeze error-driver behavior, especially invocation
tickets, settlement order/count, failure priority and result freshness, before
factoring the confirmed growing caller. This census offers no compile-time,
RSS, runtime or deployed-latency result and makes no optimizer-profile change.

## Reproduction

```sh
node wasm/scripts/run-wasm-tests.cjs --task optimized-wasm-census-o08 --report .test-results/o08-census.json
```

Run with the lockfile-pinned workspace and built TypeScript declarations.
Each attempt writes a separate directory under
`wasm/.test-results/compiler-efficiency/o08/`, retaining failure reports and
completed artifacts. The checked-in ledger includes exact source/harness,
lockfile, AssemblyScript, json-as, Binaryen and gzip identities. The census
uses the default optimization profile and schema-bearing, unlinked Fastly
Native modules only.
