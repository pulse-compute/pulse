# JWT-02.2 — bounded Native composition

This implements the JWT-02.1 design on the ordinary canonical compilation and
Fastly build paths. The independent RS256 + HMAC, RS256 + schema, and combined
cells remain separate acceptance cases. All fixtures and evidence are synthetic.
Installed-package and hosted acceptance remain JWT-02.3 work.

## Changes

- Runtime-core owns one fixed allocator, consumed by both builders. It preserves
  the 32-page signature memory ABI, reclaims/coalesces managed allocations, guards
  size overflow and rejects raw heap reset with potentially live managed roots.
- Linked primaries export an explicit initializer. Node calls it before managed
  export binding and refuses host effects until ready. Fastly marks initialization
  in progress before calling it; a trap or reentry cannot retry on the same
  instance. Successful initialization runs once, including sequential entries.
- A private inert i32 layout witness binds the actual static/shadow-stack end.
  The linker checks it stays before the signature frame and survives final
  optimization. Existing no-start, no-growth, MVP and import/export audits remain
  enforced. Generated source embeds the allocator version/content hash; manifests
  and final audits retain runtime and layout evidence.
- Crypto guest-source v2 replaces the oversized digest frame with bounded
  init/update/final/clear operations. The frame is allocated on first use;
  SHA-256 remains Crypto-owned and receives at most 64 KiB per update. The 2 MiB
  digest, 64 KiB HMAC data and 8 KiB HMAC key limits are unchanged. Existing raw
  verification and byte primitives retain their contracts. The ordinary Node HS256
  verifier also uses this bridge through its existing 1 MiB limit; Crypto performs
  the full 32-byte tag comparison before returning. Algorithm identity
  remains `pulse-hmac-as.v1`; the private source/staging protocol advances to v2.
- Linked schemas automatically use the pinned disabled-cache-elision recipe.
  Unlinked runtime selection and enabled-cache semantics remain unchanged.
  Canonical compiler v4, host v8 and Fastly compiler v2 identify the revised build
  and lifecycle contracts. The CLI description reflects automatic linked use.

## Focused validation

```sh
node wasm/scripts/run-wasm-tests.cjs --task jwt02-native-composition --task jwt02-runtime-boundaries --task crypto-native-guest-source --task guest-link-audit-diagnostics --task schema-cache-arena --no-report
```

`jwt02-native-composition` runs normal canonical compilation and Fastly builds,
then executes their exact artifacts with independent RSA signatures and HMACs.
It covers the baseline, each independent composition, their combined form, and
invalid signatures, MACs and schemas. Fastly execution uses the injected host
fixture, not Viceroy or deployment.

`jwt02-runtime-boundaries` checks Node initializer failure/reentry/forbidden
host calls, the actual Fastly entry wrapper's once/failure/reentry behavior,
SHA-256 boundary vectors through 2 MiB, HS256 verification through 1 MiB,
HMAC maxima, oversize and invalid state
rejection, repeated allocation/collection/reallocation, and retained heap
exhaustion. Rust reservations and every signature-frame byte carry canaries.
It verifies no implicit start or memory growth and refuses unsafe raw reset.
Both new tests are registered in the existing conformance/release shard. The
installed composition inventory now expects the repaired Native builds; its
exact-tarball execution remains JWT-02.3, not evidence claimed by this patch.
The guest-link adversarial suite rejects malformed initializer signatures,
missing/active layout witnesses and static/shadow-stack overlap.

The JWT-02.1 `diagnose.cjs` and `evidence.json` are historical observations at
`41f4b4e2865f6d1dcecdeed075d95d2343e34350`. Its old failure-characterization task
is replaced in the current registry by executable regressions; replay the old
script only on that revision. Do not reinterpret that receipt as current behavior.

## Remaining qualification

JWT-02.3 must qualify exact installed Node/Fastly candidates, ES256/RS256 with
all original Crypto/S3 combinations, the independent schema case, the combined
artifact and a generic composed consumer. This patch does not claim hosted
acceptance, an application migration, or arbitrary workloads fitting in 2 MiB.
Digest byte staging can accept 2 MiB without retaining it in Wasm; managed
strings/objects still share the existing fixed heap. Terminal guest traps require
instance disposal; in-guest finalizers or whole-memory erasure are not promised.
Normal returned paths and the host bridge clear owned staging and digest state.
No new public algorithm, effect, fallback or memory allowance is introduced.
