# 05F validation and recovery checkpoint

05F (#447) is implemented on draft #442, remote branch
`codex/b10-call-proof-recovered`, local branch `codex/b10-mcp-05f`. It continues
`737e2d397185d410ca5add73ef911a3d25799134`; actual base remains
`8a51d705025c69ae306004215cb6cb48248d68e1`. No merge was performed.

## Source and terminal evidence

- Clean tested local implementation: `9bfd77fb6e97233c35af5f7ab56d8581d8808c6b`.
- Published implementation: `ea1a05720f874c1941187e6ced637ec3def756b6`.
- Identical full Git tree: `18b6f9ab0d49a39259eeebbeebaed76aacdb79f6`.

The connector supplies different commit metadata; every blob and the complete
uploaded tree match local Git. The following evidence/documentation commit changes
no runtime, provider, compiler or test implementation. It registers the test-only
receipt environment setting in its canonical documentation catalog and regenerates
the public/installed reference copies. Final delivery identity is on #442/#447/#436.

All ten selected runner tasks passed with terminal exit 0 and a complete atomic
report. The separate authored Router/MCP baseline replay also passed with exit 0.

| Check | Result |
| --- | --- |
| callable-lifetime | 114 successful request/recovery cases; 18 fault envelopes; six cumulative-deadline cases; two cumulative-allocation cases |
| callable-authored-javascript | 14 executions; four invalid-output rejections; ten source rejections; 20 ownership/lifetime checks |
| callable-authored-composition | Six Native executions; 16 source and 11 independent plan rejections |
| callable-authored-native | Eight executions; 12 rejections; unused-call compatibility |
| native-context-primitives; binary-resource-execution | Existing workspace/resource parity, bounds and ownership |
| request-budget-transport | Existing shared transport/request deadline containment |
| mcp-native-binding; mcp-http | 83 cross-target protocol cases and 114 HTTP/Node-host cases |
| suite-shape | 309 registered tasks |
| Separate callable-authored-routed baseline replay | 28 executions; 12 rejections; exact no-call/unused Wasm comparison |

The lifetime test compiles actual source without embedded resources. Calls of
1/2/16 sites, repeated fresh requests and early returns produce the expected
outputs. Every conversion/computation fault is followed by a successful fresh
request. Failed Native controllers reject start/resume and have no pending
invocations. Allocation exhaustion likewise fences the controller; memory growth
beyond the existing 4,096-page ceiling is rejected on both Native targets.

## Measured bounds

Charged bytes are conservative cumulative accounting, not live memory or RSS.
Four repeated fresh requests have identical measurements in each cell. Guest
linear-memory capacity remains constant across the 1/2/16-call fixtures.

| Entry / target | Charged bytes, 1 / 2 / 16 calls | Guest bytes | Node handles, 1 / 2 / 16 |
| --- | --- | ---: | --- |
| Router / Node Native | 14,420 / 21,896 / 126,562 | 1,245,184 | 27 / 31 / 87 |
| Router / injected Fastly | 3,396 / 5,150 / 29,706 | 2,621,440 | — |
| MCP / Node Native | 16,072 / 25,256 / 153,832 | 1,310,720 | 34 / 38 / 94 |
| MCP / injected Fastly | 5,772 / 7,736 / 35,232 | 2,621,440 | — |

The allocation fixture returns only a scalar. One call passes at 8,404,888 charged
bytes on Node and 8,393,416 on Fastly; the sixteen-site request fails before
completion at 62,983,330 and 62,934,954 charged bytes respectively, when the next
charge would exceed 64 MiB. Cleanup does not refund the budget. A fresh one-call
request returns to its original measurements. The existing fixed limits are not
replaced by a test-only smaller budget.

With the same clock progression, one call completes but a second call crosses
the original request deadline. Node Router retains its deadline error, Fastly
Router returns 504, and MCP returns its existing JSON-RPC 408 interruption envelope
on all three targets. [05F](./05F.md) records the other target-specific errors.

## No-call gate and failed attempts

Complete Wasm hashes, sizes and import tables match untouched `8a51d70`. No-call
source uses its complete project compiler; imported-unused call-free plans use
its backend because the baseline frontend rejects those imports. No identity
hash is stripped. Router remains 38,063 / 87,771 bytes (Node / Fastly); MCP remains
99,527 / 129,895. Used-call fixtures are 40,266 / 87,848 and 101,408 / 144,012 bytes.
The cleanup adds 28–30 used bytes relative to 05E and zero unused bytes.

Development attempts remain in `05f-validation/development/` and are not passing
qualification. Attempt 1 found missing Fastly guards for resource-free callables;
attempt 2 corrected the expected managed-input codec code (`DECODE`, not `ENCODE`);
attempt 3 exposed omitted Fastly request-budget instrumentation; attempt 4 corrected
the ordinary Fastly timeout expectation (504, not MCP's 408). Attempt 5 passed;
the final clean run adds controller/ceiling assertions and a source-bound receipt.
Initial documentation checks failed because the optional test receipt setting was
not cataloged; the evidence follow-up corrects and rechecks that omission.

Build, maintenance, documentation synchronization/check/release inventory and
protected-scope checks pass. Their receipts and the complete focused task logs
are retained in `05f-validation/`; large documentation inventory output remains
in `.pulse-development/05f/`. The runner left a generated request-deadline fixture;
its identified temporary directory was removed after terminal completion.

No check remains running and no 05F implementation blocker remains. Full profiles,
installed closure, Viceroy/deployed acceptance, real-corpus performance and sealing
remain deferred. Dependencies are the restored identical-lockfile graph, not a
fresh clean-install qualification. Next: **05G (#448), public contract/types and
diagnostics**, on the existing draft lineage. Merge, release, deployment and
self-approval remain human-owned.
