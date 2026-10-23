# HEX-04 — Packed qualification and report attribution

Implements [#512](https://github.com/pulse-compute/pulse/issues/512) on
`hex/04-packed-qualification`, targeting `hex-integration`. The unchanged baseline
is `dfd06b26bd087f4cac29509db7b499c85f9db2f6` (HEX-03 merged). Human direction:
“Implement HEX-04.” This pass does not merge, publish, deploy, activate a service,
promote `latest`, or change released support tiers.

## Scope and ownership

The CLI now retains selected host contributions from the provider's existing
Native manifest and audits the exact final Wasm against its import policy.
Reports carry package/contract/operation, contribution and policy IDs, source
location and generated-source digest, required protocol/service/target, artifact
identity, and distinct declared/observed signatures. This is build evidence only.
The report does not fabricate execution, a source fingerprint, or hosted proof.
The Assets & sizes view shows the records; comparison uses logical operation
identity and treats historical missing coverage as unknown.

The one-line `project-execution.js` plumbing passes the already returned provider
manifest path to the report owner. It does not change provider selection,
compilation, admission, or runtime lifecycle. Its conservative protected-path
classification is `runtime-target-fluidity`; human review remains required.
No provider or compiler implementation changes are included.

The author contract explains generic methods alongside explicitly different
host-specific methods, co-location and optional splitting, trusted build code,
protocol matching, unsupported-host errors, and terminal lifecycle limits.
Installed CLI documentation and report schemas/types are regenerated from their
canonical owners.

## Reproduction

Use a clean committed checkout and the lockfile-pinned dependency bundle. Pack
the base and candidate independently with `npm run build` followed by the owning
`scripts/pack-release.cjs` producer; these local tarballs are not npm publication.

```sh
node scripts/pack-release.cjs --out /tmp/hex04-candidate/packages
node wasm/test/provider/assert-host-extensions-installed.cjs \
  /tmp/hex04-candidate/packages /tmp/hex04-candidate/proof \
  /tmp/hex04-baseline/proof-2/proof.json
node docs/internal/host-extensions/probe-hex04-local.cjs \
  /tmp/hex04-candidate/proof /absolute/viceroy /absolute/pushpin-extraction \
  /tmp/hex04-candidate/local.json
```

The installed harness creates a consumer outside the checkout, installs exact
tarballs through a read-only loopback registry with lifecycle scripts disabled,
and compares every installed Pulse file to its archive before and after. Authored
code uses public imports and the declared installed CLI binary. It retains raw
Wasm, full imports, selected contribution/policy identities, reports, per-command
stdout/stderr, package/file hashes and an incremental terminal receipt. Each
command has a 180-second process-group watchdog. No installed package is edited.

The same source/config/CLI recipe builds absent-import, imported-unused,
generic-only, Fanout and WebSocket fixtures from the baseline and candidate.
“Absent” means no extension import or use; GRIP remains installed in that consumer.
Each fixture is compared with its own pinned baseline rather than assuming two
different authored files have equal hashes. Used-operation deltas are also
reported against the no-extension control.

## Qualification boundaries

| Lane | Claim |
| --- | --- |
| Packed Fastly Native | Both handoffs build using installed exports; report/import attribution retained |
| Packed generic GRIP | Builds on Fastly Native, Node Native, Node JS and Fastly JS |
| Unsupported targets | Both recognized handoffs reject on Node Native, Node JS and Fastly JS |
| Opaque JavaScript | Node executes both facade guards; this is not Fastly JS runtime execution |
| Injected lifecycle | Existing HEX-03 corpus; separate from local transport |
| Local Viceroy | Exact packed Wasm; ordinary branches, WebSocket HTTP handoff, upgrade and bidirectional frame |
| Local Pushpin | Attempted with pinned 1.42.0; environment availability is recorded separately |
| Hosted Fastly | Not run; no separately authorized execution window |

Local engines are Viceroy 0.18.0 and Pushpin 1.42.0. Pushpin's official Noble
archive SHA-256 is `d2e0b133f6e26b10e31ce7e31aae5ed9d1edf3c9757710ab886fda077931b0ef`.
It was extracted with dependencies rather than installing/activating a service.
The development attempt hit a ZeroMQ worker `Operation not permitted` startup
failure. The harness retains that failure and continues the independent Viceroy
lane, leaving Fanout hold/publish acceptance **not run**. It never substitutes a
mock proxy for Pushpin or treats an unavailable lane as passing.

Final candidate identities, terminal regression receipts, exact measurements and
the readiness decision belong in `hex04-validation.json` and the retained
`hex04-evidence/` bundle. Their absence means qualification is still in progress.
