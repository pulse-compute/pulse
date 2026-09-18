# Pulse ES256 guest source

This Crypto-owned Rust unit implements ES256 verification and deterministic
RFC6979 signing with the pinned RustCrypto P-256 implementation. It imports
only fixed `env.memory`; the guest-link stage admits the exact reviewed binary,
source, lockfile, build identity, and two scalar exports.

Verification retains the existing invocation-frame v2 contract and 64-byte
`x || y` public key. Signing uses the same checked 16,640-byte envelope with
96-byte `x || y || d` key material and a disjoint, writable 64-byte JOSE `r || s`
output span. The scalar must be valid and match the supplied public point.
Each exported function validates its own key width and never changes operation
based on untrusted flags. Signing adds no allocator, host callback, random
source, key generation, JWK/PEM parsing, or provider authority.

The caller clears the invocation frame and borrowed Rust stack after capturing
the signing result. SigningKey also zeroizes its owned scalar on drop. Private
JWK decoding belongs to JWT; secrets and request lifetime belong to providers.

The earlier G0 source-selection hash records the foundation, not signing
acceptance. Signing acceptance requires the current guest and JWT signing
fixtures. Historical seal reports do not validate this revised artifact.

Ordinary application builds consume the checked-in prebuilt. Only maintainers
run `node ../build.cjs --write` with the pinned toolchain; the script rebuilds
twice and requires identical raw and optimized bytes.
