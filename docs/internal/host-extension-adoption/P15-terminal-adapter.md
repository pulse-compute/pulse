# P15 — Terminal service adapter

Status: RC item 2 implementation prepared for review.
Base: `latest` at `5a6dc1e40a96863a4b44e4a57ae7f010a18a6d8b` (merged #559).
Branch: `adoption/p15-terminal`; target: `latest`.

Human direction: “Implement 2.” Item 2 attaches the initial terminal service to
Fastly Native; item 1 owns contribution/admission. No single named Entry Point
covers this cross-owner implementation. Root, package, Fastly, Wasm, and docs
instructions apply. Protected boundaries: lowerer-trust, provider-registry,
effect-capability-model, continuation-runtime, runtime-target-fluidity.

The adapter selectively adapts the terminal rules from research
`ecc36468b5900a0de57a415379b85d12c5026f3f` to the production structural lifecycle
emitter. There are no source-anchor injections for the new service, diagnostic
exports in production Wasm, package-name switches, second scheduler, replacement
response-authority state, or new accounting profile.

The [canonical contract](../../architecture/current-contracts.md#fastly-native-terminal-service)
owns exact placement, input, bounds, lifecycle and outcome semantics. The existing
Fastly build and pack path emits only selected contributions and re-audits the
packaged artifact. Optional observation is provider-internal and independently
selected. Its declared coverage is separate from observed execution and hosted
acceptance; traps have no guest finalizer guarantee.

Evidence uses the existing `fastly-lifecycle` and
`lifecycle-foundation-installed` tasks. Two graph-discovered packages at npm
versions 37.4.2 and 91.0.0 contribute different operations/ABIs without a core
registry edit. Tests exercise generic fixture ABI modules and the exact fan-out
and WebSocket redirect ABI signatures. The installed lane packs and installs
those fixture packages and runs the installed compiler/provider outside the
checkout. Injected ABI success is not Viceroy or hosted Fastly qualification.

Acceptance includes successful terminal completion, plain response controls,
nonzero/trapped dispatch, cleanup failure, original deadline expiry, forged/raw/
stale/duplicate/closed completion guards, shared observers, deterministic ordering,
service/placement/binding negatives, import/signature auditing and omission.
Record exact candidate/profile completion and preserved failed development
attempts in the PR; no prior research receipt substitutes for candidate evidence.

Excluded: GRIP experimental facade, Router admission, report/compare projection,
cache, nonterminal or persistent resources, hosted deployment, release support
promotion, merging, publication, and RC sealing.
