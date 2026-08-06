# ES256 RustCrypto dependency probe

This maintainer-only G0 probe freezes the dependency and feature closure for
the first Pulse ES256 verifier candidate. It is not the production guest,
package prebuilt, application build path, or public ABI. G1 owns the real
single-export verifier and complete private-frame validation.

The selected closure deliberately avoids the aggregate `p256/ecdsa` feature.
It uses:

- `p256` `0.13.2`: `arithmetic` only;
- `ecdsa` `0.16.9`: `arithmetic` and `hazmat` only;
- `sha2` `0.10.9`: default features disabled.

`std`, `alloc`, `ecdsa/signing`, `ecdsa/verifying`, `rfc6979`, `pem`, `pkcs8`,
`serde`, JWK support, randomness, and `getrandom` are not enabled. The probe
calls the generic prehashed verification primitive directly so the high-level
signing feature and deterministic-signing dependency remain outside the
selected graph. Its one unsafe block is the probe-only raw-memory adapter;
the selected RustCrypto crates forbid unsafe code in their crate roots.

The checked-in lockfile is authoritative. The pinned toolchain target is
`wasm32v1-none`. The linker imports only fixed `env.memory` with 32 initial and
maximum pages, reserves the first 64 KiB for the Rust stack, and places static
data at 128 KiB.

Builds are maintainer-only:

```bash
cargo build
cargo build --release
```

Ordinary Pulse application builds must consume a reviewed package prebuilt.
They must never compile this source.
