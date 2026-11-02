# P16 — Bounded Router terminal placement

RC item 04; base `latest` at `d0aa72147471c02441c04a3bea0e85d5ea49042c`.
Human direction: “Implement 04” under the frozen eight-item RC scope.
Entry point: `provider-fastly`. Necessary additional owners: the GRIP diagnostic
hint, focused test registry/release shard mapping, canonical documentation and
its generated derivatives. No compiler or frozen contribution-envelope change.

The Fastly terminal admission proof admits one direct `host.extension` effect
in one canonical private Router route body. Route metadata binds that effect to
its owner; every route has one dispatcher call. All entries must be terminal
routes. Existing dispatcher locals and matching are admitted separately from
authored route bodies, which retain the pure method/path/URL condition and text
response restriction. Literal status options cover ordinary siblings and Router
exhaustion. The generated transfer flag is private and never an authored token.

The existing scheduler, tickets, settlement, response authority, deadline and
cleanup are reused unchanged. Both GRIP operations and an independently named
fixture select the same service. No per-package provider branch is added.
Middleware/error handlers, next transfers, helpers, parallel/multiple handoffs,
other effects (including sibling routes), token escape, body forwarding, dynamic
backends and package-owned application composition remain rejected.

`fastly-router-terminal` covers authored compilation and CLI build, both ABIs,
ordinary siblings and exhaustion, method selection, pure response branches,
uncertain outcomes, pre/post-dispatch deadlines, forged/stale completion,
cleanup failures and primary-error preservation, observer attachment, independent
package selection, negative placements/targets, and omitted machinery controls.
The existing `fastly-lifecycle` corpus retains detailed ticket/token guards.
Focused provider and GRIP regressions complement this task; broad integration
and release checkpoints remain CI-owned. Retain attempt reports and exact tested
source identity in the PR; development results are not a release seal.

This is injected ABI evidence. Exact installed-candidate transport qualification,
report/compare attribution, independent review and the complete RC seal remain
items 5–8. No new host ABI, transport guarantee, instance reuse, cache, nonterminal
service, child-effect composition or accounting expansion is included.
