# O-09 — freeze Fastly error-driver behavior

O-09 adds a repeatable behavior gate for O-10's driver factoring experiment.
It does not change the production emitter or claim a size, memory or compile-time
improvement. The baseline is merged O-08 on `latest`,
`0a5100a7a697171e50a840c6048763c8158f8474`.

Entry point: none. Class: evidence under the ordinary root/Wasm instruction
chain. Additional owners are the test registry and the release evidence shard
mapping in `scripts/release-evidence-bundle.cjs` (one task added to the existing
Fastly Native shard; no release authority or acceptance rule changes). The new
`fastly-driver-behavior-o09` task belongs to the `native` profile and therefore
the full portable/release profiles; it is not an opt-in benchmark.

## Controls and assertions

The generic Router fixture has one route, one application error handler, and
1/8/32 grouped effect sites. Sites alternate JSON fetch, config lookup and text
fetch. An eight-site sequential control inserts dependency guards so the
compiler cannot group independent awaits. The error handler adds no effect site.

The fixture asserts these independently specified outcomes:

- Distinct successful values at every site, a second set of response values in
  fresh instances, missing configuration and a valid zero-valued pending handle.
- Malformed JSON and wrong-schema recovery with exact public codes/statuses and
  provider error/stage/effect tuples; transport wait and send failures remain fatal.
- Every admitted site receives one positive, unique invocation ticket, settles
  exactly once in site order, and consumes its ticket before the real guest setter.
- Grouped siblings all begin before settlement and drain before continuation or
  recovery. Sequential failures stop later admissions. Ready config results and
  asynchronous fetch results both clear their provider pending mode before settlement.
- Fatal errors prevent resume; invocation completion/failure closes all tickets.
  Reentering `_start` performs no hostcalls or driver operations. A clean completed
  instance records state error 1007/stage 171; a previously fatal instance preserves
  its first error.

## Production parity and diagnostic probes

Each control is compiled twice through the unchanged Fastly provider: one
production binary and one test-only diagnostic binary. A local dependency
wrapper forwards the actual production AssemblyScript command, temporarily
adds tracing/private exports to that invocation's generated source, replays the
same compiler arguments with a different output filename, and restores source.
The production binary has no diagnostic import. Both binaries validate.

Every HTTP scenario compares the exact response, provider failure tuple and
complete mock-host trace between the two binaries. Diagnostic observations wrap
admission, resolution, settlement, the real guest setter, resume and application
error-taking. They read state without changing it when fault injection is disabled.
The extra exports/imports can affect optimization and memory layout, so this is
behavioral parity, not binary equality or performance evidence.

**Grouped Router fetch JSON projection happens on resume**, after the driver has settled
the fetch-response handles. The dependent sequential control instead decodes
during resolution and checks the saved provider error before resume. Malformed
HTTP data in the grouped control therefore does not exercise
the driver's saved recoverable-error arbitration. A separate, explicitly labelled
set of diagnostic probes injects JSON/schema provider errors immediately after
resolution. It uses the existing error recorder/schema context and lets the real
driver select, clear, settle and restore errors. These probes verify that the
first recoverable failure survives, the first fatal failure overrides recoverable
failures, a later recoverable failure cannot replace a fatal one, and siblings
still drain exactly once. They are fault-injection evidence, not claims about
where normal Router JSON decoding runs. Real two-transport-failure cases retain
the first fatal error.

Private ticket probes use the actual generated slot globals, ticket helpers and
guest setter. They reject duplicate admissions; zero, wrong, out-of-range and
cross-slot tickets; replay after settlement; stale tickets after rearming the
same slot; and late settlement/admission after close. Rejections preserve slot
state and never call the setter. Rearming deliberately retains the old result
handle while clearing readiness: an old ticket cannot make it ready or overwrite
it, and the new ticket installs the fresh value. These are instance-local
numeric tickets, not cross-instance capabilities. Private arming is not a public
ABI guarantee.

## Reproduce and inspect

```bash
node wasm/scripts/run-wasm-tests.cjs --task fastly-driver-behavior-o09 --no-report
# Deliberately refresh the checked-in baseline after reviewing behavior:
node wasm/test/runtime/compiler-efficiency/o09-driver-behavior.cjs --record
```

[o09-evidence.json](o09-evidence.json) records terminal status, source/test
identities, toolchain versions, each fixture's production/diagnostic hashes,
scenario outcomes, trace/event hashes and ticket/priority-probe summaries.
The recorded run passed all 42 HTTP scenarios, 14 injected-priority scenarios
and four ticket-probe suites (42 rejected operations, 11 accepted settlements).
Timestamped runs under `wasm/.test-results/compiler-efficiency/o09-*` retain both
binaries, complete traces/events and a running/passed/failed report. Failed
attempts are preserved. The runner asserts behavior rather than pinning binary
hashes, so O-10 may change generated code while retaining this gate.

The evidence uses AssemblyScript 0.28.18, strict json-as 1.5.0 and the provider's
normal optimization pipeline. It uses the deterministic Fastly mock host, not
Viceroy or a deployed Fastly service. It does not cover cancellation through a
throwing host import, every provider effect family, real scheduling/network
races, memory/performance changes or full release qualification. O-10 should
keep these fixtures and assertions fixed while factoring the per-site branch;
O-11 owns paired size/build/runtime qualification.

Development retries corrected fixture assumptions about grouped versus dependent
fetch projection, compiler grouping of independent awaits, and first-error
preservation on reentry. A first maintenance/unit attempt also identified the
missing release shard registration. Those failed reports remain in the local
timestamped run directories; the checked-in ledger is the completed retry.
