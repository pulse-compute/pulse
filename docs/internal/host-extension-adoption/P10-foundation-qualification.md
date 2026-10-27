# P10 — Foundation application qualification

This pass adds maintained application and packed-consumer qualification on top of
P11A PR #549, targeting `latest`. Human direction: “Let's work on unblocking.”
It qualifies P02/P03/P09A; it introduces no accounting, cache, handoffs, scheduler
or public exports. There is no single matching Entry Point. The ordinary
root/Wasm/docs instructions cover the fixtures, registry, release evidence mapping
and this record. Classification: evidence. Package-publication/release-authority
paths are touched only to register evidence; promotion and release remain separate.

## Application corpus

`lifecycle-foundation` compiles authored programs through the production compiler,
then runs Node Native and generated Fastly drivers with services absent and selected.
Services use the existing internal seams; generated source and Wasm are not patched.

| Application | Independently expected result | Selected-service oracle |
| --- | --- | --- |
| Mixed sequential effects | Config, secret, fetched text, config concatenate to `AfixtureoriginB`. | Four settlements and paired delivery notifications. |
| Sequential keyed cohorts | Two heterogeneous groups produce `AfixtureoriginB`. | Four distinct settlement visits; one terminal closure. |
| Repeated static site | Three versioned KV reads each return not-found; body is `3`. | Three fresh visits at the reused site; conditional-KV host authority. |
| `ctx.call` between effects | Imported pure computation between config effects produces `A8B`. | Two effect settlements; no effect authority for the computation. |
| Router recovery | Invalid JSON decoding after a successful effect enters the recovery route; status 400 and body `recovered`. | Two delivered effects and normal end/close/closed order. |

Both selections must produce the exact response. Fastly must send once. Node
observers inspect actual ticket sequences and all six execution points. Fastly
observes emitted sites through existing diagnostic counters without adding host
imports; the corpus performs no JWT operation. Expected counts are authored case
data, not derived from the plan. Individual rejection, stale/foreign ticket, trap,
cancellation, unknown-send and primary-error cases remain in `native-lifecycle`,
`fastly-lifecycle` and their common conformance fixture. Existing collection,
bounded-read, event, forwarding, error-boundary and request-budget suites cover
broader regressions; the new corpus does not claim exhaustive placement support.

## P13 local engine lane

```sh
PULSE_VICEROY_BIN=/absolute/path/to/viceroy \
  node wasm/test/runtime/assert-lifecycle-foundation.cjs --viceroy
```

This mode requires Viceroy 0.21.1 and fails if absent or different. It starts a local
origin, replays the exact selected-service artifacts through real HTTP twice per
application, and records engine/artifact digests and completed cases. Servers close
on success and failure. Multiple HTTP requests do not imply guest-instance reuse.
This is local-engine evidence, not deployed Fastly or cache/handoff qualification.
The explicit mode is not a new compulsory external release lane.

## P14 packaging and checkpoint

`lifecycle-foundation-installed` creates actual tarballs through the release pack
owner, installs with scripts disabled through a loopback read-only registry, and
verifies every installed Pulse file against its tarball. It copies only this test
into a consumer outside the checkout. Compiler, contracts, emitter, provider and
runtime implementations must load from physically contained installed packages;
workspace links and research imports are forbidden. The same five-case corpus is
compiled and executed there. These are internal package tests, not new exports.

The packed test requires a clean committed candidate. The PR records candidate/tree,
complete regression selection and terminal coverage, package hashes, tools and failed
attempts. Focused development evidence is not a release seal or merge approval.

## P04 unblock ledger

| Prerequisite | Completion condition |
| --- | --- |
| P05 profiles | Merged data-only contract and maintained unit/packed tests; not runtime reservation. |
| P11A control | Implemented ownership-preserving control and recipe; later accounting comparison retains the same reader, compiler, ownership and cleanup. |
| P10 foundation | Five application cases plus existing lifecycle/error/forwarding/collection regressions on this candidate. |
| Applicable P13 | Explicit local-engine replay plus actual Node host execution; no new hosted support claim. |
| P14 foundation | Exact installed replay and complete terminal regression selection on one candidate, then human review of the diff. |
| P04 bank design | Concrete fields, bounded capacity, safe-integer representation and generation exhaustion before finalizing the kernel. P11A numeric targets remain proposals for review. |

Historical report identity/retention failures remain unresolved investigations.
Passing runs do not fix their causes; a recurrence on this candidate must preserve
diagnostics and be reconciled. Those investigations do not erase independent
application/host/package evidence. P04 implementation, P11B cost qualification and
RA host profiles remain separate work. This record does not approve its own release.
