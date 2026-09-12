# Catalog mutation routing acceptance (V2)

`operations.json` freezes the method, path and operation ID of every PUT,
PATCH and DELETE operation in the Catalog foundation's existing HTTP contract.
It records the SHA-256 of the original `contracts/http/contract.json` bytes.
The subset is 3 PATCH, 5 PUT and 6 DELETE operations. It is evidence from
`catalog-platform-foundation-v0.4.0.zip`, not a new Catalog API authority.

The static application preserves those exact full paths through a mounted
`Router`. Each evidence handler returns its operation ID, method, named
parameters, request body and middleware state. Responses deliberately exercise
routing rather than implement the business contract, storage or authorization.

The shared harness has 68 cases: 14 original method/path operations, 42
GET/POST/OPTIONS method misses, and 12 ordered-route cases (first match,
terminal fallthrough, 404 exhaustion and handled error for each new verb).
The separate `catalog-router-probe` retains the original three-case consumer.

Run from the Pulse repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task catalog-router-parity --no-report
```

The gate compares expected responses and cross-target status/header/body
semantics for all 71 cases: 284 executions across Node Native, Node JavaScript,
Fastly Native and Fastly JavaScript. Native means executing compiled Wasm;
Fastly Native uses its target ABI through the existing mock host. JavaScript
uses the graph-loaded original application and each provider's test runtime.
The Fastly JavaScript lane is provider emulation. Target selection is explicit;
the test rejects target fallback. This is local evidence, not deployment or
packed-consumer acceptance. Full Catalog migration and storage remain later
workstreams.
