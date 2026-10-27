# P07 — Single decoded-text fetch accounting

This production-selected slice integrates the shared Native resource ledger with
one compiler-proven Fastly GET/text operation. It builds on #551's bounded reader,
directly on `latest` commit `9f789222fde6c5214b76dd78d007f994dbf99060`.
It does not complete general fetch accounting or P07.

Human direction: “Ok next,” following integration and qualification of #550 and
#551. Entry point: `provider-fastly`; additional owners are maintained provider
tests and this internal evidence record. Classification: architecture. Resource
ownership, effect/lifecycle and provider/target boundaries require human review.
No merge, release, deployment, public configuration or new authoring support is
included.

## Selection and scope

The trusted provider producer selects an ordinary handler whose complete entry
body is one fetch effect binding followed by `ctx.text` of that same local. It
requires a literal URL, static backend, literal optional headers, positive literal
`timeoutMs`, text decoder, and original request duration of 1–30,000 ms. The init
admits only timeout and headers, with unique init and header keys, so the method is GET and upload is empty. The
canonical control tree proves one visit and one decode; counting static effect
sites alone would not establish that. Routers, JSON, response options, dynamic
inputs, repeated effects, groups, application packages and other shapes remain
unselected. Existing unselected behavior retains no accounting claim.

There is no authored profile, limit override, disabling switch or test-only
production path. The selected profile appears in the artifact manifest. Production
compilation and source-free installed replay use the same provider, scheduler,
reader, kernel and lifecycle owners.

## Closed inventory

Let B be the existing schema/body byte bound and E the exact UTF-8 byte total of
GET, URL, backend, and literal header keys and values.

| Descriptor | Work | Exit |
| --- | --- | --- |
| Request | 1 | 0 |
| Empty upload and origin body | 2 | 0 |
| Pending request | 1 | 0 |
| Origin response | 1 | 0 |
| Error response and body | 0 | 2 |
| ABI scratch payload | 100 bytes | 0 |
| Encodings | E bytes | 0 |
| Retained reader and decoded text | 3B + 5 bytes | 0 |
| Reused error/header payload | 0 | 64 bytes |
| Logical metadata | 1 record | 0 |
| Protected disposal/observation attempts | 5 | 2 |

The cohort reserves **7 handles, 12 records, 3B + E + 169 payload bytes, 7
cleanup/exit steps and 1 effect envelope** before fetch acquisition and encoding.
The private ledger storage envelope is 2,560 bytes (128×12 + 1,024).

The 100-byte scratch inventory comprises 12 request ABI outputs, 40 scheduler
outputs, one reused 8-byte fetch clock result, two reused 4-byte body-wait outputs,
and 32 cleanup/exit ABI bytes. The existing scheduler owns polling and completion.
Its repeated clock sampling and the request-budget body wait use fixed result
storage for this selection. Retired pending ownership is represented by the
ledger; no growing retired-handle array is needed for the single cohort.

Incoming request/context reads, driver identity storage and shared request clock,
application value objects, transport diagnostics, successful downstream response
serialization/handles, allocator metadata and host/engine memory are excluded.
The scope is the selected fetch service and protected failure exit, not every
byte or handle in the invocation. Independent value and physical-memory guards
remain authoritative. The full B+1 reader input is allocated even for empty bodies.
No allocation allowance is refunded at EOF, effect settlement, alias release or
response handoff; all four allocation records remain until instance teardown.

## Ownership and terminal behavior

A private ledger belongs to one managed invocation per Wasm instance. The driver
keeps its existing cumulative effect counter and completion tickets. Admission
requires the sole ticket/count to be 1, commits the entire inventory, verifies the
fixed slot/generation mapping, and consumes backing allowances before use. It is
not a second effect counter or scheduler.

Both send inputs and all possible pending/response/body outputs are fenced before
dispatch. A successful nonstreaming send consumes request and upload. Any ambiguous
send outcome retains both input claims, the pending claim and the fenced outputs;
it never retries or closes guessed handles. Poll not-ready retains claims. Poll
error or invalid readiness marks pending and outputs unknown, with no cleanup
retry. A qualified ready poll retires pending and records both known outputs even
when the host call crossed a deadline. Recording does not authorize delivery.

The existing fetch timeout still limits headers. The original request deadline
limits all protected cleanup and exit calls. Negative, regressing or failed clocks
latch denial. Known origin handles are disposed at invocation end, after the
selected text result has been used; failed disposal retains its charge without
retry. Timeout cleanup can spend one reserved nonblocking poll to observe already
fenced outputs while original time remains. There is no cancellation guarantee.
Unknown or expired claims remain for host teardown.

Failure exit preserves the original driver error and the ledger's first marker.
It uses its reserved response/body claims and a reused 64-byte buffer for the
existing content-type and fixed error text. Shared response authority fences the
single send. An ambiguous error send is not retried or closed. Once original time
expires or its clock is untrustworthy, no new cleanup/error host calls occur; a
504 cannot be promised after that boundary. A host trap does not promise guest
cleanup.

## Qualification boundary

`assert-fastly-fetch-accounting.cjs` runs from the maintained
`fastly-native-platform-capabilities` task and supports `--installed`. It compiles
actual authored programs and compares plain/observed driver execution using the
trusted lifecycle seam, without generated-source or Wasm replacement. Assertions
cover independent inventory totals, fixed body-wait/clock storage, fragmentation,
retained text, one-shot identity, zero handles, unknown acquisition/send/poll/
disposal, protected exit, original deadlines, clock failure, host traps, and
unselected control shapes. Kernel tests remain responsible for generic bank and
generation exhaustion; this fixed cohort has no slot recycling.

The PR records immutable source/tree identities, terminal runner coverage,
source-free packed replay, unselected base/candidate byte comparisons, and local
Viceroy evidence separately. None is hosted Fastly acceptance, a release seal,
full general-fetch accounting or a P11B ownership-equivalent timing result.
Repeated/parallel cohorts, JSON and dynamic request backing, broader retained
aliases and other providers remain open.
