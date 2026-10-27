# P07 — Bounded Fastly forwarding integration

Status: implemented for the existing terminal Native forwarding realization;
qualification results and immutable source identities belong in PR #550. General
fetch decoding, other providers/targets, cache and child composition remain open.
This is a production-selected operation slice, not completion of all P07 or RA.

Human direction: “Got it let's integrate and qualify 550.” This extends the prior
bank/exhaustion policy approval to driver integration and qualification. It does
not promote the foundation, approve review, merge, release or deployment.
Entry point: `provider-fastly`. Additional owners are the shared kernel's internal
source loader and protected cleanup transitions, maintained runtime/provider and
installed tests, evidence registration and canonical documentation. Classification
is architecture; effect/continuation and provider/target boundaries require review.

## Selection and profile closure

The existing canonical forwarding validator admits one terminal opaque POST fetch,
inline incoming-body marker, literal URL/headers, static backend, explicit byte
caps and original request duration. Its supported surface is unchanged. The
provider derives a P05 profile from those selected literals and actual fixed-buffer
implementation. Neither project options nor authored data can install a profile,
change bank capacity, inject accounting code, or disable selected accounting.

The production generator includes the shared kernel only for that realization.
Configuration alone and an unreachable forwarding helper select no ledger. The
profile appears in the provider artifact manifest. Normal compilation, fixture
execution and installed build use the same source owners. No post-build Wasm or
export replacement is involved. General fetch continues its existing enforcement
and has no resource-accounting claim from this slice.

| Descriptor | Namespace / allowance | Partition |
| --- | --- | --- |
| Incoming request, outbound request | HTTP request, two claims | Work |
| Incoming body, upload, origin body, downstream writer | HTTP body, four claims | Work |
| Pending request | Pending, one claim | Work |
| Origin response, downstream response | HTTP response, two claims | Work |
| Error response and body | HTTP response and body, one each | Exit |
| Shared raw scratch, header arena, pair table, ABI outputs | 33,920 bytes | Work |
| Request URL, backend and literal header encodings | Exact total UTF-8 length | Work |
| Bounded error text | 64-byte allowance | Exit |
| Service metadata | One logical record | Work |

The single whole-invocation cohort reserves 11 handles, 15 records, 10 protected
work-disposal/observation steps, two exit steps, and one effect envelope before
incoming acquisition. The fixed storage envelope is 2,944 bytes (128×15 + 1,024),
not a new global memory limit. Backing is 33,984 bytes plus the selected encodings;
all allocation-family claims remain until invocation teardown. Static scratch is
charged before first use; payload length does not grow the bank or scratch.

Allocator metadata, application values, request-context reads, diagnostics,
driver identity storage, non-forwarding driver responses and host queues are
excluded. This bounds the selected forwarding service, not every byte or handle
in the driver, total Wasm memory, process RSS or network buffering. The existing
value, request/body, physical-memory and effect guards remain authoritative.

## Identity and dispatch

The driver permits one managed invocation per Wasm instance. A private ledger
reference plus its invocation identity authenticates resource operations; scalar
identities never cross the host ABI or become author-accessible tickets. Different
instances have disjoint memories. Raw memory and ABI access remain trusted.

This profile has one transaction and no slot recycling. At commit the driver
checks each descriptor's actual slot and generation against its immutable mapping.
Namespaces are distinct, and handle zero remains valid. Kernel tests separately
exercise generations and real u32 exhaustion; production adds no test counter.

The existing effect owner still issues and authenticates completion tickets.
Before streaming dispatch the adapter verifies its sole ticket and cumulative
count against the reserved one-effect envelope. It never resets or replaces that
counter. Reservation cannot dispatch a host call or act as a completion ticket.

All possible send/poll outputs are fenced before dispatch, including overlap with
unresolved input claims. Successful streaming send consumes the request claim;
nonzero/ambiguous status leaves it unknown and prevents retry or speculative
close. Poll returns of not-ready retain the fenced outputs; a qualified ready
result retires pending and records both outputs, even if the host call crossed
the deadline. Error or invalid poll outcomes retain uncertain claims and are not
polled again. Disposal is fenced before each close/abandon/send and releases only
on qualified success. Application-level failure remains separate from the ledger's
first scalar marker; handled error delivery does not clear the ledger marker.

## Cleanup and time

The ledger clock uses exact nanoseconds relative to the original request start.
The existing 1–30,000 ms duration bounds its representation before conversion.
No absolute nanosecond timestamp is narrowed to a safe-integer counter. Regressing,
negative or failed clock observations latch denial, including a transient fault
followed by a seemingly valid sample.

After a failure, cleanup may spend one reserved nonblocking poll under the
original request deadline to observe already-fenced outputs. It neither waits nor
creates new output reservations. Known late handles are recorded then disposed if
time remains. Unknown/not-ready claims stay held for host teardown; the ABI has no
pending-request cancellation guarantee. The protected `cleanupStep` operation
spends an attempt but grants no handle or allocation authority.

An earlier fetch timeout can still produce a bounded 504 while original request
time remains. Once the original request deadline expires, or its clock becomes
untrustworthy, no further cleanup or error-response host calls are authorized.
The host tears down unresolved resources; a new 504 or successful guest abandon is
not guaranteed. Response authority still prevents a second response after an
ambiguous downstream send. Successful final close remains the host-handoff
boundary, without a delivery receipt or post-handoff cancellation promise.

## Qualification

`fastly-forwarding-accounting` compiles the actual selected driver and compares
unobserved and lifecycle-observed execution. It checks independently specified
profile totals, stale/foreign identity rejection, one-shot instance entry, fresh
instance isolation, handle zero, unknown send/disposal/poll outcomes, retained
claims, exit protection, request-deadline enforcement and unselected machinery.
A configuration-only unselected comparison is byte-identical. The unused-import
case retains its different source/plan identity while proving absent ledger code,
unchanged imports and equal Wasm size.

`fastly-incoming-body-forwarding` retains the broad byte, header, partial-write,
backpressure, timeout, alias/transfer and trap corpus. Its clock-fault assertions
now require absence of new host work, rather than assuming a 504 can be created
without a trusted remaining deadline. The earlier-request-deadline installed
variant has the same explicit terminal rule; earlier fetch timeouts retain their
504 and cleanup assertions.

`fwd9-03-installed` packs and verifies the candidate closure outside the checkout,
replays the accounting corpus through installed compiler/provider/kernel files,
and runs doctor/inspect/test/build/report, ABI variants and required pinned
Viceroy HTTP qualification. This is installed and local-host evidence, not a
hosted Fastly deployment or release seal. P11B ownership-equivalent timing remains
separate; reader/ownership changes cannot be reported as accounting-only savings.
