# B6-07: atomic beta.6 release preparation

The user requested **Proceed with B6-07** on October 4, 2026. Entry point:
`documentation-release`. The manifest's reviewed version allowlist additionally
owns CLI diagnostics/configuration identities, guest-link version pins and crypto
guest provenance. The private MCP example's three public-package dependency pins
are included in the snapshot; MCP itself remains private at 0.0.0.

## Snapshot

The preparation command advanced the unchanged 19-package set to
`1.0.0-beta.6`, with Beta label, beta channel and candidate date `2026-10-04`.
It updated 54 exact dependency references, followed by three private-example
references, and synchronized the frozen lockfile and all named generators.
The reviewed npm `latest` dist-tag and other publication/deployment policy are
unchanged. Unreleased notes moved into the beta.6 changelog section; the beta.5
and older published notes remain byte-identical.

```sh
node scripts/release-prepare.cjs 1.0.0-beta.6 --channel beta \
  --date 2026-10-04 --replace-unpublished-docs
```

The beta.5 hosted-documentation exception preserves its source tag/commit,
npm history and exact-link policy. It omits beta.5 from the hosted selector
without creating an archive or redirect. All four existing archive trees and
their 407 built files compare byte-for-byte. No remote storage state is inferred
from these local checks. The version-owned crypto guest reconstruction script,
manifest and trusted pin are synchronized; its artifact hash and ABI are unchanged.

## Release ancestry

B6-06 merged as `4aa5d3de9fbd2429ed3331522f6cca18aa6a58f1` and its final CI
passed. B6-02's squash commit preserved content while omitting the second parent.
A fresh comparison found stable patch-ID equivalents in latest for all 23
main-only commits. Reconciliation commit
`2ed012d91797eb231a0711b922ca27201f2af67f` retains both main
`91cc3145e7ad4bec5d94c228d95016b0f77d04fd` and latest, with latest's tree
`0f7ba7042ba39fad58a166ef335f5fceecacd090` unchanged.

The snapshot is clean commit `ee62a2068b4a1574a5f7af27b19915829d8e15be`, tree
`9f6eead1da12ecbdb91462adeecf2f3df47ac8cf`. It targets main using the existing
release route in [draft PR #185](https://github.com/pulse-compute/pulse/pull/185).
Main is an ancestor on this branch. Reconcile the final main release into latest
with both parents retained after release; no integration/release ref is moved by
this preparation.

## Validation

[validation.json](validation.json) records preparation, both ancestry parents,
all patch-ID pairs, immutable archive file-set hashes, remaining historical
version-token dispositions and terminal test reports. Evidence is added after
the tested snapshot; it does not constitute a release seal.

- Frozen lifecycle-disabled dependency install and TypeScript build passed.
- Maintainer, documentation, documentation-release, publication, preflight and
  main/latest scope checks passed.
- Release-PR checks passed against main and latest: prepared, **not sealed**.
- All 40 unit tasks and three guest-link tasks passed on the clean snapshot.
- The full CLI profile failed at a pre-existing middleware body-count assertion,
  reproduced on detached pre-snapshot latest. See the
  [precise blocker](CLI-DOCTOR-BLOCKER.md). All 20 remaining CLI tasks passed and are recorded
  separately; partial/resumed reports are not pooled into a passing profile.

B6-07's atomic snapshot is prepared and reviewable. The draft remains open while
the existing CLI mismatch is resolved and B6-08 supplies the complete clean
beta.6 release replay, packed feature/provider/K4 gates and exact artifact seal.
The known Viceroy missing-key CAS discrepancy retains B6-06's authorized
non-blocking disposition; other failures still block. Deployed Pulse cross-location
K4 proof and B6-04's historical populated beta.5 guest-cache qualification remain
outstanding. Tag push, package publication, documentation promotion and deployment
remain separate human actions.
