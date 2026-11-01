# Pulse beta.11 qualification

**Automated qualification passed** on 2026-11-01T12:27:45.398Z. Release PR: [#591](https://github.com/pulse-compute/pulse/pull/591).

| Gate | Result | Evidence |
| --- | --- | --- |
| Full release profile | 231/231 tasks passed | [Release run 41301460387](https://github.com/pulse-compute/pulse/actions/runs/41301460387) |
| Installed feature acceptance | 12/12 gates passed | Same complete seal and shared package bytes |
| Portable validation | 191/191 tasks, all 7 shards passed on attempt 1 | [Run 41301460273](https://github.com/pulse-compute/pulse/actions/runs/41301460273) |
| Maintainer scope and documentation | Passed | Current release head |
| Native event reuse and local K4 | Task acceptance and cleanup passed; source clean | [Exact-source supplemental run 41301552370](https://github.com/pulse-compute/pulse/actions/runs/41301552370) |
| Local Fastly reality and seal cleanup | Passed | Enforced by successful accepted capture |

The full profile passed event results/conformance, CLI report comparison, forwarding evidence/accounting and incoming-body forwarding. Native event reuse passed separately on the identical source. Five packed-corpus records matched all 20 package hashes from the supplemental run. Profile counts overlap; they are not a sum of unique tests.

## Frozen identity

- Main base: `e69e4b6f1381a05bf0ee0b9b4c6385d2acefb20c`
- Release head: `3817f027cee36f9503d35420a775afdf639af568`
- Tested merge candidate: `67c984d8dc223dd94d1146353534b12a89e0e50b`
- Tested tree: `77e58f4f93bf3f90d1f3390423218bc6d8a20462`
- Working tree: clean; producer checked current PR/main both before and after qualification.
- Version: `1.0.0-beta.11`, all 20 packages.

The evidence archive descends from the original tested merge commit and adds records only. It leaves the release PR unchanged. Publication must consume the original qualified source and accepted bundle, with the repository's merge binding verification; the archive commit is not a new release candidate.

## Accepted bytes and retained results

- [Accepted qualification and publication bundle](https://github.com/pulse-compute/pulse/actions/runs/41301460387/artifacts/13083118233), 3,448,798 bytes.
- Accepted artifact SHA-256: `2de79c3f72776cda7ca2d575c7e69dfbc55e8e418523d1c11ae74911d1496324`.
- [Complete terminal evidence](https://github.com/pulse-compute/pulse/actions/runs/41301460387/artifacts/13082873622), 22,804,933 bytes.
- [Machine-readable observation](beta11-qualification.json): all task names/results, source identities, package hashes, raw K4 semantics, artifact digests and prior attempts.
- [Producer receipt](beta11-qualification-receipt.json): reproduced from the authenticated candidate-job log. Original receipt and bundle bytes remain in the accepted artifact. The producer verified accepted bytes; this archive does not claim a separate local ZIP extraction.

The two release artifacts expire on December 1, 2026, under the workflow's 30-day retention. The receipt's documentation mode is source-only; no website promotion follows from this result.

## Qualification repairs

Release preparation synchronized version/date, dependency ranges, changelog, installed docs and the MCP corpus. Concrete qualification findings then required:

- Synchronizing the generated context README snippet and repairing the installed lifecycle guide link.
- Raising the composite Fastly capability task's finite budget from 300s to 600s after retained active-compiler evidence; the unchanged task completed in a bounded diagnostic and subsequent seals.
- Refreshing exact canonical Fastly measurements: capabilities **46,756 bytes**, opaque proxy **37,471 bytes**. Exact assertions remain.
- Giving the lifecycle control/observer trace comparison a fixed fixture clock.
- Giving real loopback reset/body-reset/stall checks a finite 2s transport budget while preserving exact error codes and one-attempt assertions. Injected cross-target timeout probes retain 20ms deadlines.
- Giving only Native-A a finite 30-minute CI job budget after two 20-minute cancellations with passing task progress. On the qualified source, all 52 Native-A tasks passed in **24.994 minutes**. Other shard budgets remain 20 minutes.

The 20 tarball hashes are identical across candidates 5 through 8. These later fixture/CI fixes added no runtime implementation. The fetch CPU-overhead baseline remains inconclusive; functional qualification adds no accounting or performance promise.

## Earlier attempts

Each earlier run retains its own source identity and result; none is pooled into this accepted seal.

| Candidate | Retained result | Finding |
| --- | --- | --- |
| 1 | [Failed](https://github.com/pulse-compute/pulse/actions/runs/41288907859) | Stale generated README snippet |
| 2 | [Failed](https://github.com/pulse-compute/pulse/actions/runs/41289031832) | Missing installed guide anchor |
| 3 | [Failed](https://github.com/pulse-compute/pulse/actions/runs/41289274197) | Composite capability task's 300s budget |
| 4 | [Failed](https://github.com/pulse-compute/pulse/actions/runs/41290863354) | 202 tasks passed; exact example-size assertion failed |
| 5 | [Failed](https://github.com/pulse-compute/pulse/actions/runs/41295218370) | 109 tasks passed; lifecycle fixture crossed an epoch-second boundary |
| 6 | [Superseded seal](https://github.com/pulse-compute/pulse/actions/runs/41297535031) | Portable real-reset assertion raced a 20ms deadline |
| 7 | [Superseded seal](https://github.com/pulse-compute/pulse/actions/runs/41298201566) | Native-A hit its 20-minute job ceiling twice |

The record also retains the prior candidate-4 supported same-source shard retry and the initial supplemental-launcher report-path failure. Temporary launcher PRs #592 and #593 are closed without merging.

## Separate release obligations

- Independent integrated review under **#508/item 07** remains pending.
- Current hosted-provider evidence or explicit support dispositions remain required, including **deployed Pulse cross-location KV**. Earlier hosted **#571** proof retains its original source identity.
- K4's raw semantic status remains **failed** for the documented Viceroy 0.21.1 missing-key CAS discrepancy. Existing October 4 human direction makes that local discrepancy non-blocking for task acceptance. Node Native and JavaScript semantics passed. Other failures and deployed cross-location acceptance remain required.
- The producer retains experimental `str03c-bounded-transforms` as workspace-only, with installed qualification pending.

#516 stays parked without a fresh product signal; #566 and #577 remain deferred. Merge, tagging, publication and deployment remain release-owner actions.
