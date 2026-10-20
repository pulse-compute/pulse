## Behavior and scope

Plain handlers, reachable Router handlers and managed MCP operations now invoke
bounded imported computations through shared `ctx.call` on Native and explicit
Node JavaScript. This draft implements 05B–05E (#443–#446).

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

05E implementation: `d5a335aeb395db912a7208a2198464405340ea73`; full Git tree `e68f2b42c1252fd25c986cb062828e5f1b242f8e`,
identical to clean tested local `88b62fc5f9b4fb74a0e2d38203987fcfd34593af`.
Sixteen focused runner tasks pass. The new routed/MCP proof has 28 successful
executions and 12 source rejection cases. Existing Entities regressions, 83 MCP
cross-target protocol cases and 114 MCP HTTP/Node-host cases pass.

The separate Router/MCP baseline replay preserves byte-identical no-call Wasm
against untouched `8a51d70`, including complete hashes, sizes and import tables.
Imported-unused call-free plans match its untouched backend. Build, maintenance,
documentation and scope checks pass. Exact source identity, terminal logs,
measurements and remaining checks are in
`docs/internal/b10-call-proof/05E-VALIDATION.md`.

Full profiles remain deferred by the user's explicit checkpoint direction.
Focused development and injected Fastly are not installed closure, real-provider
acceptance or a release seal. Dependencies are the restored identical-lockfile
graph, not fresh clean-install qualification.

## Remaining work and direction

Next is 05F (#447), failure/cleanup and cumulative request budgets; public contract
finalization remains 05G. Application migration, retrieval, reporting, installed
closure, provider/client acceptance and sealing retain separate tickets in #436.

The user directed shared `ctx.call`, moderate measured used-call cost and zero
unused Wasm overhead, then selected each implementation checkpoint through 05E.
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
