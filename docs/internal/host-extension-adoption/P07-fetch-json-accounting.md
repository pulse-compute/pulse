# P07 — Single decoded-JSON fetch accounting

This production-selected slice extends #552's [single text-fetch ledger](P07-fetch-text-accounting.md)
to one compiler-proven GET/JSON operation, directly on `latest`
`ff8cd9f525040c3150a4fb95eaa7c8570c4587f5`. It does not complete P07.
Human direction: “Proceed” after the next bounded integration step. Entry point:
`provider-fastly`; additional owners are maintained provider tests and this internal
record. Classification: architecture. Resource ownership, effect/lifecycle and
provider/target boundaries require human review. No merge or deployment is included.

## Selection and retained boundaries

The complete handler body must be one literal fetch effect binding followed by
`ctx.json` of that same local. The existing proof still requires a static backend,
positive literal timeout, optional literal headers with unique init/header keys,
GET with empty upload, and an original request duration of 1–30,000 ms. Typed schema
JSON and untyped JSON use their existing parser and schema paths. Response options,
different result expressions, groups, repetition, routers, dynamic inputs and
application packages remain unselected. There is no authored accounting switch.

The existing seven handle slots, effect ticket, scheduler, uncertainty handling,
protected failure exit and original deadline remain authoritative. Header admission
adds no handle or disposal attempt. A selected strict JSON decode checks original
time before its content-type lookup; after the host call, the existing bounded
reader and cleanup/exit gates prevent new work when time has expired or failed.
Content-type policy semantics are unchanged: `require-json` checks the first
header value using the existing case-insensitive `json` substring test;
`accept-json-or-missing` does not perform this header lookup.

## Closed fetch-service inventory

Let B be the existing body-byte bound, E the exact literal UTF-8 encoding inventory
from the text profile, and C the actual provider header-buffer constant (65,536).

| Selection | Handles | Records | Payload backing | Ledger storage | Cleanup/exit steps | Effects |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| JSON without strict header lookup | 7 | 12 | 3B + E + 169 | 2,560 | 7 | 1 |
| JSON with `require-json` | 7 | 13 | 3B + E + 169 + 7C + 18 | 2,688 | 7 | 1 |

Strict admission reserves one additional allocation record, slot 12, before the
first fetch acquisition and encoding. The existing metadata remains at slot 11;
all handle and other backing slots retain their identities. No backing allowance
is refunded before instance teardown.

The extra `7C + 18` allowance is derived from the actual bounded header helper:
12 key bytes for `content-type`, C buffer bytes, 8 + 4 ABI output bytes, up to 2N
bytes from UTF-8 decoding and 4N bytes from lowercase conversion. The first value
contains at most N = C − 1 bytes because the helper requires a terminating NUL.
AssemblyScript 0.28.18 `String.UTF8.decodeUnsafe` allocates twice the input byte
length; `String.toLowerCase` initially allocates four times the UTF-16 length,
including its expansion case. Shrinking via `__renew` does not allocate another
buffer in the selected stub or incremental runtime. Thus C + 24 + 6(C − 1) =
7C + 18 = **458,770 bytes**. The producer receives C from the generator's owning
constant rather than copying its default. Allocator headers/alignment are excluded.

For the maintained fixture B = 1,024 and E = 45, strict JSON reserves **462,056
payload bytes**, versus 3,286 without header lookup. The manifest explicitly excludes
`json-parser-and-schema-materialization`, alongside application values, incoming
context, diagnostics, driver identity storage, successful downstream response,
allocator metadata and host memory. Existing applicable schema, format, value and
physical-memory constraints remain unchanged. This is not total invocation-memory
accounting or a new universal parser-memory budget.

## Qualification

`assert-fastly-fetch-json-accounting.cjs` is part of the maintained
`fastly-native-platform-capabilities` task and supports source-free `--installed`
replay. It compiles authored projects through the production generator; trusted
lifecycle observers check ledger closure without replacing generated source or
Wasm. It covers independent inventory totals, strict/permissive policies, typed
schema parsing, fragmented Unicode and nested JSON, exact body bounds and overflow,
invalid JSON/schema results, first content-type value and header bounds, malformed
header ABI results, unknown send/poll, protected timeout exit, original deadlines,
clock failure and selection exclusions. The existing text-fetch corpus remains
applicable to the shared ownership paths.

Qualification also compares installed artifacts with workspace output, exercises
selected JSON on pinned local Viceroy, and compares unselected controls with the
base. Local engine evidence does not establish hosted Fastly acceptance. P07 still
needs broader fetch shapes, repetition/groups, dynamic profiles, aliases and other
targets; parser materialization and successful response accounting remain outside
this slice. Exact candidate identities and terminal results belong in the PR and
retained validation report.
