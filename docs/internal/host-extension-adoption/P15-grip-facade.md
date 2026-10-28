# P15 — GRIP facade and package proof

Status: RC item 03 implementation prepared for review.
Base: `latest` at `f150c138653b31947ea6ebc9c7a51510517146c8`.
Branch: `adoption/p15-grip-facade`; target: `latest`.

Human direction: “Implement 03”, following merged #559 and #560. Entry point:
`package-lowering`, package owner `packages/grip`, documentation owner
`docs/packages/grip.md`. Necessary additional scope is the maintained installed
consumer/observer fixtures, registry and generated documentation. The unit was
planned for GPT-6.1 Sol / High; this records the recommendation, not a delegation
or a claim about the executing model.

The explicit-context `handoffFanout` and `handoffWebSocket` methods are exported
only on the provisional experimental subpath. The package owns import recognition,
argument/placement diagnostics, ABI source and contribution metadata. Shared
contracts, generic discovery, provider dispatch and lifecycle semantics are
unchanged. Canonical effects retain their manifest-root authority even though
the authored import uses the experimental subpath. The existing manifest subpath
recognition list includes that subpath; this grants lowerer recognition, not
supported compatibility status.

Both methods have a `never` TypeScript return type: native terminal transfer does
not resume an application value, and JavaScript execution throws the explicit
unsupported-target error. Real handler assignment and packed type checks verify
this without a Response cast or widening the shared handler result union.
Lexical binding distinguishes imported aliases/namespaces from shadowing locals;
context is checked against the enclosing function's parameter binding. The
provider retains its independent bounded plain-handler proof.

Focused evidence adds `grip-terminal` and extends
`lifecycle-foundation-installed`. Two independently named/versioned fixture
packages retain their ordinary discovery/build/pack path, and the same optional
observer binding applies to those packages and both real GRIP operations.
The installed replay verifies exact tarball bytes, runtime exports, declarations,
compiler/provider artifacts and injected execution outside the checkout.
Production builds use declared exports and the CLI; optional observer probes
use the verified packed internal seam, as in the existing foundation tests.
This does not add or promote a provider export.

Local regression selection covers GRIP package lowering/runtime/parity, reachability,
exports, terminal behavior and installed replay. Broad profiles/build checkpoints
remain CI-owned under the current testing policy. Preserve failures and exact
source/report identity in the PR. No combined development selection is a seal.

Excluded: Router admission, public report/compare projection, cache, nonterminal
resources, Viceroy or hosted qualification, supported-entry promotion, merge,
publication and RC sealing.
