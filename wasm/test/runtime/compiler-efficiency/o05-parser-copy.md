# O-05 — Remove unescaped parser staging

O-05 implements the candidate selected by O-04 in the Fastly provider's generated
`__PulseJsonParser.string()`. The existing bounded scan now remembers whether
it encountered an escape or raw control character. A valid unescaped span is
copied directly into an owned substring. Other spans retain the existing
UTF-16 decoder and its error paths. No borrowed view or reusable scratch state
escapes the parser.

Entry point: `provider-fastly`. Additional owners: compiler-efficiency evidence,
test registry and suite-shape exclusions. This is performance hardening within
the existing provider contract; allocator policy, schema admission, handle
caches, value charges and effect boundaries are unchanged.

## Paired mechanism evidence

Baseline: O-04 merge `5bdc28aafab76c87abea4320154768e6277fbea9`. Both variants
use the same checkout dependencies, AssemblyScript 0.28.18, json-as 1.5.0,
incremental runtime and O-02 bounded page fixture. The diagnostic compiler's
uninstrumented control equals production Wasm bytes for each variant. Within
each variant, allocator-only and staged observers agree exactly on allocations,
collection schedule, peak and post-collection memory.

| Metric, 64 pages | Baseline | O-05 |
| --- | ---: | ---: |
| Decode allocation, bytes | 5,001,536 | 3,920,128 |
| Parser scratch allocation, bytes | 1,081,344 | 0 |
| Whole invocation allocation, bytes | 19,327,168 | 18,245,760 |
| Post-collection retained blocks, bytes | 5,807,424 | 5,807,424 |
| Production Wasm, bytes | 115,076 | 115,161 |

The measured decode reduction is 21.6%; whole-invocation allocation falls 5.6%.
Wasm increases by 85 bytes (0.074%). Responses, full hostcall traces, outbound
counts and cumulative byte/value charges match for 0, 1, 16 and 64 pages.
This is one build pair with one fresh process per case and instrumentation
mode. It establishes the removal mechanism; it does **not** complete O-06's
three-build, five-alternating-process runtime/noise qualification. No Viceroy,
deployed-service, RSS or lower retained-memory claim follows from these data.

## Regression coverage and replay

The permanent provider regression exercises 101 parser cases: empty and large
strings, Unicode and raw lone surrogates, escape boundaries, every raw control
character, malformed tokens and trailing input. It checks detached output after
input mutation and collection, retention across another parse, existing empty
and single-unit scalar sharing, and fresh handles for longer strings. Its
scratch observer verifies that only eligible tokens bypass the decoder.

The paired task also compares exact parser errors, error stages/effects,
handles and charges; schema outputs and hostcall traces; and graph ownership
with collection forced across projection, codec and freeze boundaries. Numeric
schema cases retain the existing codec spelling, including the documented
`100000000000000000000.0` counterexample: values are checked independently and
output bytes are compared directly between baseline and candidate.

```sh
node wasm/scripts/run-wasm-tests.cjs --task fastly-native-platform-capabilities --task fastly-conditional-kv --task bounded-read-loops
node wasm/scripts/run-wasm-tests.cjs --task parser-copy-o05 --task copy-chain-o04
```

`parser-copy-o05` is an opt-in evidence task. Its complete report is written to
`wasm/.test-results/compiler-efficiency/o05/measurements.json`; source hashes,
working-tree state and artifact identities bind each run. The checked-in
`o05-evidence.json` is a compact projection of a passing report. Both evidence
tasks require git history containing the O-04 merge. The permanent provider
regressions do not require that history. O-04 remains a historical replay and
its original checked-in measurements are unchanged.

Development retries corrected test-oracle mistakes, not production behavior:
the initial parser test assumed every string handle was fresh; the first numeric
schema check assumed Node's JSON spelling. Failed runner reports and task logs
were retained alongside the successful retry.
