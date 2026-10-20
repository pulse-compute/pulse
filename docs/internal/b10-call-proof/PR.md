## Behavior and scope

Plain handlers, reachable Router handlers and managed MCP operations now invoke
bounded imported computations through shared `ctx.call` on Native and explicit
Node JavaScript. This draft implements 05B–05H (#443–#449).

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

## 05H application checkpoint

Example 12 now contains an explicit `application/` project with one complete
migrated tool, `pulse.start`, running through shared `ctx.call` on Node Native,
Fastly Native and Node JavaScript. It returns all dependency/configuration/
contract arrays with exact versions and citations. The existing five-tool v1
Node host remains available while other tools migrate.

The deterministic context builder owns the resource manifest, application config,
finite tool metadata, source/schema output and installed mirrors. Native uses one
physical full-text resource backing. The preserved `0b33b3c` config prototype is
reconciled against current owners without importing PR #438.

## Validation

Final source identity, complete focused task reports, measurements and retained
failed attempts are recorded in `docs/internal/b10-call-proof/05H-VALIDATION.md`.
Previous callable/no-call and lifetime evidence remains in the 05G/05F records.
Full profiles remain deferred by the user's checkpoint direction. Focused and
injected-provider evidence is not installed closure, deployed-provider acceptance
or a release seal. Dependencies are the restored identical-lockfile graph.

## Remaining work and direction

05H (#449) completes one migrated tool. Next: 05I (#450), read/example/diagnostic. Application migration, retrieval, reporting, installed
closure, provider/client acceptance and sealing retain separate tickets in #436.

The user directed shared `ctx.call`, moderate measured used-call cost and zero
unused Wasm overhead, then selected each implementation checkpoint through 05H.
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
