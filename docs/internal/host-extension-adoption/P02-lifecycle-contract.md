# P02 — Shared lifecycle contract and dispatch planner

Status: **implemented contract/planner; driver integration remains P03/P09A**.
Date: 2026-10-25. Base: `latest` at
`79927b19a5f63adf5ad49fe120ba1257e925ba1d`, after P01 #544.
Branch: `adoption/p02-lifecycle-planner`; PR target: `latest`.
Human direction: “Implement p02,” under the [adoption plan](README.md) and
[P01 decision](P01-adoption-decision.md).

No exact named Entry Point covers the shared planner. Root/Wasm instructions
apply to shared contracts and maintained tests; root/docs instructions apply to
the decision record and current-contract update, with mirrors regenerated from
their canonical owner. Classification: architecture / architecture-change.
Effect/continuation and provider/target boundaries require human review; this
task authorizes implementation and PR preparation, not merge or release.

## Owners and compatibility

- [Execution semantics](../../../wasm/packages/contracts/src/handler/execution-lifecycle.js)
  preserve the six reviewed points and five composition kinds.
- [HTTP semantics](../../../wasm/packages/contracts/src/host/http-lifecycle.js)
  supply the four optional HTTP points and conservative response-authority states.
- [Planner](../../../wasm/packages/contracts/src/handler/lifecycle-planner.js)
  validates symbolic bindings and produces immutable JSON dispatch data.
- [Canonical invocation policy](../../../wasm/packages/contracts/src/handler/canonical-runtime.js)
  remains the single ticket contract. Its existing v1 policy gains explicit
  authentication, consume-before-delivery, rejected/trapped-delivery and closure
  postconditions. Execution semantics reference that same object. No ticket
  bank, scheduler or ABI version is introduced.

The two semantic modules adapt the research source at
`ecc36468b5900a0de57a415379b85d12c5026f3f`. The planner is new production-owned
code; it does not copy Fastly source anchors, emitted bodies or research harnesses.
All three objects are reachable as `executionLifecycle`, `httpLifecycle` and
`lifecyclePlanner` on the existing `@pulse-compute/wasm-contracts/provider/toolchain`
subpath. These are **internal adoption protocols**, not new supported application
APIs or provider advertisements. The supported bootstrap version/export map is
unchanged; the internal v1 schemas identify these exact shapes and may only change
through a reviewed contract update. P15 still owns external HEX compatibility.

## Binding and contribution input

`lifecyclePlanner.createPlan({ bindings, contributions })` accepts plain data
records with exact fields. It rejects unknown fields, accessors, symbols,
non-record prototypes, sparse arrays and executable payloads. Every failure is a
`TypeError` with internal code `PULSEWASM_EXECUTION_LIFECYCLE_INVALID`; no public
diagnostic is added. This validates trusted metadata, not a JavaScript sandbox.

```js
const { lifecyclePlanner } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const plan = lifecyclePlanner.createPlan({
  bindings: {
    version: 'pulse.lifecycle-bindings.v1',
    executionVersion: 'pulse.execution-lifecycle.v1',
    sites: [{
      id: 'settle-result',
      points: [{
        point: 'effect.settle',
        parameters: { effect: 'slot', ticket: 'ticket', result: 'value' },
        reject: 'reject-stale'
      }]
    }]
  },
  contributions: [{ point: 'effect.settle', owner: 'driver.tickets', order: 0 }]
});
```

Bindings require their exact `version`, `executionVersion` and `sites` array.
HTTP is absent unless `httpVersion: 'pulse.http-lifecycle.v1'` is explicitly
present. Null, unknown versions and unselected points reject. Device/provider IDs
have no role in selecting the capability. Empty sites are valid only as an empty
overall array; each declared site must contain at least one point.

Site IDs, parameter binding IDs, action IDs and contribution owners match
`[a-z0-9][a-z0-9.:-]{0,95}`. They are opaque adapter lookup keys, not source
identifiers or expressions. A provider may map a key to a guest integer or a host
object without changing the semantic role. Type/signature validation belongs to
that adapter, outside this planner. Bindings require every semantic role exactly
once and allow no extra roles. `effect.deliver` also requires `afterParameters`
binding `accepted`. Other points reject after-parameter fields.

Each site has a unique ID and an explicit ordered `points` array with no repeated
point. Site enumeration is irrelevant; the planner sorts sites by ASCII ID. It
does **not** schedule sites or order execution across site IDs. The point array
is the adapter's declared execution order within that structural site.

Guard and predicate bindings require a symbolic `reject` action. Claim bindings
require `onClaim`. Other action fields reject. Adapters resolve those actions and
must enforce the shared rejection postconditions; the planner neither interprets
provider statuses nor emits a return, throw, cleanup call or source snippet.

Contributions have only `point`, `owner`, and `order`. Orders are distinct safe
integers per point; an owner contributes at most once per point. The same owner
and numeric order can appear on other points. Contributions sort numerically,
independent of registration order or locale, and require a bound site. Trusted
implementations are held separately by their adapter and identified by the
`(point, owner)` pair. No package registration path is added.

## Dispatch output and authority

The deeply frozen `pulse.lifecycle-plan.v1` output records execution, invocation
and optional HTTP versions, then active sites and their points. Each point carries
semantic role-to-binding pairs, the composition rule, applicable rejection or
normal-return postcondition, action IDs and ordered `{ owner, order }` entries.
Around points additionally carry the reversed `after` list. Input records are
copied; planning never freezes or mutates the caller's records.

Observe runs all contributions. Guard/predicate stop at the first false; claim
stops at the first true. Around runs before notifications in ascending order and
after notifications in reverse order only after normal delivery return, including
rejection. A trap preserves the primary failure and supplies no after/finally
guarantee. `invocation.close` observes the beginning of closure; cleanup that
requires invalidated delivery authority belongs after invalidation, not in that
pre-invalidation notification. `invocation.end` and `invocation.closed` remain
normal-return points. Service cleanup must respect qualified ownership, protected
capacity and the original remaining deadline.

Every declared `response.error` site must bind `response.authority` before it.
An active error-claim contribution also requires an active authority contribution;
an empty dispatcher is not a fence. The output preserves this precedence at each
site, independently of contribution orders. This check proves the declared local
ordering only: P03/P09A must establish that real responder sites honor it and that
the provider's rejection action actually stops response selection. Ordinary and
timeout responders still need actual authority bindings; the planner cannot infer
missing source sites. Final-result claim services must obey HTTP authority too;
their qualified transfer path is not replaced by an error-responder predicate.

Authority remains `owned → outcome-unknown → transferred → completed`, with
dispatch fenced before the host call and later transitions requiring qualified
evidence. Unknown results retain uncertainty. Authority never implies handle
ownership, a client delivery receipt or host quiescence, and never authorizes an
automatic retry or reopening.

With no selected contributions, output `sites` is empty. Inactive points are
omitted; malformed bindings still fail validation. P03/P09A must emit nothing for
that empty plan and prove unused-path artifact behavior. This metadata-only pass
does not claim byte identity or portable driver conformance from an empty array.

## Maintained evidence and stopping point

`lifecycle-contract` checks exact semantic sets, all composition kinds, ordering,
immutability, role/action/version rejection and authority precedence. Its small
reference interpreter checks dispatch data, including normal rejection and traps;
it is not a production driver or proof that a provider binds the real sites.
`lifecycle-contract-installed` packs the actual contracts package, installs its
tarball offline outside the checkout and replays the same cases through the
existing toolchain subpath. Its loaded source closure must stay in the consumer.
No test imports internal research or retrieves an evidence repository.

P02 stops at shared semantics/planning, maintained contract/packed-consumer tests
and documentation. No emitters, host-runtime integration, accounting banks,
resource profiles, cache package, handoff methods, import-audit changes or target
support changes are included. P03 and P09A now supply the two concrete driver
styles and common real-driver traces. P14 still owns complete milestone promotion.
