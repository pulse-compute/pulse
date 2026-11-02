# beta.11 integrated host-contract review

Technical review complete; no actionable production defect found. Formal independent sign-off remains pending.

## Candidate and evidence boundary

- Release PR: [#591](https://github.com/pulse-compute/pulse/pull/591).
- Reviewed/tested merge candidate: `67c984d8dc223dd94d1146353534b12a89e0e50b`.
- PR head: `3817f027cee36f9503d35420a775afdf639af568`.
- Source tree: `77e58f4f93bf3f90d1f3390423218bc6d8a20462`.
- All 3,749 tracked files reconstructed and Git-blob-verified against the complete GitHub tree before and after focused checks; zero source mismatches.
- Recovered snapshot has no working Git metadata. Its explicit identity is `verified-git-tree-snapshot`, not a clean checkout or new release seal.
- No tracked product source was changed during this review.

The reviewer prepared earlier qualification fixture/CI fixes. This pass does not independently approve those changes, submit a GitHub approval, or substitute for a separate reviewer's acceptance of #508 item 07.

## Review results

| Boundary | Result and limits |
| --- | --- |
| Contribution and admission | Descriptor-safe plain-data and dense-array validation, selected trusted-manifest ownership, exact target/service selection and deterministic admission reviewed. Trusted lowerers are build dependencies; no sandbox or package/version registry claim. |
| Import ceiling and binary audit | Complete provider baseline plus admitted contributions is established before observed imports. Exact function signatures and final Wasm bytes are audited, including the original provider audit. |
| Terminal authority | Driver authority changes to unknown before the host call, to transferred only on success. Error/trap leaves authority unknown and does not authorize a replacement response or retry. |
| Settlement, deadlines and cleanup | Private ticket/token checks precede consumption. Raw, stale, duplicate and closed settlement is blocked. Handles are retired before close, cleanup occurs once, and the first error is preserved. Unknown host-handle disposition is left to host teardown; no trap-finalizer guarantee. |
| Router | One direct terminal effect with a bounded static backend. Only documented bounded placements and text siblings are admitted. Middleware, error, parallel, helper, dynamic-backend and guest compositions remain rejected. |
| Report and compare | Artifact/hash/import-signature identities and declared lifecycle points retained. Missing historical/runtime evidence remains unknown. Bounded diagnostics do not expose source/backend payloads. |
| Author guidance and support | Canonical contract and GRIP guidance agree with implementation. Terminal APIs remain on the experimental subpath; JavaScript explicitly rejects unsupported execution. No support-tier promotion. |
| Hosted receipts | Build/local results are separate from hosted acceptance. Original #571 receipts retain their original candidate identity and are not relabeled beta.11. |

Reviewed file identities (Git blob SHA-1 and content SHA-256) are in [the machine-readable record](beta11-integrated-review.json).

## Focused verification

| Check | Result |
| --- | --- |
| Host-extension schema/ownership/selection/import contract | 92 cases passed, including independently named/versioned packages |
| Provider toolchain boundary | Passed |
| Compiled lifecycle and host-terminal adapters | Passed: 27 lifecycle cases and 19 terminal-adapter groups |
| Bounded Router terminal placements | 27 checks passed |
| Report/compare host-extension evidence | 14 checks passed |
| Maintainer control plane | Passed |
| Local K4 qualification gates | Passed; fixture evidence only, not a deployed cross-location result |

The first registered four-task attempt failed at lifecycle compilation because a recovered AssemblyScript dependency link was missing; provider-toolchain passed and the final two tasks did not run. Existing dependency links were restored without tracked source edits. That report stays failed. A subsequent complete three-task compiled selection passed with cleanup. Both reports and their task logs are retained; they are not pooled into a release seal.

The accepted existing exact-candidate release run remains [41301460387](https://github.com/pulse-compute/pulse/actions/runs/41301460387): 231 release tasks and 12 installed feature gates passed. Portable run [41301460273](https://github.com/pulse-compute/pulse/actions/runs/41301460273) passed 191 tasks. See [final qualification receipt](beta11-qualification-receipt.json) and [qualification evidence](beta11-qualification.md). This review neither alters nor supersedes that seal.

## Remaining acceptance

1. A separate independent reviewer must accept the integrated contract and the qualification/CI changes. This record is the prepared technical packet, not that approval.
2. Current hosted-provider proof or explicit candidate-specific owner disposition is still required. [Concrete hosted handoff](beta11-hosted-qualification.md) identifies the inputs and acceptance conditions. No new live requests or deployments were made in this review.
3. Merge, tag, protected publishing approval and publication have not occurred. #516 remains parked; #566/#577 remain deferred.
