# JWT-02 — signature and allocating crypto guest composition

Proposed follow-up to JWT-01; implementation is not authorized by the
qualification pass. Coordinate with the compiler optimization lane before
editing shared guest-link or memory owners. Suggested effort: Astra / xhigh,
size M, split after design if the memory contract changes substantially.

## Problem and reproduction

The ES256/RS256 signature guest shares a fixed-memory linking contract.
Native SHA-256/HMAC uses an allocating AssemblyScript guest. An artifact that
needs both is rejected by the current guest linker. S3 introduces SHA/HMAC
requirements, so signing a token and using S3 in one Native artifact encounters
the same restriction. Selecting JavaScript explicitly or separating Native
artifacts remains the documented workaround. For S3, that JavaScript target
must be Node: Fastly JavaScript separately rejects S3 because the required raw
header contract is unavailable. JWT-02 does not change that provider restriction.

Run the installed reproduction and inspect its `composition` records:

```bash
node wasm/scripts/run-wasm-tests.cjs --task jwt-installed-workflow --no-report
```

## Decision and owners

First choose how guest initialization, memory, data segments and allocation
coexist. Read the crypto-owned guest manifests, guest-link contracts and
validator, final artifact audit, and Node/Fastly native build owners before
proposing a design. Establish whether the existing fixed-memory contract can
be satisfied or needs an explicitly reviewed revision. Do not simply remove
the start-function or memory validator rejection.

## Completion gate

- Build and execute ES256 and RS256 signing/verification alongside each of
  SHA-256, HMAC-SHA256 and S3 through installed Node/Fastly Native workflows.
- Audit the exact provider-consumed final Wasm, including initialization order,
  memory bounds, stack/data separation, import authority and symbol retention.
- Keep signing/verification bytes, diagnostics and no-fallback behavior;
  compare with independent signatures and existing digest/SigV4 vectors.
- Prove request isolation, private temporary-buffer cleanup on success/failure,
  cancellation, and deterministic artifact construction.
- Retain explicit ineligibility until the complete intended cells pass.

Out of scope: allocator optimization, new algorithms, remote JWKS discovery,
provider authority changes, and the separate Fastly Native restriction to one
verification algorithm per artifact. ES256 and RS256 already share the same
signature guest; relaxing that provider selector needs its own bounded card
and per-effect key/algorithm-selection evidence.

No publication or deployment is part of this card.
