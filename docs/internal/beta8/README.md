# beta.8 release readiness

Release Step 2, prepared October 12, 2026 under the release owner's direction:
“Proceed with Release step 2.” This authorizes the beta.8 identity, notes and
readiness snapshot. Merge, tagging, publication and deployment remain separate.

Preparation base: `latest` at `9a036e3a974251a75356e213570e139bd5a81066`,
including the merged [size-baseline correction #300](https://github.com/pulse-compute/pulse/pull/300).
This base and the preparation checks are not the final qualification identity.

## Applied snapshot

- All 20 catalog packages select `1.0.0-beta.8`, Beta channel, dated 2026-10-12.
  The existing npm dist-tag remains `latest`; no package, support tier, target,
  toolchain policy or public export is added by preparation.
- Exact docs use `/v1.0.0-beta.8/`. Package metadata, exact dependencies, release
  catalogs, diagnostic links, generated references and installed CLI copies are
  synchronized through the release preparation and documentation generators.
- The beta.7 archive is rebuilt from exact tag `v1.0.0-beta.7`, source
  `be650c7a98ce7f0602c737d9ea6c08e2a8fcc0eb`, using its frozen lockfile and tagged
  site builder. Earlier archives and published changelog entries are preserved.
- Node support remains `^22.14.0 || ^24.0.0`; release execution accepts the Node
  24 line, with reproducible pins Node 24.18.0, npm 11.15.0 and pnpm 12.4.2.
  Local preparation on Node 24.19.0 does not claim use of that exact Node pin.
- Apache-2.0 and the exact root LICENSE/NOTICE policy remain unchanged.

The [changelog](../../../CHANGELOG.md) inventories the merged report, UI/build
metadata, manual performance, opt-in cache-arena, Fastly correctness and release
workflow work. It describes only the integrated scope: report comparison has an
internal shared result and HTML renderer; public CLI/MCP adapters are not yet
integrated. Containing-body observations are not exclusive route sizes.

## Readiness ledger

| Requirement | Status | Evidence or next action |
| --- | --- | --- |
| beta.8 version, package set, notes and generated references | prepared | Validate preflight, docs, publication controls and the version-change contract on this preparation diff |
| Published documentation and changelog history | preserved | beta.7 archive comes from its exact tag; beta.6 and older archive bytes and released notes are unchanged |
| Release gate stabilization | merged | [Pass 1 #298](https://github.com/pulse-compute/pulse/pull/298), [Pass 2 #299](https://github.com/pulse-compute/pulse/pull/299); no reduced coverage or wider resume admission |
| Fastly example size failures | resolved on preparation base | #300: 59/59 unit and 34/34 CLI, with both exact default/optimized provider baselines measured; these beta.7-versioned development results are not beta.8 seal evidence |
| beta.8 conditional KV/CAS evidence or disposition | local accepted; deployed still blocking | Step 3 local K4 retained only the already-dispositioned missing-key CAS discrepancy; deployed Pulse cross-location proof or an explicit beta.8 owner disposition is still required |
| tick Combined Acceptance against beta.8 packages | passed on Step 3 packed candidate | 10/10 injected Native ABI, 14/14 receiver HTTP and 10/10 strict dispatch HTTP; all 20 beta.8 package hashes match K4. Bind or replay against the final qualification artifacts before making a final release claim |
| Required main qualification gate and protected settings | owner verification pending | Confirm the stable qualification gate is required and the existing publication/deployment environments are configured; this PR changes no settings |
| Frozen candidate, complete seal and installed acceptance | pending | Open the prepared release PR into main and qualify its exact merge candidate, including mandatory Fastly CLI reality and cleanup |
| Production advisory and license closure | pending | Refresh the existing final-seal reports; retain and resolve policy-required findings/dispositions |
| npm publication and registry/context smoke | pending | After qualified review, merge and exact tag, consume the accepted package bytes; verify registry integrity, configured dist-tag and installed smoke |
| Hosted docs deployment and public verification | pending | Consume the retained docs candidate after the npm gate; verify immutable objects, promotion, purge and public routes |

The [machine preflight](../../../release/release-preflight.json) records stage
policy; its static proven gates do not establish final candidate readiness.
The historical beta.7 ledger stays historical rather than being relabeled as
beta.8 evidence. No prior setup attestation is promoted to fresh private-settings
verification here.

## Step 3 acceptance — October 12, 2026

The release owner's “Proceed with Release step 3” authorizes this acceptance
replay, the bounded K4 harness repair and this evidence record. It supplies no
new release exception. The [machine record](./acceptance-evidence.json) retains
raw K4 results, terminal reports, tick cases, exact package/module hashes and the
remaining blocking disposition.

The merged preparation is `ba24253883e04aa99bfec770e72b0d9795704e65`.
Acceptance ran on local commit `56b75180b63c8554c48f2ae35b1b3ae4a316ecda`, tree
`ddadcf75872cfb8fe77a7fa70755f0ce29580406`, with no tracked edits during those
runs. Its only source delta is the repository-only K4 harness repair: the local
acceptance predicate now requires the count from the verified candidate pack,
rather than the historical constant 19. Tests cover both 19- and 20-package
inputs, missing/invalid/mismatched counts, and continued rejection of unrelated
failures. No CAS assertion or exception is widened.

All 20 packages are `1.0.0-beta.8`. The retained packed-manifest SHA-256 is
`f026c12c30f8627d76c7708d3b48d3d8a4b28601829b87fcb7c8d8cd16d8e617`.
The same tarballs fed K4 and tick; both verified installed package bytes before
and after execution, without workspace product links. The ledger/evidence
commit follows the tested source and is not itself a final qualified candidate.

- **K4:** the dedicated task completed with passing cleanup and its existing
  `accepted-with-known-viceroy-discrepancy` disposition. Raw semantics remain
  `failed`: Viceroy 0.21.1 stores missing-key CAS where the contract requires
  conflict. This is the exact October 4 non-blocking observation. Node Native
  and JavaScript passed; the three targets each executed 171 scenario requests
  across widths 2, 8 and 16. No multi-winner failure occurred in this run.
  Public types, isolation and installed-byte checks passed, as did the 78 K2
  target scenarios and 209 injected Fastly ABI cases. The retained K4 module is
  `a92dcefd38bbd54edc1e4a288bba73e8a13960a40b8f1ef66645c957080cffc7`.
- **tick:** the tested source tree exactly matches merged
  [fastly-tick #20](https://github.com/pulse-compute/fastly-tick/pull/20), main
  `24ef2132faad7f5691f7a2ce342e3810d4005c20`. All six acceptance steps passed:
  install, receiver/worker builds, 10/10 actual-Native injected ABI cases,
  14/14 receiver Viceroy HTTP cases and 10/10 strict dispatch HTTP cases.
  Delayed headers returned healthy/unacknowledged at 1029 ms; reset at 4 ms.
  Shipping dispatch and dependency pins remain unchanged. This is local
  development acceptance, not deployed Fastly qualification.
- **Toolchain/retry:** Node 24.19.0, npm 11.9.0, pnpm 12.4.2 and direct
  Viceroy 0.21.1 were used. The first K4 attempt stopped before packing when
  pnpm attempted dependency-build approval. Its report is retained; the retry
  used `npm_config_ignore_scripts=true` and completed. No dependency build
  approval was granted. This does not claim the exact release Node/npm pins
  or the final mandatory Fastly CLI reality lane.

**Remaining release blocker:** deployed Pulse cross-location K4 is `not-run`.
No reviewed isolated T2 environment/probe driver was available. The release
owner must supply the reviewed service/version, KV binding, exact Native module
identity, authenticated writes and independently located probes described in
[K4](../../../wasm/test/kv/K4.md), or explicitly disposition this beta.8
candidate's deployed requirement. The beta.6-only exception does not apply.
No new disposition, provisioning, activation or deployment is recorded here.

The complete seal, installed release acceptance, advisory/license refresh,
private settings verification and release actions remain outstanding. Step 4
must qualify the exact main PR merge candidate and reconcile final package
hashes with this record; source changes invalidate qualification. These focused
reports cannot be pooled into the authoritative seal.

## Remaining acceptance and release sequence

Step 3 owns final-candidate acceptance and explicit dispositions. The documented
Viceroy 0.21.0/0.21.1 missing-key CAS discrepancy retains its existing non-blocking
direction and raw result requirement. The broader beta.6 multi-winner/deployed
exception applies only to its named candidate; it is not inherited by beta.8.
See [K4](../../../wasm/test/kv/K4.md) and the
[release acceptance contract](../../maintainers/release-acceptance.md).
This snapshot supplies no new exception and claims no semantic pass.

Step 4 freezes the prepared source and runs one authoritative qualification on
the release PR into main. Capture the exact base/head/merge/tree identities,
terminal full-coverage reports, accepted tarballs and documentation candidate.
Any source change invalidates that qualification. Resume only through the
existing verified same-candidate/checkout checkpoints; partial development
reports cannot be pooled into the seal.

Once this snapshot lands, do not rerun version preparation for beta.8: it is
already applied. Use the reviewed prepared source for the main release PR.
After review and merge, tag the final main source and let publication consume
its eligible pre-main qualification. Follow the current
[publishing runbook](../../maintainers/npm-publishing.md) and
[testing guide](../../maintainers/testing.md); do not use the historical beta.7
post-main sealing sequence.

This preparation adds no performance campaign, provider capability, website
cutover, public comparison adapter or scalar-retention optimization. The
[report attribution closeout](../rpt8-12/README.md#beta8-attribution-closeout)
continues to defer deeper attribution integration.
