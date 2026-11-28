# JWT-02 — signature, allocating crypto and schema composition

Proposed follow-up to JWT-01; implementation is not authorized by the
qualification pass. Coordinate with the compiler optimization lane before
editing shared guest-link or memory owners. Suggested effort: Astra / xhigh,
size M, split after design if the memory contract changes substantially.

**JWT-02.1 design/evidence checkpoint:** see
[initialization diagnosis and proposed implementation](jwt02/README.md).
The common primary start-section failure masks independent allocator ownership,
eager digest-buffer and disabled schema-cache allocation problems. The design
recommends preserving fixed memory and the no-start audit, sharing the existing
reserved-heap runtime, explicit initialization, bounded crypto staging and a
linked schema recipe that elides the disabled cache. Production behavior remains
unchanged at that checkpoint. [JWT-02.2 implementation](jwt02/IMPLEMENTATION.md)
now repairs the Native composition path; JWT-02.3 installed acceptance remains open.

## Problem and reproduction

The ES256/RS256 signature guest shares a fixed-memory linking contract.
Native SHA-256/HMAC uses an allocating AssemblyScript guest. An artifact that
needs both is rejected by the current guest linker. S3 introduces SHA/HMAC
requirements, so signing a token and using S3 in one Native artifact encounters
the same restriction. Selecting JavaScript explicitly or separating Native
artifacts remains the documented workaround. For S3, that JavaScript target
must be Node: Fastly JavaScript separately rejects S3 because the required raw
header contract is unavailable. JWT-02 does not change that provider restriction.

The generic installed-consumer reductions in
[STAB-03 / #625](https://github.com/pulse-compute/pulse/pull/625) also expose an
independent schema composition failure. RS256 alone compiles on Node Native;
RS256 plus MAC text verification and RS256 plus explicit schema decoding each
fail with `PULSE_GUEST_UNIT_START_MISMATCH`: the primary module has a forbidden
start section. The schema reduction has no reachable HMAC, digest or S3
operation. Fixing the allocating crypto guest alone therefore does not satisfy
this card. Inspect primary-module initialization as well as contributed guests.

Run the installed reproduction and inspect its `composition` records:

```bash
node wasm/scripts/run-wasm-tests.cjs --task jwt-installed-workflow --no-report
node wasm/scripts/run-wasm-tests.cjs --task stab03-installed --no-report
node wasm/scripts/run-wasm-tests.cjs --task cli-stab05-compiler-replay --no-report
```

STAB-03 retains installed-package composition evidence; STAB-05 is a workspace
replay and diagnostic regression. Their currently expected blocked cells are
not passing Native acceptance. Preserve the historical failure evidence and
update the expectations only when replacement build-and-execution proof exists.

## Decision and owners

First choose how guest initialization, memory, data segments and allocation
coexist. Read the crypto-owned guest manifests, guest-link contracts and
validator, final artifact audit, and Node/Fastly native build owners before
proposing a design. Establish whether the existing fixed-memory contract can
be satisfied or needs an explicitly reviewed revision. Do not simply remove
the start-function or memory validator rejection.

## Completion gate

- Keep the following generic cells independent on **both installed Node Native
  and Fastly Native**, with exact package and final-artifact identities:

  | Cell | Required proof |
  | --- | --- |
  | RS256 alone | Baseline builds and verifies an independently signed token |
  | RS256 + HMAC text verification | Both operations execute correctly in the same artifact |
  | RS256 + explicit schema decoding, without allocating crypto effects | Signature verification and valid/invalid schema cases execute in the same artifact |
  | RS256 + HMAC text verification + schema decoding | Combined initialization and execution preserve all three contracts |
  | Generic composed consumer | Ingress proof, independent Bearer identity, schemas, assets, conditional writes and worker/replay behavior pass on Native |

  The schema-only composition is a separate acceptance gate, not an inferred
  result of the HMAC cell. Compilation alone, JavaScript execution, or a
  successful component in isolation cannot close any composed execution cell.
- Build and execute ES256 and RS256 signing/verification alongside each of
  SHA-256, HMAC-SHA256 and S3 through installed Node/Fastly Native workflows.
- Audit the exact provider-consumed final Wasm, including initialization order,
  memory bounds, stack/data separation, import authority and symbol retention.
- Keep signing/verification bytes, diagnostics and no-fallback behavior;
  compare with independent signatures and existing digest/SigV4 vectors.
- Prove request isolation, private temporary-buffer cleanup on success/failure,
  cancellation, and deterministic artifact construction.
- Retain explicit ineligibility until the complete intended cells pass.

## Evidence and consumer boundary

Keep all Pulse fixtures, reports, issues and PR descriptions generic: synthetic
application shapes and data, independent test keys, and Pulse-owned reproduction
references only. Do not include downstream application names, repository links,
source, deployment identities or direct application qualification receipts.
Application-specific qualification belongs in the application's own repository.

Consumer adoption is a separate gate. Each consumer must explicitly select and
pin a qualified package version, update its lockfile and build/package identities,
and rerun its own acceptance before claiming readiness. A Pulse fix or generic
qualification does not upgrade an existing consumer pin or qualify that consumer.

Out of scope: allocator optimization, new algorithms, remote JWKS discovery,
provider authority changes, and the separate Fastly Native restriction to one
verification algorithm per artifact. ES256 and RS256 already share the same
signature guest; relaxing that provider selector needs its own bounded card
and per-effect key/algorithm-selection evidence.

No publication or deployment is part of this card.
