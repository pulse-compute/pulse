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
when the existing allocation test failed. Its packed Catalog smoke, if completed,
is candidate evidence, not evidence that the final product enables the patch.

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

Measured identities, completed validation and result tables follow below.
