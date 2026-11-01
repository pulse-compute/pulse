# P03 — Structural Fastly lifecycle integration

P03 implements the Fastly side of the foundation on `latest` after P02 (#545,
base `0917d4d118a3794bc7fddd0512c83412977be048`). It adapts the lifecycle and
response-authority direction from pinned research
`ecc36468b5900a0de57a415379b85d12c5026f3f`; no research ancestry, harnesses,
archives or accounting banks enter the production pipeline.

## Ownership and concrete sites

`runtime-core-as/src/compiler/lifecycle-emitter.js` consumes the shared data-only
planner and emits AssemblyScript dispatchers and explicit template calls. It is
reachable through the existing `compiler/canonical-native` internal subpath.
The emitter owns ordered observe/guard/predicate/claim/around execution, concrete
role types and normal-return after dispatch. It rejects missing implementations,
inconsistent types, missing actions and selected sites that were never emitted.
It neither scans source anchors nor owns provider ABI/status interpretations.

Fastly's `build/lifecycle.js` supplies the site table, local symbols and rejection
actions. Trusted provider-internal `lifecycleServices` are a generator seam for
maintained services and conformance; they are not project configuration,
application callbacks, a package contribution protocol or provider advertisement.
Package-owned driver emitters with selected lifecycle services reject before
emission until their sites are explicitly bound. Existing package builds without
services retain their previous behavior.

| Point | Concrete placement |
| --- | --- |
| `effect.settle` | After driver ticket authentication, before consumption; rejection retains the active ticket. |
| `effect.deliver` | After consumption, around continuation delivery; rejected normal return still runs reverse after notifications. |
| `effect.result` | At the canonical raw setter entry; guards can reject without invoking the setter cases. |
| `invocation.end` | After normal driver return, before closure. |
| `invocation.close` | At closure entry, before ticket invalidation. |
| `invocation.closed` | After normal invalidation; repeated cleanup must remain service-idempotent. |
| `request.acquired` | After downstream handles are obtained. |
| `result.claim` | Before ordinary final-result handling. |
| `response.authority` | Outer fences on ordinary, error and timeout responders. |
| `response.error` | After the error responder's authority fence, before legacy handlers. |

Traps skip subsequent after/end/closed notifications. These are not finalizers.
Ticket storage, scheduling, deadlines and the original invocation policy remain
with the existing driver. Raw setter guards do not replace ticket authentication.

## Response and forwarding changes

The selected HTTP authority service fences raw downstream send before entering
the host. Zero status advances to transferred, then completed for nonstreaming
responses; streaming completion requires the known close path. Nonzero status or
trap retains outcome-unknown. No transition reopens authority, retries a send or
asserts client delivery, physical reclamation or host quiescence.

Forwarding now uses structural acquired, error-claim, result-claim and invocation-end
points instead of five source-anchor insertions. Its separate committed flag is
replaced by shared authority state. Resource-specific bounded pumping and cleanup
remain with forwarding. Legacy error/body/deadline instrumenters target inner
responder implementations, so they cannot precede the outer authority fence.
The timeout source is a template owner rather than a patched function declaration.

This is a bounded migration. Fetch primitive, request/deadline and other legacy
instrumenters still exist. No claim is made that every ABI call or instrumenter
has moved to lifecycle points. P09A owns the second driver; P15 owns package HEX
contributions and surface policy. RA, cache, handoffs and Router widening remain
outside P03.

## Maintained evidence and limits

`fastly-lifecycle` compiles production ticket/setter templates, the shared emitter,
and response authority, and executes a generated Fastly driver in the injected
host. It covers invalid/stale/repeated settlement, guard retry, accepted/rejected
normal delivery, before/delivery traps, closure and idempotent cleanup, ordered
short circuiting, status/trap uncertainty, ordinary/error/timeout fences,
registration permutations, empty selection and unsupported emitter rejection.
The existing forwarding ABI matrix remains maintained regression evidence.
Neither suite imports internal research or downloads historical artifacts.

Four separately matched controls were built from the P02 base and this candidate
with Node 24.22.1 and the lockfile-pinned AssemblyScript toolchain: absent feature,
imported-unused GRIP, generic GRIP handoff, and a deadline-only handler. For each
control, generated source, Wasm, byte count and imports match its own baseline.
Identity across different authored controls is not claimed. The maintained test
also compares empty and absent service selections on the same plan.

These are emitted-template and injected-host results. No new Viceroy or hosted
Fastly acceptance, packed foundation consumer or cross-driver conformance is
claimed. Applicable P10/P13 qualification and the P14 promotion checkpoint remain
required before foundation promotion. Evidence migration and repo-wide thinning
remain separate owner work.
