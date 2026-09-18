# Pulse first-party ES256/RS256 guest

The historical directory, unit id and module name are retained. The current
ABI is `pulse.crypto.es256-rs256.verify-and-sign.v3`; it exports separate
ES256 and RS256 signing and verification functions in one trusted unit.
Application builds use only the pinned prebuilt and never run a C/Rust build.

ES256 uses the locked RustCrypto dependencies. RS256 uses the unmodified
BearSSL 0.6 i31 source subset in `source/bearssl`, with an MIT license and an
`UPSTREAM.json` archive/file hash inventory. Pulse's `rs256.c` is bounded ABI,
key-consistency and exact PKCS#1 encoding glue; all multiprecision arithmetic
comes from BearSSL. RSA supports balanced two-prime 2048/3072/4096-bit keys,
odd 32-bit public exponents, 12288-byte signing inputs and modulus-width
signatures. It checks all private CRT relations and publicly verifies each
signature before releasing output. It does not test primality or generate keys.

[BearSSL i31's constant-time design](https://www.bearssl.org/constanttime.html) replaces a need for RSA blinding/entropy.
Its assumptions include constant-time multiplication and suitable compiler,
Wasm engine and CPU behavior. No formal cross-engine timing claim is made.
The RustCrypto RSA crate was not selected: [its upstream README](https://github.com/RustCrypto/RSA#%EF%B8%8Fsecurity-warning) warns about
Marvin timing attacks. Private key validation on the JavaScript Web Crypto
path uses BigInt and carries no constant-time guarantee. See the canonical
Crypto guide for the full execution and erasure boundaries.

Maintainer reconstruction requires the manifest-pinned Rust/Cargo, wasm32v1-none,
Binaryen, and Zig **0.13.0**. Set `PULSE_RSA_ZIG` to the official Zig executable;
then run `node build.cjs --write` or `node build.cjs --check`. Both builds run
twice and compare raw and optimized bytes. The official Linux x86_64 Zig
archive SHA-256 is `d45312e61ebcc48032b77bc4cf7fd6915c11fa16e4aad116b66c9468211230ea`.
The guest build script verifies the version before compiling freestanding C
with MVP features, no libc, no allocation, and no host entropy imports.

The prebuilt has one fixed, unshared 32-page memory import, no start section,
no memory growth and no host function imports. The 64 KiB stack and 16640-byte
frame are caller-cleared on return. The Node wrapper also clears on traps;
Fastly Native traps abort before in-Wasm cleanup. RSA uses algorithm code 2 of the v2
frame envelope; ES256 retains code 1 and its original lengths. Shared memory
layout and exact instruction/static-data inventories are pinned by the linker.

The G0 source-decision reference in the manifest is historical ES256 provenance,
not an RS256 security attestation. Current proof tasks are `crypto-rs256`,
`jwt-rs256`, `crypto-es256-signing`, and `jwt-es256-signing`; historical seals
do not attest the changed binary.
