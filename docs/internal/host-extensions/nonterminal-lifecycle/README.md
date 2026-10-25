# Nonterminal lifecycle qualification before RA-06

Status: bounded compiled-Native proof after the [shared lifecycle extraction](../shared-lifecycle/README.md)
in merged PR #535. This evidence-only checkpoint uses existing execution hooks,
the Fastly driver and the RA-03 accounting kernel. It changes no production
contracts, provider code, admission rules or package API.

The final run passes **38 cases and detects five deliberate mutations**. Within
this fixed profile, the existing lifecycle points support a nonterminal service
that suspends, delivers a result and continues into ordinary core fetch. No new
generic lifecycle point is needed for this proof. RA-06 can proceed to a bounded
cache mapping; production adoption and host qualification remain separate.

## Fixture and authority

The canonical compiler builds a handler with exactly two ungrouped bound effects:
`ctx.config.get('PROBE')`, then `ctx.fetch('https://origin.example/value').text()`.
The handler returns their concatenation. The private builder validates that plan
and substitutes the first slot's dispatch and result resolver with a probe
service. The config slot supplies an existing string result shape; this is not
a config implementation or a newly admitted authored extension. Its config ABI
is pruned from the active Wasm.

The original driver owns tickets, suspension, readiness waits, the request
deadline, resumption, core fetch, response dispatch and invocation closure. The
probe contributes settlement and result guards, delivery notifications and
post-closure cleanup through the existing composer. HTTP response authority
remains with the ordinary responder: successful probe completion returns `42`,
the real core fetch returns `loaded`, and the response is `42:loaded`.

The unchanged RA-03 fixed-bank kernel (with exports made private) reserves two
logical handle/record claims before acquisition: pending and potential output
lease. One service slot is used. An independent host model tracks actual probe
resources and checks that retained claims cover them. Core fetch is compared
against an authority-only control, including its remaining resources; it is not
migrated into the probe ledger. This is not yet joint core/cache accounting.

## What the proof establishes

| Boundary | Observed result |
| --- | --- |
| Suspension and continuation | The compiled handler has one pending effect during probe select, then continues into core fetch after accepted success delivery. Core fetch trace and response match the authority-only control. |
| Authentication | Wrong tickets, wrong success tokens, direct result setters, undefined presented as success and success presented after known failure cannot consume the legitimate ticket. |
| Normal-return rejection | Settlement rejection retains the ticket until closure. Result rejection runs the around after-notification and clears delivery state. Neither continues into core fetch. |
| Known service failure | The driver's failure placeholder is accepted without business success. The original error remains primary and core fetch does not begin. |
| Cleanup | A known lease closes once after invocation closure and ticket invalidation. Successful disposal refunds its claims. Repeated closure and responders do not duplicate cleanup or response dispatch. Handle zero is valid. |
| Uncertain disposition | Acquisition, completion and cleanup failure retain conservative claims even when the host model actually consumes a handle. Cleanup failure does not replace the primary read error. |
| Cancellation | Cancellation before completion retains unknown output capacity. Cancellation during completion disposes a qualified lease without reading or delivering business success. These are private fixture injections, not a public cancel ABI. |
| Late observation | After closure, one modeled late lease remains covered by retained claims; duplicate observation is ignored. Neither settlement nor a direct setter revives the invocation. The fixture does not dispose that post-closure lease. |
| Deadline | A 37 ms probe delay leaves 963 ms of the original 1,000 ms budget for core fetch. Cleanup cannot borrow the error-response time allowance after expiry. |
| Traps | Acquisition, completion, read, delivery, core read, send and cleanup traps have no implied finalizer. A trapped cleanup attempt remains fenced and charged. No instance reuse after a trap is qualified. |
| HTTP authority | Probe work does not transfer downstream authority. An uncertain downstream send cannot reopen it and does not prevent cleanup of a known probe lease while budget remains. |

### Accepted delivery is not business success

The existing application-error driver drains a failed effect using an undefined
placeholder while saving the primary error outside the shared hook. A guard that
accepts only success tokens rejects that legitimate drain and masks the original
service error with a settlement failure. This was found during fixture development.

The private service therefore records pending, known-success and known-failure
outcomes. It accepts the exact success token only for known success, or an
undefined value only after a known failure and with the original ticket. Its
result guard accepts only the token authorized for that delivery. An accepted
failure placeholder does not grant business success or continuation; the
existing driver's fatal path retains the primary error.

The five compiled mutants remove settlement authentication, remove result
authentication, omit cleanup, move cleanup before closure, or restore the
success-only guard. Each is rejected by a specific behavioral assertion. The
last mutant preserves this failure-delivery distinction as a regression oracle.

## Evidence and reproduction

[evidence.json](evidence.json) indexes the final receipt, artifact hashes,
validation outcomes and [evidence.tar.gz](evidence.tar.gz). The bundle retains
the final full traces, generated AssemblyScript/Wasm, authored fixture, plan,
input snapshots and logs. An earlier successful 36-case run is retained
separately; the final run adds deadline consumption and forged-success checks.
The earlier run has different harness identities and is not the final receipt.

The base is `f7f15e7d6cc26e6df75dea56e07429187e0af28a`; the receipt hashes the
new fixture inputs independently of that base. Final execution used Node
v24.22.1 and AssemblyScript 0.28.18 with the RA-03 pinned compiler recipe.

```sh
node docs/internal/host-extensions/nonterminal-lifecycle/check.cjs /tmp/hex-nonterminal-lifecycle
node wasm/scripts/run-wasm-tests.cjs --task fastly-host-extension-proof --task fastly-incoming-body-forwarding --no-report
```

The disabled fixture is byte-identical to baseline source and Wasm. Reversing
contribution registration yields identical generated source. The active artifact
is 42,207 bytes versus 37,656 for the authority-only control: a 4,551-byte delta
including the diagnostic attack surface and private accounting fixture. This is
not a production overhead or execution-cost measurement.

## RA-06 handoff and limits

RA-06 should select one experimental cache owner and fixed profile, then map its
acquisition, readiness, commit and abandonment observations into these lifecycle
and accounting obligations. Record which observations prove consumption or
disposal and which leave capacity charged. Keep accepted failure delivery
separate from business success, and preserve the original deadline and error.

This proof does not qualify a cache ABI, package-completion delivery variants,
sequential slot reuse, dynamic cohorts, joint core/service accounting, actual
Fastly/Viceroy disposition, a second host, byte bounds or runtime cost. Late
post-closure disposal and trap teardown remain host-qualification questions.
The host model's status/disposition combinations are explicit assumptions,
not host guarantees. RA-07 composition and RA-10 host qualification remain open;
this checkpoint grants no merge, release or production-admission authority.
