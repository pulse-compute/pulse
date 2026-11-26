# RC-H05 — RC1 release candidate

The release owner requested “Implement RC-H05” after merging RC-H04 (#615).
Prepare `1.0.0-rc.1` on the `rc` channel, with the existing twenty-package set,
support tiers, target eligibility and explicit `latest` npm dist-tag policy.
The RC label does not promote experimental interfaces or promise stable 1.0
compatibility. Publication, merge and tagging remain separate human actions.

The development input is `3688fd96a5d90731a757a089ffc37011ec0bf1d1`.
The release PR targets `main`; its exact clean merge candidate owns full CI and
`Release qualification`, including the aggregate seal and twelve separately
required installed feature gates. That workflow retains original source, tree,
base/head identities and accepted package hashes. A failed, incomplete or
untriggered gate remains a blocker. The PR is the live qualification ledger.

## Preparation

- Synchronize version/date, package ranges, display vocabulary and generated
  source/installed documentation through their canonical owners.
- Preserve beta.11's tagged manifest, published changelog and website-owned
  historical delivery metadata. Do not replace published beta.11 bytes.
- Admit the Release Candidate label only on the `rc` channel; continue rejecting
  mismatched labels and unknown channels. Preserve beta history validation.
- Keep S3 upload/list/delete, OpenAPI export, new timeout controls and other
  deferred features outside this release scope.

## Provider evidence boundary

RC-H04's local/deployed receipts remain under `../rc-h04/` with their original
source and package identities. Its 15-cell hosted terminal replay, 58-request
IAD/LHR KV corpus and 16-case live S3/fetch proof do not automatically qualify
newly versioned RC tarballs. The earlier unexplained held-response timeout also
remains visible. No new provider waiver is created by this release snapshot.

The dedicated installed local K4 gate must execute against the RC candidate;
only the pre-existing narrow Viceroy 0.21.0/0.21.1 missing-key discrepancy has
an owner disposition. Deployed RC identity requires fresh proof or an explicit
reviewed binding. The aggregate seal alone cannot close those separate gates.

## Release handoff

Review the PR's exact-source terminal CI and qualification artifacts before
merge. Retain the accepted qualification artifact, then bind the human-reviewed
main merge and exact tag through the existing release controller. npm publication
and website delivery remain separate protected operations. Do not tag or publish
from this preparation branch, and do not relabel old evidence as RC1 execution.
