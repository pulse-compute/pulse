# Nonterminal execution — investigation 1

Status: **completed internal experiment; no production contract change**.
Date: 2026-10-24. Base: `b421aa58b7df07cc5bcb060248026c660eaf5ae3`
(`hex-integration`). Follow-up to [authoring shapes](../DESIGN-01-authoring-shapes.md)
and [execution costs](../DESIGN-02-execution-costs.md).

Human direction: “Investigate nonterminal execution,” following the decision to
split further work into deliberate spikes without release pressure. This pass
investigates immediate runtime metrics and downstream facts. It does not approve
resource-owning operations, deferred child effects, a public API, or a merge.
No single named Entry Point covers the cross-owner internal experiment; the
ordinary root/docs instruction chain applies. Classification: evidence. All
writes stay in internal evidence; compiler, runtime and provider owners are read-only.

## Finding

A bounded, immediately completed observation can use the existing effect
invocation, result, continuation, group and collection machinery. The prototype
compiled and executed two package operations through direct await, keyed
`ctx.parallel`, and `ctx.effects` followed by parallel flush. Neither operation
needed a pending-resource registry or a new scheduler. Authored code can inspect
the structured result and branch after the await.

This is a credible narrow service candidate, not a finished general nonterminal
contract. The hardest remaining work is result typing/identity, service authority,
completion instrumentation, and report identity. Cache handles, delayed completion
and nested effects still need their own investigations.

## What the author writes

These are experiment APIs from the ephemeral `@hex-spike/observations` package,
not installed or supported Pulse exports. The executable sources are retained
with the artifact bundle.

```ts
const sample = await metrics.snapshot(ctx)

const facts = await ctx.parallel({
  metrics: metrics.snapshot(ctx),
  tls: downstream.tls(ctx),
})

const effects = ctx.effects({ max: 4 })
for (const item of inputs) {
  effects.add(downstream.tls(ctx))
}
const observations = await ctx.parallel(effects)
```

All three forms pass. Collections reserve capacity statically and dispatch only
the populated entries; the empty collection dispatches none. Parallel means
composition through the existing effect boundary, not simultaneous execution of
these synchronous host calls. Sequential snapshots are separate samples. A group
does not make measurements atomic or define their timing relative to other work.

The focused follow-up also executes both branches of:

```ts
const tls = await downstream.tls(ctx)
if (tls.protocol.status === 'available') {
  return ctx.text(tls.protocol.value)
}
return ctx.text('not-present')
```

The prototype returns field-level observations:

```ts
type Observation<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: 'not-present' }

type RuntimeSample = {
  vcpuMs: Observation<number>
  memoryMiB: Observation<number>
}
type TlsSample = {
  protocol: Observation<string>
  cipher: Observation<string>
}
```

TLS is deliberately an alternative to pass 1's whole-object observation: one
field may be unavailable while another succeeds. That makes partial facts easy
to represent, but leaves the package API decision open. Injected status `10`
exercises absence; its meaning for every actual ABI/status combination has not
been qualified. Other host failures and malformed values fail the effect; they
are not silently converted into absence or fallback.

## Execution and responsibility split

| Owner | Prototype responsibility | Contract work still required |
| --- | --- | --- |
| Package lowerer | Recognizes fixture calls; emits ordinary canonical package effects and existing host-extension artifacts | A real facade, declarations, binding-aware recognition and cross-target diagnostics |
| Package contribution | Calls two declared ABIs and writes bounded raw fields | Versioned entry/result layout, status mapping and authority requirements bound to identity |
| Provider adapter | Supplies permitted handle, validates fields, builds ordinary result values and completes the existing invocation | Stable service admission and result codec; remove source-replacement dependence |
| Existing runtime | Invocation tickets, budgets, continuation resume, keyed groups, collection slots and deadline fences | No new scheduling algorithm demonstrated necessary for immediate observations |
| Evidence owners | Existing import audit plus proposed capability/use-site rows | Separate unique contributions from their many use sites; standard report integration |

`prototype.cjs` temporarily replaces the existing host-extension module exports
inside one Node process, restores them in `finally`, and uses the real canonical
compiler and Fastly Native generator. It is a test adapter, not a registration
API or a production implementation. It replaces the terminal extension adapter
for the experiment; mixing terminal GRIP and observations is untested.

Package ABI source does not reference provider-private variables. Instance
metrics receive no request authority (the uniform entry receives `0`). TLS
receives the current borrowed request handle. No body handle, full ctx, binding
map, secret resolver or scheduler object is supplied. The descriptor deciding
this access is fixed in the experiment, not yet a validated package contract.
Declarations and trusted generated source are not a sandbox.

Each dispatch has a 160-byte raw payload frame, two poisoned status slots and
at most 64 bytes per ASCII field. The provider copies values into the ordinary
result representation. Invalid lengths/non-ASCII and u64 values exceeding the
safe JavaScript integer range are rejected. This is sufficient for the selected
TLS fixtures, not a generic UTF-8 or binary result protocol. The 160 bytes exclude
allocation headers, strings, result objects and runtime storage; no allocation,
latency or peak-memory benchmark is claimed.

The raw result setter rejects observation completion except during validated
invocation settlement. Two checked source replacements install that fence; they
remain generator coupling, not standardized lifecycle hooks. Existing closure,
cumulative-budget and request-deadline checks are reused. Calls are synchronous:
closure/deadline fences cannot interrupt a package entry midway, and both ABI
calls may execute before the result is rejected after return. A trap does not
produce a successful observation or an automatic retry.

## Contract and evidence gaps exposed

1. **Result typing remains incomplete.** The canonical effect declares `json`,
   but the Native plan carries `valueKind: unknown`. Property access and branching
   execute successfully; that does not establish a checked TypeScript or codec
   contract. The branch fixture retains an extra `fastly_http_resp.status_get`
   import through the existing generic property accessor's fetch-status path.
   The injected host throws if it is invoked, and both branches pass. This is
   retained code/import overhead, not a demonstrated fetch or request access.
2. **Result layout and authority need identity.** Current contribution source
   hashes do not bind the separate experiment descriptor. The proposed sidecar
   records a layout hash, but the production artifact schema/admission must own
   and validate these fields before this can be a stable service.
3. **Contribution identity is not use-site identity.** The current standard HEX
   reader accepts one site. It rejects the repeated collection with
   `REPORT_IDENTITY`: the provider manifest emits per-site entries while policy
   contributions are unique, and the reader expects matching counts and unique
   contribution IDs. Keep a unique contribution census and explicit many-to-one
   use-site membership; do not manufacture a contribution per reserved slot.
4. **Capability binding evidence is only proposed.** The receipt's
   `hex.proposed-capability-bindings.v0` rows carry operation, semantic capability,
   package, target, authority, source, continuation/site identity, contribution
   and layout identity. `namedBinding: null` means these are host capabilities,
   not fabricated named stores. The canonical carrier still says
   `host.extension`; these rows explicitly set `standardPulseReport: false`.
   They record selection, not runtime observation. There is no claim that normal
   `pulse report` already presents them correctly.
5. **Fixture discovery is intentionally narrow.** The builder recognizes exact
   `metrics.snapshot(ctx)` and `downstream.tls(ctx)` text, without robust alias or
   shadowing handling. Existing trusted package discovery and target rejection
   run, but this is not a reusable production lowerer or packed-consumer proof.
   JavaScript fixture methods throw “not implemented for this host”; JavaScript
   execution and public package typings are not qualified.

## Measured artifact costs

Raw Wasm bytes from the same recipe and compiler settings. The baseline returns
text, while used fixtures have different authored work; deltas include that work
and are not isolated service costs. No runtime-speed inference follows.

| Fixture | Effect slots | Bytes | Delta from baseline |
| --- | ---: | ---: | ---: |
| Production baseline / adapter with no usage | 0 | 23,413 | 0 |
| Imported but unused fixture | 0 | 23,413 | 0 |
| Direct metrics snapshot | 1 | 25,632 | +2,219 |
| Direct TLS observation | 1 | 25,430 | +2,017 |
| Keyed metrics + TLS | 2 | 26,363 | +2,950 |
| Snapshot collection, capacity 1, one entry | 1 | 25,995 | +2,582 |
| Snapshot collection, capacity 4, two entries | 4 | 26,977 | +3,564 |
| Snapshot collection, capacity 16, two entries | 16 | 30,444 | +7,031 |
| Snapshot collection, capacity 32, two entries | 32 | 35,113 | +11,700 |
| TLS collection, capacity 4, two entries | 4 | 26,949 | +3,536 |
| Snapshot collection, capacity 4, empty | 4 | 26,945 | +3,532 |
| Core time + snapshot | 2 | 26,894 | +3,481 |
| Two sequential snapshots | 2 | 26,116 | +2,703 |
| TLS field access and branching | 1 | 27,424 | +4,011 |

The absent adapter artifact is byte-identical to production baseline. Unused
import adds zero bytes, no observation imports and identical code-section bytes;
the whole artifact differs because the embedded plan hash changes. Generated
source differs only in that constant. This is not whole-artifact identity.

Capacity 4 to 32 adds 8,136 bytes for the same two executed samples. Immediate
completion does not avoid the existing statically reserved slots. This does not
justify changing collection mechanics in this pass, but capacity remains an
important ergonomic and size constraint. Test-only completion/deadline exports
produce a separate 26,587-byte artifact, excluded from service-cost comparisons.

## Evidence and reproduction

The final main run completed **25/25 checks**; the focused consumption run
completed **2/2 branches**. These are development experiments, not regression
profiles or release qualification. The checks cover:

- Absent/unused artifacts; both operations direct, keyed and collected; empty and
  capacity-scaled collections; sequential sampling; mixed core time/observation.
- Partial absence versus host failure; malformed size/ASCII; integer precision;
  trap behavior; one-site report acceptance and expected repeated-site rejection.
- Closure before/during dispatch; exhausted cumulative budget; raw-setter
  rejection during execution and after close; request deadline before dispatch
  and after host return; explicit Node Native target rejection.
- Authored field access and available/unavailable branching after await.

No pending fetch/observation mixture, cache resource, delayed callback, duplicate
or stale ticket injection, full terminal parity, allocation pressure, JavaScript
parity, Viceroy or hosted Fastly acceptance was run in this investigation.
A mocked ABI proves the selected execution path, not platform availability.

Reproduce from the recorded base plus these script bytes, with the existing
lockfile-pinned toolchain installed:

```sh
node docs/internal/host-extensions/nonterminal/run.cjs /tmp/hex-nonterminal-main
node docs/internal/host-extensions/nonterminal/consume.cjs /tmp/hex-nonterminal-consume
```

The runners write receipts even on failure and remove temporary package roots.
Use a fresh output directory for each attempt. [evidence-index.json](evidence-index.json)
indexes the retained receipts, logs, source identities and compressed raw
artifacts. The archive contains final authored/generated source, Wasm, manifests,
and earlier failed attempt receipts. [receipt.json](receipt.json) is the main
successful run; [consume-receipt.json](consume-receipt.json) is the focused retry.
Scripts are not installed or added to production test gates. Repository checks
and exclusions are recorded in [validation.json](validation.json).

The ledger preserves two failures: the first main run assumed whole-artifact
identity for an unused import; the first consumption run lacked a stub for the
retained generic `status_get` import. The former assertion was corrected to the
measured invariant. The latter gained a throwing, never-expected host stub; both
consumption branches and the full main selection then passed. Earlier fixture
placement exploration is not counted as a passing check. No product fix was made.

ABI signatures were checked against the Fastly 0.13.1 Rust sources/docs:
[compute runtime](https://docs.rs/crate/fastly/0.13.1/source/src/compute_runtime.rs),
[TLS protocol](https://docs.rs/fastly-sys/0.13.1/fastly_sys/fastly_http_downstream/fn.downstream_tls_protocol.html),
and [TLS cipher](https://docs.rs/fastly-sys/0.13.1/fastly_sys/fastly_http_downstream/fn.downstream_tls_cipher_openssl_name.html).
Source inspection is separate from engine qualification.

## Decision left for review

Keep immediate, bounded observations as the smallest candidate service. Specify
its result/authority descriptor, completion hook and contribution/use-site
evidence model before widening it. The prototype suggests that scheduling is
reusable; it does not remove the need for explicit contracts.

The next resource-ownership spike should test whether this narrow service can
remain narrow when pending handles, cancellation and cleanup enter the picture.
The later composition spike should address child effects separately. Neither is
automatically authorized or implemented by this investigation.
