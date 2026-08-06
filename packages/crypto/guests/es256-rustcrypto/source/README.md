# Pulse ES256 verifier guest source

This is the crypto-owned, verifier-only Rust source for the first-party Pulse
ES256 guest. It accepts only the frozen private invocation-frame v2 contract,
imports fixed `env.memory`, and exposes one scalar verification function.

It intentionally has no JWT, JWK, base64url, DER-signature, PEM, SPKI, claims,
profile, provider, allocator, randomness, signing, key-generation, host-call,
or dynamic-loading behavior.

Ordinary application builds must not compile this directory. The reviewed
artifact in `../prebuilt/` is produced only through the sibling maintainer
build script. G2 owns integrating that prebuilt with the private guest-link
pipeline.
