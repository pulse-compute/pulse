## Current checkpoint: private source admission

One statically imported target and its literal schema pair now produce admitted
callee plans and call-site facts for a named plain entry handler. This is an
opt-in internal pass: ordinary compilation still rejects `ctx.call`, and the
caller is not yet validated or executable. Router/MCP authoring and runtime
wiring remain deferred. The ordinary linker resolver and callable validator
are reused; no public package API is added.

Focused checks pass: 7 acceptance cases, 33 rejection cases, pure-helper
contract and suite-shape regressions; maintainer, docs, documentation-release
and build checks pass. Full profiles and backend execution were not rerun for
this checkpoint. The backend proof results below remain historical evidence.
See `SOURCE-ADMISSION.md` and `source-admission-validation/receipt.json`.

## Summary

B10-MCP-05 needs resource/workspace computation from managed Native handlers.
The earlier Entities proof duplicated execution machinery. This replacement
proves a bounded internal callable boundary that uses the ordinary compiler,
plan validator, ownership rules and code generator.

- One computation is invoked from HTTP and MCP through the same callee plan.
- Entities gains only a small invocation adapter; the #438 primitive expansion
  is excluded.
- Schema-bound immutable inputs/results, request deadlines and existing
  memory/value bounds apply at the call boundary.
- Unused-call HTTP/MCP fixtures produced byte-identical Wasm on Node and Fastly
  in the retained baseline comparison.

**Draft execution-boundary proof. No supported `ctx.call(...)` syntax, static
import discovery, nested/effectful calls or completion of B10-MCP-05.**
The frontend is private, and test call sites are compiler facts. Fastly execution
uses an injected host; this is not Viceroy or deployed-service acceptance.
Bounded internal JSON/schema conversions remain a measurable cost.

Supersedes #438's implementation direction while preserving its branch and
evidence. No tracking issue is closed by this proof.

## Validation and recovery

The recovered code tree is exactly
`20f61b33724b5b3dd6ee0578f8d37dd01e131cb9`, matching the recorded original proof
tree. Original tested code SHA: `04e567b`; recovered code SHA: `6b47239`.
Historical receipts and failed attempts are retained separately from fresh
review checks under `docs/internal/b10-call-proof`.

Fresh checks passed on clean commit `51fcd83`: workspace build, docs check,
documentation release check, maintainer check, scope declaration check and the
callable proof. The proof completed 8 configurations on both targets, 24 runtime
rejections, 7 source rejections, 8 forged-plan rejections, 3 input-mutation
rejections, 2 output-schema rejections and deadline/determinism checks.
All 16 emitted Wasm hashes match the retained passing run, including its
zero-call baseline artifacts. The baseline compiler was not rerun this time.
The evidence-only follow-up commit changes no executable source.

Dependencies were copied from an existing checkout with an identical
`pnpm-lock.yaml`; no install scripts ran. This is development evidence, not a
fresh clean-install claim, full portable qualification or release seal.

Remaining review includes error envelopes and exceptional cleanup, memory and
CPU behavior at real query sizes, multi-callee/resource ownership, helper/import
composition, source attribution and supported authoring contracts. Follow-up
work will introduce one statically resolved authored call before integrating
context-mcp and resuming deterministic vector/seal acceptance.

## Direction and scope

The user directed shared callable machinery, moderate call-site overhead, zero
or near-zero unused Wasm overhead, and rollback of the Entities expansion.
They authorized continuing recovery and publishing a replacement draft, with
smaller return boundaries. Merge, releases, deployment and self-approval remain
human-owned. No single Entry Point covers this cross-owner proof; root,
compiler, package, Fastly and docs instructions apply. The release shard change
only registers the proof task. The scope classifier flags the Entities native
adapter path for explicit human review.

<!-- pulse-maintainer-declaration:start -->
Change class: architecture
Scope: architecture-change
Protected boundaries: effect-capability-model, continuation-runtime, provider-registry, runtime-target-fluidity, package-publication, release-authority
Human decision: required
<!-- pulse-maintainer-declaration:end -->
