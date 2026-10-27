# P07 — Bounded decoded-body backing

This first decoded-fetch pass replaces the maintained Fastly platform driver's
fragment-dependent reader allocation. It is a prerequisite for a complete fetch
profile, not whole-operation resource accounting. The forwarding ledger remains
unchanged. Base: `latest` after #549, `ea8a6efd170fb9da75f88b1da7166a5730d7e711`.

Human direction: “Proceed,” after foundation review and merge. Entry point:
`provider-fastly`; additional owners are its maintained provider tests and this
internal allocation record. Classification: hardening. No new public API,
configuration field, scheduler, effect ticket or memory default is introduced.

## Selected allocation strategy

The canonical Fastly platform driver now allocates one input buffer of `B + 1`
bytes and one four-byte ABI result slot per decoded body. `B` is the existing
schema/body byte bound. Every read writes directly at the accumulated offset,
requesting at most 65,536 bytes and never more than the remaining input capacity.
The additional byte distinguishes exact-limit EOF from overflow. A positive
overflow observation stops before decoding. Invalid counts or host errors stop
without another read. No per-fragment buffer, view array, assembled copy or copied
string prefix is allocated by this reader.

UTF-8 is decoded once at EOF, preserving scalars split across reads and embedded
NULs. Request text validation examines only the received prefix, so spare buffer
capacity cannot make truncated UTF-8 valid. Request malformed-text and overflow
responses retain their existing behavior. Fetch decoding retains its existing
decoder policy. The original request-budget wait still runs before each read;
the reader neither creates nor extends a deadline.

AssemblyScript 0.28.18's UTF-8 decoder allocates at most `2B` string payload bytes
and shrinks that same allocation. The reader's cumulative payload backing is
therefore **`(B + 1) + 4 + 2B = 3B + 5` bytes per first body read**, independent of
fragmentation. At B=65,536 this is 196,613 bytes. This is an allocation envelope,
not measured peak memory or a live ledger reservation. Array/object headers,
alignment and allocator metadata are excluded. Existing cached body text remains
retained with its response/request owner; repeated decoding does not imply a
backing refund. Another independently read body needs its own allowance.

The implementation checks signed address/UTF-16 allocation representability
before allocating. An invalid or over-1,073,741,823-byte bound fails through the
existing body/schema limit path. This does not promise allocation success near
that representation ceiling; the independent Wasm memory ceiling remains active.
The strategy allocates the full bounded input capacity even for an empty body,
trading that fixed cost for a fragmentation-independent envelope.

This helper is shared by request text, decoded fetch and the selected asset-text
path. Opaque terminal forwarding uses its separate fixed scratch. The legacy
`native-http-effects.js` generator is unchanged and must not inherit this profile.
The earlier P05 chunked-text formula describes that legacy reader, not this new
realization. Before this change, the maintained platform reader already decoded
once, but retained a 64 KiB allocation for every positive fragment and EOF read.

## Evidence and remaining integration

`assert-fastly-decoded-body-backing.cjs` is included in the maintained
`fastly-native-platform-capabilities` task and can replay through installed
compiler/provider files using `--installed`. It compiles authored programs through
the project compiler. ABI observations check contiguous writes into one backing,
one reused result slot, one-byte fragmentation, empty and exact-bound bodies,
single-byte overflow detection, cross-fragment Unicode, request malformed UTF-8,
JSON decoding, invalid host counts/errors and the original request deadline.
A guest-memory ceiling catches the prior per-byte 64 KiB amplification. It is
supporting evidence, not a total process-memory guarantee. The no-reader control
must retain no body-read import; candidate/base byte identity belongs in the PR.

The next P07 pass must derive the complete selected fetch profile, including
request/header encodings, pending and response handles, overlapping unknown
outputs, protected cleanup/exit, repeated effects and retained result aliases.
It must reserve the entire admitted cohort before dispatch and preserve the
existing cumulative effect owner. This reader alone does none of those things.
P11B must compare accounting-on/off artifacts using this same reader; reader
allocation savings cannot be reported as accounting overhead improvements.
