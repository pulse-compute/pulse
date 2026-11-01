# P09A — Node Native execution lifecycle

P09A starts from `latest` at `23e842fc5bf3710f847acfc2ce090844084dd025`, after
P03 #546. It implements the second driver style in the foundation: host-managed
JavaScript settlement around a Native guest. It does not implement P09B's
JavaScript accounting parity or qualify Node support for Fastly handoffs.

## Ownership and selection

`wasm/packages/host-runtime/src/runtime/native-execution-lifecycle.js` consumes
P02's shared planner. It binds the six execution points, orders trusted synchronous
service implementations by the returned plan, and reverses after notifications
only after normal delivery return. The immutable plan remains data. No scheduler,
new ticket ledger, guest import, generated guest hook, dependency or package export
is added. The existing invocation owner remains authoritative for ticket identity,
static site reuse, single consumption and closure.

`canonical-native-host.js` accepts an internal `lifecycleServices` option at the
host-driver boundary, parallel to P03's internal emitter seam. Entries contain
`point`, `owner`, `order` and `run`, or `before`/`after` for an around point. These
are trusted host implementations, not application callbacks, project configuration,
package registration or a sandbox. Async/generator functions, asynchronous return
values, invalid phases, duplicate orders/owners and HTTP points reject. Guards
must return booleans; observers must return undefined. Selected callback references
are captured at construction. Empty/absent selection takes a fast path without
building a dispatch plan or wrapping exports.

## Concrete execution boundaries

| Point | Host realization |
| --- | --- |
| `effect.settle` | Authenticate the ticket object first; then service guards; then the existing ledger reauthenticates and consumes. Denial allocates no result handle and retains the pending ticket. |
| `effect.deliver` | Around the guest setter after consumption. After notifications receive its integer accepted/rejected result before the host converts rejection into an error. |
| `effect.result` | Guard host-visible `pulse_set_effect_result` and package-failure setter entry. Effect is the slot index; result is the value handle, or undefined for failure completion. |
| `invocation.end` | Normal terminal guest run return, including a terminal failed status, before closure. Suspension is not an end. This does not mean HTTP delivery succeeded. |
| `invocation.close` | At host closure entry before invalidation. Reentrant close is bounded; mediated settlement/resume is denied while closing. |
| `invocation.closed` | After invalidation, pending/admission queue clearing and abort-listener removal return normally. It is skipped if the pre-close observer throws. |

Settle/deliver callbacks receive host result values; the raw setter guard receives
a numeric guest handle. Semantic roles do not mandate identical representations
at distinct points. Service denial cannot bypass the ledger's second authentication
if a callback closes the invocation. Ticket object identity rejects clones,
foreign executions, duplicates and stale visits.

With services selected, the controller and its instance expose the same frozen
host export view; result setters are JavaScript wrappers around the original Wasm
functions. Guest bytes and import/export ABI stay unchanged. This guards external
controller callers as well as managed settlement, but it is not a security boundary
against trusted host code that obtains raw exports or instantiates the module
itself. Raw setters do not authenticate invocation tickets; result delivery belongs
through the controller's ticketed settlement methods. Unselected execution retains
the original native export view.

## Closure, traps and HTTP scope

Host closure is idempotent and invalidates outstanding tickets even when a
pre-close observer throws. Memory exhaustion, cancellation and execution failure
retain their primary error; cleanup callbacks cannot replace it. Provider disposal
still runs. Cleanup does not renew deadlines, retry host operations or establish
physical reclamation.

A trapped before/delivery path consumes the ticket and skips after notifications.
Unlike guest AssemblyScript, the managed Node host has a `finally` boundary that
can subsequently close the invocation. Its successful close can run closed
notifications. This is qualified host-side behavior, not a portable guest trap
finalizer. Manual controller users still own closing after a thrown setter.

This controller constructs canonical HTTP responses but does not own socket
send/error/timeout dispatch. It therefore binds no HTTP lifecycle version and
rejects HTTP services. P03's actual Fastly authority cases remain in the suite;
they do not qualify Node socket authority. Node HTTP and event invocations both
use the execution contract without implying that every invocation serves HTTP.

## Maintained evidence and remaining gates

`execution-lifecycle-conformance.cjs` runs the same authentication, guard retry,
accepted/rejected delivery, closure and before/delivery trap assertions against
P03's compiled guest fixture and the real Node Native controller. Faults are
injected only into maintained test guest artifacts, with explicit source markers;
ordinary Node execution uses unmodified generated Wasm. Host-specific tests cover
raw setter guards, foreign/stale/repeated tickets, reentrant closure, abort,
observer failures, memory exhaustion, primary-error preservation, package failure
ABI dispatch, Node provider execution and event execution. The package-failure
fault export is an ABI fixture, not package admission qualification.

The same supplied guest has identical bytes/imports with absent, empty or selected
host services. No compiler or guest-emission owner changes in this pass. The empty
selection additionally retains the native instance export view. Existing Native,
Node forwarding, events, error, deadline and collection suites supply regressions;
exact completed selections and failures are recorded in the PR.

P09A completes the second-driver implementation, not foundation promotion. P10's
application matrix, applicable P13 host qualification and P14's immutable-candidate,
packed-consumer and complete regression gate remain. P05/P11A still precede the
P04 accounting core. Evidence migration, HEX surface changes, RA and cache remain
outside this pass. No historical harness or evidence repository is required by
the new tests or production runtime.
