# B10-07 measurements

Recorded investigation result: **28 cases passed; 72 isolated memory samples passed**.

**Scope of these measurements:** the initial proof retains inherited Assets size
ceilings and an experimental 4 MiB read quota. The reviewed contract in
[README.md](README.md) supersedes those as production recommendations with
application-configured admission budgets and no fixed read-byte quota. These
results establish representation behavior only over the recorded 0–256 KiB
sweep; they do not qualify the actual MCP `vector.bin`, larger inputs or production
execution-limit enforcement. B10-08 owns those acceptance measurements.

Production baseline `f393e238a529212c8e8217a4ccd41d1646fd4f6b`, tree `c8f56081c5b8af956d750751f34a7c2619e7f6c0`.
Node v24.18.0, AssemblyScript 0.28.18, linux/x64.
The working tree contained only the new investigation directory; all four executable
proof sources are bound by SHA-256 in [results.json](results.json). This is not a
clean-candidate release receipt. No production source was changed.

## Artifact and guest capacity

These are private scalar-reader guests, not complete Pulse application artifacts.
Compilation uses the pinned AssemblyScript compiler, optimized stub runtime, no
assertion runtime, and a 64-page (4 MiB) guest maximum. All figures below are bytes.

| Payload | Raw Wasm | Base64 Wasm | Host-copy Wasm | Raw guest capacity | Base64 guest capacity | Host-copy guest capacity |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1,189 | 1,472 | 1,341 | 65,536 | 65,536 | 65,536 |
| 16,384 | 17,593 | 45,183 | 1,351 | 65,536 | 65,536 | 65,536 |
| 65,536 | 66,745 | 176,256 | 1,351 | 131,072 | 196,608 | 131,072 |
| 262,144 | 263,353 | 700,544 | 1,351 | 327,680 | 720,896 | 327,680 |

At 256 KiB, raw embedding saves **437,191 artifact bytes** versus the base64-string
model, and uses **393,216 fewer bytes of guest capacity**. Native raw growth over
the empty control is payload size plus 20 bytes in these samples. The host-copy
guest excludes the sidecar/host payload: its 1,351-byte module still needs all
262,144 input bytes, a retained host snapshot and 327,680 bytes of guest capacity.
It does not eliminate payload storage or imply mmap.

The base64 comparison uses allocation-free character-code decoding, deliberately
separating representation expansion from transient string allocation. It is not
the production Assets HTTP decoder. All three Native models stayed at the same
guest capacity after 100,000 additional byte reads within one execution.

The vector fixture is 1,040 bytes. Its import-free Native guest is 2,245 bytes;
the private Fastly ABI wrapper is 2,782 bytes. The latter imports only Fastly
initialization and HTTP response/body operations, with no origin fetch or storage
imports. It returns the computed nearest row (7) through the injected ABI host.

## Process memory

Three fresh processes per cell, forced GC before and after, with input artifacts
and resource ownership intentionally retained. Values are MiB. Peak is the largest
process high-water RSS among the three runs, not a sum of component allocations.

| Representation | Empty retained RSS median | 256 KiB retained RSS median | 256 KiB peak RSS max | Explicit private host bytes at 256 KiB |
| --- | ---: | ---: | ---: | ---: |
| native-raw | 57.61 | 61.94 | 62.20 | 0 B |
| native-base64 | 57.80 | 63.65 | 63.74 | 0 B |
| native-host-copy | 57.80 | 61.96 | 62.04 | 262,144 B |
| javascript-embedded | 56.68 | 62.85 | 63.41 | 262,144 B |
| javascript-packaged | 56.55 | 62.66 | 62.81 | 262,144 B |
| javascript-host-supplied | 56.48 | 62.43 | 62.81 | 262,144 B |

These RSS differences include engine/JIT activity, file buffers, compilation and
page residency. They cannot be interpreted as resource-only costs. The raw report
also records heapUsed, heapTotal, external and arrayBuffers before loading, after
loading and after GC, plus exact guest capacity. Do not add those fields together:
some overlap. The explicit host-byte column excludes serialized input/artifact
buffers and guest memory. It therefore is not total process ownership.

JS embedded input retains the canonical manifest string plus a decoded private
byte array. Packaged/host-supplied samples retain input bytes and a private snapshot.
The two latter paths intentionally share the same in-process ownership experiment;
they do not establish runtime filesystem portability, network cost or performance
differences. No read-latency or production throughput comparison was performed.

## Validation and failed attempts

- Manifest identity, corruption/truncation, declaration errors, empty resources,
  unaligned reads, overflow-safe offset checks, exact upper limits, wrong ownership,
  stale generation, lifetime, budget exhaustion, float semantics and vector oracle
  are covered by the 28 named cases. Native and JS source/lifecycle integration are
  still separate B10-08 acceptance, as documented in the contract.
- The first run used the wrong AssemblyScript lookup root. The corrected run then
  exposed a private-adapter problem: charAt/indexOf base64 reads allocated temporary
  strings and trapped under the 4 MiB cap after repeated reads. We retained the
  failure and switched the representation experiment to allocation-free scalar
  decoding. No production decoder was modified or declared defective.
- A later run completed the size sweep but automatic approval review blocked
  observing the optional local Fastly launcher, citing possible third-party payload
  disclosure. No terminal local-server receipt was produced. The final report has
  `fastlyReality.status: not-run`; injected ABI success is not live qualification.
- Subsequent harness corrections added the existing injected-host error-reporting
  hook, moved the unsupported-authoring check to the Native plan boundary, and
  read the pinned compiler version from its package metadata. Failed reports/logs
  are retained separately; no partial attempt is counted as a pass.
- Final result: all 28 cases, all 72 samples and the injected Fastly guest passed.
  The output includes sources and hashes needed to reproduce the measurements.

## Interpretation

The evidence supports **raw embedded mapping as the narrow first realization**.
It avoids base64 storage inflation in Native and repeated scalar-read allocation.
External bytes can reduce the module file but create loader, integrity, authority
and duplicate-memory costs. Neither the small prototype nor process RSS establishes
zero-copy, mmap, bounded aggregate concurrency or a Fastly deployment limit.
