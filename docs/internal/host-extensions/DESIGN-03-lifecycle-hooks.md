# Host extensions — design pass 3: driver-owned lifecycle hooks

Status: **bounded architecture spike; not a new package hook API**. Human
instruction: “Ok spike on lifecycle”, following review of the supplied DESIGN-03
candidate. Entry point: `provider-fastly`, with internal documentation and test
helpers included. Class: architecture; scope: architecture-change. Human review
and merge authority remain unchanged.

The spike builds on RA-05 (`25b3f96` locally, identical tree to the merged RA-05
change). It incorporates the supplied terminal-hook candidate, then pressure-tests
shared response authority, forwarding and accounting closure. The supplied
candidate's measurements are not substituted for this spike's evidence.

Follow-up: [shared lifecycle contract extraction](shared-lifecycle/README.md) moves
execution and HTTP semantics into shared contracts while retaining this spike’s
Fastly implementation and historical evidence.

## Problem and boundary

Several provider services rewrite the same generated driver functions. Correctness
has depended on pass order: terminal fences must precede budget/error responders,
forwarding must suppress replacement responses after commitment, and accounting
cleanup must follow authored use and pending-result reaping.

The driver now owns a table of lifecycle points. Trusted provider services supply
AssemblyScript function bodies with typed parameters and distinct integer orders.
They cannot capture caller locals; they can access module globals. This is a
provider-internal composition convention, not a sandbox or package registration
mechanism. Packages still supply bounded ABI shims under the existing admission
contract. Terminal placement remains one direct terminal effect.

The composer still resolves checked text anchors after legacy instrumenters.
Centralizing that dependency is this checkpoint; explicit template call sites
remain follow-up work. Capability-specific I/O instrumentation stays with its
owner. No new scheduler, cancellation ABI, retry policy or public configuration
is introduced.

## Point semantics

| Point | Kind | Meaning |
| --- | --- | --- |
| `request.acquired` | observe | Downstream request/body handles loaded |
| `effect.settle` | guard | Before invocation ticket consumption |
| `effect.deliver` | around | Continuation hand-off; `after` receives acceptance |
| `effect.result` | guard | Exported continuation setter entry |
| `invocation.close` | observe | Closure entry, before existing reaping/ticket clearing |
| `invocation.end` | observe | Driver run returned, before closure |
| `invocation.closed` | observe | Driver closure and reaping returned |
| `response.error` | claim | Service error responder behind the authority fence |
| `response.authority` | predicate | Shared fence at ordinary, error and timeout responders |
| `result.claim` | claim | Service handles final result before ordinary response selection |

Observers run in ascending order; guards/predicates AND with short-circuiting;
claims stop at the first true result. Around hooks run `before` ascending and
`after` descending. **After hooks and end/closed observers run only on normal
return, including handled failures. They are not trap finalizers.** A trapped
continuation may leave its delivery flag set; the invocation must not be reused.
Existing request entry/ticket fences remain authoritative.

The table fixes cross-point nesting: the response-authority predicate is outside
service error claims and legacy responders. Service registration order does not
change emitted source. Required anchors must occur exactly once. The timeout
responder is required exactly when the provider's normalized request-budget mode
is enabled. A missing, duplicate or unexpected timeout anchor rejects composition;
absence is never used to infer that the budget was disabled.

No contributions returns the source unchanged. Shared authority support is selected
only for terminal extensions or incoming body forwarding. Ordinary builds that
select neither service remain unchanged.

## Shared downstream response authority

`response-authority.js` owns a single request state:

`owned (0) -> outcome unknown (1) -> transferred (2) -> locally completed (3)`.

Every selected downstream send fences authority before crossing the host ABI.
Nonzero status and traps leave it unknown; neither permits a replacement send.
Success marks transfer. Nonstreaming success completes locally. Forwarding marks
completion only after successful final body close; this is not client delivery
or host quiescence evidence. Terminal handoff completes after authenticated
settlement and final token selection.

Terminal and forwarding services no longer own separate response-commit flags.
Ordinary responses in a terminal-enabled artifact now report state 3 through the
existing internal diagnostic export; previously that export tracked only terminal
handoff and remained 0. Error/timeout responders share the same state.

**Response authority is not handle ownership.** Borrowed request handles,
streaming writers, cleanup failure and uncertain resource disposition remain
service responsibilities. This spike does not qualify all forwarding cleanup
paths under RA accounting or change existing forwarding host disposition policy.

Forwarding contributes handle acquisition, specialized error response, final
result claim and normal-return cleanup through the points. Its upload, header,
body-pump and readiness logic remains capability-local. Its cleanup now runs at
`invocation.end` even when the shared fence suppresses a late responder.

## Accounting replay

RA-05 keeps its original baseline mode. `--lifecycle` selects the shared
response-authority wrapper and contributes `rf_finish()` at `invocation.closed`.
This runs after pending reaping and ticket invalidation, while preserving the
existing request clock and conservative unknown/consumed/transferred accounting.

All 44 Native cases pass, including ambiguous sends/waits, traps, failed disposal,
whole-request expiry, late arrivals, opaque transfer and fixed cohorts 8/16/32.
This establishes the accounting closure placement in the bounded fixture. Host-call
wrappers, body-allocation checks and cohort admission still use RA-05's checked
source injection; this is not full structural accounting adoption.

## Evidence and limits

Current receipts and exact source identities are under [lifecycle/](lifecycle/).
The evidence distinguishes:

- 28 composer checks: explicit feature modes, anchor drift, safe integer orders,
  owner validation, short-circuit/reverse ordering and unused source identity.
- Nine compiled composition cases using real terminal/forwarding hook bodies and
  explicit I/O stubs: shared authority, reentrant/late responders, uncertain and
  trapped sends, claims, rejected settlement and trapped delivery. Reversing the
  contribution list produces identical source. This forced composition is **not
  authored terminal-plus-forwarding admission**.
- Existing full terminal and forwarding service fixtures, run separately against
  the migrated provider, plus the 44-case RA-05 lifecycle replay.
- Matched base/current source, optimized Wasm, import sets and extension policy
  measurements. These are binary-size results, not runtime-cost measurements.

Matched final deltas are **+246 bytes** for Fanout/WebSocket and **+149 bytes**
for forwarding. Absent/imported-unused/generic GRIP source and Wasm are identical.
Import sets and extension policy are identical; selected-build import order changes.
The final terminal suite has 66 lifecycle traces, including uncertain ordinary
sends that retain their output fence while still closing known borrowed ingress.

The workspace build, six selected provider tasks and repository documentation/
maintenance checks pass. The unit aggregate passed 30 tasks and failed
`release-recovery` once (executed versus expected reused); an isolated retry passed
without changing that task. Both attempts are retained, so the aggregate is not
reported as an uninterrupted pass.

No hosted Fastly, Viceroy, packed consumer, release seal or general multi-service
placement qualification is claimed. This checkpoint does not add nonterminal
extension admission or a cache implementation.

## Reproduction and next stopping point

```sh
node wasm/scripts/run-wasm-tests.cjs --task fastly-host-extension-proof --task fastly-incoming-body-forwarding --no-report
node docs/internal/host-extensions/resource-accounting/ra05/check.cjs /tmp/hex-lifecycle-ra05 --lifecycle
node docs/internal/host-extensions/lifecycle/measure.cjs 41d9f6b5d577e444c5135fdb098da120596f76fd /tmp/lifecycle-measure.json
```

RA-05 evidence remains valid within its recorded scope. Before broader RA-06/07
adoption, review this checkpoint, then pressure the point set with one minimal
nonterminal service. Migrate budget begin/ready and the remaining error/timeout
claims only where that proof demonstrates the need. Replace anchor resolution
with explicit template sites before calling structural migration complete.

Remaining questions are service interaction under admitted placement, package
completion variants of delivery, resource-specific acquisition/transfer hooks,
and matched execution cost. The original candidate's redundant settle-guard
mutation observation is historical evidence; it has not been rerun for this spike.
