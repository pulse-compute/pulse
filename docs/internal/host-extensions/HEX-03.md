# HEX-03 — Terminal ownership and WebSocket passthrough

Integration work for [#511](https://github.com/pulse-compute/pulse/issues/511).
Base: `d3eb6648e8084c0c4bba2285e715d00d372e1c87` (`hex-integration`, HEX-02 merged).
Branch: `hex/03-terminal-lifecycle`. Human direction: “Done, implement HEX-03.”
Pass PRs target `hex-integration`; promotion to `latest` is a separate stability
and support decision. No release, deployment or merge is performed by this pass.

## Implementation

The existing `terminal-request-backend.v1` service now authenticates its opaque
completion against the selected effect's invocation ticket, exact token and
private delivery path. Calling the exported canonical result setter directly
cannot authenticate a terminal result, even with the correct token. Tickets and
tokens are retired once; stale, repeated, escaped and forged results cannot
become normal responses. The provider instruments only an admitted terminal
artifact; the shared canonical runtime and invocation protocol are unchanged.

The shared request budget is rechecked immediately before the ABI. Closed
invocations cannot dispatch or settle. Once dispatch begins, normal response,
shared error and deadline response paths are fenced even if the status is
nonzero, the host traps, cleanup fails or settlement fails. Cancellation here
means the existing invocation-closed boundary, not a new public cancellation
API or interruption of a synchronous hostcall.

The service borrows the downstream request handle. Status zero transfers response
authority, leaving the local request/body handles owned by Pulse. Successful
handoff closes both local handles once, before completion; ordinary undispatched
invocation exit also closes them. Close attempts retire the local references
before entering the host. A cleanup failure is retained without retry or a new
response. Nonzero/trapped dispatch leaves ownership uncertain and performs no
speculative close; host teardown remains responsible for reclamation. These
rules add no general resource manager.

`grip.handoffWebSocket('backend')` is a second provisional method beside
`handoffFanout`. It contributes `redirect_to_websocket_proxy_v2` through the
same v1 carrier, source schema, provider service and ABI signature. Only the
GRIP-owned operation table differs. No package-method registry, provider-specific
selection branch, new protocol shape, WebSocket frame/session engine or released
support symbol is added. Dynamic JavaScript calls retain an explicit unsupported
host error. Generic GRIP methods retain their existing semantics.

## Placement matrix

| Placement | Integration admission |
| --- | --- |
| Ordinary HTTP handler, direct terminal return, literal backend key | Admitted |
| Pure method/path/URL predicate with ordinary text-response control | Admitted |
| Total request budget (`maxDurationMs`) | Admitted; pre-dispatch and post-transfer tests |
| Assignment, returned token reuse, nested expression | Rejected |
| Additional/prior effects, parallel/grouped effects | Rejected |
| Router, middleware and application error handlers | Rejected |
| `ctx.call`, helper/managed handlers, guest-unit composition | Rejected |
| Body reads/mutation/forwarding, state access, logging | Rejected |
| Node Native, Node JavaScript, Fastly JavaScript | Recognized calls rejected; dynamic JS guard throws |

The shared provider fatal/error responder is tested; an authored Router error
handler is outside this placement contract. Existing body-forwarding ownership
is not reused or weakened to admit terminal handoff.

## Evidence boundaries

[Injected traces](hex03-injected.json) cover both operations, 62 lifecycle cases,
resource close accounting, exact-once cleanup, failure statuses 1–14, traps,
forged/stale completion, invocation closure, deadlines and ordinary responses.
Test-only observer exports are absent from production artifacts. An unselected
real WebSocket contribution leaves the Fanout Wasm byte-identical and adds no
WebSocket import. The original absent/unused/generic controls remain separate.

[Engine traces](hex03-engine.json) use Viceroy `0.18.0`, commit
`6cc29ea3c4534518322df8cc19766519384de633`, matching the pinned HEX-01 source.
The official Linux amd64 archive SHA-256 is
`090c978dd160335e8ac6c7d5b4d0ce7c7b7bf9b6d072617fa2301266515182ab`;
the binary SHA-256 is recorded in the receipt. Source/SDK provenance remains in
[hex01-source-evidence.json](hex01-source-evidence.json).

| Engine probe | Observed result | Limit |
| --- | --- | --- |
| Both ABI calls, valid request | Status 0; request readable; request/body close each succeeds, repeated close returns 3 | Local core ABI only |
| Invalid request handle | Status 3 before handoff; original downstream handles remain closable | Does not establish all hosted BADF ownership |
| Invalid UTF-8 backend bytes | Status 2; original handles remain closable | Standalone malformed-input probe |
| Second handoff | Status 1 after first handoff; local handles still closable | A nonzero result is not restored response authority |
| Authored WebSocket artifact | Backend HTTP response and HTTP 101 WebSocket upgrade pass with cleanup enabled | No frame/session, TLS or hosted qualification |
| Authored ordinary branches | One 200 ordinary response for each fixture | Local engine regression |
| Authored Fanout artifact | Engine reports missing Pushpin after the ABI signals handoff | Fanout delivery remains unqualified |

The local observations do not justify generalizing cleanup or recovery to all
nonzero statuses. Statuses 4–14, host traps and hosted correspondence remain
unresolved. No nonzero outcome is claimed as recoverable. Fanout/Pushpin delivery,
hosted Fastly acceptance and packed consumers remain support gates. HEX-04 owns
packed qualification and author guidance. Issue #516 remains a separate
workstream promotion concern; this pass does not fix or waive report failures.

Reproduce engine evidence explicitly:

```bash
node docs/internal/host-extensions/probe-hex03-engine.cjs /absolute/path/to/viceroy /tmp/hex03-engine.json
```

This starts local loopback servers, runs the pinned engine and closes all child
processes. It neither deploys nor contacts a hosted Fastly service. The standard
`fastly-host-extension-proof` task runs the portable injected cases; optional
engine availability is never treated as an automatic pass.

The [validation receipt](hex03-validation.json) records source identities, final
checks, completed task coverage and failed development attempts.

## Final regression validation

The initial full portable selection passed 137 tasks, then failed Fastly
JavaScript JWT packaging because the shared contribution validator imported
`node:crypto`. The validator now uses the contracts package's existing portable
SHA-256 helper. Both production handoff Wasm artifacts and policy hashes remain
identical to the retained engine evidence. The failing JWT task, all 54
contribution contract cases and the complete HEX lifecycle proof pass after
the fix. The [original failure](hex03-portable-failure.log) is retained.

The remaining 74-task diagnostic range passed on the corrected implementation.
Recovery reused its running process for the last 14 documentation regressions;
all 14 passed without restarting the earlier 60. Build, maintenance, documentation
and the three exact HEX-01 baselines also pass after the portability fix.
These results span two implementation commits and are not a single complete
green release aggregate on the final source. The validation receipt retains
each source identity, terminal status and task result. No test process remains
pending from this pass. PR #518 remains ready for human review against
`hex-integration`; hosted and packed qualification and promotion remain separate.
