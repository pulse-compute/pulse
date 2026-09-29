# STR-02A — Node JavaScript incoming forwarding

Implements the first sequential card in the merged
[STR-01 design](STR-01-body-stream-ownership.md), on `beta` baseline
`058e4b62f4cfa906f3b2cbc1daa66920fdd770fc`. Human direction: “Implement STR-02”.
Node Native (STR-02B) and Fastly feasibility/integration (STR-02C) remain separate
cards. No target fallback, deployment, package publication or Native ABI change
is included.

## Contract

The public form is `ctx.fetch(url, { method: 'POST', body: ctx.req.body() })`.
The marker is synchronous, opaque, execution-owned and single-use. Canonical
source rejects escaping/awaiting/duplicating it and combining it with structured
reads. Runtime ownership remains authoritative. Same-turn invalid admission
fences queued group dispatch. Provider capabilities still own network authority.

Node profiles explicitly opt in with `node.bodyForwarding.maxBytes` and
`node.maxDurationMs`. The request budget covers lazy admission through the local
response writer; a shorter fetch timeout survives response headers. Response
ownership is separate from upload ownership. Early origin replies cancel the
upload; redirects are rejected without replay. Post-header failures destroy the
downstream connection. Opted-in body-bearing requests close their connections to
avoid draining abandoned input indefinitely.

## Bounds and evidence

`str02-node-forwarding.cjs` uses real loopback HTTP and the ordinary provider
lifecycle. It verifies first origin byte before client EOF; SHA-256 and byte
equality at 1, 16 and 64 MiB; no read on denial; no dispatch on conflicting claims,
invalid grouped input, forbidden headers or read-then-forward; empty input; early
response; redirects; declared/measured overflow; deadline and disconnect
recovery; post-header origin failure; and post-header operation timeout.

| Storage term | Bound / observation |
| --- | --- |
| Pulse pump retained source queue, each direction | One chunk/backing allocation, at most 64 KiB; oversized allocations rejected |
| Pump read concurrency | One; gated source/sink probe confirms no read without demand and no next source read while retained bytes remain |
| Emitted in-flight chunk | At most 16 KiB, copied to avoid retaining a larger backing allocation |
| Node incoming transport | Configured readable high-water mark must be at most 64 KiB; reads at most 16 KiB |
| Loopback upload observed Pulse queue | 16 KiB for each of 1, 16 and 64 MiB inputs |
| Destination transport, OS/socket storage and RSS | Platform-owned; no total-memory or zero-copy claim |

The provider also disposes a response delivered after cancellation. Cleanup
does not wait for an uncooperative source's cancellation promise.

`str02-installed.cjs` packs current candidates, installs them in an external
consumer with lifecycle scripts disabled, and verifies every installed Pulse
file against its tarball before and after execution. It exercises the public
CLI's doctor/inspect/test/build/dev workflows; dev forwards 64 MiB through real
HTTP with origin receipt gated before EOF. Doctor's Native-ineligibility warning
is expected, with zero failed checks. Native, Fastly, missing opt-in and invalid
source forms are rejected through the installed CLI.

Run the focused gates with:

```bash
node wasm/scripts/run-wasm-tests.cjs --task canonical-opaque-node-emission --task str02-installed
```

Each installed run writes a unique report under `wasm/.test-results/str02-installed-*`.
Reports record source/tree and dirty-state identity, command outcomes, package
hashes, exact installed file identity, and HTTP results. Failed attempts remain
distinct from retries. These are Node local acceptance results, not Fastly
provider reality or a complete publication/release replay.

Shared compiler coordination: inspected `latest` at
`cd0f20a0e9e7d2de01937ee4f6aba740cd6b7680`; its four touched spine owners matched
this beta baseline. Changes stay on the isolated STR-02A branch; no cross-lane
merge or cherry-pick was performed.
