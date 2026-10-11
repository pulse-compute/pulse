# PERF8-06: explain arena-removal memory behavior

Human direction: isolate the guest capacity regression and host RSS behavior
before changing allocation policy. Class: evidence; scope: evidence-only.
No named entry point exactly matches this investigation. The ordinary instruction
chain applies to performance experiments and this internal note. Production
compiler, runtime, provider, dependency installation, limits and defaults are
unchanged. Nothing is added to default CI or release profiles.

## Reproduce

Use the existing lockfile-pinned workspace, Node 24.19.0, unset NODE_OPTIONS and
JSON_CACHE, and commit the source before recording evidence. No Rust rebuild is
needed: this ticket isolates the two Pulse variants; PERF8-05 retains the Rust
comparison. Choose a new output directory outside the tracked source:

```bash
node wasm/test/performance/gc-baseline.cjs --out /tmp/pulse-perf806
node wasm/test/performance/gc-baseline.cjs --check /tmp/pulse-perf806/report.json
```

The runner preserves raw JSON, compile logs, generated source, control and
experimental Wasm, and a terminal campaign report. Workers are serial. Failed
attempts retain their files and must not be relabeled as completed. Do not use
these diagnostic runs as timing evidence or production qualification.

## Guest experiment

The unchanged Fastly allocation fixture builds and validates its ordinary
artifact. Its unpatched/patched hashes must reproduce PERF8-05; the patched
128 MiB failure remains an expected adoption blocker. Experimental artifacts
are compiled separately from the same generated source; they never pass through
or weaken the production ABI admission policy. The existing mock host executes
them with a process-local numeric diagnostic import.

The diagnostic ASC entry edits only its in-memory standard library source map,
after checking complete pinned ITCMS and TLSF hashes. It records allocation
sizes/types, currently managed bytes, GC thresholds/states, completed cycles,
full collection calls, and each growth request. At growth, it traverses free
lists to record total/largest free blocks. Numeric host callbacks allocate no
guest trace objects. Managed bytes include unreachable objects until collection;
post-full-collection figures establish what that collector still retains.

Controls/interventions:

- Trace-only capacity must match the uninstrumented artifact for both original
  payloads and a one-character payload.
- Full guest collection every 65536 allocations tests periodic collection timing.
- Full guest collection before allocations of at least 65536 bytes tests pressure
  from large requests. Neither is proposed production policy.
- Request-sized memory growth replaces doubling only in a diagnostic artifact;
  its allocation histogram and exact responses must match trace-only.
- A reduced version changes only the outer loop bound to an exported diagnostic
  variable. Run 0/1/64/128/256 iterations with one-character input, asserting the
  exact adjusted total and response digest. At 256 it must reproduce capacity.
- After validating the response, collect, then destructively clear the value
  table and collect again. This tests root retention, invalidates all handles,
  and discards the instance immediately. It is not a safe runtime cleanup API.

No input, assertion, production limit, GC setting or installed package is changed.
Wasm capacity is reserved linear address capacity, not process resident memory.
The existing fixture is a Fastly ABI mock under Node, not Viceroy or deployment.

## Host experiment

Build the exact two small schema artifacts from PERF8-05, verify both hashes,
and reuse its request execution and checkpoint schedule. Run observed/yielding
and unobserved request loops, natural and separate forced-host-GC processes,
three repetitions each: 24 workers, 6144 requests. Alternate variant order.
Add V8 GC performance entries, heap statistics and heap-space statistics at the
existing 1/11/41/128/256 checkpoints. Observed workers retain only weak references
to guest memories; unobserved workers have no guest census. The two schedules
must be analyzed separately.

RSS covers the whole process. V8 heap committed/physical bytes and live guest
capacity do not sum to RSS; external and arrayBuffers overlap. A zero weak-memory
census plus remaining RSS cannot identify every native allocation or establish
allocator fragmentation. Forced Node GC is not guest __collect(). GC performance
event delivery is asynchronous; drain queued events before saving the receipt.
