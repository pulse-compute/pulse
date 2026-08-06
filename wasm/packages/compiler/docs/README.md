# Compiler contracts

This directory contains maintained internal contracts for the Pulse compiler. Application authors should use the public documentation under [`docs/`](../../../../docs/).

## Maintained contracts

- [`pulse-config-contract-v1.md`](./pulse-config-contract-v1.md) — compiler configuration contract.
- [`pulsewasm-core-runtime-contract-v1.md`](./pulsewasm-core-runtime-contract-v1.md) — core runtime vocabulary.
- [`pulsewasm-deployment-posture-contract-v1.md`](./pulsewasm-deployment-posture-contract-v1.md) — deployment-posture artifact contract.
- [`pulsewasm-json-body-abi-contract-v1.md`](./pulsewasm-json-body-abi-contract-v1.md) — structured JSON/body ABI.
- [`pulsewasm-library-contract-v1.md`](./pulsewasm-library-contract-v1.md) — trusted package-owned compiler contract.
- [`pulsewasm-runtime-abi-boundary-contract-v1.md`](./pulsewasm-runtime-abi-boundary-contract-v1.md) — runtime ABI ownership boundary.
- [`pulsewasm-wasm-host-abi-contract-v1.md`](./pulsewasm-wasm-host-abi-contract-v1.md) — Wasm guest/host ABI.
- [`runtime-provider-kv-contract.md`](./runtime-provider-kv-contract.md) — runtime-provider KV mapping.

Generated contracts emitted into the selected artifact directory are ephemeral implementation evidence and are not checked into the repository.

## Current evidence

- compiler and provider source;
- focused contract, lowering, runtime, provider, and compiled tests;
- the current contracts above;
- [`CHANGELOG.md`](../../../../CHANGELOG.md).

Material changes to the public contract require explicit human direction and an
update to the current owner, beginning with the
[current architecture contracts](../../../../docs/architecture/current-contracts.md).
Update the associated machine-readable catalogs, generated references, and
executable evidence in the same change.

## Implementation evidence

Focused tests prove the local Wasm host ABI and host bridge (`ptr + byteLen`), the platform-neutral host runtime kernel and `executeRequest`, and the Node adapter as a provider implementation rather than a JavaScript-engine escape hatch. These are implementation regressions; they do not define a second public workflow or new route semantics.
