# O-07 — generated source census on merged O-06

Entry point: none. Class: evidence. The ordinary root/Wasm evidence chain owns
this opt-in harness; the test registry and suite-shape exclusion are additional
owners. This pass changes no production generator, optimizer, ABI or target
behavior. The baseline is `latest` at
`e18ba95e09e8144b52ab235f7a3d2667554db175` (merged O-06).

The [seven-cell evidence ledger](o07-evidence.json) has terminal status
`passed`. It records fixture and generated-source hashes, the harness and
production-owner hashes, lockfile identity, Node version and dirty-tree state.
The harness generates final **instrumented Fastly AssemblyScript source** using
the same canonical Router fixture and byte-exact stage attribution as GEN01.
It does not run AssemblyScript or Binaryen. Every source byte is assigned to a
GEN01 source-owner bucket. The source declaration parser separately counts
lexical top-level ranges, including text up to the next declaration; its
families reconcile with the same complete source byte count. These are source
bytes, not final Wasm bytes or a per-owner compiler-cost decomposition.

The fixture has one referenced `R0` schema with optional additional registered
IDs. Every effect is `config.get`. A route/site contrast has one route with 1,
8 or 32 sequential static sites; an independent control has eight routes with
three sites each. Repeated schema IDs have the same flat shape; diverse IDs
vary scalar/array and nested properties. The plan's route, static-effect-site
and schema-ID counts are asserted before source attribution.

| Cell | Source B | Declarations | Portable codecs B | Provider projections B | Runtime support B | Dispatcher/handlers B | Package/effect adapters B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 site, 1 schema | 111,906 | 316 | 1,340 | 3,247 | 94,963 | 8,614 | 3,742 |
| 8 sites, 1 schema | 122,161 | 373 | 1,340 | 3,247 | 94,963 | 18,527 | 4,084 |
| 32 sites, 1 schema | 157,878 | 566 | 1,340 | 3,247 | 94,964 | 53,407 | 4,920 |
| 8 routes × 3 sites, 1 schema | 158,705 | 571 | 1,340 | 3,247 | 94,964 | 54,514 | 4,640 |
| 1 site, 16 repeated schemas | 126,885 | 361 | 11,066 | 8,500 | 94,963 | 8,614 | 3,742 |
| 1 site, 16 diverse schemas | 175,134 | 413 | 14,797 | 53,018 | 94,963 | 8,614 | 3,742 |
| 1 site, 32 repeated schemas | 143,045 | 409 | 21,594 | 14,132 | 94,963 | 8,614 | 3,742 |

With one schema held fixed, 1→8 sites adds 10,255 source bytes: 9,913 in
dispatcher/handlers and 342 in adapters. At 1→32 sites, the increase is
45,972 B: 44,793 dispatcher/handlers, 1,178 adapters and one byte of runtime
support. The lexical family changes over 1→32 are handler chunks +16,804 B,
expression helpers +11,893 B, effect-site state +3,507 B and Fastly effect
dispatch +1,178 B; the remaining +12,590 B is other declarations, chiefly
portable handler/step support. The 8-route/3-site control reaches 24 distinct
effect sites and adds 46,799 B relative to the one-site cell. Thus site count
alone does not determine handler source: route topology also matters.

Across all seven cells, **exact full-text repeated declaration groups are
zero**. Distinct generated symbol names prevent a byte-exact declaration
match here. GEN01's narrower comparison, which removes the function header and
compares the remaining body verbatim, finds three repeated-body groups and
367 redundant body bytes in every fixed-schema site cell; at 32 repeated
schema IDs it finds 34 groups and 4,609 redundant body bytes. Those are
unmerged source-text matches, not evidence of retained optimized duplicates.
The ledger includes the group names and sizes. The total family table also
exposes portable codec growth (1,301→21,555 B in the one-to-32 repeated-ID
contrast) and projector growth (2,007→12,892 B).

Already completed GEN work is visible on this baseline:

- GEN02's optional Assets helpers are absent in every no-Assets fixture.
  Common runtime support remains about 95 KB; this does not imply that all
  runtime support is reachable in optimized Wasm.
- GEN03 uses one flat-object projector for 16 and 32 identical shapes versus
  16 for the diverse control. The repeated-ID provider bucket still grows
  with dispatch and per-ID materialization; portable codecs remain per ID.
- GEN04 emits one shared `config.get` resolver for multi-site cells and none
  for single-site cells. Distinct effect-site state and handler code still grow.

This ranks the source-side follow-up: handler chunks, expressions and per-site
state dominate the measured 32-site increase; schema diversity is a separate
axis. O-08 must inspect optimized Wasm sections and proven names before
choosing a final-function target. Source repetition alone is not a Wasm size,
compile-time or runtime improvement claim. The synthetic single-kind fixture
does not substitute for O-09's mixed success/pending/failure driver proof or
a broad application workload.

Reproduce with a lockfile-pinned workspace and built TypeScript declarations:

```sh
node wasm/scripts/run-wasm-tests.cjs --task generated-source-census-o07 --report .test-results/o07-census.json
```

The full generated report is also written to
`wasm/.test-results/compiler-efficiency/o07/measurements.json`.
