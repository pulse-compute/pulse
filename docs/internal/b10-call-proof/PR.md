## Behavior and scope

Plain handlers, reachable Router handlers and managed MCP operations now invoke
bounded imported computations through shared `ctx.call` on Native and explicit
Node JavaScript. This draft implements 05B–05G (#443–#448).

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
  state or effect authority. 05G adds public types, source-bound docs and diagnostics;
  final support still requires human PR review.

## Validation

05G implementation: `5195e06e3debdf21a555954e7e470cc6a88efd6a`; full tree
`edf4acb94afd41c4c3cd8975a4446926c75980e4`, identical to clean tested local
`1555a51887749f78500978287fa3b93ee67a1305`.

Eleven focused runner tasks pass with complete terminal reports, including exact
packed public types, nine example executions across the three supported targets,
seven stale-metadata rejection checks, fourteen diagnostic entries and regenerated
context corpus/resources. Existing composition and JavaScript packaged-source
regressions pass. The separate 28-execution routed/MCP baseline replay preserves
byte-identical no-call/unused Wasm against untouched `8a51d70`. Runtime surface,
build, maintenance, documentation and scope checks pass.

Receipts, failed attempts and exact source identities are in
`docs/internal/b10-call-proof/05G-VALIDATION.md` and `05g-validation/`.
Preceding lifetime/budget evidence remains in `05F-VALIDATION.md`.

Full profiles remain deferred by the user's checkpoint direction. Focused and
injected-provider evidence is not installed closure, deployed-provider acceptance
or a release seal. Dependencies are the restored identical-lockfile graph.

## Remaining work and direction

05G (#448) finalizes the bounded public contract/types and diagnostics. Next:
05H (#449). Application migration, retrieval, reporting, installed
closure, provider/client acceptance and sealing retain separate tickets in #436.

The user directed shared `ctx.call`, moderate measured used-call cost and zero
unused Wasm overhead, then selected each implementation checkpoint through 05G.
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
