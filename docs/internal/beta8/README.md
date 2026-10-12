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
| beta.8 conditional KV/CAS evidence or disposition | pending, required before release | Dedicated local K4 and deployed Pulse cross-location requirements remain explicit; preserve raw failed/not-run status and bind any owner disposition to the final candidate |
| tick Combined Acceptance against final beta.8 packages | pending for a beta.8 compatibility claim | [fastly-tick #20](https://github.com/pulse-compute/fastly-tick/pull/20) is development acceptance against an earlier beta.7-versioned package set; rerun the focused app acceptance against final packed beta.8 bytes |
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
