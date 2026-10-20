## Behavior and scope

Plain handlers, reachable Router handlers and managed MCP operations now invoke
bounded imported computations through shared `ctx.call` on Native and explicit
Node JavaScript. This draft implements 05B–05F (#443–#447).

- Shared project resolution, helper composition, schema codecs, readonly ownership,
  resource/workspace rules and Native generation remain the owners. Entities keeps
  its small invocation adapter; MCP owns protocol and dispatch selection.
- Static imported identities and registered literal schema pairs define up to
  sixteen reachable call occurrences. Reused Router handlers share callee bodies.
  Dormant calls/resources are not emitted.
- Node JavaScript retains original source. The loader and built source package
  bind selected targets across caller modules to the application, preserving
  request-owned schemas, resource access, fresh workspace lifetime and deadlines.
- Calls remain synchronous and bounded: no nested/effectful/dynamic calls,
  call-in-loop, recursion or arbitrary package targets. Callees receive no HTTP,
  state or effect authority. Public types/support remain 05G.

## Validation

05F implementation: `ea1a05720f874c1941187e6ced637ec3def756b6`; full tree
`18b6f9ab0d49a39259eeebbeebaed76aacdb79f6`, identical to clean tested local
`9bfd77fb6e97233c35af5f7ab56d8581d8808c6b`.

Ten focused runner tasks pass with complete terminal reports. The lifetime proof
covers 114 successful requests/recoveries, 18 conversion/computation failures,
six cumulative-deadline cases and allocation exhaustion on both Native targets.
Existing callable, workspace/resource, transport and MCP regressions pass.
The separate Router/MCP replay adds 28 executions and 12 rejection cases and
preserves byte-identical no-call/unused Wasm against untouched `8a51d70`.
Build, maintenance, documentation and protected-scope checks pass.

05F clears successful frame roots/workspaces, releases invalidated JavaScript
backing stores and fences calls after failure. It also fixes Fastly guard and
request-budget selection for resource-free callables. Recovery after a Native
trap uses a fresh request instance; no catch-and-continue feature is added.
Measurements and failed attempts are retained in
`docs/internal/b10-call-proof/05F-VALIDATION.md` and `05f-validation/`.

Full profiles remain deferred by the user's checkpoint direction. Focused
and injected-provider evidence is not installed closure, real-provider acceptance
or a release seal. Dependencies are the restored identical-lockfile graph.

## Remaining work and direction

05F (#447) hardens cleanup, failures and cumulative request budgets. The next
unit is 05G, public contract finalization. Application migration, retrieval, reporting, installed
closure, provider/client acceptance and sealing retain separate tickets in #436.

The user directed shared `ctx.call`, moderate measured used-call cost and zero
unused Wasm overhead, then selected each implementation checkpoint through 05F.
No single Entry Point covers this cross-owner work; ordinary root, packages,
Wasm/compiler, CLI and documentation instructions apply. The release evidence map
only enrolls the new task. PR #438 stays superseded. Merge, release, deployment and
self-approval remain human-owned.

<!-- pulse-maintainer-declaration:start -->
Change class: architecture
Scope: architecture-change
Protected boundaries: public-authoring-api, effect-capability-model, continuation-runtime, lowerer-trust, provider-registry, runtime-target-fluidity, package-publication, release-authority
Human decision: required
<!-- pulse-maintainer-declaration:end -->
