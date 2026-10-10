# PERF8-05: conditional JSON cache arena experiment

Human direction: test removal of the disabled json-as arena, repeat PERF8-04's
memory comparison, and adopt only if the evidence supports it.
Class: evidence; scope: evidence-only. Entry point: schema-codecs. Additional
owners: performance experiment tools, an opt-in test-registry selection, and
this internal documentation. Production compiler, provider, runtime, dependencies,
GC settings, limits, package exports and defaults remain unchanged.

**Adoption is blocked.** The candidate removes a real 1 MiB startup allocation
and reduces RSS in the original short workload, but breaks the existing Fastly
schema allocation limit: 110 MiB unpatched becomes 148 MiB patched, exceeding
the unchanged 128 MiB bound. Correct output alone does not qualify this change.
The implementing PR retains the reproducible experiment and upstream-ready
patch, not an enabled production optimization.

## Candidate and controls

The pinned json-as 1.5.0 source allocates its default string-cache arena even
when `CACHE_ENABLED` is false. [The minimal patch](json-as-1.5.0-cache-arena.patch)
makes `ARENA_SIZE` zero in that case. The enabled branch retains the original
size calculation, including its minimum. Arena bounds remain consistent. A
zero-length managed buffer remains; other codec allocations are unchanged.

`wasm/test/performance/schema-cache-arena-transform.cjs` applies the expression
change with the active AssemblyScript AST class, after checking the complete
upstream source SHA-256. Missing, duplicate or changed source fails compilation.
Only isolated test workers inject this transform after json-as. There is no
production hook, configuration flag, dependency fork or node_modules mutation.
The exact source patch can be reviewed upstream independently; a workspace-only
pnpm patch would not reach downstream npm consumers if later adopted.

The original prototype also applied the adapter to all three Fastly schema
build paths and packaged it with build-support. That prototype was rejected
when the existing allocation test failed. Its completed packed Catalog smoke is candidate evidence, not evidence that the
final product enables the patch. [The consumer prototype patch](consumer-prototype.patch)
preserves the exact adapter/packaging changes for a disposable checkout; it
passes `git apply --check` against the unchanged production source. It must not
be enabled by default while the allocation gate fails.

The opt-in `schema-cache-arena` proof builds unpatched and patched artifacts for
an unset cache, explicit `false`, `true`, 65536 bytes and a one-byte request
exercising the minimum. It checks complete response/effect/lifecycle parity,
invalid inputs, escaping, Unicode and larger strings. All enabled-cache artifacts
must be byte-identical. This does not newly qualify upstream caching behavior.
Default initial linear capacity is 1,245,184 bytes unpatched and 65,536 patched.

## Reproduction and admission

Use the pinned workspace and Rust setup from PERF8-03, unset JSON_CACHE and
NODE_OPTIONS, commit source, and choose new output paths:

```bash
node wasm/scripts/run-wasm-tests.cjs --task schema-cache-arena --no-report
node wasm/test/performance/arena-baseline.cjs --out wasm/.test-results/arena-first.json
node wasm/test/performance/check-arena.cjs wasm/.test-results/arena-first.json
node wasm/test/performance/arena-baseline.cjs --out wasm/.test-results/arena-repeat.json
node wasm/test/performance/check-arena.cjs wasm/.test-results/arena-repeat.json
node wasm/test/performance/arena-stress.cjs --out wasm/.test-results/arena-stress.json
```

Each campaign builds unpatched Pulse, patched Pulse and unchanged Rust for the
same minimal and schema/effect plans. The test-owned build receipt records the
actual intercepted recipe and discards production metadata that observes argv
before interception. Unpatched schema Wasm must match PERF8-04; minimal artifacts
must agree across Pulse variants. Experimental artifacts are never production
reporting or package-acceptance evidence.

The campaign reuses PERF8-04's Node workers, payloads, phase observations,
1/11/41/128/256 checkpoints, natural and separate forced-GC processes, and three
repetitions. It rotates the three implementations across repetitions. Each run
requires 180 sweep workers, 18 unchanged timing controls, and two sets of ten
paired behavior cases. Both Pulse variants are separately validated against Rust
and the complete existing memory-report rules. Additional checks bind transform
and cache provenance, initial capacity and causal controls; 21 negative cases
exercise rejection. Source, dependencies and Rust toolchain must remain clean
and unchanged throughout a campaign.

`arena-stress.cjs` executes the existing Fastly schema allocation test unchanged
in two isolated processes. Both payloads must pass exact response, escaping and
SHA-256 assertions before the patched variant fails its final capacity bound.
The report says **completed / adoption blocked**, not that the candidate passed
the existing test. Unexpected failures are rejected. Production limits and GC
settings are never adjusted to make the candidate pass.

See PERF8-04 for observation limits: RSS is process-wide, linear capacity is not
resident bytes, external and arrayBuffers overlap, WeakRef diagnostics require
yields, and forced GC is a separate diagnostic. Timing comes only from unchanged
unobserved controls. Three process samples are descriptive evidence, not
confidence intervals, production-memory predictions or general leak verdicts.

## Decision

Do not ship the conditional arena patch by itself. Removing an eager allocation
changes allocator and collector behavior beyond the nominal bytes saved.
AssemblyScript's pinned TLSF allocator grows memory geometrically; its incremental
collector also depends on allocation totals and thresholds. These are concrete
reasons to investigate sensitivity, not a proven attribution of the stress result
to one particular mechanism. Tuning GC, retaining dummy allocations, raising the
limit, or changing initial-memory policy is outside this experiment.

A follow-up must explain and remove the large-payload regression, then repeat
short and long request-count sweeps plus the existing allocation bound before
reconsidering a default change. Keep the startup allocation finding separate
from the unresolved longer-run RSS behavior.

## Implementing evidence (2026-10-10)

The two final campaigns ran at local source
`c95c30e4db854ab4ed46452e9c60b7d5e9f5c3eb`, tree
`e5d0ff823d24599b1baafbb4361143069974efb2`, with a clean working tree.
Public source commit `bda674be08dd3e1d2857378077322a94779be734` has that exact tree;
raw local measurement identities have not been rewritten. Only result
recording and the archived consumer-prototype patch follow those measurements.
Node 24.19.0, Rust 1.99.0, source, environment, protocol, dependencies, toolchain
and all six artifact identities match across both campaigns. Both unpatched
Pulse and Rust reproduce PERF8-04's Wasm hashes.

Each final run completed 180 sweep workers (46,080 iterations), 18 unchanged
reference workers (738 requests), and 20 paired preflight cases (40 observations).
Elapsed times were 221.94 and 218.76 seconds. Both report validators and all
21 negative admission cases passed. The earlier production-adapter pilot is
retained separately; it is not one of these two final campaigns.

Each RSS cell below is the median of three independent processes, first / repeat,
in MiB. Complete-path rows use the small payload and unobserved scheduling.

| Observation | Unpatched Pulse | Patched Pulse | Rust |
| --- | --- | --- | --- |
| Natural GC, 41 requests | 100.99 / 100.68 | 59.36 / 59.25 | 60.82 / 59.96 |
| After forced GC, 41 requests | 57.63 / 60.14 | 57.68 / 58.81 | 56.66 / 56.40 |
| Natural GC, 256 requests | 86.91 / 83.34 | 94.07 / 97.31 | 66.91 / 68.31 |
| After forced GC, 256 requests | 67.98 / 69.19 | 73.38 / 74.34 | 68.88 / 67.20 |
| Instantiate only, natural GC, 41 iterations | 76.87 / 77.18 | 54.58 / 55.00 | 52.72 / 52.77 |
| Codec only, natural GC, 41 iterations | 74.68 / 76.57 | 55.48 / 55.46 | 53.59 / 53.77 |
| Codec only, after forced GC, 256 iterations | 57.21 / 57.96 | 63.76 / 63.58 | 56.09 / 56.84 |

The original roughly 40 MiB short-run RSS gap disappears in this counterfactual.
The longer-run result is worse for the patched variant, including the separate
post-GC diagnostic. This experiment does not attribute that residual process
RSS to a specific host or guest allocation. Of 144 final observed forced-GC
censuses across both campaigns, 143 have zero live memories and one patched
small-payload worker retains one 64 KiB memory. That does not establish a leak
or explain the multi-MiB RSS residual.

First-request medians in the unchanged timing workers were 19.33 / 20.84 ms
unpatched, 19.11 / 18.54 ms patched, and 20.02 / 21.45 ms Rust. The median of
three per-process warm medians was 2.694 / 2.255 ms unpatched, 1.811 / 1.695 ms
patched, and 2.057 / 1.962 ms Rust. These are descriptive results, not a release
performance threshold or a statistically established speedup.

### Artifact and allocation proof

The schema artifact changes from 39,479 to 39,476 bytes. The complete Binaryen
130 disassembly differs in exactly one operand: the start function's call to
exported `__new` for ArrayBuffer type 1 uses zero rather than 1,048,576 bytes.
The two Wasm hashes are respectively
`b12dc0793501ca703a64d790291ebaef6652cdca3ba577cab6dc60f9d3ce1a13` and
`d1e19b5900999d58e850c293bd7880b73332f3190ac9c28a28ae80f84ed94260`.
Enabled-cache artifacts are byte-identical for all three tested settings.
The schema-free Pulse artifact remains 808 bytes and unchanged.

Small-payload initial/max observed linear capacity falls from 1,245,184 bytes
to 65,536. The escaped-Unicode sweep's max observed capacity falls from
2,490,368 to 262,144. These local capacity savings do not predict process RSS
at every request count or capacity in the independent stress fixture.

The unchanged Fastly stress fixture instead uses **115,343,360 bytes (110 MiB)**
unpatched and **155,189,248 (148 MiB)** patched. Both payloads produce exact
expected responses and digests; the patched artifact then fails the original
134,217,728-byte limit. The isolated reproduction records that expected failure
and keeps adoption blocked. No limit, initial-memory policy or collector setting
was adjusted.

### Catalog and validation

The rejected consumer prototype was packed and npm-installed in an isolated
Catalog copy at Catalog revision `54a5bb5876f228a5778b66fb9beb2b2007cf5d18`.
Its local Pulse source is `b73851ede6ae8f7d5f9e15f3ec92eb1d7bd8c964`, tree
`c9d24c7a56ffd92e394a9e9df0ce8c06bc2cf7d3`; the archived prototype patch captures
its production changes. All 20 installed packages' source/distribution/metadata
files were checked against the tarballs. The API workspace's older beta.5
requirements were aligned to those same local candidates for this isolated run.

The build and report completed in 538.99 seconds with
`experimental-native-bounded-size`, optimize 3, shrink 2, no convergence,
`emitWat: false`, and a 720000 ms timeout on each compiler. The early part of
this build overlapped focused tests; elapsed time is completion evidence, not
a comparative build-speed measurement. Both compiler observations identify the
arena transform. Portable/provider Wasm sizes are 2,690,558 / 2,839,688 bytes.
Five health/contract/schema/404 cases pass with exact expected JSON; project and
artifact capsules, JSON round-trip, embedded HTML payload, deterministic HTML
and section-byte accounting agree. Reporting leaves both Wasm hashes unchanged.
The inventory is 100 routes, 255 entries and 136 schemas. This is candidate-only
functional evidence; no deployment or full Catalog acceptance suite was run.

Final opt-in arena proof, unchanged production Fastly platform suite, and Fastly
Entities workflow all pass. The optional exact-artifact Viceroy lane was not run
because PULSE_VICEROY_BIN was absent. The earlier prototype passed the complete
schema-codecs and Fastly HTTP-effects suites before the platform allocation gate
rejected it. Schema-registry and one-compile schema smoke also passed. Final
maintenance, documentation and scope checks are recorded in the PR. These are
focused development checks, not complete release qualification.

Preserved development failures include the first proof's incorrect capacity
expectation, an initially unmapped release-task registration, the candidate's
real allocation failure, a Catalog installation with duplicate old/new packages,
and an outdated smoke-harness manifest field. The latter two were corrected in
the isolated setup/harness; the completed Catalog build was reused for the smoke
retry. No failed report was relabeled as passing.
