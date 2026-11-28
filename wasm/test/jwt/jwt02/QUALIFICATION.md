# JWT-02.3 — installed Native composition acceptance

Run the focused acceptance from a clean committed checkout with the pinned
Node and dependency toolchain:

```sh
node wasm/scripts/run-wasm-tests.cjs --task stab03-installed --task jwt-installed-workflow --task cli-stab05-compiler-replay --report /absolute/new/report.json
```

`stab03-installed` packs the candidate and installs all exact tarballs outside
the checkout, with install scripts disabled. Every installed Pulse file is
compared against the tarballs before and after execution. The isolated worker
loads product modules only from that installation; the only checkout imports
allowed are the Fastly ABI fixture and its storage/transport models. The receipt
binds candidate commit/tree, harness hashes, all package SHA-256 values, final
artifacts and case results. A blocked Native cell fails acceptance.

| Installed matrix | Node Native | Fastly Native |
| --- | --- | --- |
| RS256 baseline | Independent token verification | Independent token verification |
| RS256 + MAC text | Signature and valid/invalid proof | Signature and valid/invalid proof |
| RS256 + schema only | Signature and valid/invalid schema | Signature and valid/invalid schema |
| RS256 + MAC text + schema | All three; deterministic rebuild | All three; deterministic rebuild |
| ES256 and RS256 + SHA-256 | Verification, digest vectors, signing | Verification, digest vectors, signing |
| ES256 and RS256 + HMAC | Verification, HMAC issuance, signing | Verification, HMAC issuance, signing |
| ES256 and RS256 + S3 | Verification, signed object read, signing | Verification, signed object read, signing |
| Generic consumer | All 29 cases | All 29 cases |

The generic consumer also retains its 29-case Node JavaScript comparison. Each
matrix cell builds through the installed ordinary project workflow. Node's
emitted artifact must equal the bytes passed to its installed execution adapter;
Fastly executes `bin/main.wasm`. Each final artifact is inspected for fixed
32-page memory, no implicit start, no growth, retained layout witness and MVP
compatibility. The production build's strict linker/import audit remains active.

Independent Node crypto verifies emitted signatures, SHA-256/HMAC results and
actual outbound SigV4 requests. Invalid signatures cannot dispatch S3 requests.
Malformed signing keys, invalid MACs/schemas, cancellation before execution and
S3 cancellation after dispatch are followed by healthy requests to check
request isolation. Default traces and retained artifacts exclude private keys,
tokens and fixture secrets. The installed Node crypto bridge also checks 2 MiB
digest staging and zeroed owned frames after success and injected failure, with
failed-bridge reuse rejected. The JWT workflow retains rotation, CLI/dev and
package/provider temporary-buffer cleanup coverage across all four targets.

`cli-stab05-compiler-replay` retains its unrelated diagnostic corpus; its three
historically blocked build controls now require success. Historical JWT-02.1
and STAB-03 receipts are not rewritten. Fresh terminal reports, rather than
this test definition, establish which exact candidate passed.

These are local installed acceptance tests, not an aggregate release seal.
Fastly uses injected ABI behavior, not Viceroy or deployed infrastructure.
Terminal guest traps require disposal and do not imply whole-memory erasure.
The 2 MiB memory limit remains unchanged. Fastly JavaScript S3 and dual-algorithm
Fastly Native verification remain ineligible. No package publication, provider
activation, consumer pin change or application-specific qualification follows
from this generic proof.
