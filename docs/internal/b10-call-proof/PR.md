## Behavior and scope

Plain handlers, reachable Router handlers and managed MCP operations now invoke
bounded imported computations through shared `ctx.call` on Native and explicit
Node JavaScript. This draft implements 05B–05I (#443–#450).

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

## 05I application checkpoint

Example 12's contained `application/` project now exposes four complete tools:
`pulse.start`, `pulse.read`, `pulse.example` and `pulse.diagnostic`, through shared
`ctx.call` on Node Native, injected Fastly Native and Node JavaScript. The existing
five-tool v1 Node host remains available, including its `pulse.explain_diagnostic`
name. Migrated search remains a separate checkpoint.

Read preserves original UTF-16 offsets, scalar boundaries and exact UTF-8 text.
Example pages retain whole files, optional fields and complete citation arrays;
diagnostics retain remediation, related contracts and suggested local checks.
Generation and application code enforce 24 KiB tool and 128 KiB protocol budgets,
including JSON escaping and duplicate MCP text/structured content. Native retains
one full-text resource backing. A focused shared-emitter correction reuses that
backing across callable owners; resource checks and frame ownership remain intact.
No source syntax, context authority or provider capability is widened.

## Validation

Reconciliation with latest `54c779c` is described in
`docs/internal/b10-call-proof/RECONCILIATION.md`. This combines the callable work
with current Fastly dynamic backends, schema-wrapper repair, documentation links
and CLI evidence status. Full qualification of this combined candidate is the
next checkpoint before human review/merge. Earlier 05I measurements below retain
their original source identity.

Source identities, focused results, measurements and failed development attempts
are retained in `docs/internal/b10-call-proof/05I-VALIDATION.md`. The four-tool task
includes the 05H start regression and independently executes legacy handlers as
its oracle. Production coverage and a separate format-admitted synthetic corpus
exercise Unicode, maximum content, terminal pages and response-bound failures.
All nine focused checks have passing terminal evidence, including 3,330 tool
executions and 120 rebuild/admission cases. The first aggregate run hit the old
rebuild timeout; its completed results are retained, and the remainder passed
after a timeout-only adjustment. The fresh baseline replay passed 28 executions
with byte-identical no-call/unused Wasm. Published code `dd7241e1` matches the full
tree of clean tested local `eaa0180`; the remainder ran on clean `7a82f92`. Full profiles, installed closure, actual provider acceptance
and release sealing remain deferred under the user's checkpoint direction.
Dependencies are the restored identical-lockfile graph.

## Remaining work and direction

05I (#450) completes four migrated tools. Next: qualify the reconciled draft for
integration into latest. Then resume 06A (#451), sparse lexical search.
Application migration, retrieval, reporting, installed
closure, provider/client acceptance and sealing retain separate tickets in #436.

The user directed shared `ctx.call`, moderate measured used-call cost and zero
unused Wasm overhead, then selected each implementation checkpoint through 05I.
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
