# B10-MCP-06B — retrieval quality and whole-request callable cost

The subsequent [latest reconciliation](./merge-latest/README.md) regenerates the combined 264-record corpus and records fresh passing focused checks. Measurements below remain bound to their original revisions.

## Outcome

[PR #471](https://github.com/pulse-compute/pulse/pull/471) implements [#452](https://github.com/pulse-compute/pulse/issues/452). The final **24/24 frozen cases pass**: six exact names at rank one, six workflow questions and six filtered questions with relevant top-five citations, and six negative/ambiguity cases. All admitted production query pages match an independent direct-scanning/sort oracle, including counts, ordering, terminal/invalid offsets and exact citation/excerpt fields. V1/v2 outcomes and scores are retained; there are **0 relevance-rank declines** on the corrected corpus.

The original 23/24 result is preserved. `compare reports` failed in both versions because the comparison record lacked the exact plural token. [The source-grounded review](./REVIEW.md) explains the bounded correction: add the truthful `reports` tag to the canonical existing record. The frozen query, relevant IDs, criteria, encoder, weights and numerical budgets are unchanged. A separate byte comparison confirms all 263 records, original source content and citation identities are preserved; only that one tag list changes. Generated corpus/resource/application mirrors are regenerated normally.

## Sources and handoff

Base: `777f1e264a0a5006e8138b56311a795984de613a`, including merged 06A #469. Branch: `codex/b10-mcp-06b`. Final focused evidence ran on clean local `961daca`, published equivalent `19cf3d1d99dcf32ed2397157cb2adc3cd148400f`, identical full tree `5a9afa3775c4ceade7b9b11519f499290c024ff3`. The later contributor-environment documentation commit is local `9edb8ab`, published `ffed4568ba00e29267bc4e3430a370cf9356c235`, tree `a8d23cef4dae02935e388e1b80aec16b75ab8428`; resource freshness remained unchanged and documentation checks passed there. The final handoff commits add evidence only; the PR records the final head and dirty state.

The freeze commit is local `ba4c699`, published `8d5d529785a544c71c3ef65beaf95f8b0e25e5ea`, tree `97b46a76122260bc6f3a2e05a7047a9dcb76545d`. Initial growth ran on `d1910ee` / `e6f58220`; initial production/repeat on `d34ebae` / `1387485f`. The shard mapping is local `ee1d6c3`, published `ffd4578f9910b34aa14377e486df43cf3705c7a6`, tree `512624a298d1521f067f6eff8161f025e663a4d4`. Broader regression evidence retains that earlier exact source; final corpus changes have fresh focused/freshness evidence, not an invented later full-profile pass.

The fresh no-call replay started on `d34ebae` and reports clean `ee1d6c3` at completion. Only the three-line release-shard mapping changed during it; all compiled inputs were unchanged. It proves Node/Fastly no-call and imported-unused bytes identical to untouched baseline `e3bd03711ce15222fc318c6bb5ab5d68b51bfdbf`, plus 8 used-call executions and 12 rejection cases. The later corpus tag correction cannot reach those fixtures; its changed inputs are explicitly recorded separately.

No local checks remain running at handoff. No merge, release, deployment or self-approval. Next: **07A / #453**, packed source-free application qualification. Dependencies/dist were reused from the identical-lockfile 06A workspace, followed by the final workspace build; no fresh installed-consumer claim. GitHub CI is separate from these local receipts.

## Workloads and measurements

The finished authored `tools/call` request includes caller/callee schema conversions, resources, output validation, duplicated text/structured content and final MCP serialization. Parity runs Node Native, injected Fastly Native and Node JavaScript. V1 is the unmodified bundled host search handler using the same corpus.

The growth workload preserves all production records and reaches **512 rows, 3,946 terms and 65,278 nonzeros**, including a 1,024-term row, 24,576-byte Unicode/control-heavy text row and escaped metadata whose first page must reject as oversized. All limits apply jointly: **1,770,619 raw resource bytes** and **2,361,483 serialized bytes**. No corpus shrinkage or partial hits.

Budgets were fixed before measurement: 5 s request CPU/wall, 120 s per backend compilation, 8 MiB Wasm, 128 MiB committed guest memory, 64 MiB conservative retained values, 24 KiB complete tool result and 128 KiB whole MCP response. All measured ceilings pass. These are existing development experiment limits, not platform promises.

| Workload | Target | Wasm bytes | Cold / warm median CPU ms | Cold / warm median wall ms | Peak committed guest MiB |
|---|---|---:|---:|---:|---:|
| actual | node | 991,496 | 68.90 / 32.88 | 45.56 / 17.02 | 3.75 |
| actual | fastly | 1,043,406 | 61.59 / 26.90 | 32.09 / 15.41 | 7.50 |
| growth | node | 2,091,752 | 157.34 / 80.30 | 96.15 / 64.07 | 3.50 |
| growth | fastly | 2,143,700 | 177.26 / 82.67 | 116.71 / 69.18 | 14.00 |
| repeat | node | 991,574 | 112.84 / 37.97 | 62.14 / 25.44 | 3.75 |
| repeat | fastly | 1,043,499 | 60.59 / 31.95 | 33.54 / 18.90 | 7.50 |

Cold requests run in a fresh Node process without a previous module for those artifact bytes. Warm medians use nine complete requests, each with a fresh instance; no instance reuse claim. CPU is process CPU including conversions, serialization and potentially V8 background work, not guest-only instructions or Fastly billing. Peak committed pages are monotonic Wasm capacity, not live-object heap. Cold process peak RSS is recorded separately and includes Node/host dependencies. Fastly is injected ABI evidence, not 10A CLI/Viceroy or deployed-provider reality.

`actual` and `repeat` use identical `schema` queries. `repeat` calls the same computation twice at separate static sites, returns the second result, and shares the cumulative request budget. The aggregate delta shows the additional site's cost without claiming precise phase timing. Added Wasm: **78 Node bytes**, **93 Fastly bytes**. Growth uses eight terms and late pagination.

One complete physical vector backing and one text backing occur in initial memory even with repeated sites. The unused full metadata.bin backing is absent; existing finite citation literals remain. Per-record UTF-16 content-hash literal copy counts are retained, without claiming complete metadata accounting.

Production observation measures **12 host-exported allocations / 46,746 requested bytes**, **44,402 guest-to-host ABI string bytes**, and **12,310 value-JSON host-to-guest bytes**. These are scoped counters, not disjoint totals or a complete allocation census. Guest-internal allocation counts and peak live-object bytes remain null/unavailable. Retained bytes/values are conservative cumulative charges. Timing runs do not use the observer; observer/non-observer MCP bodies match byte-for-byte.

## Failure and validation results

Each workload passes ten Node probes: deadline expiry and allocation exhaustion in request setup, callable input, computation, callable output and final MCP serialization. Test-only allocation allowance is reduced to the current charge and the existing failure path executes; production ceilings never change. Deadlines become elapsed on phase entry and reject at the next existing checkpoint. Callable input has no interior clock sample: this proves cumulative rejection, not synchronous codec preemption. Each fault produces no successful partial result and is followed by a successful fresh request.

Each workload also passes five injected Fastly deadline probes at fixed fractions of its clock-check sequence; those fractions are not named guest phases. Fastly phase-specific allocation injection is not claimed. Request-setup zero-headroom allocation failure can surface `PULSE_EFFECT_INVOCATION_INVALID` after memory exhaustion closes invocation state. Raw evidence retains the masking diagnostic; no partial result escapes. Diagnostic precedence is separate runtime work.

The final focused runner passes **4/4** tasks, including the **123** resource-build/admission cases. Counted ordinary parity/timing executions: production **1274**, growth **44**, repeated-site **23**, plus the fault/recovery requests recorded separately. Build, maintainer, docs and documentation-release checks pass.

Broader development coverage: **69/69** selected unit/authority tasks have passing evidence across the retained original/retry/remainder reports. Uncovered tasks: **none**. The original aggregate is still recorded as failed and these reports are not pooled into a release seal. They ran on the earlier `ee1d6c3` tree. The first attempt lacked shard mappings; after correction, retained-report symlink admission failed with `REPORT_MISSING_ARTIFACT` instead of `REPORT_PATH` and passed unchanged on isolated retry. A later topology attempt hit `REPORT_ARTIFACT_HASH` and passed unchanged on retry; both attempts are retained. No root cause is invented for intermittent outcomes.

All development failures remain visible: initial corpus density exceeded the joint budget (reduced synthetic density, retaining every production row and 512 rows); the first clock fault started advanced instead of at zero (corrected test clock); original frozen relevance miss (corrected metadata); and initial over-strict review/allocation prerequisites (corrected to truthful evidence coverage, explained in REVIEW.md). The first documentation check identified the missing catalog entry for `PULSE_CONTEXT_QUALITY_DIR`; its contributor-only entry and both generated references were added, freshness rechecked and documentation validation rerun successfully. No frozen numerical threshold or relevance criterion was relaxed.

The release-owned change only maps three new tasks to the existing evidence shard. It is declared under the user's 06B implementation direction, with protected path review; release authority/publication behavior is unchanged.

## Frozen results

Rank is the first expected citation in the top five. A dash means absent or a case without a rank criterion. Before/after refers to the original/corrected corpus; v1/v2 ranks use the corrected same corpus.

| Case | Query | Before criterion | v1 rank | v2 rank | Final criterion |
|---|---|---|---:|---:|---|
| exact-1 | `compile` | pass | 1 | 1 | pass |
| exact-2 | `inspect` | pass | 1 | 1 | pass |
| exact-3 | `report` | pass | 1 | 1 | pass |
| exact-4 | `PULSE_BINARY_RESOURCE_INVALID` | pass | 1 | 1 | pass |
| exact-5 | `PULSE_CALL_SOURCE_PLACEMENT` | pass | 1 | 1 | pass |
| exact-6 | `PULSE_REQUEST_BODY_INVALID_UTF8` | pass | 1 | 1 | pass |
| workflow-1 | `configure project` | pass | 1 | 1 | pass |
| workflow-2 | `request body limits` | pass | 1 | 1 | pass |
| workflow-3 | `declare schema registry` | pass | 1 | 1 | pass |
| workflow-4 | `parallel fetch` | pass | 1 | 1 | pass |
| workflow-5 | `build selected target` | pass | 1 | 1 | pass |
| workflow-6 | `compare reports` | FAIL | 1 | 1 | pass |
| filtered-1 | `node native` | pass | 1 | 1 | pass |
| filtered-2 | `fastly` | pass | 1 | 1 | pass |
| filtered-3 | `schema declarations` | pass | 1 | 1 | pass |
| filtered-4 | `fetch` | pass | 3 | 2 | pass |
| filtered-5 | `jwt` | pass | 1 | 1 | pass |
| filtered-6 | `build` | pass | 1 | 1 | pass |
| failure-1 | `zzzz_no_such_term` | pass | — | — | pass |
| failure-2 | `schéma` | pass | — | — | pass |
| failure-3 | `...` | pass | — | — | pass |
| failure-4 | `one two three four five six seven eight nine` | pass | — | — | pass |
| failure-5 | `simultaneous upstream requests` | pass | — | — | pass |
| failure-6 | `schema` | pass | — | — | pass |

## Replay

Use the pinned producer Node 24.18.0 and workspace dependencies:

```bash
node wasm/scripts/run-wasm-tests.cjs --task pulse-context-quality-actual --task pulse-context-quality-growth --task pulse-context-quality-repeat --task pulse-context-build
```

Each quality task has a 240 s timeout and cleans its temporary compiled application. Raw Wasm is ephemeral; receipts retain exact hashes, byte lengths and reproducible source identities. `PULSE_CONTEXT_QUALITY_DIR` selects receipts (default `wasm/.test-results/context-quality`). Registered execution enforces acceptance. Explicit direct `--measure-only` is development collection only, not acceptance. `status: completed` is separate from `acceptance: passed/blocked`; blocked acceptance exits nonzero.
