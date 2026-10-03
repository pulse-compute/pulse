# STR-02B — Node Native incoming forwarding

Implements the second card in [STR-01](STR-01-body-stream-ownership.md) on
`beta` baseline `cf37f711139f9c3901423ee48b93123d45b0a388`, following merged
STR-02A. Human direction: “Implement STR-02B”. Fastly remains STR-02C.

## Contract and boundaries

The same inline `ctx.fetch(url, {method: 'POST', body: ctx.req.body()})`
source now compiles to Native. The optional `pulse_host.request_body() -> i32`
import returns an execution-local opaque marker handle. It never copies body
bytes into guest memory and is distinct from an invocation ticket. Existing
ABI v2 fields retain their meanings; older hosts reject the unfamiliar import.

Node provider configuration still requires `bodyForwarding.maxBytes` and
`maxDurationMs`. The provider owns lazy admission and the existing bounded pump.
The optional provider-driver `prepareNativeRequest` hook supplies request
metadata, ownership and disposal to the CLI without a provider-specific branch.
Only exact emitted Wasm executes forwarding applications. Group admission
precedes dispatch; normal invocation tickets fence late completion. Response
ownership survives guest completion until the HTTP writer finishes or cancels.

Native request text/JSON reads currently use synchronous host imports. A Native
application containing forwarding and structured request reads is rejected,
including reads on a separate route. JavaScript retains per-request exclusion
and permits separate read/forward routes. Supporting that mixed Native case
requires separate request-read lowering work; no empty-body or buffering
fallback is introduced. Multiple forwarding routes remain supported.

Shared compiler coordination inspected `latest` at
`cd0f20a0e9e7d2de01937ee4f6aba740cd6b7680`. Its unrelated code-generation
optimization was not merged or cherry-picked. This change adds only the marker
mapping to beta's generator and preserves beta's package-completion behavior.

## Reproducible acceptance

```bash
node wasm/scripts/run-wasm-tests.cjs --task str02b-node-native
node wasm/scripts/run-wasm-tests.cjs --task str02-installed --task str02b-installed
```

`str02b-node-native` uses ordinary project build and dev APIs, real HTTP and the
emitted Wasm hash. It proves first origin byte before client EOF; byte/hash
equality for 1, 16 and 64 MiB; constant 65,536-byte guest memory; denial without
reading; pre-dispatch group failure; forbidden headers; empty and abandoned
bodies; early response; non-replayed redirects; declared and measured limits;
disconnect recovery; post-header failure; and operation/total deadlines after
upload EOF. The same artifact's suspended invocation rejects a stale ticket
after closure. These observations do not bound platform buffers or process RSS.

The shared installed fixture runs each Node target from exact packed candidates
outside the checkout, with lifecycle scripts disabled. It verifies installed
file bytes before and after doctor/inspect/test/build/dev, rejects unsupported
source/configuration and Fastly forwarding, and forwards 64 MiB through real
HTTP. Native compares the emitted Wasm hash against test and dev execution
evidence and checks constant guest memory. Its unique reports under
`wasm/.test-results/str02-installed-*` record target, source/tree, dirty state,
package and installed-file hashes, command outcomes and HTTP evidence. Retries
retain separate reports. These gates are local Node acceptance, not a complete
publication replay or Fastly platform evidence.
