# AN9-09 normalization evidence

Measured on Node 24.19.0 from base `2c04ac8d2fbd95114554eabec88e7dd923c183ca`.
This is focused implementation evidence, not release acceptance. Machine results
and input/codec hashes are in `measurements.json`. Timings are single observations
on a shared host, not statistically established performance guarantees.

| Input | Canonical UTF-8 JSON | Normalized UTF-8 JSON | Raw savings |
| --- | ---: | ---: | ---: |
| Historical Catalog VIS05 | 33,776,510 | 3,575,340 | 89.41% |
| Small compiled application | 28,483 | 14,930 | 47.58% |
| AN9 repeated mounts/helpers | 306,997 | 79,306 | 74.17% |

Normalization preserves the complete canonical JSON byte sequence on round trip.
Neither compression nor evidence removal contributes to these percentages.
Catalog analytics account for 30,050,186 bytes of the baseline. Its 642,369 string
occurrences occupy 24,660,678 bytes; 24,126 distinct strings occupy 1,597,814 bytes.
The encoding uses 85,874 value/subtree nodes and 59 object layouts. These are
nested accounting categories, not additive independent savings. Long identities,
source evidence, facts, association paths and repeated subtrees all use this same
exact-value interning; there are no domain-specific identity rewrites.

**Catalog qualification limit:** the real input is the retained payload from
`Pulse-Catalog-VIS05.html`, produced by beta.8/AssemblyScript 0.28.18 using
`experimental-native-bounded-size`. Its original source fingerprint and revision
are unavailable. It exceeds the current 16 MiB expanded limit. Production rejects
both its original and normalized forms. Only the measurement process uses an
isolated 64 MiB / 2M-node codec to prove losslessness and measure decode; no product
limit override exists. Catalog validation, product HTML rendering and browser
first paint are unqualified. Do not present 3.58 MB as a newly admissible report.

The small sample is a real compiled `Pulse({auto:true})` application with one
`GET /hello` handler returning `ctx.text('Hello')`. The repeated sample comes from
`wasm/test/support/report-analytics-fixture.cjs` with variant `http` (including
HTTP errors, reused handlers, scoped middleware, nested imports and helpers).
Both use `compileNativeProject` with `emitWat:false`, default Native optimization,
and passive `collectArtifactReport`; source, recipe and artifact identities are
recorded with the metrics. The combined error/event Native defect #329 is separate.

Actual standalone HTML bytes (base scripts versus new scripts, same semantic
capsule, CSS and shell): small 195,277 → 188,788; repeated 473,921 → 253,224.
The general measurement tool also reports a *same-current-shell* comparison to
isolate payload savings; that denominator includes the new decoder on both sides.
Catalog's original HTML is 33,986,644 bytes, but an admitted replacement HTML is
not claimed. Embedded escaped-data bytes are recorded separately for every input.

Actual completion-sidecar totals: small 20,282 → 12,638; repeated 235,814 → 71,757.
These totals use the build's retained **seed inventory**, not the enriched replay
capsule used in the report-size table. Unaffected attribution sidecars contribute
2,028 and 17,473 bytes respectively. Source-input receipts retain their original
encoding and are outside these completion-sidecar totals.

Compression is separate: gzip level 9 Catalog data is 2,957,019 → 1,270,921 bytes;
Brotli quality 5 is 1,420,368 → 1,241,301. On small reports and some repeated-report
Brotli results, table indexes compress worse than the repeated expanded strings.
Raw reduction is not a universal compressed-size improvement.

The codec-only Catalog observation took 675 ms to encode and 1,223 ms to decode;
its full measurement process peaked at 703 MB RSS, including both representations,
exact byte assertions and compression. This is not isolated decoder allocation.
Admitted samples took 2–7 ms to encode, 4–17 ms to decode, 25–141 ms to validate,
and 16–163 ms to render standalone HTML on the server. Separate fresh-process
model-startup observations were 3.00 → 11.26 ms (small), 11.13 → 45.85 ms (repeated),
with peak RSS 40,704 → 45,236 KiB and 46,312 → 51,628 KiB. They include JSON parsing,
view-model creation and initial route projection; the old path eagerly constructs
its export string, the new path defers it. They do **not** measure DOM layout or
browser first paint. Browser startup/memory qualification remains at the sprint
boundary; these results disclose added decoder work rather than claim a speedup.

Reproduce size/codec observations in a fresh process for each retained canonical
capsule with `node wasm/test/cli/measure-report-normalization.cjs INPUT.json`.
Use `--model-runtime` on canonical and normalized files separately for startup/RSS.
Only for the historical oversized prototype, use `--oversize-codec-only`; this
asserts production rejection before the isolated experiment. Exact runtime totals
vary with measured build durations. No source/Wasm/recipe is changed to improve
normalization results.

Focused qualification: capsule/codec contract (including old goldens, version
binding, malicious references/dictionaries and expansion bombs), viewer/CSP/export,
CLI workflow, retained lifecycle, imported passive replay, and integrated AN9
handler topology. Integration covers default and bounded-size HTTP/error and
HTTP/event cells, 112 executions, exact plan/source/Wasm parity, naming, ordered
mount paths, source-free report HTML and semantic comparison. Full profiles,
installed/browser acceptance, release qualification and seal remain deferred.
