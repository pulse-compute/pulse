# @pulse-compute/wasm-guest-link

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse compiler, release, and first-party guest-unit maintainers.<br>
> **Install directly:** No for application projects; it is an internal synchronized compiler dependency.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal first-party prebuilt guest-link interface synchronized with the compiler; no application-author or third-party guest compatibility guarantee.<br>
> **npm:** [`@pulse-compute/wasm-guest-link`](https://www.npmjs.com/package/@pulse-compute/wasm-guest-link)<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.2/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.2` package policy.
<!-- pulse-package-status:end -->

Internal Pulse implementation package for connecting validated first-party core
Wasm guest units into one final audited Native artifact.

The package owns:

- `pulse.guest-unit.v1` / `pulse.guest-unit-plan.v1` validation plus the
  closed ES256-only v2 contracts;
- package-prebuilt hash, source-provenance, and binary verification;
- content-addressed `.pulse/guests/` materialization;
- the direct pinned Binaryen toolchain;
- static core-Wasm composition and post-link optimization;
- `pulse.guest-link-report.v1` and `pulse.final-wasm-audit.v1`;
- normalized, redacted guest-link diagnostics.

The original implementation continues to accept the A4-bound
`pulse.guest-memory.borrowed-span.v1` contract: one fixed 32-page
link-stage-owned memory, synchronous read-only borrowed spans of at most 4096
bytes, no allocation or retention, MVP features, and no fallback.

G2 adds a separate closed `pulse.guest-unit.v2` /
`pulse.guest-unit-plan.v2` path for the reviewed
`pulse.crypto.es256.rustcrypto-p256.v1` package prebuilt. That path preserves
the same single fixed memory while reserving the frozen 16,640-byte private
invocation frame. It accepts no other v2 unit, owner, ABI, artifact, source
tree, frame capacity, or toolchain identity. Both default Native and
`experimental-native-size` realization plans perform post-link optimization
and audit the layout before and after optimization.

It does not own package semantics, provider packaging, source builds, local
overrides, dynamic loading, or third-party guest registration. Package
manifests contain normalized metadata only; they cannot supply executables,
shell commands, or argument vectors. Every binary claim is independently
verified before composition.

The exported package root is an internal compiler integration surface. It is
not an application-author API.

The ES256 unit is linked and exercised as a G2 Node Native integration proof,
but it is not selected by application lowering and is not executable through
the crypto or JWT public surfaces. G3 owns that activation.

## Release boundary

The package is synchronized with the compiler as an implementation dependency.
It accepts only trusted first-party `package-prebuilt` units selected through
the compiler's closed package-lowering path. It does not expose project
configuration, CLI guest commands, source-build adapters, local overrides,
runtime loading, self-registration, or a third-party guest API.

Selected-unit failures are terminal. No error path retries another owner,
realization, execution mode, or provider path.

## JWT/crypto proof relationship

The sealed guest-link pipeline is evidence that the accepted borrowed-memory
contract can produce one audited final core module. It is not load-bearing for
HS256. The synchronized JWT/crypto packages select
`guest-source:pulse-hmac-as` for Native targets and emits zero linked guest
units; JavaScript selects the Web Crypto runtime builtin.

The historical guest pipeline result is recorded in
`wasm/.test-results/guest-link-b4/phase-b-seal.json`. Its relationship to the
current four-target JWT proof is audited by
`wasm/.test-results/jwt-e4/jwt-phase-e-seal.json`. Neither result creates a
third-party guest ABI or authorizes publication, deployment, or activation.

## Validation

The Phase B seal replays the valid production pipeline, the complete negative
diagnostic matrix, content-addressed reuse and deletion/recreation, Node
execution, and `fastly compute serve` over the exact production core artifact.
It cross-checks the core identity against the sealed A3 evidence without
rebuilding the package-prebuilt Rust source:

```bash
PULSE_FASTLY_BIN=/path/to/fastly \
PULSE_VICEROY_BIN=/path/to/viceroy \
node ../../scripts/run-wasm-tests.cjs --task guest-link-b-seal --no-report
```

The seal writes `wasm/.test-results/guest-link-b4/phase-b-seal.json`, including
artifact-size and focused validation wall-clock measurements. It performs no
remote deployment.
