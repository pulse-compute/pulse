# Catalog's original verb probe

`src/index.ts` and `tests/pulse.harness.ts` are copied byte-for-byte from
`catalog-platform-foundation-v0.4.0.zip`, paths
`catalog-platform/probes/router-methods/src/index.ts` and
`catalog-platform/probes/router-methods/tests/pulse.harness.ts`.
The original source comment describes its failure on Pulse baseline
`969b8f43e87e4c2bce3b575cb702bc6dfd5c816b`; it remains intact as provenance.
The local configuration selects four explicit provider/target profiles.

Run `node wasm/scripts/run-wasm-tests.cjs --task catalog-router-parity --no-report`
from the Pulse repository root. The test executes the unchanged three consumer
cases on Node Native, Node JavaScript, Fastly Native with the local ABI host,
and Fastly JavaScript with provider emulation. No deployed service is involved.

The companion `catalog-router-methods` fixture expands coverage to all 14
formerly blocked Catalog operations without implementing domain behavior.
