# MEM03 — avoid the final explicit-encode materialization

Entry point: `provider-fastly`. Class: hardening. Baseline: merged GEN01,
`8a6f2ff45baf3d60b7819f0788d8ad6ab6331204`. The implementation is confined to
`packages/provider-fastly/src/build/native-platform-capabilities.js`. The
provider registry and target realization paths require review; their public
contracts, hostcalls, bindings and effect authority are unchanged.

## Selected path

MEM01 selected explicit `ctx.encodeJson` for a closed text/boolean schema. The
provider still projects the input into fresh containers, serializes the
projection and runs the portable codec. On the eligible path, the normalized
codec text becomes the result. The provider no longer reparses that text into
another request-rooted handle graph and serializes the graph a second time.

The static selector admits only a closed object root using the existing
presence codec, containing strings, booleans, closed objects, arrays and
nullable wrappers, with structural depth at most 16. Schemas with numeric,
enum, dynamic/open JSON, explicit JSON limits, required-only struct codecs or
greater depth retain the established path. The presence-codec restriction
keeps this first implementation within the codec family exercised by MEM01.
Selection is per registered ID. Registered IDs and codec exports remain intact.

Every plan containing a bounded read loop retains the original path for the
entire execution. PS3 charges and terminal failure points are therefore
preserved without virtual charges, reclamation or refunds. Explicit decode,
request/fetch JSON, response JSON and JWT schema validation still request a
value graph. Their internal calls use the default `textResult = false`.

## Paired result

The fixed near-bound input is 59,081 UTF-8 bytes. Three independent traced
instances per implementation produced exactly equal allocation and collection
metrics. Sizes below include TLSF block alignment and GC headers.

| Metric | Baseline | MEM03 | Delta |
| --- | ---: | ---: | ---: |
| Cumulative allocated bytes | 4,461,616 | 3,866,480 | −595,136 (13.3%) |
| Peak outstanding allocator bytes | 3,841,200 | 3,543,568 | −297,632 (7.7%) |
| Outstanding bytes after explicit collection | 2,295,184 | 2,174,608 | −120,576 (5.3%) |
| Uncollected terminal outstanding bytes | 2,592,048 | 3,543,568 | +951,520 |
| Encode reparse handles | 13 | 0 | −13 |
| Distinct value-table UTF-16 text bytes added by encode reparse | 118,074 | 0 | −118,074 |
| Wasm linear-memory capacity | 5,242,880 | 5,242,880 | 0 |
| Complete generated source bytes | 117,093 | 117,327 | +234 |
| Final optimized Wasm bytes | 102,478 | 102,560 | +82 |

This establishes reduced allocation work, a lower allocator peak and lower
post-collection retention for the affected fixture. It does **not** establish
lower uncollected terminal memory: changing allocation changes GC scheduling,
and more garbage remains pending collection at response completion here.
Linear-memory capacity is unchanged. These are guest allocator measurements,
not Node RSS or deployed Fastly memory. Static data, shadow stack, allocator
metadata and spare pages are excluded. The distinct-text counter measures
represented UTF-16 data, not every physical memory copy. There is no compiler
time improvement claim; the small source/Wasm increases are recorded above.

The closed numeric and bounded-open controls have byte-identical complete
source and final Wasm, with identical allocator results. The PS3 control also
has byte-identical source and Wasm, equal effect traces and equal cumulative
value/byte accounting. The exact artifacts and source hashes are retained in
[the compact evidence](mem03-encode-evidence.json).

## Correctness and observation controls

- Forty-one paired semantic cases compare exact response bytes or failure
  category/stage, together with injected hostcall traces. Independent expected
  values/text check field projection/order, duplicate keys after unescaping,
  optional absence, nullable objects and array elements, booleans, all BMP code
  points in bounded chunks, control escapes, surrogate pairs and unpaired
  surrogates. Near-bound and malformed input controls remain present.
- Authored mutable aliases remain mutable after encoding; later mutation cannot
  change the already returned text. The retained MEM01 stage readers show the
  decoded input remains deeply frozen, projection containers remain fresh,
  scalar sharing is unchanged, and only the eligible encode reparse disappears.
- Invalid encode types and oversized output fail before a following config
  effect. Admission and portable validation still execute. One escaped-field-name
  case traps in the existing pinned portable codec on both baseline and candidate;
  the test preserves that failure and does not claim to fix or broaden it.
- Forty-two memory cases across three schema families run in both production
  modules and three diagnostic modes: allocator trace only, stage observation,
  and collection at each stage. Outcomes and host traces match production.
  Trace-only and staged allocation totals, peak and terminal/post-collection
  values must match exactly. Forced-stage collection must preserve ownership.
- For each family and implementation, the diagnostic compiler's uninstrumented
  control must reproduce the optimized production Wasm byte for byte. The
  recipe retains default optimization/bounded merging, incremental GC,
  AssemblyScript 0.28.18 and json-as 1.5.0 strict `NAIVE` mode. Diagnostic
  imports/exports are confined to temporary source.

## Reproduction and provenance

```sh
node wasm/test/runtime/compiler-efficiency/mem03-encode-materialization.cjs
node wasm/test/provider/assert-fastly-schema-encode-text.cjs
```

The first command loads the baseline generator verbatim from git, with every
other production dependency shared and unchanged. `PULSEWASM_MEM03_BASE` can
select a different baseline explicitly. It writes the full atomic progress
ledger and diagnostic artifacts beneath
`wasm/.test-results/compiler-efficiency/mem03/<run>/` and records source revision,
dirty tree, baseline/candidate owner hashes, harness hashes, lockfile hash and
toolchain settings. The committed compact ledger is a projection of the
completed `2026-09-25T03-37-30-411Z/measurements.json`; its `fullReportSha256`
identifies the original. It retains every semantic case, every trace-only
memory result, repeated near-bound samples, ownership and collected stage
snapshots for the near-bound cases. Redundant stage metrics are replaced with
the equality assertion result. Full raw reports can be regenerated by the
command above.

Development first passed the original corpus, then added broad Unicode,
encode-only failures, aliases, nested shapes and PS3 controls. The expanded
fixture initially lacked its test KV binding and expected an escaped-key codec
case to succeed; these test assumptions were corrected using baseline evidence.
The earlier passing memory report is retained in the ignored results directory;
only the final expanded run backs this record. Current source hashes match that
run. The MEM01 observer now accepts both generated signatures and explicitly
reports zero reparse handles when that stage is absent.

The permanent semantic checks run inside `fastly-native-platform-capabilities`.
Scope-selected validation comprises the unit, native, JavaScript, conformance
and providers profiles, the workspace TypeScript build, and the maintenance
check. No deployed service is part of this acceptance. The PR records their
terminal results.
