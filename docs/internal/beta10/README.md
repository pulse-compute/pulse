# beta.10 release readiness

Prepared October 21, 2026 under the release owner's direction to close the
remaining capability evidence tickets and proceed to the next release task.
This authorizes release preparation and records the supplied evidence decisions.
Merge, tagging, publication and website promotion remain separate owner actions.

Preparation base: Pulse `latest` at
`cbfb9a8bc61b8b2dd64745b416af393b46b63f47`. This identifies the integrated input,
not a final qualified merge candidate or a sealed artifact.

## Prepared snapshot

All 20 catalog packages select `1.0.0-beta.10`, Beta channel, dated 2026-10-21.
The existing npm dist-tag remains `latest`. Package composition, supported
platforms, dependency policy, toolchain pins and public exports are unchanged
by preparation. Exact documentation links use `/v1.0.0-beta.10/`.

The canonical release preparer synchronizes package ranges, release metadata,
changelog, generated references and installed documentation. The context MCP
corpus is regenerated from current source with its existing deterministic
encoder and budgets. Source-dependent measurements must be taken again after
preparation; earlier beta.9-versioned builds are development evidence only.

The previous beta.9 product manifest is retained from exact tag
`v1.0.0-beta.9`, commit `fda16de1b3520c65cc62574878727e753ade850c`, with a content
digest in the documentation catalog. Website-managed history does not rebuild
historical HTML or establish hosted availability. Earlier history is preserved.

## Owner evidence decisions — October 21, 2026

The owner directed: “Stale should close and the capability ticks around dynamic,
kv and logs close. Human approved not getting the evidence quickly.”
The beta.10 closeout is recorded in the
[scope tracker #372](https://github.com/pulse-compute/pulse/issues/372) and
[qualification tracker #382](https://github.com/pulse-compute/pulse/issues/382).

| Evidence requirement | beta.10 disposition |
| --- | --- |
| Deployed stdout/log-tail proof (#309) | Owner accepts outstanding deployed evidence gap |
| Deployed dynamic-backend proof (#407) | Owner accepts outstanding deployed evidence gap |
| Named production logging destination proof (#467) | Owner accepts outstanding deployed evidence gap |
| Deployed KV list/delete proof (#468) | Owner accepts outstanding deployed evidence gap |
| Deployed Pulse cross-location conditional KV/CAS K4 | Owner accepts outstanding deployed evidence gap |
| Local K4 execution | Still required; retain raw semantics and the existing specific Viceroy missing-key discrepancy disposition |
| Other local/provider, installed-client, recovery, determinism and cleanup checks | Still required; unrelated failures are not covered |

These are beta.10 release-owner decisions, not inherited beta.6 exceptions,
semantic passes, test removal, a public-contract change or a permanent signoff
policy. Retain failed and not-run statuses and bind the final qualification
record to its actual source and artifacts. No final seal identity exists in
this preparation record. A future permanent signoff mechanism is separate work.

## Remaining qualification and release work

| Requirement | State and next action |
| --- | --- |
| Integrated product and documentation scope | Closed in #372; stale implementation tickets and the capability evidence tickets above are closed |
| Website source/import compatibility | Website #47 and #48 merged; #48 corrects adjacent anchor aliases and validates the current preview and retained beta.9 production build |
| beta.10 source snapshot | Prepared here; run maintainer, documentation, publication and release-PR checks on this diff |
| Exact main merge candidate | Pending #382: freeze base/head/merge/tree and run the authoritative qualification, required local K4 and installed/client acceptance |
| Dependency and supply-chain evidence | Pending final frozen-candidate audit/license refresh and policy-required dispositions |
| Private release settings and registry state | Owner verification remains separate; historical setup records are not fresh attestations |
| npm publication | Pending qualified review, merge, exact tag and protected publication consuming the accepted package bytes |
| Website release pin and promotion | Separate website task after the released source is known; refresh source-lock, version provenance, anchor baseline and retirement decisions, then run delivery validation |

A ready release PR into `main` starts the existing qualification workflow; a
draft preserves this preparation checkpoint. Any source change invalidates the
qualified candidate. Focused preparation checks cannot be pooled into a seal.
The v2 documentation receipt is source-only and cannot authorize the retired
Pulse website deployer. The website currently retains its beta.9 production pin;
the beta.10 version catalog alone does not promote it.

See the [machine preflight](../../../release/release-preflight.json),
[publishing runbook](../../maintainers/npm-publishing.md) and
[testing contract](../../maintainers/testing.md). Static proven gates express
source policy; pending final checks remain pending.
