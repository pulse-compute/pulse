## Behavior and scope

B10-MCP computation needs the ordinary compiler through a shared call boundary.
This draft implements 05B (#443), 05C (#444), and 05D (#445): named plain handlers
invoke bounded imported project functions through `ctx.call` on Native and
explicit Node JavaScript.

- Shared project resolution, pure-helper composition, readonly ownership,
  schema codecs, resource/workspace rules and Native code generation remain the
  owners. Entities retains its small invocation adapter.
- Static targets preserve defining identities through imports and re-exports.
  Up to 16 sites/targets use literal registered schema pairs. Unused Native
  bodies/data are not emitted; separate callees retain their own workspace slots.
- Node JavaScript uses its original source graph. Its loader and built source
  package bind the compiler-selected targets once, without application target
  registration. Each call gets immutable copied input, complete output validation,
  selected resources, a fresh workspace lifetime and the parent request budget.
- No nested/effectful/dynamic calls, call-in-loop, recursion, arbitrary package
  targets or new helper language are admitted. Callees receive no HTTP/state/
  effect authority. Public types and supported authoring remain 05G.

## Validation

05D implementation: `56f1e464ae4427d78bb20e839e54fb9cc65ce703`, with full tree
`a0d3aac1d4aebeeeb86fcf6929c64602771154f0` identical to clean tested local
`f27ef5674458305dc944ec354110b0e95a5b7b9b`. Nine selected runner tasks pass,
plus the authored unchanged-baseline replay and build/documentation/maintenance/
scope checks. The new task has 14 successful executions, 4 invalid-output
rejections, 10 source rejections and 18 ownership/deadline checks.

The exact source binding, terminal logs and remaining checks are recorded in
`docs/internal/b10-call-proof/05D-VALIDATION.md`. The registered
`callable-authored-javascript` task exercises actual `ctx.call` sites across
Native, the JavaScript loader, CLI preparation and built Node packages, plus
source/ownership/schema/deadline rejection. The unchanged authored Native gate
retains the byte-identical unused-Wasm comparison with untouched `8a51d70`.

Full functional profiles are deferred by the user's explicit checkpoint
direction. Historical receipts under `docs/internal/b10-call-proof` remain
historical; focused development checks are not a release seal, installed closure
or real Fastly/provider/client acceptance. Dependencies remain the restored
identical-lockfile graph, not a fresh clean-install qualification.

## Remaining work and direction

Next is 05E (#446), Router and managed MCP caller integration. Failure/cleanup and
cumulative budget qualification remain 05F, public contract finalization 05G.
Application migration, retrieval, reporting, installed closure, provider/client
acceptance and sealing retain their separate tickets in #436.

The user directed shared `ctx.call`, moderate used-call conversion cost and
zero/near-zero unused Wasm overhead, then explicitly selected each implementation
checkpoint through 05D. No single Entry Point covers this cross-owner work;
ordinary root, packages, Wasm/compiler, CLI and documentation instructions apply.
The release evidence map only enrolls the new task. PR #438 remains superseded;
its duplicated Entities primitive machinery is not resumed. Merge, release,
deployment and self-approval remain human-owned.

<!-- pulse-maintainer-declaration:start -->
Change class: architecture
Scope: architecture-change
Protected boundaries: public-authoring-api, effect-capability-model, continuation-runtime, lowerer-trust, provider-registry, runtime-target-fluidity, package-publication, release-authority
Human decision: required
<!-- pulse-maintainer-declaration:end -->
