Run from the repository root:

- `node wasm/test/s3/run-native-read-acceptance.cjs`: O2 read regression, 65 cases
  on Node Native and Fastly Native.
- `node wasm/test/s3/run-write-acceptance.cjs`: O3 canonical PUT/HEAD/GET on Node
  Native, Node JavaScript and Fastly Native; exact bytes, signature oracle,
  ambiguous acknowledgements, bounded errors and cancellation.
- `node wasm/test/s3/assert-s3-write-contract.cjs`: PUT lowering and Crypto
  JavaScript primitive bounds, vectors, snapshots and cleanup.
- `node wasm/test/s3/assert-node-transport.cjs`: local TLS byte/header evidence.

Fastly Native executes real compiled Wasm against host ABI fixtures. These are
local conformance checks, not live Object Storage acceptance. Fastly JavaScript
is excluded for the documented SDK limitation in `wasm/test/s3/O3.md`.
Published consumer acceptance belongs to O4.
