# GEN03 — closed flat-object projector code sharing

Entry point: `provider-fastly`. Class: hardening following bounded semantic proof. Base: merged GEN02, `08f7521e4250065d9725119372282fe2d6085533` (tree `8004d2aaa6593653e4445ccfbe762b7522d27cb6`). The baseline worker checkout has the same tree, with pre-publication commit `07b5670e45d30cd493a04eb364b2372371625ea7`.

## Scope and result

`generateSchemaRuntime` shares exact emitted closed flat-object bodies after resolving their scalar child functions. Eligibility is limited to fields of string, boolean, i32, u32, f64, and string-enum kinds; optional scalar fields are included. Function-local names are stable within this family. Each call still runs `host_value_object`, creates its own projection, and preserves validation and error order. Field names/order, requiredness, scalar bounds and enum values/order participate in the emitted-body match. Nullable, array, open and non-flat object functions remain separate, while flat children beneath those containers can share code.

Registry IDs and dispatch remain explicit. Per-schema JSON limits and direction-specific codec behavior stay outside the shared helper and are checked per ID. There is no descriptor interpreter, value/container interning, public option, ABI change, registry pruning, or compiler recipe change.

The accepted metric is reduced generated source for repeated flat shapes. **Compiler peak RSS increased on the repeated-schema fixture; this is a tradeoff for human review, not a compiler-memory improvement.** No runtime-memory benefit is claimed.

## Paired compiler evidence

The [sample ledger](gen03-structural-sharing-evidence.json) contains the confirmation screen plus the initial compiler samples. Both screens passed: three serial, alternating pairs for each of three GEN01 cells, **36 compiler executions** total. Each compile runs in an isolated worker with the lockfile-pinned toolchain and default optimization. Source attribution runs separately. The production emitter, lockfile and compile worker hashes match across both screens. The second screen followed an RSS increase in the first; the driver also corrected its runtime timing label to acknowledge engine caching.

| GEN01 cell | Complete source bytes | Final Wasm bytes | ASC median ms (6 per variant) | ASC peak RSS median MiB (6 per variant) |
| --- | ---: | ---: | ---: | ---: |
| schema-1 | 111,524 → 111,598 | 66,135, byte-identical | 2,565.5 → 2,525.0 | 318.83 → 315.06 |
| schema-32-repeat | 177,987 → 142,737 | 70,206, byte-identical | 3,354.5 → 3,199.5 | 310.80 → 333.21 |
| schema-16-diverse | 174,201 → 174,826 | 123,327, byte-identical | 5,831.0 → 5,791.5 | 329.06 → 317.71 |

At 32 repeated schemas, complete source decreases **35,250 bytes (19.80%)**. The provider projection bucket falls **49,382 → 14,132 bytes**; its declarations fall **38 → 7**, including **32 → 1** flat-object projectors. The portable codec bucket is unchanged. Final Wasm bytes and hashes are identical in all three scaling cells and all samples.

The one-schema and diverse controls grow by **74** and **625** bytes respectively, from longer private helper/local names. The diverse fixture has no equal flat subshapes to merge. Different schemas are deliberately not collapsed.

For the repeated cell, the compiler RSS median rises **7.21%**. The initial screen medians were 305.43 → 340.90 MiB; confirmation was 316.17 → 325.52 MiB. Across all six pairs, baseline ranges 297.33–324.52 MiB and candidate 323.97–342.35 MiB. The limited overlap and repeated direction make this a regression signal. Time ranges overlap in each cell; no compiler-speed improvement is established. These are subprocess maxima, not live guest memory, and the cause of the RSS signal is not established.

## Semantic and ownership proof

`assert-fastly-structural-sharing.cjs` is called by the existing `fastly-native-platform-capabilities` task. It checks deterministic generation, source-only/compiled entry agreement and isolation between generations. Its 13-ID fixture exercises 86 encode/decode cases: ordered and reordered fields, required/optional/nullable differences, distinct names, signed/unsigned bounds, distinct and reordered enums, unknown-field projection, open-object preservation, duplicate-key direction rules, nested objects/arrays, Unicode, per-ID limits, invalid values and error stages. Every registered ID is invoked, including IDs unused by the production handler.

Temporary diagnostic exports directly compare handles and object pointers, mutate one of two projected outputs, mutate the original input and reproject, and project a nested/array graph whose input children are aliases. Outputs remain distinct and mutation does not cross into siblings or the input. Separate decoded outputs remain immutable. These probes share functions, never objects. The diagnostic compiler without instrumentation produces byte-identical production Wasm; instrumented and production responses and hostcall traces match. Private diagnostic exports do not enter production output.

Both baseline and candidate pass every control, with exactly equal response bytes, hostcall traces, errors/stages, imports and exports. The mixed semantic fixture's source falls **224,767 → 210,679 bytes**. Its final Wasm remains **138,218 bytes**, with different binary layout; it is not claimed byte-identical. Five repeated full-host executions per variant run in separate measurement processes after the controls. Engine compilation may already be cached; these are not cold-start samples or a production latency claim. Their ranges overlap and show no demonstrated runtime regression on this fixture.

All execution here uses the injected Fastly ABI host, not a deployed service. No live heap or allocation-saving claim follows from source sharing. Existing schema materialization/accounting behavior remains in place.

## Reproduction

With a restored merged-GEN02 checkout and this checkout, run:

```sh
node wasm/test/runtime/compiler-efficiency/gen03-structural-sharing.cjs /path/to/merged-gen02-checkout
node wasm/scripts/run-wasm-tests.cjs --task fastly-native-platform-capabilities
node wasm/test/runtime/compiler-efficiency/assert-schema-cost-profile.cjs
```

The paired driver writes terminal status, fixture/owner/harness identities, source partitions, compiler samples and runtime/semantic outcomes beneath `wasm/.test-results/compiler-efficiency/gen03/`. Run it twice to repeat the two-screen measurement. The ledger records dirty-tree measurement state and the exact production owner hash; required validation is recorded against the committed candidate in the PR.
