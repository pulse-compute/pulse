# FWD9-03 — Fastly Native forwarding qualification

This qualifies the FWD9-02 implementation under the host-handoff contract
selected in FWD9-01. It does not promote the experimental API, change the
release version, deploy a service, or run the #301 Rust comparison.

## Reproduce

Use the lockfile-pinned workspace toolchain and Viceroy **0.21.1**. The reviewed
Linux executable has SHA-256
`881dc618935b9d8c2f04bb8e3c2f2199d77f2a1415be141755fbe0cd7682e5b9`.
Other executable builds must retain their own recorded digest. The runner
rejects a different Viceroy version.

```sh
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/scripts/run-wasm-tests.cjs \
  --task fastly-incoming-body-forwarding --report .test-results/fwd9-03-workspace.json
PULSE_VICEROY_BIN=/path/to/viceroy node wasm/scripts/run-wasm-tests.cjs \
  --task fwd9-03-installed --report .test-results/fwd9-03-installed.json
```

The first task allows an ABI-only run when Viceroy is absent. The installed task
requires Viceroy and fails if it is unavailable. Both retain unique detailed
reports; a failed attempt must not be presented as passing qualification.
These tasks are focused development evidence, not the aggregate release seal.
The installed task is explicitly selectable; this change does not silently add
a new mandatory release gate or relax an existing one.

## Coverage and interpretation

| Evidence | Assertions |
| --- | --- |
| Compiler admission | Missing/invalid bounds, duplicate/aliased consumers, structured reads, groups, multiple effects, dynamic backends, decoding and forbidden request framing fail closed |
| Exact emitted Wasm, injected ABI | Binary 0/1 KiB/64 KiB/1 MiB, cap ±1, unknown/invalid/duplicate/mismatched lengths, early responses, denial without input reads, independent caps |
| Ownership and bounded storage | One reused 16 KiB payload pointer, no next read before prior writes finish, partial writes, zero/invalid counts, read/write errors, owned handles closed or abandoned, unresolved pending work distinguished from guest-owned handles |
| Deadlines and termination | Source/writer/header stalls, EOF in each direction, clock failures/regression, stale headers, cleanup polling, operation timeout and earlier total deadline; successful close is the handoff boundary |
| Headers and bodies | 64-pair/16 KiB metadata budget, invalid ABI counts/cursors, repeated values, Connection nominations, framing/hop removal, raw encoded bytes, 204/205/304, post-header abort without a second response |
| Pinned Viceroy HTTP | Binary identity through 1 MiB and cap boundaries; chunked unknown lengths; upload prefix before input EOF; response prefix before origin EOF; slow client, early rejection, overflow/truncated body/deadline aborts; disconnect followed by healthy requests |
| Installed workflow | Real pnpm packing, outside-checkout npm consumer with lifecycle scripts disabled; every installed Pulse file compared with its exact tarball before/after execution; doctor/inspect/test/build/report; CLI test and build Wasm hashes agree; emitted bytes replayed in both hosts |
| Installed variants | Request/response caps 33/65 bytes; request deadline 1000 ms before fetch timeout 1500 ms; restored configuration reproduces identical Wasm; disabled opt-in, JavaScript target and dynamic backends reject |

The injected ABI host is an adversarial oracle, not Fastly platform evidence.
Viceroy is local provider evidence, not deployed Fastly acceptance. Repeated
requests use fresh invocation instances, matching the lifecycle boundary; no
claim is made that `_start` is reusable on an already completed Wasm instance.
A host cancellation trap prevents further guest execution; guest cleanup cannot
run after that trap. Pending host operations remain invocation-bound because
the ABI has no pending-request cancellation export.

The measured default fixture uses 1,310,720 bytes of guest linear memory at all
successful tested sizes. The pointer/read/write assertions establish one
16,384-byte retained payload chunk. Fixed metadata scratch is another 17,536
bytes. These observations exclude host queue storage, fixture capture buffers,
Viceroy process memory and client/origin buffers. Sequential loopback wall times
are recorded only as diagnostics, with deliberately slow clients labeled.
They are not a zero-copy claim, a throughput acceptance threshold, or a Rust
comparison.

## Defect found and fixed

The Fastly Native CLI test adapter previously classified forwarding output as
`structured`, because the pump replaces origin response metadata while retaining
opaque payload semantics. A harness expectation of `bodyClass: 'opaque'`
reproduced the failure. Classification now recognizes the admitted forwarding
plan's streaming response. A pre-commit 413 remains `structured`; neither case
widens source eligibility or changes the emitted pump.

Initial installed-run attempts also exposed two oracle mistakes: Node's
`native-wasm` evidence shape and the portable `files.nativeWasm` artifact were
selected. Fastly truthfully emits
`fastly-native-fixture-abi`, with `providerRealityValidated: false`. The runner
now asserts that provider-specific evidence and checks the exact provider
`bin/main.wasm` digest against `fastly-native-manifest.json`. Its import audit
requires streaming Fastly dispatch and excludes `pulse_host`.

## Remaining boundary

Live Fastly qualification, host resource accounting, and #301 performance
measurements remain separate. No delivery receipt or timeout after successful
streaming close is available. Keep PR #307 open and draft for review; FWD9-03
results do not authorize merge, deployment, or release promotion.
