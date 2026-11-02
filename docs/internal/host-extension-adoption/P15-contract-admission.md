# P15 — Contribution contract and admission

Status: item 1 implementation prepared for review; terminal execution remains item 2.
Date: 2026-10-28. Base: `latest` at `5b78a6535cab23881f88ddcd5778c109e2eb2a3c`.
Branch: `adoption/p15-contract`; target: `latest`.

Human direction: “Implement 1”, referring to contract/admission in the bounded RC
workstream. This authorizes the cross-owner implementation and its tests/docs.
Class: architecture. Boundaries: lowerer-trust, provider-registry,
effect-capability-model, runtime-target-fluidity. No single named repository
entry point covers this cross-owner change; root and owning-directory rules apply.
Merge, publication, and RC sealing remain separate actions.

The shared owner adapts the contract from research
`ecc36468b5900a0de57a415379b85d12c5026f3f`, without importing its runtime adapter.
The [canonical schema](../../contributing/package-lowerer-contract.md#host-extension-contribution-v1)
is frozen as v1 for this workstream. New wire shapes or service semantics require
an explicit versioned contract change.

The implementation connects strict raw contribution validation to the existing
builder result, compiler artifact carrier, and lowering bundle. Optional exact
Native target advertisement and deterministic selection are shared toolchain
utilities. A complete baseline-plus-contribution policy retains all MVP import
kinds, rejects baseline rebinding and signature conflicts, and audits every
observed import. It complements the provider's existing final-Wasm policy.
Research fixes include descriptor-safe dense arrays, portable SHA/UTF-8 handling,
code-point ordering, and baseline table/memory/global import coverage.

Evidence tasks are `provider-toolchain`,
`package-reachability`, and `lifecycle-contract-installed`. The provider contract task includes
an external graph-selected package outside the checkout at npm versions 37.4.2
and 91.0.0, raw carrier rejection, deterministic admission, and real binary import
checks. The installed task replays the contract from an actual offline-installed
pnpm tarball. Required compiler profiles and maintenance/documentation checks are
recorded with exact candidate identity and outcomes in the PR.

Node and Fastly advertise no host-extension service. This step does not implement
terminal dispatch, GRIP methods, Router placement, report projection, WebSocket
or fan-out qualification, cache, or nonterminal/resource-owning services. The next
unit implements the terminal service against the existing execution lifecycle
and response authority, then enables its exact provider advertisement.
