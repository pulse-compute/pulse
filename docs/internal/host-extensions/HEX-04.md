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

## Retained qualification

The product candidate was built and tested at local commit
`69e0d59771d8c8664524da5af1f72613e6e64048`, tree
`34034e5d429d6795f29113c51a83b56ba99bada1`. The published implementation commit
`10797ad76f5cfb74a0027eae27df54e7498e0783` has that exact tree; only Git commit
metadata differs. The evidence includes the local commit object and the
blob/tree equivalence receipt. The follow-up records evidence and makes the
local WebSocket probe reject premature peer closure; that harness-only fix was
checked with an early-close negative case and rerun against the same packed
artifacts. No package payload was changed by the follow-up.

| Installed Fastly Native fixture | Bytes | Delta from its pinned baseline | Delta from absent import |
| --- | ---: | ---: | ---: |
| Absent import | 23,444 | 0 | 0 |
| Imported but unused | 23,444 | 0 | 0 |
| Generic GRIP | 25,268 | 0 | +1,824 |
| Fanout | 27,305 | 0 | +3,861 |
| WebSocket | 27,310 | 0 | +3,866 |

All five artifacts are byte-for-byte identical to their corresponding baseline,
including imports. The three controls have ten imports and no selected extension;
each used fixture has thirteen imports and one selected contribution. Raw Wasm,
complete hashes, manifests/policies, installed-file inventories, command logs and
reports are retained. The compatibility matrix includes both static target
rejections on all three unsupported targets and the separate opaque Node JS
facade guard.

The regression selection contains 199 distinct tasks from unit, CLI, Native,
JavaScript and conformance profiles plus the handoff proof. Every task has a
passing result across the retained development runs. The first run completed
30 passes and one `release-recovery` checkpoint-retention failure; that test
passed an isolated unchanged-source retry. A subsequent run completed 49 tasks
before the execution service disconnected and changed executor identity. Its
original incomplete receipt is retained with an external-interruption record.
The next run starts at the unfinished documentation task, completes another
53 passes, then encounters a `pulse-context-tools` setup collision: leftover
example dependency links from the interrupted execution were copied and then
created again (`EEXIST`). Those task-owned links/outputs were preserved outside
the checkout, without source edits. The final run starts at that failed task
and completes all remaining 66 tasks. These manually combined results are not an uninterrupted
release-controller run or a release seal. The initial retention failure's root
cause remains unresolved.

Local Viceroy passes four cases on the packed artifacts: each handoff's ordinary
branch, WebSocket HTTP handoff, and upgrade with a bidirectional frame. The
Pushpin worker could not start, so Fanout GRIP hold/publish is **not run**. Hosted
entitlement, service identity and live behavior are also **not run**. Injected
lifecycle assertions remain separately identified in the handoff-proof task log.

The comparison examples show an extension addition, Fanout-to-WebSocket
replacement (one removal and one addition, net zero), and historical missing
attribution (unknown coverage, no invented addition). Source fingerprints remain
null and build reports contain no fabricated test evidence.

See [the validation ledger](./hex04-validation.json) and
[archive index](./hex04-evidence-index.json). The
[evidence archive](./hex04-evidence.tar.gz) preserves each indexed file's exact
bytes, including failed attempts. Extract it outside the checkout:

```sh
mkdir -p /tmp/hex04-review
tar -xzf docs/internal/host-extensions/hex04-evidence.tar.gz -C /tmp/hex04-review
```

Ledger paths beginning `hex04-evidence/` refer to that extracted root. Raw runner
receipts retain their original absolute log paths; the same files are under the
corresponding `regressions/<attempt>/` directory in the archive. Archive and file
SHA-256 identities are checked in the ledger/index.

HEX-04 is ready for review against `hex-integration`. This is not authorization
to merge or promote `latest`, and it does not waive missing local/hosted acceptance
or promote provisional methods to released support.
